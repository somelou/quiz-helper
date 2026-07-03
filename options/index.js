// 选项页协调层：主题管理 + 抽屉 + 模块装配

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

// ===== 模块装配 =====
document.addEventListener('DOMContentLoaded', async () => {
  await window.QuizHelperIcons?.replaceIcons(document);

  // --- 主题切换器 ---
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', event => {
      const btn = event.target.closest('.theme-btn');
      if (!btn) return;
      _currentTheme = btn.dataset.theme;
      chrome.storage.local.set({ theme_mode: _currentTheme });
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
    apiUrlInput: document.getElementById('apiUrl'),
    apiKeyInput: document.getElementById('apiKey'),
    modelInput: document.getElementById('model'),
    systemPromptInput: document.getElementById('systemPrompt'),
    extraContextPromptInput: document.getElementById('extraContextPrompt'),
    allowedDomainsInput: document.getElementById('allowedDomains'),
    saveBtn: document.getElementById('saveBtn'),
    resetBtn: document.getElementById('resetBtn'),
    toggleKeyBtn: document.getElementById('toggleKey'),
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
    drawerBodyEl.innerHTML = '';
    drawerTitleEl.textContent = '详情';
    drawerMetaEl.textContent = '';
    drawerSaveBtn.style.display = 'none';
    drawerSaveBtn.dataset.action = '';
    drawerSaveBtn.dataset.ruleId = '';
    drawerSaveBtn.dataset.ruleDomain = '';
  }

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
          const typeStyle = TYPE_CLASSES[q.type] || TYPE_CLASSES.unknown;
          html += `
            <div class="q-item">
              <div class="q-title">
                <span class="q-id">${idx + 1}</span>
                <span class="q-type" style="${typeStyle}">${typeLabel}</span>
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
          const typeStyle = TYPE_CLASSES[q.type] || TYPE_CLASSES.unknown;
          const answerHtml = q.status === 'error'
            ? `<div class="q-label">解析结果</div><div class="q-error">分析出错</div>`
            : `<div class="q-label">参考答案</div><div class="q-answer">${escapeHtml(q.answer || '未获取答案')}</div>`;
          html += `
            <div class="q-item">
              <div class="q-title">
                <span class="q-id">${idx + 1}</span>
                <span class="q-type" style="${typeStyle}">${typeLabel}</span>
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
    }

    drawerOverlay.classList.add('open');
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

  // --- 抽屉交互 ---
  drawerCloseBtn.addEventListener('click', closeDrawer);

  drawerSaveBtn.addEventListener('click', async () => {
    const action = drawerSaveBtn.dataset.action;
    if (action === 'save-rule') {
      await ruleMod.saveRuleFromDrawer();
    }
  });

  drawerOverlay.addEventListener('click', event => {
    if (event.target === drawerOverlay) closeDrawer();
  });

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
    await chrome.storage.local.set(updates);
  }

  // --- 全局 Esc 键处理 ---
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawerOverlay.classList.contains('open')) {
      closeDrawer();
    }
  });

  // --- 启动：加载所有数据 ---
  await ensureDefaultParseRuleSeeded();
  await configMod.loadSettings();

  // 从 storage 读取快捷键并同步到 shortcut 模块
  const config = await chrome.storage.local.get(['panel_shortcut']);
  shortcutMod.setShortcutFromConfig(config.panel_shortcut);

  await historyMod.loadHistory();
  await bankMod.loadQuestionBanks();
  await ruleMod.loadParseRules();
});
