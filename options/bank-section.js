// 题库管理模块

function initBank({
  bankListEl, bankFileInput, bankStatusEl,
  questionBankEnabledInput, onOpenDrawer, onCloseDrawer
}) {
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
    await chrome.storage.local.set({ active_bank_ids: activeBankIds });

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
      item.className = `list-item ${enabled ? 'active' : ''}`;
      item.dataset.id = bank.id;

      const date = new Date(bank.timestamp).toLocaleString('zh-CN');
      const enabledText = enabled
        ? (questionBankEnabled ? '已启用' : '已选中（总开关关闭）')
        : '未启用';

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(bank.name || '未命名题库')}</div>
            <div class="list-item-meta">${date} · ${bank.questions.length} 题 · ${enabledText}</div>
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
      // Use the drawer reference from the outer scope to close if relevant
      showBankStatus('题库已删除');
      await loadQuestionBanks();
      return;
    }

    if (action === 'view') {
      onOpenDrawer('bank', bank);
    }
  }

  questionBankEnabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ question_bank_enabled: questionBankEnabledInput.checked });
    showBankStatus(questionBankEnabledInput.checked ? '已启用题库优先回答' : '已关闭题库优先回答');
    await loadQuestionBanks();
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
        action: 'parseQuestionBank', text, fileName
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

  return { loadQuestionBanks, getQuestionBankState };
}
