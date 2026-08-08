(function() {
  'use strict';

  // 防止重复注入
  if (window.__quizHelperInjected || document.documentElement.hasAttribute('data-quiz-helper-injected')) return;
  window.__quizHelperInjected = true;
  document.documentElement.setAttribute('data-quiz-helper-injected', 'true');

  const state = globalThis.QuizHelperContentState;
  const { normalizeShortcutConfig, shortcutMatches, getDefaultShortcut } = globalThis.QuizHelperShortcutUtils;
  const { isDomainMatch } = globalThis.QuizHelperTextUtils;

  // ===== 初始化 =====

  loadPanelShortcut();
  loadThemeMode();
  ensureDefaultRules();
  chrome.storage.onChanged.addListener(handleStorageChange);
  document.addEventListener('keydown', handleGlobalShortcut, true);

  // ===== 主题管理 =====

  async function loadThemeMode() {
    const config = await chrome.storage.local.get(['theme_mode']);
    state.themeMode = config.theme_mode || 'system';
    updateDarkMode();
  }

  function updateDarkMode() {
    if (state.themeMode === 'dark') {
      state.isDarkMode = true;
    } else if (state.themeMode === 'light') {
      state.isDarkMode = false;
    } else {
      state.isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    globalThis.QuizHelperPanelUI.applyTheme();
  }

  // ===== 工具函数 =====

  async function loadPanelShortcut() {
    const config = await chrome.storage.local.get(['panel_shortcut']);
    state.panelShortcut = config.panel_shortcut === null
      ? null
      : normalizeShortcutConfig(config.panel_shortcut) || getDefaultShortcut();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'local') return;
    if (changes.panel_shortcut) {
      const newValue = changes.panel_shortcut.newValue;
      state.panelShortcut = newValue === null
        ? null
        : normalizeShortcutConfig(newValue) || getDefaultShortcut();
    }
    if (changes.theme_mode) {
      state.themeMode = changes.theme_mode.newValue || 'system';
      updateDarkMode();
    }
    if (changes.active_model_id || changes.llm_models) {
      globalThis.QuizHelperPanelUI.refreshModelNameDisplay();
    }
  }

  function isEditableTarget(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return false;

    if (element.matches('input, textarea, select, [contenteditable="true"]')) {
      return true;
    }

    return !!element.closest('input, textarea, select, [contenteditable="true"]');
  }

  async function handleGlobalShortcut(event) {
    if (event.repeat) return;
    if (state.pickerState) return;
    if (!shortcutMatches(event, state.panelShortcut)) return;
    if (isEditableTarget(event.target)) return;

    const allowed = await checkDomainAllowed();
    if (!allowed) return;

    event.preventDefault();
    event.stopPropagation();
    await togglePanelVisibility();
  }

  async function togglePanelVisibility() {
    if (state.panelElement && state.shadowRoot) {
      if (state.panelElement.style.display === 'none') {
        globalThis.QuizHelperPanelUI.restorePanel();
      } else {
        globalThis.QuizHelperPanelUI.removePanel();
      }
      return;
    }

    if (state.isStarting) return;
    state.isStarting = true;
    try {
      await startAnalysis();
    } finally {
      state.isStarting = false;
    }
  }

  /**
   * 检查当前域名是否在白名单中
   * @returns {Promise<boolean>}
   */
  async function checkDomainAllowed() {
    const config = await chrome.storage.local.get(['allowed_domains']);
    const domains = config.allowed_domains || [];
    if (domains.length === 0) return true;
    const hostname = location.hostname;
    return domains.some(domain => isDomainMatch(hostname, domain));
  }

  // ===== 解析规则管理 =====

  /**
   * 获取当前域名对应的解析规则
   * @returns {Promise<Object|null>}
   */
  async function getDomainRule() {
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    const hostname = location.hostname;
    return rules.find(r => isDomainMatch(hostname, r.domain)) || null;
  }

  /**
   * 保存或更新解析规则（按域名去重）
   * @param {Object} rule
   */
  async function saveParseRule(rule) {
    const { safeSet } = globalThis.QuizHelperStorageUtils;
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    const existingIdx = rules.findIndex(r => r.domain === rule.domain);
    if (existingIdx >= 0) {
      rules[existingIdx] = { ...rules[existingIdx], ...rule, lastUsed: Date.now() };
    } else {
      rule.lastUsed = Date.now();
      rules.push(rule);
    }
    await safeSet({ parse_rules: rules });
    state.currentRule = rules[existingIdx >= 0 ? existingIdx : rules.length - 1] || rule;
  }

  /**
   * 增加规则使用次数
   * @param {Object} rule
   */
  async function incrementRuleUseCount(rule) {
    if (!rule || !rule.domain) return;
    const { safeSet } = globalThis.QuizHelperStorageUtils;
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    const idx = rules.findIndex(r => r.domain === rule.domain);
    if (idx >= 0) {
      rules[idx].useCount = (rules[idx].useCount || 0) + 1;
      rules[idx].lastUsed = Date.now();
      await safeSet({ parse_rules: rules });
      state.currentRule = rules[idx];
    }
  }

  /**
   * 确保默认规则（example.com）已入库
   * 与设置页 ensureDefaultParseRuleSeeded 保持一致：以种子标记 + 规则存在性共同判定
   */
  async function ensureDefaultRules() {
    const { safeSet } = globalThis.QuizHelperStorageUtils;
    if (!state.defaultRuleSeedPromise) {
      state.defaultRuleSeedPromise = fetch(chrome.runtime.getURL('data/default-parse-rule.json')).then(async res => {
        if (!res.ok) {
          throw new Error(`加载默认解析规则失败: ${res.status}`);
        }
        return res.json();
      });
    }

    const result = await chrome.storage.local.get(['parse_rules', 'default_parse_rule_seeded_v1']);
    const rules = result.parse_rules || [];
    const seeded = result.default_parse_rule_seeded_v1 === true;
    if (seeded && rules.some(r => r.id === 'default-example')) return;

    const seedRule = await state.defaultRuleSeedPromise;
    const now = Date.now();
    const existingIdx = rules.findIndex(r => r.id === 'default-example');
    if (existingIdx >= 0) {
      // 已有同 ID 规则：保留用户修改字段，仅合并补齐缺失的种子字段（如新增的 single 关键词）
      const existing = rules[existingIdx] || {};
      const seedSelectors = seedRule.selectors || {};
      const existingSelectors = existing.selectors || {};
      rules[existingIdx] = {
        ...existing,
        id: existing.id || seedRule.id,
        domain: existing.domain || seedRule.domain,
        name: existing.name || seedRule.name,
        selectors: {
          ...seedSelectors,
          ...existingSelectors,
          typeIndicators: {
            ...(seedSelectors.typeIndicators || {}),
            ...(existingSelectors.typeIndicators || {})
          }
        },
        typeKeywords: {
          ...(seedRule.typeKeywords || {}),
          ...(existing.typeKeywords || {})
        }
      };
    } else {
      rules.push({
        id: seedRule.id,
        domain: seedRule.domain,
        lastUsed: now,
        name: seedRule.name,
        selectors: seedRule.selectors,
        timestamp: now,
        typeKeywords: seedRule.typeKeywords,
        useCount: 1
      });
    }
    await safeSet({ parse_rules: rules, default_parse_rule_seeded_v1: true });
  }

  // ===== 主入口 =====

  /**
   * 启动完整分析流程
   */
  async function startAnalysis() {
    const allowed = await checkDomainAllowed();
    if (!allowed) {
      globalThis.QuizHelperPanelUI.createPanel(0);
      globalThis.QuizHelperPanelUI.showPanelMessage('当前域名不在白名单中，请在设置页面添加生效域名。');
      return;
    }

    state.currentRule = await getDomainRule();

    if (state.currentRule) {
      const success = await globalThis.QuizHelperDomParser.parseExamQuestions();
      if (success) {
        globalThis.QuizHelperPanelUI.createPanel(state.questionsData.length);
        globalThis.QuizHelperPanelUI.renderCards();
        await globalThis.QuizHelperAnalyzer.analyzeAllQuestions();
        return;
      }
      state.questionsData = [];
      globalThis.QuizHelperPanelUI.createPanel(0);
      globalThis.QuizHelperPanelUI.showPanelMessage('规则解析未能提取到题目。可点击"AI 选区解析"重新选取区域，AI 将自动更新规则。');
      return;
    }

    await globalThis.QuizHelperAnalyzer.aiParseFullPageAndAnalyze();
  }

  // ===== 消息监听 =====

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'analyze') {
      if (state.isStarting) {
        sendResponse({ status: 'already_starting' });
        return true;
      }
      state.isStarting = true;
      startAnalysis().finally(() => { state.isStarting = false; });
      sendResponse({ status: 'started' });
      return true;
    }
    return false;
  });

  // 导出 API（供其他模块运行时调用）
  globalThis.QuizHelperApp = {
    startAnalysis,
    getDomainRule,
    saveParseRule,
    incrementRuleUseCount,
    ensureDefaultRules,
    togglePanelVisibility,
    updateDarkMode
  };
})();
