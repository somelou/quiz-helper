// 配置管理模块 - 助手设置 + 提示词配置

function initConfig({
  extraContextPromptInput, allowedDomainsInput, blockedDomainsInput, ruleParseAppendModeInput,
  systemPromptTextareas, promptTypeTabs, promptResetBtns,
  saveBtn, resetBtn,
  questionBankEnabledInput, getCurrentShortcut, resetShortcut,
  loadQuestionBanks
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const { STORAGE_KEYS } = globalThis.QuizHelperConstants;
  let currentPromptType = 'single';
  let defaultPrompts = {};

  function showStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  async function loadDefaultPrompts() {
    try {
      const res = await fetch(chrome.runtime.getURL(globalThis.QuizHelperI18n.getPromptTemplatesUrl()));
      const data = await res.json();
      defaultPrompts = data.answerSystemPrompts || {};
    } catch (e) {
      defaultPrompts = {};
    }
  }

  function updatePromptPlaceholder() {
    const textarea = systemPromptTextareas[currentPromptType];
    if (textarea) {
      textarea.placeholder = defaultPrompts[currentPromptType] || defaultPrompts.unknown || '';
    }
  }

  function switchPromptType(type) {
    currentPromptType = type;
    const tabsEl = document.querySelector('.prompt-type-tabs');
    if (tabsEl) setSegValue(tabsEl, type);
    Object.keys(systemPromptTextareas).forEach(key => {
      if (systemPromptTextareas[key]) {
        systemPromptTextareas[key].style.display = key === type ? '' : 'none';
      }
    });
    if (promptResetBtns && promptResetBtns.length) {
      promptResetBtns.forEach(btn => {
        btn.dataset.type = type;
      });
    }
    updatePromptPlaceholder();
  }

  async function loadSettings() {
    await loadDefaultPrompts();

    const config = await chrome.storage.local.get([
      STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS,
      STORAGE_KEYS.EXTRA_CONTEXT_PROMPT,
      STORAGE_KEYS.ALLOWED_DOMAINS,
      STORAGE_KEYS.BLOCKED_DOMAINS,
      STORAGE_KEYS.PANEL_SHORTCUT,
      STORAGE_KEYS.QUESTION_BANK_ENABLED,
      STORAGE_KEYS.RULE_PARSE_APPEND_MODE
    ]);

    const customPrompts = config[STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS] || {};
    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        systemPromptTextareas[type].value = customPrompts[type] || '';
      }
    });

    extraContextPromptInput.value = config[STORAGE_KEYS.EXTRA_CONTEXT_PROMPT] || '';
    allowedDomainsInput.value = (config[STORAGE_KEYS.ALLOWED_DOMAINS] || []).join('\n');
    blockedDomainsInput.value = (config[STORAGE_KEYS.BLOCKED_DOMAINS] || []).join('\n');
    if (ruleParseAppendModeInput) {
      ruleParseAppendModeInput.checked = config[STORAGE_KEYS.RULE_PARSE_APPEND_MODE] === true;
    }
    questionBankEnabledInput.checked = config[STORAGE_KEYS.QUESTION_BANK_ENABLED] !== false;

    switchPromptType(currentPromptType);
  }

  promptTypeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchPromptType(tab.dataset.value);
    });
  });

  if (promptResetBtns && promptResetBtns.length) {
    promptResetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type || currentPromptType;
        if (systemPromptTextareas[type]) {
          systemPromptTextareas[type].value = defaultPrompts[type] || '';
          autoSave(); // 点击「默认」后立即生效
          showStatus(getMessage('optionsPromptResetDone', [TYPE_LABELS[type] || type]));
        }
      });
    });
  }

  // 输入区失焦自动保存：提示词 / 补充提示词 / 白名单 / 黑名单
  Object.values(systemPromptTextareas).forEach(textarea => {
    if (textarea) textarea.addEventListener('blur', autoSave);
  });
  extraContextPromptInput.addEventListener('blur', autoSave);
  allowedDomainsInput.addEventListener('blur', autoSave);
  blockedDomainsInput.addEventListener('blur', autoSave);
  if (ruleParseAppendModeInput) {
    ruleParseAppendModeInput.addEventListener('change', autoSave);
  }

  // 收集表单值并写入存储（「保存设置」与自动保存共用）
  async function persistSettings() {
    const parseDomains = input => input.value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    const domains = parseDomains(allowedDomainsInput);
    const blockedDomains = parseDomains(blockedDomainsInput);

    const customPrompts = {};
    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        const val = systemPromptTextareas[type].value.trim();
        if (val) customPrompts[type] = val;
      }
    });

    await safeSet({
      [STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS]: customPrompts,
      [STORAGE_KEYS.EXTRA_CONTEXT_PROMPT]: extraContextPromptInput.value.trim(),
      [STORAGE_KEYS.ALLOWED_DOMAINS]: domains,
      [STORAGE_KEYS.BLOCKED_DOMAINS]: blockedDomains,
      [STORAGE_KEYS.PANEL_SHORTCUT]: getCurrentShortcut(),
      [STORAGE_KEYS.RULE_PARSE_APPEND_MODE]: ruleParseAppendModeInput?.checked === true
    });
  }

  // 失焦自动保存：静默写入，不弹提示
  function autoSave() {
    persistSettings().catch(() => {});
  }

  // 域名输入实时保存（防抖）：刷新/关页时 blur 不触发会丢内容，输入停顿即落盘
  let domainsSaveTimer = null;
  function scheduleDomainsSave() {
    clearTimeout(domainsSaveTimer);
    domainsSaveTimer = setTimeout(autoSave, 500);
  }
  allowedDomainsInput.addEventListener('input', scheduleDomainsSave);
  blockedDomainsInput.addEventListener('input', scheduleDomainsSave);

  saveBtn.addEventListener('click', async () => {
    try {
      await persistSettings();
      showStatus(getMessage('optionsSettingsSaved'));
      // 诊断：输出本次保存的域名配置，便于定位保存链路问题
      const diag = await chrome.storage.local.get([STORAGE_KEYS.ALLOWED_DOMAINS, STORAGE_KEYS.BLOCKED_DOMAINS]);
      console.log('[QuizHelper] 保存完成，存储值 =', JSON.stringify(diag));
    } catch (err) {
      console.error('[QuizHelper] 保存设置失败:', err);
      globalThis.QuizHelperMessage.error('保存失败：' + ((err && err.message) || err));
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm(getMessage('optionsResetConfirm'))) return;

    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        systemPromptTextareas[type].value = '';
      }
    });
    extraContextPromptInput.value = '';
    allowedDomainsInput.value = '';
    blockedDomainsInput.value = '';
    if (ruleParseAppendModeInput) ruleParseAppendModeInput.checked = false;
    questionBankEnabledInput.checked = true;
    resetShortcut();

    await chrome.storage.local.remove([
      STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS,
      STORAGE_KEYS.EXTRA_CONTEXT_PROMPT,
      STORAGE_KEYS.ALLOWED_DOMAINS,
      STORAGE_KEYS.BLOCKED_DOMAINS,
      STORAGE_KEYS.PANEL_SHORTCUT,
      STORAGE_KEYS.QUESTION_BANK_ENABLED,
      STORAGE_KEYS.RULE_PARSE_APPEND_MODE,
      STORAGE_KEYS.THEME_MODE
    ]);

    showStatus(getMessage('optionsSettingsReset'));
    await loadQuestionBanks();
    switchPromptType('single');
  });

  return { loadSettings };
}
