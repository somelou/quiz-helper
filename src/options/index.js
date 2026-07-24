// 选项页协调层：主题管理 + 抽屉 + 模块装配

const { safeSet } = globalThis.QuizHelperStorageUtils;

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('copy failed');
    }
  } finally {
    textarea.remove();
  }
}

function buildDrawerQuestionCopyText(type, text) {
  return `【${TYPE_LABELS[type] || '其他'}】${text || ''}`.trim();
}

// ===== 主题管理（提前执行，避免闪烁） =====
const _darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
let _currentTheme = 'system';

async function initTheme() {
  const config = await chrome.storage.local.get(['theme_mode']);
  _currentTheme = config.theme_mode || 'system';
  applyOptionsTheme(_currentTheme);
  updateOptionsToggleUI();
}

function applyOptionsTheme(theme) {
  let isDark;
  if (theme === 'dark') isDark = true;
  else if (theme === 'light') isDark = false;
  else isDark = _darkMediaQuery.matches;
  document.body.classList.toggle('dark', isDark);
}

function updateOptionsToggleUI() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;
  themeToggle.dataset.theme = _currentTheme;
  themeToggle.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === _currentTheme);
  });
}

_darkMediaQuery.addEventListener('change', async () => {
  const config = await chrome.storage.local.get(['theme_mode']);
  const theme = config.theme_mode || 'system';
  if (theme === 'system') {
    applyOptionsTheme('system');
    updateOptionsToggleUI();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme_mode) {
    _currentTheme = changes.theme_mode.newValue || 'system';
    applyOptionsTheme(_currentTheme);
    updateOptionsToggleUI();
  }
});

initTheme();

// ===== 侧边导航 =====
function initSidebarNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = Array.from(navItems).map(item => {
    const id = item.getAttribute('href')?.replace('#', '');
    return document.getElementById(id);
  }).filter(Boolean);

  if (!navItems.length || !sections.length) return;

  // 点击导航项平滑滚动
  navItems.forEach(item => {
    item.addEventListener('click', event => {
      event.preventDefault();
      const targetId = item.getAttribute('href')?.replace('#', '');
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // IntersectionObserver: 在视口顶部创建 10% 高的「激活带」
  // 只有 top 边缘进入这个带的 section 才会触发高亮
  // rootMargin '-5% 0px -85% 0px' → 带从 5% 到 15% 处
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting);

    if (visible.length > 0) {
      // 多个同时进入带时，选最靠上的
      visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const id = visible[0].target.id;
      navItems.forEach(nav => {
        const href = nav.getAttribute('href')?.replace('#', '');
        nav.classList.toggle('active', href === id);
      });
    }
    // 无 section 在带内时不更新，保持上一次高亮
  }, {
    threshold: 0,
    rootMargin: '-5% 0px -85% 0px'
  });

  sections.forEach(s => observer.observe(s));
}

// ===== 分段滑块全局工具 =====
function setSegValue(el, value) {
  // 预测量目标按钮在 font-weight:600 时的宽度，避免切换时指示器膨胀
  const targetBtn = el.querySelector(`button[data-value="${value}"]`);
  if (targetBtn) {
    const prevClass = targetBtn.className;
    targetBtn.classList.add('seg-active');
    const w = targetBtn.offsetWidth;
    if (w > 0) el.style.setProperty('--seg-width', w + 'px');
    targetBtn.className = prevClass;
  }

  el.querySelectorAll('button').forEach(b => {
    b.classList.toggle('seg-active', b.dataset.value === value);
  });

  const active = el.querySelector('.seg-active');
  if (active) {
    el.style.setProperty('--seg-left', active.offsetLeft + 'px');
    el.style.setProperty('--seg-width', active.offsetWidth + 'px');
  }

  // 首次初始化后标记 ready，显示指示器并启用 transition
  el.classList.add('seg-ready');
}
function getSegValue(el) {
  const active = el.querySelector('.seg-active');
  return active ? active.dataset.value : '';
}

// 全局委托：所有 .segmented-control 按钮点击自动处理（滑动指示器 + data-active）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-control button');
  if (!btn) return;
  const seg = btn.closest('.segmented-control');
  if (!seg) return;
  const value = btn.dataset.value;
  if (value === undefined) return;
  setSegValue(seg, value);
  seg.dataset.active = value;
});

// ===== 模块装配 =====
document.addEventListener('DOMContentLoaded', async () => {
  await window.QuizHelperIcons?.replaceIcons(document);

  // --- 初始化侧边导航 ---
  initSidebarNav();

  // --- 主题切换器 ---
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', event => {
      const btn = event.target.closest('.theme-btn');
      if (!btn) return;
      _currentTheme = btn.dataset.theme;
      safeSet({ theme_mode: _currentTheme }).catch(() => {});
      applyOptionsTheme(_currentTheme);
      updateOptionsToggleUI();
    });
  }

  // --- 缓存 DOM 引用 ---
  const statusDiv = document.getElementById('status');

  // --- 初始化快捷键模块 ---
  const shortcutMod = initShortcut({
    shortcutDisplayEl: document.getElementById('shortcutDisplay'),
    shortcutHintEl: document.getElementById('shortcutHint'),
    recordBtn: document.getElementById('recordShortcutBtn'),
    clearBtn: document.getElementById('clearShortcutBtn'),
    resetBtn: document.getElementById('resetShortcutBtn'),
    statusDiv
  });

  // --- 初始化配置模块 ---
  const configMod = initConfig({
    extraContextPromptInput: document.getElementById('extraContextPrompt'),
    allowedDomainsInput: document.getElementById('allowedDomains'),
    systemPromptTextareas: {
      single: document.getElementById('systemPrompt-single'),
      multiple: document.getElementById('systemPrompt-multiple'),
      judge: document.getElementById('systemPrompt-judge'),
      fill: document.getElementById('systemPrompt-fill'),
      unknown: document.getElementById('systemPrompt-unknown')
    },
    promptTypeTabs: Array.from(document.querySelectorAll('.prompt-type-tabs button')),
    promptClearBtns: Array.from(document.querySelectorAll('.prompt-clear-btn')),
    saveBtn: document.getElementById('saveBtn'),
    resetBtn: document.getElementById('resetBtn'),
    statusDiv,
    questionBankEnabledInput: document.getElementById('questionBankEnabled'),
    getCurrentShortcut: () => shortcutMod.getCurrentShortcut(),
    resetShortcut: () => shortcutMod.resetShortcut(),
    loadQuestionBanks: null // 将在 bank 模块初始化后赋值
  });

  // --- 抽屉元素 ---
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerTitleEl = document.getElementById('drawerTitle');
  const drawerMetaEl = document.getElementById('drawerMeta');
  const drawerBodyEl = document.getElementById('drawerBody');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const drawerSaveBtn = document.getElementById('drawerSaveBtn');

  let drawerType = null;
  let currentDrawerId = null;

  // 抽屉关闭函数（供各模块使用）
  function closeDrawer() {
    drawerType = null;
    currentDrawerId = null;
    drawerOverlay.classList.remove('open');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    drawerBodyEl.innerHTML = '';
    drawerTitleEl.textContent = '详情';
    drawerMetaEl.textContent = '';
    drawerSaveBtn.style.display = 'none';
    drawerSaveBtn.dataset.action = '';
    drawerSaveBtn.dataset.ruleId = '';
    drawerSaveBtn.dataset.ruleDomain = '';
  }

  // --- 初始化模型模块 ---
  const modelMod = initModels({
    modelListEl: document.getElementById('modelList'),
    modelStatusEl: document.getElementById('modelStatus'),
    drawerBodyEl, drawerTitleEl, drawerMetaEl, drawerSaveBtn, drawerOverlay,
    onCloseDrawer: closeDrawer
  });

  // --- 初始化搜索模块 ---
  const searchMod = initSearch({
    searchListEl: document.getElementById('searchList'),
    searchStatusEl: document.getElementById('searchStatus'),
    searchEnabledInput: document.getElementById('webSearchEnabled'),
    countInput: document.getElementById('searchCount'),
    timeRangeEl: document.getElementById('searchTimeRange'),
    drawerBodyEl, drawerTitleEl, drawerMetaEl, drawerSaveBtn, drawerOverlay,
    onCloseDrawer: closeDrawer
  });

  // --- 初始化规则模块 ---
  const ruleMod = initRules({
    ruleListEl: document.getElementById('parseRuleList'),
    ruleStatusEl: document.getElementById('ruleStatus'),
    drawerBodyEl, drawerTitleEl, drawerMetaEl, drawerSaveBtn, drawerOverlay,
    onCloseDrawer: closeDrawer
  });

  // --- 打开抽屉：根据类型分发 ---
  function openDrawer(type, data) {
    drawerType = type;
    currentDrawerId = data.id || data.timestamp;

    if (type === 'bank') {
      drawerTitleEl.textContent = data.name || '未命名题库';
      drawerMetaEl.textContent = `${new Date(data.timestamp).toLocaleString('zh-CN')} · ${data.questions.length} 题`;
      drawerSaveBtn.style.display = 'none';

      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        drawerBodyEl.innerHTML = '<div class="drawer-empty">该题库暂无可展示的题目。</div>';
      } else {
        let html = '';
        data.questions.forEach((q, idx) => {
          const typeLabel = TYPE_LABELS[q.type] || '其他';
          const typeClass = TYPE_CLASSES[q.type] || TYPE_CLASSES.unknown;
          html += `
            <div class="q-item">
              <div class="q-title-row">
                <div class="q-title">
                  <span class="q-id">${idx + 1}</span>
                  <span class="q-type ${typeClass}">${typeLabel}</span>
                </div>
                <button type="button" class="q-copy-btn" data-copy-question="${escapeHtml(buildDrawerQuestionCopyText(q.type, q.text))}">复制题目</button>
              </div>
              <div class="q-label">题目</div>
              <div class="q-text">${escapeHtml(q.text)}</div>
              <div class="q-label">答案</div>
              <div class="q-answer">${escapeHtml(q.answer || '无')}</div>
              ${q.analysis ? `<div class="q-label" style="margin-top:8px;">解析</div><div class="q-answer">${escapeHtml(q.analysis)}</div>` : ''}
            </div>
          `;
        });
        drawerBodyEl.innerHTML = html;
      }
    } else if (type === 'history') {
      drawerSaveBtn.style.display = 'none';
      const date = new Date(data.timestamp).toLocaleString('zh-CN');
      const doneCount = data.questions.filter(q => q.status === 'done').length;
      const errorCount = data.questions.filter(q => q.status === 'error').length;
      drawerTitleEl.textContent = data.title || '未命名试卷';
      drawerMetaEl.textContent = `${date} · ${data.questions.length} 题 · 已完成 ${doneCount} 题${errorCount > 0 ? ` · ${errorCount} 题出错` : ''}`;

      if (!data.questions || data.questions.length === 0) {
        drawerBodyEl.innerHTML = '<div class="drawer-empty">暂无题目数据。</div>';
      } else {
        let html = '';
        data.questions.forEach((q, idx) => {
          const typeLabel = TYPE_LABELS[q.type] || '其他';
          const typeClass = TYPE_CLASSES[q.type] || TYPE_CLASSES.unknown;
          const answerHtml = q.status === 'error'
            ? `<div class="q-label">解析结果</div><div class="q-error">分析出错</div>`
            : `<div class="q-label">参考答案</div><div class="q-answer">${escapeHtml(q.answer || '未获取答案')}</div>`;
          html += `
            <div class="q-item">
              <div class="q-title-row">
                <div class="q-title">
                  <span class="q-id">${idx + 1}</span>
                  <span class="q-type ${typeClass}">${typeLabel}</span>
                </div>
                <button type="button" class="q-copy-btn" data-copy-question="${escapeHtml(buildDrawerQuestionCopyText(q.type, q.text))}">复制题目</button>
              </div>
              <div class="q-label">题目</div>
              <div class="q-text">${escapeHtml(q.text)}</div>
              ${answerHtml}
            </div>
          `;
        });
        drawerBodyEl.innerHTML = html;
      }
    } else if (type === 'rule') {
      ruleMod.openRuleDrawer(data);
    } else if (type === 'model') {
      modelMod.openModelDrawer(data);
    } else if (type === 'search') {
      searchMod.openSearchDrawer(data);
    }

    drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // 强制布局计算，确保 drawer 内元素 offset 可用（同步，首次绘制前即就位）
    drawerBodyEl.getBoundingClientRect();
    drawerBodyEl.querySelectorAll('.segmented-control').forEach(seg => {
      const active = seg.querySelector('.seg-active');
      if (active) setSegValue(seg, active.dataset.value);
    });
  }

  // --- 初始化历史模块 ---
  const historyMod = initHistory({
    historyListEl: document.getElementById('historyList'),
    onOpenDrawer: openDrawer
  });

  // --- 初始化题库模块 ---
  const bankMod = initBank({
    bankListEl: document.getElementById('questionBankList'),
    bankFileInput: document.getElementById('questionBankFile'),
    bankStatusEl: document.getElementById('bankStatus'),
    questionBankEnabledInput: document.getElementById('questionBankEnabled'),
    onOpenDrawer: openDrawer,
    onCloseDrawer: closeDrawer
  });

  // 补充配置模块的题库加载回调
  configMod.loadQuestionBanks = bankMod.loadQuestionBanks;

  async function refreshShortcutFromStorage() {
    const config = await chrome.storage.local.get(['panel_shortcut']);
    shortcutMod.setShortcutFromConfig(config.panel_shortcut);
  }

  async function refreshImportModeUI() {
    const importMode = document.getElementById('importMode');
    const importModeHint = document.getElementById('importModeHint');
    if (!importMode) return;

    const MODE_MAP = {
      eco: '并发 5 批 · 每批 100 题，速度较慢，适合 token 不足或 API 限流严格的场景',
      balanced: '并发 10 批 · 每批 50 题，均衡速度与稳定性，推荐日常使用',
      precise: '并发 10 批 · 每批 25 题，小批次高精度，适合题目格式复杂、容易解析出错的题库'
    };

    const result = await chrome.storage.local.get(['import_mode']);
    const currentMode = result.import_mode || 'balanced';

    importMode.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('seg-active', btn.dataset.value === currentMode);
    });
    setSegValue(importMode, currentMode);
    if (importModeHint) {
      importModeHint.textContent = MODE_MAP[currentMode] || MODE_MAP.balanced;
    }
  }

  async function reloadOptionModulesAfterImport() {
    await configMod.loadSettings();
    await refreshShortcutFromStorage();
    await refreshImportModeUI();
    await modelMod.loadModels();
    await searchMod.loadSearchProviders();
    await ruleMod.loadParseRules();
    await bankMod.loadQuestionBanks();
    await historyMod.loadHistory();
  }

  initBackup({
    moduleListEl: document.getElementById('backupModuleList'),
    exportBtn: document.getElementById('exportBackupBtn'),
    exportStatusEl: document.getElementById('backupExportStatus'),
    fileInputEl: document.getElementById('backupFileInput'),
    fileNameEl: document.getElementById('backupFileName'),
    importBtn: document.getElementById('importBackupBtn'),
    importStatusEl: document.getElementById('backupImportStatus'),
    onImportComplete: reloadOptionModulesAfterImport
  });

  // --- 抽屉交互 ---
  drawerCloseBtn.addEventListener('click', closeDrawer);

  drawerSaveBtn.addEventListener('click', async () => {
    const action = drawerSaveBtn.dataset.action;
    if (action === 'save-rule') {
      await ruleMod.saveRuleFromDrawer();
    } else if (action === 'save-model') {
      await modelMod.saveModelFromDrawer();
    } else if (action === 'save-search') {
      await searchMod.saveSearchFromDrawer();
    }
  });

  let drawerClickStartedOnOverlay = false;

  drawerOverlay.addEventListener('mousedown', event => {
    drawerClickStartedOnOverlay = event.target === drawerOverlay;
  });

  drawerOverlay.addEventListener('click', event => {
    if (drawerClickStartedOnOverlay && event.target === drawerOverlay) closeDrawer();
  });

  drawerBodyEl.addEventListener('click', async event => {
    const copyBtn = event.target.closest('.q-copy-btn');
    if (!copyBtn) return;
    event.preventDefault();
    const copyTextValue = copyBtn.dataset.copyQuestion || '';
    const originalText = '复制题目';
    copyBtn.disabled = true;
    try {
      await copyText(copyTextValue);
      copyBtn.textContent = '已复制';
      copyBtn.classList.add('copied');
    } catch (error) {
      copyBtn.textContent = '复制失败';
      copyBtn.classList.add('failed');
    } finally {
      window.setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.disabled = false;
        copyBtn.classList.remove('copied', 'failed');
      }, 1200);
    }
  });

  // 阻止抽屉打开时背景页面滚动
  document.addEventListener('wheel', event => {
    if (!drawerOverlay.classList.contains('open')) return;
    if (event.target.closest('.drawer')) return;
    event.preventDefault();
  }, { passive: false });

  // --- 历史记录全局按钮 ---
  document.getElementById('exportAllHistory').addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['exam_history']);
    const history = result.exam_history || [];
    if (history.length === 0) {
      alert('暂无历史记录可导出');
      return;
    }
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-helper-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
    await chrome.storage.local.remove(['exam_history']);
    historyMod.renderHistory([]);
  });

  // --- 默认解析规则种子 ---
  let defaultRuleSeedPromise = null;

  async function ensureDefaultParseRuleSeeded() {
    const markerKey = 'default_parse_rule_seeded_v1';
    const result = await chrome.storage.local.get(['parse_rules', markerKey]);
    if (result[markerKey]) return;

    const rules = result.parse_rules || [];
    const now = Date.now();
    const updates = { [markerKey]: true };
    if (!defaultRuleSeedPromise) {
      defaultRuleSeedPromise = fetch(chrome.runtime.getURL('data/default-parse-rule.json')).then(async res => {
        if (!res.ok) throw new Error(`加载默认解析规则失败: ${res.status}`);
        return res.json();
      });
    }
    const defaultRule = await defaultRuleSeedPromise;
    const seedRule = { ...defaultRule, lastUsed: now, timestamp: now, useCount: 1 };

    const idx = rules.findIndex(r => r && r.id === 'default-example');
    if (idx >= 0) {
      rules[idx] = { ...rules[idx], ...seedRule };
    } else {
      rules.push(seedRule);
    }
    updates.parse_rules = rules;
    await safeSet(updates);
  }

  // --- 数据迁移：旧单模型 -> 新多模型结构 ---
  async function ensureModelMigration() {
    const result = await chrome.storage.local.get(['llm_models', 'api_url', 'api_key', 'model']);
    if (result.llm_models && result.llm_models.length > 0) return;

    const oldApiUrl = result.api_url;
    const oldApiKey = result.api_key;
    const oldModel = result.model;

    if (oldApiKey && oldApiUrl && oldModel) {
      const now = Date.now();
      const migratedModel = {
        id: `model-${now}`,
        name: oldModel,
        modelId: oldModel,
        apiUrl: oldApiUrl.replace(/\/+$/, ''),
        apiKey: oldApiKey,
        apiFormat: 'openai',
        isActive: true,
        timestamp: now
      };
      await safeSet({
        llm_models: [migratedModel],
        active_model_id: migratedModel.id
      });
    }
  }

  // --- 数据迁移：旧 system_prompt -> 新 custom_system_prompts ---
  async function ensurePromptMigration() {
    const result = await chrome.storage.local.get(['custom_system_prompts', 'system_prompt']);
    if (result.custom_system_prompts) return;

    const oldPrompt = result.system_prompt;
    if (oldPrompt && oldPrompt.trim()) {
      await safeSet({
        custom_system_prompts: { unknown: oldPrompt.trim() }
      });
    } else {
      await safeSet({ custom_system_prompts: {} });
    }
  }

  // --- 添加模型按钮 ---
  document.getElementById('addModelBtn').addEventListener('click', () => {
    openDrawer('model', {});
  });

  // --- 全局 Esc 键处理 ---
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawerOverlay.classList.contains('open')) {
      closeDrawer();
    }
  });

  // --- 启动：加载所有数据 ---
  await ensureDefaultParseRuleSeeded();
  await ensureModelMigration();
  await ensurePromptMigration();
  await configMod.loadSettings();

  // 从 storage 读取快捷键并同步到 shortcut 模块
  await refreshShortcutFromStorage();
  await refreshImportModeUI();

  await historyMod.loadHistory();
  await bankMod.loadQuestionBanks();
  await ruleMod.loadParseRules();
  await modelMod.loadModels();

  // 加载搜索模块
  await searchMod.loadSearchProviders();
});
