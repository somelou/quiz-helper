// 选项页共享常量和工具函数

const PAGE_SIZE = 10;

// 题型中文标签统一复用 shared/constants.js（面板与选项页共用一份，避免双份维护）
const TYPE_LABELS = globalThis.QuizHelperConstants.TYPE_LABELS;
const TYPE_CLASSES = {
  single: 'q-type-single',
  multiple: 'q-type-multiple',
  judge: 'q-type-judge',
  fill: 'q-type-fill',
  unknown: 'q-type-unknown'
};

// HTML 转义统一复用 shared/text-utils.js（避免双份实现）
const escapeHtml = globalThis.QuizHelperTextUtils.escapeHtml;

function parseLines(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function parseKeywords(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 初始化抽屉内分段滑块指示器（同步执行，确保首次绘制前 CSS 变量已就位）
 * 依赖 options/index.js 中定义的全局 setSegValue
 * @param {HTMLElement} drawerBodyEl - 抽屉内容容器
 */
function initDrawerSegControls(drawerBodyEl) {
  drawerBodyEl.getBoundingClientRect();
  drawerBodyEl.querySelectorAll('.segmented-control').forEach(seg => {
    const active = seg.querySelector('.seg-active');
    if (active) setSegValue(seg, active.dataset.value);
  });
}

function normalizeArrayField(value, mode) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return mode === 'keywords' ? parseKeywords(value) : parseLines(value);
  return [];
}

// 题型归一化统一复用 shared/text-utils.js（与后台 AI 解析、题库导入共用一份）
const normalizeBankQuestionType = globalThis.QuizHelperTextUtils.normalizeQuestionType;

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
    if (opts.icon) {
      const span = document.createElement('span');
      span.setAttribute('data-icon', opts.icon);
      span.setAttribute('aria-hidden', 'true');
      btn.appendChild(span);
      btn.setAttribute('aria-label', text);
    } else {
      btn.textContent = text;
    }
    if (opts.disabled) btn.disabled = true;
    if (!opts.active && !opts.disabled) {
      btn.addEventListener('click', () => onPageChange(page));
    }
    return btn;
  };

  container.appendChild(createBtn('上一页', currentPage - 1, { disabled: currentPage === 1, icon: 'chevron-left' }));

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

  container.appendChild(createBtn('下一页', currentPage + 1, { disabled: currentPage === totalPages, icon: 'chevron-right' }));

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = getMessage('optionsPaginationFormat', [currentPage, totalPages, total]);
  container.appendChild(info);

  window.QuizHelperIcons?.replaceIcons(container);
}
