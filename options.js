// 设置页面逻辑：保存/读取 API 配置 + 题库管理 + 历史记录管理

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

document.addEventListener('DOMContentLoaded', async () => {
  // ===== 主题切换器交互 =====
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

  // ===== 常量 =====
  const DEFAULT_SHORTCUT = {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: 'KeyQ',
    key: 'q',
    display: 'Alt+Q'
  };

  const TYPE_LABELS = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', unknown: '其他' };
  const TYPE_CLASSES = {
    single: 'background:#e3f2fd;color:#1565c0',
    multiple: 'background:#f3e5f5;color:#6a1b9a',
    judge: 'background:#e8f5e9;color:#2e7d32',
    fill: 'background:#fff3e0;color:#e65100',
    unknown: 'background:#f5f5f5;color:#616161'
  };

  // ===== 配置区域 =====
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model');
  const systemPromptInput = document.getElementById('systemPrompt');
  const extraContextPromptInput = document.getElementById('extraContextPrompt');
  const allowedDomainsInput = document.getElementById('allowedDomains');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusDiv = document.getElementById('status');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const shortcutDisplayEl = document.getElementById('shortcutDisplay');
  const shortcutHintEl = document.getElementById('shortcutHint');
  const recordShortcutBtn = document.getElementById('recordShortcutBtn');
  const clearShortcutBtn = document.getElementById('clearShortcutBtn');
  const resetShortcutBtn = document.getElementById('resetShortcutBtn');

  // ===== 历史记录区域 =====
  const historyListEl = document.getElementById('historyList');
  const exportAllBtn = document.getElementById('exportAllHistory');
  const clearHistoryBtn = document.getElementById('clearHistory');

  // ===== 题库管理区域 =====
  const bankFileInput = document.getElementById('questionBankFile');
  const bankListEl = document.getElementById('questionBankList');
  const bankStatusEl = document.getElementById('bankStatus');
  const questionBankEnabledInput = document.getElementById('questionBankEnabled');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerTitleEl = document.getElementById('drawerTitle');
  const drawerMetaEl = document.getElementById('drawerMeta');
  const drawerBodyEl = document.getElementById('drawerBody');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const drawerSaveBtn = document.getElementById('drawerSaveBtn');

  // ===== 解析规则管理区域 =====
  const ruleListEl = document.getElementById('parseRuleList');
  const ruleStatusEl = document.getElementById('ruleStatus');

  let currentShortcut = getDefaultShortcut();
  let isRecordingShortcut = false;
  let drawerType = null; // 'bank' | 'history' | 'rule' | null
  let currentDrawerId = null;

  // 分页状态（每页 10 条）
  const PAGE_SIZE = 10;
  const paginationState = { rule: 1, bank: 1, history: 1 };

  /**
   * 渲染分页控件
   * @param {HTMLElement} container - 分页控件挂载点
   * @param {number} total - 总条数
   * @param {number} currentPage - 当前页（从1开始）
   * @param {Function} onPageChange - 切页回调
   */
  function renderPagination(container, total, currentPage, onPageChange) {
    container.innerHTML = '';
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (totalPages <= 1) return;

    const createBtn = (text, page, opts = {}) => {
      const btn = document.createElement('button');
      btn.className = 'page-btn' + (opts.active ? ' active' : '');
      btn.textContent = text;
      if (opts.disabled) btn.disabled = true;
      if (!opts.active && !opts.disabled) {
        btn.addEventListener('click', () => onPageChange(page));
      }
      return btn;
    };

    // 上一页
    container.appendChild(createBtn('<', currentPage - 1, { disabled: currentPage === 1 }));

    // 显示页码：最多显示 7 个，超过则首尾省略
    const maxVisible = 7;
    let start = 1, end = totalPages;
    if (totalPages > maxVisible) {
      const half = Math.floor(maxVisible / 2);
      start = Math.max(1, currentPage - half);
      end = Math.min(totalPages, start + maxVisible - 1);
      if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
      container.appendChild(createBtn('1', 1));
      if (start > 2) {
        const span = document.createElement('span');
        span.className = 'page-info';
        span.textContent = '...';
        container.appendChild(span);
      }
    }

    for (let p = start; p <= end; p++) {
      container.appendChild(createBtn(String(p), p, { active: p === currentPage }));
    }

    if (end < totalPages) {
      if (end < totalPages - 1) {
        const span = document.createElement('span');
        span.className = 'page-info';
        span.textContent = '...';
        container.appendChild(span);
      }
      container.appendChild(createBtn(String(totalPages), totalPages));
    }

    // 下一页
    container.appendChild(createBtn('>', currentPage + 1, { disabled: currentPage === totalPages }));

    // 信息
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `${currentPage}/${totalPages} 页 · 共 ${total} 条`;
    container.appendChild(info);
  }

  // ===== 初始化 =====
  await loadSettings();
  await loadHistory();
  await loadQuestionBanks();
  await loadParseRules();

  // ===== 配置交互 =====
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '隐藏';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '显示';
    }
  });

  saveBtn.addEventListener('click', async () => {
    const domains = allowedDomainsInput.value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    await chrome.storage.local.set({
      api_url: apiUrlInput.value.trim(),
      api_key: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || 'gpt-3.5-turbo',
      system_prompt: systemPromptInput.value.trim(),
      extra_context_prompt: extraContextPromptInput.value.trim(),
      allowed_domains: domains,
      panel_shortcut: currentShortcut
    });

    showStatus('设置已保存');
  });

  resetBtn.addEventListener('click', async () => {
    apiUrlInput.value = 'https://api.openai.com/v1';
    apiKeyInput.value = '';
    modelInput.value = 'gpt-3.5-turbo';
    systemPromptInput.value = '';
    extraContextPromptInput.value = '';
    allowedDomainsInput.value = '';
    questionBankEnabledInput.checked = true;
    currentShortcut = getDefaultShortcut();
    updateShortcutDisplay();

    await chrome.storage.local.remove([
      'api_url',
      'api_key',
      'model',
      'system_prompt',
      'extra_context_prompt',
      'allowed_domains',
      'panel_shortcut',
      'question_bank_enabled',
      'theme_mode'
    ]);

    showStatus('已恢复默认设置');
    await loadQuestionBanks();
  });

  recordShortcutBtn.addEventListener('click', () => {
    isRecordingShortcut = true;
    shortcutDisplayEl.textContent = '请按下新的快捷键组合...';
    shortcutDisplayEl.classList.add('recording');
    shortcutHintEl.textContent = '请至少包含一个修饰键，如 Alt、Ctrl、Shift 或 Meta。按 Esc 可取消。';
  });

  clearShortcutBtn.addEventListener('click', () => {
    isRecordingShortcut = false;
    currentShortcut = null;
    updateShortcutDisplay();
    showStatus('已清空快捷键，保存后生效');
  });

  resetShortcutBtn.addEventListener('click', () => {
    isRecordingShortcut = false;
    currentShortcut = getDefaultShortcut();
    updateShortcutDisplay();
    showStatus('已恢复默认快捷键，保存后生效');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (isRecordingShortcut) {
        event.preventDefault();
        isRecordingShortcut = false;
        updateShortcutDisplay();
        showStatus('已取消快捷键录制');
        return;
      }
      if (drawerOverlay.classList.contains('open')) {
        closeDrawer();
      }
      return;
    }

    if (!isRecordingShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (isModifierKey(event.key)) return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      shortcutHintEl.textContent = '快捷键至少需要一个修饰键，请重新录制。';
      return;
    }

    currentShortcut = {
      altKey: !!event.altKey,
      ctrlKey: !!event.ctrlKey,
      metaKey: !!event.metaKey,
      shiftKey: !!event.shiftKey,
      code: event.code || '',
      key: event.key || '',
      display: formatShortcutDisplay({
        altKey: !!event.altKey,
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        shiftKey: !!event.shiftKey,
        code: event.code || '',
        key: event.key || ''
      })
    };

    isRecordingShortcut = false;
    updateShortcutDisplay();
    showStatus('快捷键已录制，点击“保存设置”后生效');
  }, true);

  // ===== 题库交互 =====
  questionBankEnabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ question_bank_enabled: questionBankEnabledInput.checked });
    showBankStatus(questionBankEnabledInput.checked ? '已启用题库优先回答' : '已关闭题库优先回答');
    await loadQuestionBanks();
  });

  drawerCloseBtn.addEventListener('click', closeDrawer);
  drawerSaveBtn.addEventListener('click', async () => {
    const action = drawerSaveBtn.dataset.action;
    if (action === 'save-rule') {
      await saveRuleFromDrawer();
    }
  });
  drawerOverlay.addEventListener('click', event => {
    if (event.target === drawerOverlay) {
      closeDrawer();
    }
  });

  bankFileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;

    showBankStatus('正在读取文件...');

    try {
      let text = '';
      const fileName = file.name;

      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        text = await readExcelFile(file);
      } else if (fileName.endsWith('.docx')) {
        text = await readWordFile(file);
      } else {
        alert('不支持的文件格式，请上传 Excel(.xlsx/.xls) 或 Word(.docx) 文件');
        return;
      }

      if (!text || text.length < 10) {
        alert('文件内容为空或过少');
        return;
      }

      showBankStatus('正在使用 AI 解析题库...');

      const response = await chrome.runtime.sendMessage({
        action: 'parseQuestionBank',
        text,
        fileName
      }).catch(err => {
        console.error('消息发送失败:', err);
        return { success: false, error: '消息发送失败：' + err.message };
      });

      if (!response || typeof response !== 'object') {
        alert('解析失败：响应格式错误');
        showBankStatus('');
        return;
      }

      if (!response.success) {
        alert('解析失败：' + (response.error || '未知错误'));
        showBankStatus('');
        return;
      }

      const result = await chrome.storage.local.get(['question_banks']);
      const banks = result.question_banks || [];
      const newBank = {
        id: Date.now().toString(),
        name: fileName,
        timestamp: Date.now(),
        questions: response.questions.map((q, i) => ({
          id: q.id || i + 1,
          text: (q.text || '').trim(),
          type: normalizeBankQuestionType(q.type),
          answer: (q.answer || '').trim(),
          analysis: (q.analysis || '').trim()
        })).filter(q => q.text.length > 0)
      };

      if (!newBank.questions.length) {
        alert('解析失败：未提取到有效题目');
        showBankStatus('');
        return;
      }

      banks.unshift(newBank);
      if (banks.length > 10) banks.length = 10;

      await chrome.storage.local.set({ question_banks: banks });
      showBankStatus(`题库导入成功，共 ${newBank.questions.length} 道题目`);
      await loadQuestionBanks();
    } catch (err) {
      console.error('导入失败:', err);
      alert('导入失败：' + err.message);
      showBankStatus('');
    }

    bankFileInput.value = '';
  });

  // ===== 历史记录交互 =====
  exportAllBtn.addEventListener('click', async () => {
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

  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
    await chrome.storage.local.remove(['exam_history']);
    renderHistory([]);
  });

  // ===== 配置加载 =====
  async function loadSettings() {
    const config = await chrome.storage.local.get([
      'api_url',
      'api_key',
      'model',
      'system_prompt',
      'extra_context_prompt',
      'allowed_domains',
      'panel_shortcut',
      'question_bank_enabled'
    ]);

    apiUrlInput.value = config.api_url || 'https://api.openai.com/v1';
    apiKeyInput.value = config.api_key || '';
    modelInput.value = config.model || 'gpt-3.5-turbo';
    systemPromptInput.value = config.system_prompt || '';
    extraContextPromptInput.value = config.extra_context_prompt || '';
    allowedDomainsInput.value = (config.allowed_domains || []).join('\n');
    questionBankEnabledInput.checked = config.question_bank_enabled !== false;
    currentShortcut = config.panel_shortcut === null
      ? null
      : normalizeShortcutConfig(config.panel_shortcut) || getDefaultShortcut();

    updateShortcutDisplay();
  }

  // ===== 历史记录函数 =====
  async function loadHistory() {
    const result = await chrome.storage.local.get(['exam_history']);
    renderHistory(result.exam_history || []);
  }

  function renderHistory(history) {
    if (history.length === 0) {
      historyListEl.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      return;
    }

    const totalPages = Math.ceil(history.length / PAGE_SIZE);
    if (paginationState.history > totalPages) paginationState.history = totalPages;
    const page = paginationState.history;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, history.length);

    historyListEl.innerHTML = '';
    for (let idx = startIdx; idx < endIdx; idx++) {
      const record = history[idx];
      const item = document.createElement('div');
      item.className = 'history-item';

      const date = new Date(record.timestamp).toLocaleString('zh-CN');
      const doneCount = record.questions.filter(q => q.status === 'done').length;
      const errorCount = record.questions.filter(q => q.status === 'error').length;

      item.innerHTML = `
        <div class="history-item-header">
          <div class="history-info">
            <div class="history-title">${escapeHtml(record.title || '未命名试卷')}</div>
            <div class="history-meta">${date} · ${record.questions.length} 题 · 已完成 ${doneCount} 题${errorCount > 0 ? ` · ${errorCount} 题出错` : ''}</div>
            <div class="history-meta">${escapeHtml(record.url || '')}</div>
          </div>
          <div class="history-actions">
            <button class="history-btn history-btn-view" data-idx="${idx}">查看</button>
            <button class="history-btn history-btn-export" data-idx="${idx}">导出</button>
            <button class="history-btn history-btn-delete" data-idx="${idx}">删除</button>
          </div>
        </div>
      `;

      item.querySelector('.history-btn-view').addEventListener('click', () => openDrawer('history', record));
      item.querySelector('.history-btn-export').addEventListener('click', () => exportSingleHistory(record));
      item.querySelector('.history-btn-delete').addEventListener('click', () => deleteHistoryItem(idx));

      historyListEl.appendChild(item);
    }

    const pager = document.createElement('div');
    pager.className = 'pagination';
    historyListEl.appendChild(pager);
    renderPagination(pager, history.length, page, (p) => {
      paginationState.history = p;
      renderHistory(history);
    });
  }

  async function deleteHistoryItem(idx) {
    if (!confirm('确定要删除这条历史记录吗？')) return;
    const result = await chrome.storage.local.get(['exam_history']);
    const history = result.exam_history || [];
    history.splice(idx, 1);
    await chrome.storage.local.set({ exam_history: history });
    renderHistory(history);
  }

  function exportSingleHistory(record) {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const title = (record.title || '未命名试卷').replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 30);
    a.download = `quiz-${title}-${new Date(record.timestamp).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===== 题库函数 =====
  async function loadQuestionBanks() {
    const state = await getQuestionBankState();
    questionBankEnabledInput.checked = state.questionBankEnabled;
    renderQuestionBanks(state.banks, state.activeBankIds, state.questionBankEnabled);
  }

  async function getQuestionBankState() {
    const result = await chrome.storage.local.get([
      'question_banks',
      'active_bank_id',
      'active_bank_ids',
      'question_bank_enabled'
    ]);

    const banks = result.question_banks || [];
    let activeBankIds = Array.isArray(result.active_bank_ids)
      ? result.active_bank_ids.filter(Boolean)
      : [];

    if (activeBankIds.length === 0 && result.active_bank_id) {
      activeBankIds = [result.active_bank_id];
    }

    activeBankIds = [...new Set(activeBankIds)].filter(id => banks.some(bank => bank.id === id));

    await chrome.storage.local.set({ active_bank_ids: activeBankIds });

    return {
      banks,
      activeBankIds,
      questionBankEnabled: result.question_bank_enabled !== false
    };
  }

  function renderQuestionBanks(banks, activeBankIds, questionBankEnabled) {
    const bankCountHint = document.getElementById('bankCountHint');
    if (bankCountHint) {
      const activeCount = activeBankIds.length;
      bankCountHint.textContent = activeCount > 0
        ? `共 ${banks.length} 个题库，${activeCount} 个已启用`
        : `共 ${banks.length} 个题库`;
    }

    if (banks.length === 0) {
      bankListEl.innerHTML = '<div class="bank-empty">暂无题库。点击上方"+ 导入题库"按钮上传 Excel(.xlsx/.xls) 或 Word(.docx) 文件。</div>';
      if (bankCountHint) bankCountHint.textContent = '';
      return;
    }

    const totalPages = Math.ceil(banks.length / PAGE_SIZE);
    if (paginationState.bank > totalPages) paginationState.bank = totalPages;
    const page = paginationState.bank;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, banks.length);

    bankListEl.innerHTML = '';
    for (let idx = startIdx; idx < endIdx; idx++) {
      const bank = banks[idx];
      const enabled = activeBankIds.includes(bank.id);
      const item = document.createElement('div');
      item.className = `bank-item ${enabled ? 'active' : ''}`;
      item.dataset.id = bank.id;

      const date = new Date(bank.timestamp).toLocaleString('zh-CN');
      const enabledText = enabled
        ? (questionBankEnabled ? '已启用' : '已选中（总开关关闭）')
        : '未启用';

      item.innerHTML = `
        <div class="bank-item-header">
          <div class="bank-info">
            <div class="bank-name">${escapeHtml(bank.name || '未命名题库')}</div>
            <div class="bank-meta">${date} · ${bank.questions.length} 题 · ${enabledText}</div>
          </div>
          <div class="bank-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle-enabled" data-idx="${idx}" ${enabled ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="bank-btn bank-btn-view" data-action="view" data-idx="${idx}">查看</button>
            <button class="bank-btn bank-btn-delete" data-action="delete" data-idx="${idx}">删除</button>
          </div>
        </div>
      `;

      item.querySelector('[data-action="toggle-enabled"]').addEventListener('change', event => {
        handleBankAction('toggle-enabled', idx, event.target.checked);
      });
      item.querySelector('[data-action="view"]').addEventListener('click', () => handleBankAction('view', idx));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => handleBankAction('delete', idx));

      bankListEl.appendChild(item);
    }

    const pager = document.createElement('div');
    pager.className = 'pagination';
    bankListEl.appendChild(pager);
    renderPagination(pager, banks.length, page, (p) => {
      paginationState.bank = p;
      renderQuestionBanks(banks, activeBankIds, questionBankEnabled);
    });
  }

  async function handleBankAction(action, index, checked = false) {
    const state = await getQuestionBankState();
    const banks = state.banks;
    const bank = banks[index];
    if (!bank) return;

    let activeBankIds = [...state.activeBankIds];

    if (action === 'toggle-enabled') {
      if (checked) {
        activeBankIds.push(bank.id);
      } else {
        activeBankIds = activeBankIds.filter(id => id !== bank.id);
      }

      activeBankIds = [...new Set(activeBankIds)];
      await chrome.storage.local.set({ active_bank_ids: activeBankIds });
      showBankStatus(`${checked ? '已启用' : '已停用'}题库：${bank.name}`);
      await loadQuestionBanks();
      return;
    }

    if (action === 'delete') {
      if (!confirm('确定要删除这个题库吗？此操作不可恢复。')) return;
      banks.splice(index, 1);
      activeBankIds = activeBankIds.filter(id => id !== bank.id);
      await chrome.storage.local.set({
        question_banks: banks,
        active_bank_ids: activeBankIds,
        active_bank_id: activeBankIds[0] || null
      });
      if (drawerType === 'bank' && currentDrawerId === bank.id) {
        closeDrawer();
      }
      showBankStatus('题库已删除');
      await loadQuestionBanks();
      return;
    }

    if (action === 'view') {
      openDrawer('bank', bank);
    }
  }

  function openDrawer(type, data) {
    drawerType = type;
    currentDrawerId = data.id;

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
      const date = new Date(data.timestamp).toLocaleString('zh-CN');
      const doneCount = data.questions.filter(q => q.status === 'done').length;
      const errorCount = data.questions.filter(q => q.status === 'error').length;
      drawerTitleEl.textContent = data.title || '未命名试卷';
      drawerMetaEl.textContent = `${date} · ${data.questions.length} 题 · 已完成 ${doneCount} 题${errorCount > 0 ? ` · ${errorCount} 题出错` : ''}`;
      drawerSaveBtn.style.display = 'none';

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
      drawerTitleEl.textContent = '编辑解析规则';
      drawerMetaEl.textContent = data.domain || '';
      renderRuleForm(data);
      drawerSaveBtn.style.display = '';
    }

    drawerOverlay.classList.add('open');
  }

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

  function showBankStatus(msg) {
    bankStatusEl.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (bankStatusEl.textContent === msg) {
          bankStatusEl.textContent = '';
        }
      }, 3000);
    }
  }

  // ===== 解析规则管理 =====

  function showRuleStatus(msg) {
    ruleStatusEl.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (ruleStatusEl.textContent === msg) {
          ruleStatusEl.textContent = '';
        }
      }, 3000);
    }
  }

  async function loadParseRules() {
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    renderParseRules(rules);
  }

  function renderParseRules(rules) {
    if (!rules || rules.length === 0) {
      ruleListEl.innerHTML = '<div class="rule-empty">暂无解析规则。访问新站点时 AI 会自动生成规则。</div>';
      return;
    }

    const totalPages = Math.ceil(rules.length / PAGE_SIZE);
    if (paginationState.rule > totalPages) paginationState.rule = totalPages;
    const page = paginationState.rule;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, rules.length);

    ruleListEl.innerHTML = '';
    for (let idx = startIdx; idx < endIdx; idx++) {
      const rule = rules[idx];
      const item = document.createElement('div');
      item.className = 'rule-item';

      const lastUsed = rule.lastUsed ? new Date(rule.lastUsed).toLocaleString('zh-CN') : '未使用';
      const created = rule.timestamp ? new Date(rule.timestamp).toLocaleString('zh-CN') : '';
      const useCount = rule.useCount || 0;

      item.innerHTML = `
        <div class="rule-item-header">
          <div class="rule-info">
            <div class="rule-name">${escapeHtml(rule.domain || '未命名')}</div>
            <div class="rule-meta">创建: ${created} · 最后使用: ${lastUsed} · 使用次数: ${useCount}</div>
          </div>
          <div class="rule-actions">
            <button class="rule-btn rule-btn-edit" data-idx="${idx}">编辑</button>
            <button class="rule-btn rule-btn-delete" data-idx="${idx}">删除</button>
          </div>
        </div>
      `;

      item.querySelector('.rule-btn-edit').addEventListener('click', () => openDrawer('rule', rule));
      item.querySelector('.rule-btn-delete').addEventListener('click', () => deleteParseRule(idx));

      ruleListEl.appendChild(item);
    }

    const pager = document.createElement('div');
    pager.className = 'pagination';
    ruleListEl.appendChild(pager);
    renderPagination(pager, rules.length, page, (p) => {
      paginationState.rule = p;
      renderParseRules(rules);
    });
  }

  async function deleteParseRule(idx) {
    if (!confirm('确定要删除这条解析规则吗？删除后该站点将回退到 AI 解析模式。')) return;
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    rules.splice(idx, 1);
    await chrome.storage.local.set({ parse_rules: rules });
    showRuleStatus('解析规则已删除');
    await loadParseRules();
  }

  /**
   * 在抽屉中渲染规则编辑表单
   * @param {Object} rule
   */
  function renderRuleForm(rule) {
    const selectors = rule.selectors || {};
    const typeKeywords = rule.typeKeywords || {};
    const typeIndicators = selectors.typeIndicators || {};

    const rootSelectors = (selectors.rootSelectors || []).join('\n');
    const questionTextSelectors = (selectors.questionTextSelectors || []).join('\n');
    const optionContainerSelectors = (selectors.optionContainerSelectors || []).join('\n');
    const fallbackTextSelectors = (selectors.fallbackTextSelectors || []).join('\n');
    const singleIndicators = (typeIndicators.single || []).join(', ');
    const multipleIndicators = (typeIndicators.multiple || []).join(', ');
    const judgeIndicators = (typeIndicators.judge || []).join(', ');
    const multipleKw = (typeKeywords.multiple || []).join(', ');
    const judgeKw = (typeKeywords.judge || []).join(', ');
    const fillKw = (typeKeywords.fill || []).join(', ');

    drawerBodyEl.innerHTML = `
      <div class="rule-form-group">
        <label>站点域名</label>
        <input type="text" id="rule-domain" value="${escapeHtml(rule.domain || '')}" placeholder="example.com">
      </div>

      <div class="rule-form-section">CSS 选择器配置</div>

      <div class="rule-form-group">
        <label>根容器选择器（每行一个，按优先级排序）</label>
        <textarea id="rule-rootSelectors" rows="3">${escapeHtml(rootSelectors)}</textarea>
      </div>
      <div class="rule-form-group">
        <label>题目项选择器</label>
        <input type="text" id="rule-questionItemSelector" value="${escapeHtml(selectors.questionItemSelector || '')}" placeholder=".question-type-item">
      </div>
      <div class="rule-form-group">
        <label>题型标题选择器（可选）</label>
        <input type="text" id="rule-typeHeadingSelector" value="${escapeHtml(selectors.typeHeadingSelector || '')}" placeholder=".h3.m-bottom">
      </div>
      <div class="rule-form-group">
        <label>题干选择器（每行一个，按优先级排序）</label>
        <textarea id="rule-questionTextSelectors" rows="2">${escapeHtml(questionTextSelectors)}</textarea>
      </div>
      <div class="rule-form-group">
        <label>选项容器选择器（每行一个，按优先级排序）</label>
        <textarea id="rule-optionContainerSelectors" rows="2">${escapeHtml(optionContainerSelectors)}</textarea>
      </div>
      <div class="rule-form-group">
        <label>选项元素选择器</label>
        <input type="text" id="rule-optionItemSelector" value="${escapeHtml(selectors.optionItemSelector || '')}" placeholder="dd">
      </div>
      <div class="rule-form-group">
        <label>选项编号选择器（可选）</label>
        <input type="text" id="rule-optionNumberSelector" value="${escapeHtml(selectors.optionNumberSelector || '')}" placeholder=".option-num">
      </div>

      <div class="rule-form-section">题型指示器（class 名关键词，逗号分隔）</div>
      <div class="hint" style="margin-bottom: 8px; font-size: 12px;">题目元素或其父元素的 class 包含这些关键词时，优先据此判断题型（适用于用 checkbox 模拟单选等场景）</div>
      <div class="rule-form-group">
        <label>单选指示器</label>
        <input type="text" id="rule-singleIndicators" value="${escapeHtml(singleIndicators)}" placeholder="singleContainer, singleChoice">
      </div>
      <div class="rule-form-group">
        <label>多选指示器</label>
        <input type="text" id="rule-multipleIndicators" value="${escapeHtml(multipleIndicators)}" placeholder="multipleContainer, multipleChoice">
      </div>
      <div class="rule-form-group">
        <label>判断指示器</label>
        <input type="text" id="rule-judgeIndicators" value="${escapeHtml(judgeIndicators)}" placeholder="judgeContainer, true-false">
      </div>

      <div class="rule-form-section">文本降级选择器</div>
      <div class="rule-form-group">
        <label>降级文本选择器（每行一个）</label>
        <textarea id="rule-fallbackTextSelectors" rows="4">${escapeHtml(fallbackTextSelectors)}</textarea>
      </div>

      <div class="rule-form-section">题型检测关键词</div>
      <div class="rule-form-group">
        <label>多选题关键词（逗号分隔）</label>
        <input type="text" id="rule-kwMultiple" value="${escapeHtml(multipleKw)}" placeholder="多选, 以下哪些, 至少选">
      </div>
      <div class="rule-form-group">
        <label>判断题关键词（逗号分隔）</label>
        <input type="text" id="rule-kwJudge" value="${escapeHtml(judgeKw)}" placeholder="正确, 错误, 对, 错">
      </div>
      <div class="rule-form-group">
        <label>填空题关键词（逗号分隔）</label>
        <input type="text" id="rule-kwFill" value="${escapeHtml(fillKw)}" placeholder="___, 【, 填空">
      </div>
    `;

    drawerSaveBtn.dataset.action = 'save-rule';
    drawerSaveBtn.dataset.ruleId = rule.id || '';
    drawerSaveBtn.dataset.ruleDomain = rule.domain || '';
  }

  /**
   * 从抽屉表单中收集数据并保存规则
   */
  async function saveRuleFromDrawer() {
    const originalId = drawerSaveBtn.dataset.ruleId || '';
    const originalDomain = drawerSaveBtn.dataset.ruleDomain || '';

    const domain = drawerBodyEl.querySelector('#rule-domain').value.trim();
    if (!domain) {
      showRuleStatus('域名不能为空');
      return;
    }

    const parseLines = (text) => text.split('\n').map(s => s.trim()).filter(Boolean);
    const parseKeywords = (text) => text.split(',').map(s => s.trim()).filter(Boolean);

    const updatedFields = {
      domain,
      name: domain,
      selectors: {
        rootSelectors: parseLines(drawerBodyEl.querySelector('#rule-rootSelectors').value),
        questionItemSelector: drawerBodyEl.querySelector('#rule-questionItemSelector').value.trim(),
        typeHeadingSelector: drawerBodyEl.querySelector('#rule-typeHeadingSelector').value.trim(),
        questionTextSelectors: parseLines(drawerBodyEl.querySelector('#rule-questionTextSelectors').value),
        optionContainerSelectors: parseLines(drawerBodyEl.querySelector('#rule-optionContainerSelectors').value),
        optionItemSelector: drawerBodyEl.querySelector('#rule-optionItemSelector').value.trim(),
        optionNumberSelector: drawerBodyEl.querySelector('#rule-optionNumberSelector').value.trim(),
        typeIndicators: {
          single: parseKeywords(drawerBodyEl.querySelector('#rule-singleIndicators').value),
          multiple: parseKeywords(drawerBodyEl.querySelector('#rule-multipleIndicators').value),
          judge: parseKeywords(drawerBodyEl.querySelector('#rule-judgeIndicators').value)
        },
        fallbackTextSelectors: parseLines(drawerBodyEl.querySelector('#rule-fallbackTextSelectors').value)
      },
      typeKeywords: {
        multiple: parseKeywords(drawerBodyEl.querySelector('#rule-kwMultiple').value),
        judge: parseKeywords(drawerBodyEl.querySelector('#rule-kwJudge').value),
        fill: parseKeywords(drawerBodyEl.querySelector('#rule-kwFill').value)
      }
    };

    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];

    // 如果域名变了，检查是否与其他规则冲突
    if (domain !== originalDomain) {
      const conflict = rules.find(r => r.domain === domain);
      if (conflict) {
        showRuleStatus(`域名 ${domain} 已存在规则，无法重复`);
        return;
      }
    }

    const idx = rules.findIndex(r => r.id === originalId);
    if (idx >= 0) {
      rules[idx] = { ...rules[idx], ...updatedFields, lastUsed: Date.now() };
    } else {
      rules.push({ ...updatedFields, id: `manual-${Date.now()}`, timestamp: Date.now(), lastUsed: Date.now() });
    }

    await chrome.storage.local.set({ parse_rules: rules });
    showRuleStatus('规则已保存');
    closeDrawer();
    await loadParseRules();
  }

  // ===== 快捷键工具 =====
  function getDefaultShortcut() {
    return { ...DEFAULT_SHORTCUT };
  }

  function normalizeShortcutConfig(shortcut) {
    if (!shortcut || typeof shortcut !== 'object') return null;
    const normalized = {
      altKey: !!shortcut.altKey,
      ctrlKey: !!shortcut.ctrlKey,
      metaKey: !!shortcut.metaKey,
      shiftKey: !!shortcut.shiftKey,
      code: String(shortcut.code || ''),
      key: String(shortcut.key || '')
    };

    if (!normalized.altKey && !normalized.ctrlKey && !normalized.metaKey && !normalized.shiftKey) {
      return null;
    }

    if (!normalized.code && !normalized.key) {
      return null;
    }

    normalized.display = formatShortcutDisplay(normalized);
    return normalized;
  }

  function formatShortcutDisplay(shortcut) {
    if (!shortcut) return '未设置';
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.metaKey) parts.push('Meta');
    if (shortcut.altKey) parts.push('Alt');
    if (shortcut.shiftKey) parts.push('Shift');

    const keyLabel = getShortcutKeyLabel(shortcut);
    if (keyLabel) parts.push(keyLabel);
    return parts.join('+') || '未设置';
  }

  function getShortcutKeyLabel(shortcut) {
    const code = shortcut.code || '';
    const key = shortcut.key || '';

    if (/^Key[A-Z]$/i.test(code)) return code.slice(3).toUpperCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    if (code === 'Space') return 'Space';
    if (code.startsWith('Arrow')) return code.replace('Arrow', '');
    if (code) return code.replace(/^Key|^Digit|^Numpad/, '');
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function updateShortcutDisplay() {
    shortcutDisplayEl.classList.remove('recording');
    shortcutDisplayEl.textContent = currentShortcut ? currentShortcut.display : '未设置';
    shortcutHintEl.textContent = currentShortcut
      ? '默认快捷键为 Alt+Q，macOS 上对应 Option+Q'
      : '当前未设置快捷键，保存后将关闭快捷键功能。';
  }

  function isModifierKey(key) {
    return ['Alt', 'Control', 'Meta', 'Shift'].includes(key);
  }

  // ===== 文件读取与通用工具 =====
  function showStatus(msg) {
    statusDiv.textContent = msg;
    setTimeout(() => {
      if (statusDiv.textContent === msg) {
        statusDiv.textContent = '';
      }
    }, 3000);
  }

  function readExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          let text = '';
          workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const sheetText = XLSX.utils.sheet_to_csv(sheet, { header: 1 });
            text += sheetText + '\n\n';
          });
          resolve(text);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function readWordFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => {
        mammoth.extractRawText({ arrayBuffer: event.target.result })
          .then(result => resolve(result.value))
          .catch(reject);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function normalizeBankQuestionType(type) {
    const value = String(type || '').toLowerCase();
    if (value.includes('single') || value.includes('单选')) return 'single';
    if (value.includes('multiple') || value.includes('multi') || value.includes('多选')) return 'multiple';
    if (value.includes('judge') || value.includes('judgement') || value.includes('判断')) return 'judge';
    if (value.includes('fill') || value.includes('blank') || value.includes('填空')) return 'fill';
    return 'unknown';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
