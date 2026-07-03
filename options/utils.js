// 选项页共享常量和工具函数

const PAGE_SIZE = 10;

const TYPE_LABELS = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', unknown: '其他' };
const TYPE_CLASSES = {
  single: 'background:#e3f2fd;color:#1565c0',
  multiple: 'background:#f3e5f5;color:#6a1b9a',
  judge: 'background:#e8f5e9;color:#2e7d32',
  fill: 'background:#fff3e0;color:#e65100',
  unknown: 'background:#f5f5f5;color:#616161'
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseLines(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function parseKeywords(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

function normalizeArrayField(value, mode) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return mode === 'keywords' ? parseKeywords(value) : parseLines(value);
  return [];
}

function normalizeBankQuestionType(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('single') || value.includes('单选')) return 'single';
  if (value.includes('multiple') || value.includes('multi') || value.includes('多选')) return 'multiple';
  if (value.includes('judge') || value.includes('judgement') || value.includes('判断')) return 'judge';
  if (value.includes('fill') || value.includes('blank') || value.includes('填空')) return 'fill';
  return 'unknown';
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

function makeUniqueRuleId(desiredId, rules, skipIndex) {
  const base = String(desiredId || '').trim();
  const candidateBase = base || `manual-${Date.now()}`;
  const isTaken = value => rules.some((r, idx) => idx !== skipIndex && r && r.id === value);
  if (!isTaken(candidateBase)) return candidateBase;
  for (let i = 1; i < 1000; i++) {
    const next = `${candidateBase}-${i}`;
    if (!isTaken(next)) return next;
  }
  return `${candidateBase}-${Date.now()}`;
}

/**
 * 渲染分页控件
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

  container.appendChild(createBtn('<', currentPage - 1, { disabled: currentPage === 1 }));

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

  container.appendChild(createBtn('>', currentPage + 1, { disabled: currentPage === totalPages }));

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${currentPage}/${totalPages} 页 · 共 ${total} 条`;
  container.appendChild(info);
}
