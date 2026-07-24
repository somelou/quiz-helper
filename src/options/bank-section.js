// 题库管理模块

function initBank({
  bankListEl, bankFileInput, bankStatusEl,
  questionBankEnabledInput, onOpenDrawer, onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { bank: 1 };

  function showBankStatus(msg) {
    bankStatusEl.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (bankStatusEl.textContent === msg) bankStatusEl.textContent = '';
      }, 3000);
    }
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
      const activeCount = activeBankIds.length;
      bankCountHint.textContent = activeCount > 0
        ? `共 ${banks.length} 个题库，${activeCount} 个已启用`
        : `共 ${banks.length} 个题库`;
    }

    if (banks.length === 0) {
      bankListEl.innerHTML = '<div class="list-empty">暂无题库。点击上方"+ 导入题库"按钮上传 Excel(.xlsx/.xls) 或 Word(.docx) 文件。</div>';
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

      const date = new Date(bank.timestamp).toLocaleString('zh-CN');

      const enabledBadge = enabled
        ? '<span class="model-badge model-preferred">已启用</span>'
        : '<span class="model-badge model-inactive-badge">未启用</span>';

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(bank.name || '未命名题库')}
              ${enabledBadge}
            </div>
            <div class="list-item-meta">${date} · ${bank.questions.length} 题</div>
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle-enabled" data-idx="${idx}" ${enabled ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-view" data-action="view" data-idx="${idx}">查看</button>
            <button class="action-btn action-delete" data-action="delete" data-idx="${idx}">删除</button>
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
      await safeSet({ active_bank_ids: activeBankIds });
      showBankStatus(`${checked ? '已启用' : '已停用'}题库：${bank.name}`);
      // 直接更新当前 item DOM，保留 switch 动画
      updateBankItemDom(index, bank, checked);
      // 更新计数提示
      const hintEl = document.getElementById('bankCountHint');
      if (hintEl) {
        hintEl.textContent = `共 ${banks.length} 个题库，已启用 ${activeBankIds.length} 个`;
      }
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
      // Use the drawer reference from the outer scope to close if relevant
      showBankStatus('题库已删除');
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
        ? '<span class="model-badge model-preferred">已启用</span>'
        : '<span class="model-badge model-inactive-badge">未启用</span>';
      titleEl.innerHTML = escapeHtml(bank.name || '未命名题库') + badge;
    }
  }

  questionBankEnabledInput.addEventListener('change', async () => {
    await safeSet({ question_bank_enabled: questionBankEnabledInput.checked });
    showBankStatus(questionBankEnabledInput.checked ? '已启用题库优先回答' : '已关闭题库优先回答');
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
        updateProgress(0, '正在取消...');
        cancelBtn.disabled = true;
      }
    };
    cancelBtn.addEventListener('click', onCancel);

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

      showBankStatus('');
      showProgress(true);
      updateProgress(0, '正在连接 AI 解析服务...');
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
            updateProgress(pct, msg.message || `正在解析...`);
          } else if (msg.type === 'result') {
            finish(msg);
          }
        });

        port.onDisconnect.addListener(() => {
          if (!settled) {
            settled = true;
            currentPort = null;
            reject(new Error('解析服务连接已断开'));
          }
        });

        port.postMessage({ text, fileName });
      });

      showProgress(false);
      cancelBtn.style.display = 'none';
      showBankStatus('');

      // 取消且无结果
      if (parseResult.cancelled && !parseResult.success) {
        showBankStatus('解析已取消');
        return;
      }

      if (!parseResult.success) {
        alert('解析失败：' + (parseResult.error || '未知错误'));
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
        alert('解析失败：未提取到有效题目');
        return;
      }

      banks.unshift(newBank);
      if (banks.length > 10) banks.length = 10;

      await safeSet({ question_banks: banks });

      const warnMsg = parseResult.warnings && parseResult.warnings.length > 0
        ? `（${parseResult.warnings[0]}）`
        : '';
      showBankStatus(`题库导入成功，共 ${newBank.questions.length} 道题目${warnMsg}`);
      await loadQuestionBanks();
    } catch (err) {
      console.error('导入失败:', err);
      showProgress(false);
      cancelBtn.style.display = 'none';
      updateProgress(0, '');
      alert('导入失败：' + (err.message || '未知错误'));
      showBankStatus('');
    }

    bankFileInput.value = '';
  });

  // --- 导入设置 ---
  (async function initImportSettings() {
    const importMode = document.getElementById('importMode');
    const importModeHint = document.getElementById('importModeHint');
    if (!importMode) return;

    const MODE_MAP = {
      eco: { concurrency: 5, batchSize: 100, label: '并发 5 批 · 每批 100 题，速度较慢，适合 token 不足或 API 限流严格的场景' },
      balanced: { concurrency: 10, batchSize: 50, label: '并发 10 批 · 每批 50 题，均衡速度与稳定性，推荐日常使用' },
      precise: { concurrency: 10, batchSize: 25, label: '并发 10 批 · 每批 25 题，小批次高精度，适合题目格式复杂、容易解析出错的题库' }
    };

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
