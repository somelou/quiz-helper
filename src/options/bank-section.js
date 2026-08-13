// 题库管理模块

function initBank({
  bankListEl, bankFileInput,
  questionBankEnabledInput, onOpenDrawer, onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { bank: 1 };

  function showBankStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  async function getQuestionBankState() {
    const result = await chrome.storage.local.get([
      'question_banks', 'active_bank_id', 'active_bank_ids', 'question_bank_enabled'
    ]);

    const banks = result.question_banks || [];
    let activeBankIds = Array.isArray(result.active_bank_ids)
      ? result.active_bank_ids.filter(Boolean)
      : [];

    if (activeBankIds.length === 0 && result.active_bank_id) {
      activeBankIds = [result.active_bank_id];
    }

    activeBankIds = [...new Set(activeBankIds)].filter(id => banks.some(bank => bank.id === id));
    await safeSet({ active_bank_ids: activeBankIds });

    return { banks, activeBankIds, questionBankEnabled: result.question_bank_enabled !== false };
  }

  async function loadQuestionBanks() {
    const state = await getQuestionBankState();
    questionBankEnabledInput.checked = state.questionBankEnabled;
    renderQuestionBanks(state.banks, state.activeBankIds, state.questionBankEnabled);
  }

  function renderQuestionBanks(banks, activeBankIds, questionBankEnabled) {
    const bankCountHint = document.getElementById('bankCountHint');
    if (bankCountHint) {
      const totalQuestions = banks.reduce((sum, bank) => sum + (bank.questions ? bank.questions.length : 0), 0);
      bankCountHint.textContent = getMessage('optionsBankCountHint', [banks.length, totalQuestions.toLocaleString()]);
    }

    if (banks.length === 0) {
      bankListEl.innerHTML = '<div class="list-empty">' + getMessage('optionsBankEmpty') + '</div>';
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
      item.className = 'list-item' + (enabled ? '' : ' model-inactive');
      item.dataset.id = bank.id;

      const date = new Date(bank.timestamp).toLocaleString();

      const enabledBadge = enabled
        ? '<span class="model-badge model-enabled-badge">' + getMessage('optionsBankEnabledBadge') + '</span>'
        : '<span class="model-badge model-inactive-badge">' + getMessage('optionsBankDisabledBadge') + '</span>';

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(bank.name || getMessage('optionsBankUnnamed'))}
              ${enabledBadge}
            </div>
            <div class="list-item-meta">${getMessage('optionsBankMetaFormat', [date, bank.questions.length])}</div>
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle-enabled" data-idx="${idx}" ${enabled ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-view" data-action="view" data-idx="${idx}"><span data-icon="eye"></span>${getMessage('optionsView')}</button>
            <button class="action-btn action-delete" data-action="delete" data-idx="${idx}"><span data-icon="trash"></span>${getMessage('commonDelete')}</button>
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

    window.QuizHelperIcons?.replaceIcons(bankListEl);

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
      await safeSet({ active_bank_ids: activeBankIds });
      showBankStatus(getMessage(checked ? 'optionsBankEnabledMsg' : 'optionsBankDisabledMsg', [bank.name]));
      // 直接更新当前 item DOM，保留 switch 动画
      updateBankItemDom(index, bank, checked);
      // 更新计数提示
      const hintEl = document.getElementById('bankCountHint');
      if (hintEl) {
        const totalQuestions = banks.reduce((sum, b) => sum + (b.questions ? b.questions.length : 0), 0);
        hintEl.textContent = getMessage('optionsBankCountHint', [banks.length, totalQuestions.toLocaleString()]);
      }
      return;
    }

    if (action === 'delete') {
      if (!confirm(getMessage('optionsBankDeleteConfirm'))) return;
      banks.splice(index, 1);
      activeBankIds = activeBankIds.filter(id => id !== bank.id);
      await chrome.storage.local.set({
        question_banks: banks,
        active_bank_ids: activeBankIds,
        active_bank_id: activeBankIds[0] || null
      });
      // Use the drawer reference from the outer scope to close if relevant
      showBankStatus(getMessage('optionsBankDeleted'));
      await loadQuestionBanks();
      return;
    }

    if (action === 'view') {
      onOpenDrawer('bank', bank);
    }
  }

  function updateBankItemDom(idx, bank, enabled) {
    const checkbox = bankListEl.querySelector(`input[data-idx="${idx}"][data-action="toggle-enabled"]`);
    if (!checkbox) return;
    const item = checkbox.closest('.list-item');
    if (!item) return;
    item.classList.toggle('model-inactive', !enabled);
    const titleEl = item.querySelector('.list-item-title');
    if (titleEl) {
      const badge = enabled
        ? '<span class="model-badge model-enabled-badge">' + getMessage('optionsBankEnabledBadge') + '</span>'
        : '<span class="model-badge model-inactive-badge">' + getMessage('optionsBankDisabledBadge') + '</span>';
      titleEl.innerHTML = escapeHtml(bank.name || getMessage('optionsBankUnnamed')) + badge;
    }
  }

  questionBankEnabledInput.addEventListener('change', async () => {
    await safeSet({ question_bank_enabled: questionBankEnabledInput.checked });
    showBankStatus(questionBankEnabledInput.checked ? getMessage('optionsBankPreferEnabled') : getMessage('optionsBankPreferDisabled'));
    await loadQuestionBanks();
  });

  bankFileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;

    const progressEl = document.getElementById('bankProgress');
    const progressFill = document.getElementById('bankProgressFill');
    const progressText = document.getElementById('bankProgressText');
    const cancelBtn = document.getElementById('bankProgressCancel');
    let currentPort = null;

    const showProgress = (visible) => {
      if (progressEl) progressEl.style.display = visible ? 'block' : 'none';
    };
    const updateProgress = (percent, msg) => {
      if (progressFill) progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      if (progressText) progressText.textContent = msg || '';
    };

    // 取消按钮
    const onCancel = () => {
      if (currentPort) {
        currentPort.disconnect();
        currentPort = null;
        updateProgress(0, getMessage('optionsBankCancelling'));
        cancelBtn.disabled = true;
      }
    };
    cancelBtn.addEventListener('click', onCancel);

    showBankStatus(getMessage('optionsBankReadingFile'));

    try {
      let text = '';
      const fileName = file.name;

      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        text = await readExcelFile(file);
      } else if (fileName.endsWith('.docx')) {
        text = await readWordFile(file);
      } else {
        alert(getMessage('optionsBankFileFormatError'));
        return;
      }

      if (!text || text.length < 10) {
        alert(getMessage('optionsBankFileEmpty'));
        return;
      }

      showBankStatus('');
      showProgress(true);
      updateProgress(0, getMessage('optionsBankConnectingAi'));
      cancelBtn.disabled = false;
      cancelBtn.style.display = '';

      // 通过 port 通道通信，支持分批进度上报
      const parseResult = await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'parseQuestionBank' });
        currentPort = port;
        let settled = false;

        const finish = (result) => {
          if (!settled) {
            settled = true;
            currentPort = null;
            resolve(result);
            port.disconnect();
          }
        };

        port.onMessage.addListener((msg) => {
          if (msg.type === 'progress') {
            const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
            updateProgress(pct, msg.message || getMessage('optionsBankParsing'));
          } else if (msg.type === 'result') {
            finish(msg);
          }
        });

        port.onDisconnect.addListener(() => {
          if (!settled) {
            settled = true;
            currentPort = null;
            reject(new Error(getMessage('optionsBankParseDisconnected')));
          }
        });

        port.postMessage({ text, fileName });
      });

      showProgress(false);
      cancelBtn.style.display = 'none';
      showBankStatus('');

      // 取消且无结果
      if (parseResult.cancelled && !parseResult.success) {
        showBankStatus(getMessage('optionsBankParseCancelled'));
        return;
      }

      if (!parseResult.success) {
        alert(getMessage('optionsBankParseFailedFormat', [parseResult.error || getMessage('commonUnknownError')]));
        return;
      }

      const result = await chrome.storage.local.get(['question_banks']);
      const banks = result.question_banks || [];
      const newBank = {
        id: Date.now().toString(),
        name: fileName,
        timestamp: Date.now(),
        questions: parseResult.questions.map((q, i) => ({
          id: q.id || i + 1,
          text: (q.text || '').trim(),
          type: normalizeBankQuestionType(q.type),
          answer: (q.answer || '').trim(),
          analysis: (q.analysis || '').trim()
        })).filter(q => q.text.length > 0)
      };

      if (!newBank.questions.length) {
        alert(getMessage('optionsBankNoQuestions'));
        return;
      }

      banks.unshift(newBank);
      if (banks.length > 10) banks.length = 10;

      await safeSet({ question_banks: banks });

      const warnMsg = parseResult.warnings && parseResult.warnings.length > 0
        ? `（${parseResult.warnings[0]}）`
        : '';
      showBankStatus(getMessage('optionsBankImportedFormat', [newBank.questions.length, warnMsg]));
      await loadQuestionBanks();
    } catch (err) {
      console.error('导入失败:', err);
      showProgress(false);
      cancelBtn.style.display = 'none';
      updateProgress(0, '');
      alert(getMessage('optionsBankImportFailedFormat', [err.message || getMessage('commonUnknownError')]));
      showBankStatus('');
    }

    bankFileInput.value = '';
  });

  // --- 导入设置 ---
  (async function initImportSettings() {
    const importMode = document.getElementById('importMode');
    const importModeHint = document.getElementById('importModeHint');
    if (!importMode) return;

    // 导入模式配置统一来自 shared/constants.js（IMPORT_MODES），与后台并发/批大小共用一份
    const MODE_MAP = globalThis.QuizHelperConstants.IMPORT_MODES;

    const result = await chrome.storage.local.get(['import_mode']);
    const currentMode = result.import_mode || 'balanced';

    // 初始化 active 状态并触发滑动指示器
    importMode.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('seg-active', btn.dataset.value === currentMode);
    });
    setSegValue(importMode, currentMode);
    if (importModeHint && MODE_MAP[currentMode]) {
      importModeHint.textContent = MODE_MAP[currentMode].label;
    }

    importMode.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const mode = btn.dataset.value;
      if (importModeHint && MODE_MAP[mode]) {
        importModeHint.textContent = MODE_MAP[mode].label;
      }
      safeSet({ import_mode: mode });
    });
  })();

  return { loadQuestionBanks, getQuestionBankState };
}
