// 设置页面逻辑：保存/读取 API 配置 + 历史记录管理

document.addEventListener('DOMContentLoaded', async () => {
  // ===== 配置区域 =====
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model');
  const systemPromptInput = document.getElementById('systemPrompt');
  const allowedDomainsInput = document.getElementById('allowedDomains');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusDiv = document.getElementById('status');
  const toggleKeyBtn = document.getElementById('toggleKey');

  // 加载已有配置
  const config = await chrome.storage.local.get([
    'api_url', 'api_key', 'model', 'system_prompt', 'allowed_domains'
  ]);

  apiUrlInput.value = config.api_url || 'https://api.openai.com/v1';
  apiKeyInput.value = config.api_key || '';
  modelInput.value = config.model || 'gpt-3.5-turbo';
  systemPromptInput.value = config.system_prompt || '';
  allowedDomainsInput.value = (config.allowed_domains || []).join('\n');

  // 切换 API Key 显示/隐藏
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '隐藏';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '显示';
    }
  });

  // 保存配置
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
      allowed_domains: domains
    });
    showStatus('设置已保存');
  });

  // 恢复默认配置
  resetBtn.addEventListener('click', async () => {
    apiUrlInput.value = 'https://api.openai.com/v1';
    apiKeyInput.value = '';
    modelInput.value = 'gpt-3.5-turbo';
    systemPromptInput.value = '';
    allowedDomainsInput.value = '';
    await chrome.storage.local.remove(['api_url', 'api_key', 'model', 'system_prompt', 'allowed_domains']);
    showStatus('已恢复默认设置');
  });

  function showStatus(msg) {
    statusDiv.textContent = msg;
    setTimeout(() => { statusDiv.textContent = ''; }, 3000);
  }

  // ===== 历史记录区域 =====
  const historyListEl = document.getElementById('historyList');
  const exportAllBtn = document.getElementById('exportAllHistory');
  const clearHistoryBtn = document.getElementById('clearHistory');

  const typeLabels = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', unknown: '其他' };
  const typeClasses = {
    single: 'background:#e3f2fd;color:#1565c0',
    multiple: 'background:#f3e5f5;color:#6a1b9a',
    judge: 'background:#e8f5e9;color:#2e7d32',
    fill: 'background:#fff3e0;color:#e65100',
    unknown: 'background:#f5f5f5;color:#616161'
  };

  async function loadHistory() {
    const result = await chrome.storage.local.get(['exam_history']);
    const history = result.exam_history || [];
    renderHistory(history);
  }

  function renderHistory(history) {
    if (history.length === 0) {
      historyListEl.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      return;
    }

    historyListEl.innerHTML = '';
    history.forEach((record, idx) => {
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
        <div class="history-detail" id="history-detail-${idx}"></div>
      `;

      item.querySelector('.history-btn-view').addEventListener('click', () => toggleHistoryDetail(idx, record));
      item.querySelector('.history-btn-export').addEventListener('click', () => exportSingleHistory(record));
      item.querySelector('.history-btn-delete').addEventListener('click', () => deleteHistoryItem(idx));

      historyListEl.appendChild(item);
    });
  }

  function toggleHistoryDetail(idx, record) {
    const detail = document.getElementById(`history-detail-${idx}`);
    detail.classList.toggle('open');
    if (!detail.classList.contains('open')) return;

    let html = '';
    record.questions.forEach(q => {
      const typeLabel = typeLabels[q.type] || '其他';
      const typeStyle = typeClasses[q.type] || typeClasses.unknown;
      const answerHtml = q.status === 'error'
        ? `<div class="q-label">解析结果</div><div class="q-error">分析出错</div>`
        : `<div class="q-label">参考答案</div><div class="q-answer">${escapeHtml(q.answer || '未获取答案')}</div>`;
      html += `
        <div class="q-item">
          <div class="q-title">
            <span class="q-id">${q.id}</span>
            <span class="q-type" style="${typeStyle}">${typeLabel}</span>
          </div>
          <div class="q-label">题目</div>
          <div class="q-text">${escapeHtml(q.text)}</div>
          ${answerHtml}
        </div>
      `;
    });
    detail.innerHTML = html;
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
    a.download = `quiz-${title}-${new Date(record.timestamp).toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
    a.download = `quiz-helper-history-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
    await chrome.storage.local.remove(['exam_history']);
    renderHistory([]);
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 初始化加载历史记录
  loadHistory();
});
