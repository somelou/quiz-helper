// 历史记录管理模块

function initHistory({ historyListEl, onOpenDrawer }) {
  const paginationState = { history: 1 };

  async function loadHistory() {
    const result = await chrome.storage.local.get(['exam_history']);
    renderHistory(result.exam_history || []);
  }

  function renderHistory(history) {
    if (history.length === 0) {
      historyListEl.innerHTML = '<div class="list-empty">暂无历史记录</div>';
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
      item.className = 'list-item';

      const date = new Date(record.timestamp).toLocaleString('zh-CN');
      const doneCount = record.questions.filter(q => q.status === 'done').length;
      const errorCount = record.questions.filter(q => q.status === 'error').length;

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(record.title || '未命名试卷')}</div>
            <div class="list-item-meta">${date} · ${record.questions.length} 题 · 已完成 ${doneCount} 题${errorCount > 0 ? ` · ${errorCount} 题出错` : ''}</div>
            <div class="list-item-meta">${escapeHtml(record.url || '')}</div>
          </div>
          <div class="list-item-actions">
            <button class="action-btn action-view" data-idx="${idx}">查看</button>
            <button class="action-btn action-export" data-idx="${idx}">导出</button>
            <button class="action-btn action-delete" data-idx="${idx}">删除</button>
          </div>
        </div>
      `;

      item.querySelector('.action-view').addEventListener('click', () => onOpenDrawer('history', record));
      item.querySelector('.action-export').addEventListener('click', () => exportSingleHistory(record));
      item.querySelector('.action-delete').addEventListener('click', () => deleteHistoryItem(idx));

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

  return { loadHistory, renderHistory };
}
