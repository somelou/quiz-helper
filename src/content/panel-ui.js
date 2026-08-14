(() => {
  'use strict';

  const state = globalThis.QuizHelperContentState;
  const { escapeHtml, normalizeWhitespace } = globalThis.QuizHelperTextUtils;
  const { TYPE_LABELS, STATUS_LABELS } = globalThis.QuizHelperConstants;
  const { getMessage } = globalThis.QuizHelperI18n;

  // 面板级 matchMedia 监听器引用（createPanel 只注册一次，destroyPanel 时移除）
  let darkMediaQueryRef = null;
  let darkMediaQueryHandler = null;

  // shadow DOM 内主题根容器（承载 data-theme-style，供主题组件覆盖选择器匹配）
  let panelThemeRoot = null;

  // ===== 工具函数 =====

  /**
   * 格式化 AI 回答文本为 HTML
   * @param {string} text
   * @returns {string}
   */
  function formatAnswer(text) {
    let html = escapeHtml(text || '');
    html = html.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  /**
   * 流式更新答案（思考区默认折叠、加载动画、限制高度、自动滚动）
   * @param {number} index
   * @param {string} thinkingText - 思考完整文本
   * @param {string} answerText - 答案正文完整文本
   * @param {boolean} thinkingActive - 是否仍在思考中（显示 loading）
   */
  function updateAnswerStream(index, thinkingText, answerText, thinkingActive = false) {
    if (!state.shadowRoot) return;
    const bodyEl = state.shadowRoot.getElementById(`card-body-${index}`);
    if (!bodyEl) return;

    const hasThinking = thinkingText && thinkingText.length > 0;
    let answerEl = bodyEl.querySelector('.qh-answer-text');

    // answerEl 存在但思考区未创建（被 updateCardBody 预创建了）时也需要重建布局
    if (!answerEl || !bodyEl.querySelector('.qh-thinking-section')) {
      // 首次调用，创建完整布局（思考区默认折叠隐藏）
      const question = state.questionsData[index];
      if (!question) return;
      bodyEl.innerHTML = `
        <div class="qh-question-section">
          <div class="qh-section-title-row">
            <div class="qh-section-title">${getMessage('panelQuestionLabel')}</div>
            <button class="qh-copy-btn">${getMessage('panelCopy')}</button>
          </div>
          <div class="qh-question-text">${escapeHtml(question.text)}</div>
        </div>
        <div class="qh-thinking-section" style="display:none">
          <div class="qh-thinking-header qh-thinking-collapsed">
            <span class="qh-thinking-dot"></span>
            <span>${getMessage('panelDeepThinking')}<span class="qh-thinking-spinner" style="display:${thinkingActive ? '' : 'none'}"></span></span>
            <svg class="qh-thinking-chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </div>
          <div class="qh-thinking-body" style="display:none">${hasThinking ? escapeHtml(thinkingText) : ''}</div>
        </div>
        <div class="qh-answer-section">
          <div class="qh-section-title">${getMessage('panelReferenceAnswer')}</div>
          <div class="qh-answer-text">${escapeHtml(answerText) || getMessage('panelAnswerRequesting')}</div>
        </div>`;

      // 绑定复制按钮
      const copyBtn = bodyEl.querySelector('.qh-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(question.text).catch(() => {});
        });
      }

      // 绑定思考折叠
      const thinkingHeader = bodyEl.querySelector('.qh-thinking-header');
      if (thinkingHeader) {
        thinkingHeader.addEventListener('click', () => {
          const thinkingBody = bodyEl.querySelector('.qh-thinking-body');
          const collapsed = thinkingBody.style.display === 'none';
          thinkingBody.style.display = collapsed ? '' : 'none';
          thinkingHeader.classList.toggle('qh-thinking-collapsed', !collapsed);
        });
      }
    } else {
      // 后续增量更新
      const thinkingSection = bodyEl.querySelector('.qh-thinking-section');
      const thinkingBody = bodyEl.querySelector('.qh-thinking-body');
      const thinkingHeader = bodyEl.querySelector('.qh-thinking-header');

      if (hasThinking && thinkingSection && thinkingBody && thinkingHeader) {
        thinkingSection.style.display = '';
        thinkingBody.style.display = '';
        thinkingHeader.classList.remove('qh-thinking-collapsed');
        thinkingBody.textContent = thinkingText;
        thinkingBody.scrollTop = thinkingBody.scrollHeight;
        // spinner 用 class 控制，避免重置动画
        const spinnerEl = thinkingHeader.querySelector('.qh-thinking-spinner');
        if (spinnerEl) spinnerEl.style.display = thinkingActive ? '' : 'none';
      }
      if (answerEl) answerEl.textContent = answerText;
    }

    // 自动滚到底部
    if (answerEl) {
      const answerSection = answerEl.closest('.qh-answer-section');
      if (answerSection) answerSection.scrollTop = answerSection.scrollHeight;
    }
  }

  // ===== 渲染辅助 =====

  function getTypeLabel(type) {
    return TYPE_LABELS[type] || getMessage('typeUnknown');
  }

  function getTypeClass(type) {
    return `qh-type-${type}`;
  }

  function getStatusLabel(status) {
    return STATUS_LABELS[status] || getMessage('statusPending');
  }

  function getStatusClass(status) {
    return `qh-status-${status}`;
  }

  /**
   * 复制文本到剪贴板，优先使用 Clipboard API，失败时降级到 execCommand。
   * @param {string} text
   * @returns {Promise<void>}
   */
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

  /**
   * 构造题目复制文案。
   * @param {Object} question
   * @returns {string}
   */
  function buildQuestionCopyText(question) {
    return `【${getTypeLabel(question.type)}】${question.text || ''}`.trim();
  }

  /**
   * 获取答案区显示内容。
   * @param {Object} question
   * @returns {{content: string, isError: boolean}}
   */
  function getAnswerSectionState(question) {
    if (question.answer) {
      return {
        content: formatAnswer(question.answer),
        isError: question.status === 'error'
      };
    }

    if (question.status === 'loading') {
      return {
        content: getMessage('panelAnswerLoading'),
        isError: false
      };
    }

    if (question.status === 'error') {
      return {
        content: getMessage('panelAnswerFailed'),
        isError: true
      };
    }

    return {
      content: `<span class="qh-loading-text">${getMessage('statusPending')}</span>`,
      isError: false
    };
  }

  /**
   * 获取题目摘要（第一行前44字符）
   * @param {string} text
   * @returns {string}
   */
  function getSummary(text) {
    const firstLine = normalizeWhitespace((text || '').split('\n')[0] || '');
    return firstLine.length > 44 ? firstLine.slice(0, 44) + '...' : firstLine;
  }

  /**
   * 从 AI 回答文本中提取答案结果（用于卡片头部展示）
   * @param {string} text
   * @returns {string}
   */
  function getAnswerResult(text) {
    const t = normalizeWhitespace(text || '');
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0] || '';

    // 中英文答案标记均可识别：答案：/ Answer: （(.+) 不跨行，可同时避免误吞解析部分）
    const answerMatch = t.match(/(?:答案[：:]|Answer\s*[：:])\s*(.+)/i);
    if (answerMatch) {
      const ans = answerMatch[1].trim();
      const letters = ans.match(/^([A-H]+)$/i);
      if (letters) return letters[1].toUpperCase();
      if (/^(正确|对|是|true)$/i.test(ans)) return getMessage('panelAnswerCorrect');
      if (/^(错误|错|否|false)$/i.test(ans)) return getMessage('panelAnswerWrong');
      return ans.length > 10 ? ans.slice(0, 10) + '...' : ans;
    }

    const optionLines = lines.filter(line => /^[A-H][\.\、\)\s]/.test(line));
    if (optionLines.length >= 2) {
      return optionLines.map(line => line[0].toUpperCase()).join('');
    }

    const multiMatch = firstLine.match(/(?:答案[：:]?\s*)?([A-H](?:[\s,]+[A-H]){1,})/i);
    if (multiMatch) return multiMatch[1].replace(/[\s,]/g, '').toUpperCase();

    const singleMatch = firstLine.match(/^([A-H])[\.\、\)]/);
    if (singleMatch) return singleMatch[1].toUpperCase();

    if (/^(正确|对|是|true)\b/i.test(firstLine)) return getMessage('panelAnswerCorrect');
    if (/^(错误|错|否|false)\b/i.test(firstLine)) return getMessage('panelAnswerWrong');

    return firstLine.length > 10 ? firstLine.slice(0, 10) + '...' : firstLine;
  }

  // ===== 卡片渲染 =====

  /**
   * 渲染所有题目卡片
   */
  function renderCards() {
    if (!state.shadowRoot) return;
    const body = state.shadowRoot.getElementById('qh-body');
    if (!body) return;

    if (state.questionsData.length === 0) {
      body.innerHTML = getMessage('panelEmptyNoQuestions');
      updateControls();
      updateProgress();
      return;
    }

    body.innerHTML = '';
    state.questionsData.forEach((question, index) => {
      const card = document.createElement('div');
      card.className = 'qh-card';
      const answerPreview = (question.answer && question.status === 'done')
        ? `<span class="qh-card-answer">${escapeHtml(getAnswerResult(question.answer))}</span>`
        : '';
      card.innerHTML = `
        <div class="qh-card-header">
          <span class="qh-card-num">${question.id}</span>
          <span class="qh-card-type ${getTypeClass(question.type)}">${getTypeLabel(question.type)}</span>
          <span class="qh-card-summary">${escapeHtml(getSummary(question.text))}</span>
          ${answerPreview}
          <span class="qh-card-status ${getStatusClass(question.status)}">${getStatusLabel(question.status)}</span>
        </div>
        <div class="qh-card-body" id="card-body-${index}"></div>
      `;

      card.querySelector('.qh-card-header').addEventListener('click', () => {
        card.querySelector(`#card-body-${index}`).classList.toggle('open');
      });

      body.appendChild(card);
      const answerState = getAnswerSectionState(question);
      // 批量渲染时静默更新卡片内容，循环结束后统一刷新进度与按钮，避免 O(n²) 重复计算
      updateCardBody(index, answerState.content, answerState.isError, true);
    });

    updateProgress();
    updateControls();
  }

  /**
   * 在面板中显示消息
   * @param {string} message
   */
  function showPanelMessage(message) {
    ensurePanel(state.questionsData.length);
    const body = state.shadowRoot.getElementById('qh-body');
    if (body) {
      body.innerHTML = `
        <div class="qh-empty">
          <span class="qh-empty-icon" data-icon="help-circle" aria-hidden="true"></span>
          <span>${escapeHtml(message).replace(/\n/g, '<br>')}</span>
        </div>`;
      window.QuizHelperIcons?.replaceIcons(body);
    }
    updateControls();
    updateProgress();
  }

  /**
   * 更新单张卡片的内容区域
   * @param {number} index
   * @param {string} content
   * @param {boolean} isError
   * @param {boolean} [silent=false] - 为 true 时跳过进度/按钮刷新（批量渲染时由调用方统一刷新）
   */
  /**
   * 同步卡片头部的状态标签与答案预览
   * @param {number} qIndex - 题目下标
   * @param {Object} question - 题目对象
   */
  function syncCardHeader(qIndex, question) {
    const card = state.shadowRoot?.getElementById(`card-body-${qIndex}`)?.closest('.qh-card');
    if (!card) return;
    const headerEl = card.querySelector('.qh-card-header');
    const statusEl = card.querySelector('.qh-card-status');
    if (statusEl) {
      statusEl.className = `qh-card-status ${getStatusClass(question.status)}`;
      statusEl.textContent = getStatusLabel(question.status);
    }
    if (question.answer && (question.status === 'done' || question.status === 'error')) {
      let answerEl = card.querySelector('.qh-card-answer');
      if (!answerEl && headerEl) {
        answerEl = document.createElement('span');
        answerEl.className = 'qh-card-answer';
        headerEl.insertBefore(answerEl, statusEl);
      }
      if (answerEl) {
        answerEl.textContent = getAnswerResult(question.answer);
      }
    }
  }

  /**
   * 同步"重新作答/作答"按钮（先移除旧的再按需添加，避免重复）
   * @param {HTMLElement} body - 卡片内容容器
   * @param {number} qIndex - 题目下标
   * @param {Object} question - 题目对象
   */
  function syncActionButton(body, qIndex, question) {
    body.querySelectorAll('.qh-btn.qh-btn-secondary').forEach(btn => btn.remove());
    if (question.status === 'done' || question.status === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'qh-btn qh-btn-secondary';
      retryBtn.style.marginTop = '10px';
      retryBtn.textContent = getMessage('panelReAnswer');
      retryBtn.addEventListener('click', event => {
        event.stopPropagation();
        globalThis.QuizHelperAnalyzer.analyzeSingleQuestion(qIndex, { forceSearch: true });
      });
      body.appendChild(retryBtn);
    } else if (state.isPaused && question.status === 'pending') {
      const answerBtn = document.createElement('button');
      answerBtn.className = 'qh-btn qh-btn-secondary';
      answerBtn.style.marginTop = '10px';
      answerBtn.textContent = getMessage('panelAnswer');
      answerBtn.addEventListener('click', event => {
        event.stopPropagation();
        globalThis.QuizHelperAnalyzer.analyzeSingleQuestion(qIndex, { forceSearch: true });
      });
      body.appendChild(answerBtn);
    }
  }

  /**
   * 更新单张卡片的内容区域
   * @param {number} index
   * @param {string} content
   * @param {boolean} isError
   * @param {boolean} [silent=false] - 为 true 时跳过进度/按钮刷新（批量渲染时由调用方统一刷新）
   */
  function updateCardBody(index, content, isError = false, silent = false) {
    if (!state.shadowRoot) return;
    const bodyEl = state.shadowRoot.getElementById(`card-body-${index}`);
    if (!bodyEl) return;

    const question = state.questionsData[index];

    // 是否有引用内容：增量快速路径不需要引用时，直接跳过引用 HTML 的构建
    const hasBankRefs = !!(question.bankMatches && question.bankMatches.length > 0);
    const hasSearchRefs = !!(question.webSearchRefs && question.webSearchRefs.length > 0);
    const needRefs = hasBankRefs || hasSearchRefs;

    // 增量更新：结构未变（无思考区、无引用区、本次也不需要引用）时仅更新答案文本与状态，
    // 避免每次状态流转都整卡 innerHTML 重建
    const existingQuestionSection = bodyEl.querySelector('.qh-question-section');
    const existingAnswerEl = bodyEl.querySelector('.qh-answer-text, .qh-error-text');
    const hasThinkingSection = !!bodyEl.querySelector('.qh-thinking-section');
    const existingRefs = !!bodyEl.querySelector('.qh-bank-refs, .qh-search-ref');

    if (existingQuestionSection && existingAnswerEl && !hasThinkingSection && !existingRefs && !needRefs) {
      const newCls = isError ? 'qh-error-text' : 'qh-answer-text';
      if (existingAnswerEl.className !== newCls) existingAnswerEl.className = newCls;
      existingAnswerEl.innerHTML = content;
      syncActionButton(bodyEl, index, question);
      syncCardHeader(index, question);
      if (!silent) {
        updateProgress();
        updateControls();
      }
      return;
    }

    // 全量重建路径，此时才构建引用 HTML
    let bankRefsHtml = '';
    if (hasBankRefs) {
      bankRefsHtml = '<div class="qh-bank-refs">';
      question.bankMatches.forEach(m => {
        bankRefsHtml += `
          <details class="qh-bank-ref">
            <summary>
              <span class="qh-bank-ref-icon" data-icon="database"></span>
              <span class="qh-bank-ref-name">${getMessage('panelBankSource', [m.source])}</span>
              ${m.score ? `<span class="qh-bank-ref-score">${getMessage('panelSimilarity', [m.score])}</span>` : ''}
              <span class="qh-ref-chevron" data-icon="chevron-down"></span>
            </summary>
            <div class="qh-bank-ref-detail">
              <div class="qh-bank-q">${escapeHtml(m.questionText)}</div>
              <div class="qh-bank-a">${getMessage('panelAnswerLabel', [escapeHtml(m.answer)])}</div>
              ${m.analysis ? `<div class="qh-bank-ana">${getMessage('panelAnalysisLabel', [escapeHtml(m.analysis)])}</div>` : ''}
            </div>
          </details>`;
      });
      bankRefsHtml += '</div>';
    }

    // 联网搜索参考链接
    let searchRefsHtml = '';
    const webSearchRefs = question.webSearchRefs || [];
    if (hasSearchRefs) {
      const providerName = question.searchProviderName || '';
      searchRefsHtml = `<details class="qh-search-ref" open>
        <summary>
          <span class="qh-search-ref-icon" data-icon="link"></span>
          <span class="qh-search-ref-name">${getMessage('panelRefLinks')}${providerName ? `<span class="qh-search-ref-provider"> · ${escapeHtml(providerName)}</span>` : ''}</span>
          <span class="qh-bank-ref-score">${getMessage('panelRefCount', [webSearchRefs.length])}</span>
          <span class="qh-ref-chevron" data-icon="chevron-down"></span>
        </summary>
        <div class="qh-search-ref-detail">`;
      webSearchRefs.forEach((ref) => {
        const domain = (() => {
          try { return new URL(ref.url).hostname; } catch { return ''; }
        })();
        const displayIndex = ref.originalIndex || 0;
        searchRefsHtml += `
          <div class="qh-search-ref-item">
            <a class="qh-search-ref-title" href="${escapeHtml(ref.url)}" target="_blank" rel="noopener">${displayIndex}. ${escapeHtml(ref.title || getMessage('panelNoTitle'))}</a>
            <div class="qh-search-ref-url">${escapeHtml(domain)}</div>
            ${ref.snippet ? `<div class="qh-search-ref-snippet">${escapeHtml(ref.snippet)}</div>` : ''}
          </div>`;
      });
      searchRefsHtml += '</div></details>';
    }

    bodyEl.innerHTML = `
      <div class="qh-question-section">
        <div class="qh-section-title-row">
          <div class="qh-section-title">${getMessage('panelQuestionLabel')}</div>
          <button class="qh-copy-btn" type="button" data-role="copy-question">${getMessage('panelCopy')}</button>
        </div>
        <div class="qh-question-text">${escapeHtml(question.text).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="qh-answer-section">
        <div class="qh-section-title">${getMessage('panelReferenceAnswer')}</div>
        <div class="${isError ? 'qh-error-text' : 'qh-answer-text'}">${content}</div>
      </div>
      ${searchRefsHtml}
      ${bankRefsHtml}
    `;

    syncActionButton(bodyEl, index, question);

    const copyBtn = bodyEl.querySelector('[data-role="copy-question"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async event => {
        event.stopPropagation();
        const originalText = getMessage('panelCopy');
        copyBtn.disabled = true;
        try {
          await copyText(buildQuestionCopyText(question));
          copyBtn.textContent = getMessage('panelCopied');
          copyBtn.classList.add('copied');
        } catch (error) {
          copyBtn.textContent = getMessage('panelCopyFailed');
          copyBtn.classList.add('failed');
        } finally {
          window.setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.disabled = false;
            copyBtn.classList.remove('copied', 'failed');
          }, 1200);
        }
      });
    }

    window.QuizHelperIcons?.replaceIcons(bodyEl);

    syncCardHeader(index, question);

    if (!silent) {
      updateProgress();
      updateControls();
    }
  }

  /**
   * 更新进度文本
   */
  function updateProgress() {
    if (!state.shadowRoot) return;
    const progressEl = state.shadowRoot.querySelector('.qh-progress');
    if (!progressEl) return;

    const total = state.questionsData.length;
    const finished = state.questionsData.filter(q => q.status === 'done' || q.status === 'error').length;
    // 仅在有已完成题目时显示进度；无进度（作答中/已暂停/选区）一律不显示
    progressEl.textContent = finished > 0 ? getMessage('panelProgressText', [finished, total]) : '';
  }

  /**
   * 让分段控件的滑块跟随当前活动按钮的实际位置与宽度。
   * 文本长度随语言变化（中英文不等宽），不能用写死的像素值。
   * @param {Element} segEl - .qh-seg 容器
   */
  function syncSegSlider(segEl) {
    if (!segEl || !segEl.isConnected) return;
    const visibleBtns = Array.from(segEl.querySelectorAll('.qh-seg-btn'))
      .filter(b => getComputedStyle(b).display !== 'none');
    const activeBtn = segEl.querySelector('.qh-seg-btn.active') || visibleBtns[0];
    if (!activeBtn) return;
    const segRect = segEl.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    segEl.style.setProperty('--seg-left', `${btnRect.left - segRect.left}px`);
    segEl.style.setProperty('--seg-w', `${btnRect.width}px`);
  }

  /**
   * 更新控制按钮状态
   */
  function updateControls() {
    if (!state.shadowRoot) return;

    const aiBtn = state.shadowRoot.getElementById('qh-ai-parse');
    const reparseBtn = state.shadowRoot.getElementById('qh-reparse');
    const pauseBtn = state.shadowRoot.getElementById('qh-pause');
    const retryBtn = state.shadowRoot.getElementById('qh-retry');
    const segEl = state.shadowRoot.querySelector('.qh-seg');

    if (aiBtn) {
      aiBtn.textContent = state.pickerState ? getMessage('panelCancelSelection') : getMessage('panelAiSelection');
      aiBtn.disabled = state.isAnalyzing;
      aiBtn.classList.toggle('active', !!state.pickerState);
    }

    if (reparseBtn) {
      reparseBtn.style.display = state.currentRule ? '' : 'none';
      reparseBtn.disabled = state.isAnalyzing || state.pickerState !== null;
      reparseBtn.classList.toggle('active', !!state.currentRule && !state.pickerState);
    }

    if (segEl) {
      // 滑块跟随活动按钮实际尺寸（语言切换后文本宽度不同；尺寸变化由 ResizeObserver 兜底）
      syncSegSlider(segEl);
    }

    if (pauseBtn) {
      const pauseIcon = pauseBtn.querySelector('.qh-btn-icon');
      if (pauseIcon) {
        const nextIcon = state.isPaused ? 'play' : 'pause';
        if (pauseIcon.getAttribute('data-icon') !== nextIcon) {
          pauseIcon.setAttribute('data-icon', nextIcon);
          delete pauseIcon.dataset.iconLoaded;
          window.QuizHelperIcons?.replaceIcons(pauseBtn);
        }
      }
      pauseBtn.disabled = state.pickerState !== null || (!state.isAnalyzing && !state.isPaused);
    }

    if (retryBtn) {
      retryBtn.disabled = state.pickerState !== null || state.questionsData.length === 0 || state.isAnalyzing;
    }
  }

  // ===== 拖拽 =====

  /**
   * 使元素可拖拽
   * @param {Element} handle - 拖拽手柄
   * @param {Element} target - 实际移动的元素
   */
  function makeDraggable(handle, target) {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    handle.addEventListener('mousedown', event => {
      hasMoved = false;
      if (event.target.closest('.qh-header-btn, button')) return;
      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = target.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      target.style.transition = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', event => {
      if (!isDragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }
      target.style.left = `${initLeft + dx}px`;
      target.style.top = `${initTop + dy}px`;
      target.style.right = 'auto';
      target.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    handle.addEventListener('click', event => {
      if (hasMoved) {
        event.stopPropagation();
        event.preventDefault();
      }
    }, true);
  }

  // ===== 主题管理 =====

  /**
   * 根据系统主题切换 Shadow DOM 内的 dark 类
   */
  function applyTheme() {
    const host = document.getElementById('quiz-helper-host');
    if (!host || !state.shadowRoot) return;
    const isDark = state.isDarkMode;
    host.classList.toggle('dark', isDark);
    if (panelThemeRoot) panelThemeRoot.classList.toggle('dark', isDark);
  }

  /**
   * 应用主题风格（经典/苹果）到面板宿主与 shadow 内根容器
   */
  async function applyThemeStyle() {
    try {
      const style = await globalThis.QuizHelperThemeUtils.loadThemeStyle();
      const resolved = style === 'apple' ? 'apple' : 'classic';
      const host = document.getElementById('quiz-helper-host');
      if (host) host.setAttribute('data-theme-style', resolved);
      if (panelThemeRoot) panelThemeRoot.setAttribute('data-theme-style', resolved);
    } catch (e) {
      // 静默降级为经典
    }
  }

  async function refreshModelNameDisplay() {
    const el = state.shadowRoot?.getElementById('qh-model-name');
    if (!el) return;
    const result = await chrome.storage.local.get(['llm_models', 'active_model_id']);
    const models = result.llm_models || [];
    const activeId = result.active_model_id || '';
    const model = models.find(m => m.id === activeId && m.isActive);
    el.textContent = model?.name || model?.modelId || '';
  }

  // ===== 面板生命周期 =====

  /**
   * 清理页面中残留的面板宿主节点。
   * 某些页面会触发重复初始化或残留旧宿主，这里统一做一次兜底去重。
   */
  function removeAllPanelHosts() {
    document.querySelectorAll('#quiz-helper-host').forEach(host => host.remove());
  }

  /**
   * 获取当前唯一的面板宿主节点，并清理多余重复节点。
   * @returns {HTMLElement|null}
   */
  function getCurrentPanelHost() {
    const hosts = Array.from(document.querySelectorAll('#quiz-helper-host'));
    const currentHost = hosts[0] || null;
    hosts.slice(1).forEach(host => host.remove());
    return currentHost;
  }

  /**
   * 判断本次渲染是否仍然是最新的一次。
   * 通过 DOM 属性做跨执行上下文仲裁，避免并发创建时在同一 ShadowRoot 里追加两套内容。
   * @param {HTMLElement|null} host
   * @param {string} renderToken
   * @returns {boolean}
   */
  function isActiveRender(host, renderToken) {
    return !!host
      && host.isConnected
      && host.id === 'quiz-helper-host'
      && host.dataset.renderToken === renderToken;
  }

  /**
   * 创建助手面板（Shadow DOM 隔离样式）
   * @param {number} totalQuestions
   */
  async function createPanel(totalQuestions) {
    if (state._createPanelTask) {
      await state._createPanelTask;
    }

    let taskDone;
    state._createPanelTask = new Promise(resolve => { taskDone = resolve; });

    try {
      let host = getCurrentPanelHost();
      if (!host) {
        host = document.createElement('div');
        host.id = 'quiz-helper-host';
        document.body.appendChild(host);
      }

      const renderToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      host.dataset.renderToken = renderToken;

      state.shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });
      state.shadowRoot.replaceChildren();
      state.panelElement = null;

      // 主题根容器：承载 data-theme-style，使主题组件覆盖选择器可匹配
      panelThemeRoot = document.createElement('div');
      panelThemeRoot.className = 'qh-theme-root';
      panelThemeRoot.setAttribute('data-theme-style', 'classic');
      state.shadowRoot.appendChild(panelThemeRoot);

      try {
        const variablesUrl = chrome.runtime.getURL('shared/variables.css');
        const resp = await fetch(variablesUrl);
        if (!isActiveRender(host, renderToken)) return;
        if (resp.ok) {
          const cssText = await resp.text();
          if (!isActiveRender(host, renderToken)) return;
          const variablesStyle = document.createElement('style');
          variablesStyle.textContent = cssText;
          state.shadowRoot.appendChild(variablesStyle);
        }
      } catch (e) {
        // 静默降级
      }

      if (!isActiveRender(host, renderToken)) return;

      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = chrome.runtime.getURL('content/panel.css');
      state.shadowRoot.appendChild(styleLink);

      // 主题样式注入（经典 + 苹果，由 data-theme-style 属性决定生效者）。
      // 必须位于 panel.css <link> 之后，保证同优先级时主题覆盖生效。
      // ?v=5 用于强制刷新浏览器缓存。
      for (const themeFile of ['themes/theme-classic.css?v=12', 'themes/theme-apple.css?v=12']) {
        try {
          const resp = await fetch(chrome.runtime.getURL(themeFile));
          if (!isActiveRender(host, renderToken)) return;
          if (resp.ok) {
            const cssText = await resp.text();
            if (!isActiveRender(host, renderToken)) return;
            const themeStyle = document.createElement('style');
            themeStyle.textContent = cssText;
            state.shadowRoot.appendChild(themeStyle);
          }
        } catch (e) {
          // 静默降级
        }
      }

      const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      if (!darkMediaQueryRef) {
        darkMediaQueryRef = darkMediaQuery;
        darkMediaQueryHandler = () => {
          if (state.themeMode === 'system') {
            globalThis.QuizHelperApp.updateDarkMode();
          }
        };
        darkMediaQueryRef.addEventListener('change', darkMediaQueryHandler);
      }

      applyTheme();
      applyThemeStyle();

      if (!isActiveRender(host, renderToken)) return;

      state.panelElement = document.createElement('div');
      state.panelElement.className = 'qh-panel';
      state.panelElement.innerHTML = `
        <div class="qh-header">
          <div>
            <span class="qh-title">${getMessage('panelTitle')}</span>
            <span class="qh-progress"></span>
          </div>
          <div class="qh-header-btns">
            <button class="qh-header-btn" id="qh-minimize" title="${getMessage('panelMinimize')}"><span data-icon="minimize"></span></button>
            <button class="qh-header-btn" id="qh-close" title="${getMessage('commonClose')}"><span data-icon="close"></span></button>
          </div>
        </div>
        <div class="qh-body" id="qh-body"></div>
        <div class="qh-footer">
          <span class="qh-model-name" id="qh-model-name"></span>
          <div class="qh-footer-actions">
            <div class="qh-seg">
              <button class="qh-seg-btn" id="qh-ai-parse">${getMessage('panelAiSelection')}</button>
              <button class="qh-seg-btn" id="qh-reparse" style="display:none;">${getMessage('panelRuleParse')}</button>
            </div>
            <button class="qh-btn qh-btn-icon-only qh-btn-warning" id="qh-pause"><span class="qh-btn-icon" data-icon="pause"></span></button>
            <button class="qh-btn qh-btn-icon-only qh-btn-primary" id="qh-retry"><span class="qh-btn-icon" data-icon="refresh-cw"></span></button>
          </div>
        </div>
      `;
      panelThemeRoot.appendChild(state.panelElement);

      if (!isActiveRender(host, renderToken)) return;

      const miniBar = document.createElement('div');
      miniBar.className = 'qh-mini-bar';
      miniBar.id = 'qh-mini-bar';
      const iconUrl = chrome.runtime.getURL('icons/icon.svg');
      miniBar.innerHTML = `<img src="${iconUrl}" width="48" height="48" alt="${getMessage('panelTitle')}" draggable="false">`;
      panelThemeRoot.appendChild(miniBar);

      state.shadowRoot.getElementById('qh-minimize').addEventListener('click', minimizePanel);
      state.shadowRoot.getElementById('qh-close').addEventListener('click', removePanel);
      state.shadowRoot.getElementById('qh-ai-parse').addEventListener('click', () => {
        globalThis.QuizHelperAnalyzer.toggleAiPicker();
      });
      state.shadowRoot.getElementById('qh-reparse').addEventListener('click', () => {
        globalThis.QuizHelperAnalyzer.reparseAndAnalyze();
      });
      state.shadowRoot.getElementById('qh-pause').addEventListener('click', () => {
        globalThis.QuizHelperAnalyzer.togglePauseAnalysis();
      });
      state.shadowRoot.getElementById('qh-retry').addEventListener('click', () => {
        globalThis.QuizHelperAnalyzer.restartAnalysis();
      });
      miniBar.addEventListener('click', restorePanel);

      makeDraggable(state.shadowRoot.querySelector('.qh-header'), state.panelElement);
      makeDraggable(state.shadowRoot.querySelector('.qh-footer'), state.panelElement);
      makeDraggable(miniBar, miniBar);

      renderCards();
      refreshModelNameDisplay();
      window.QuizHelperIcons?.replaceIcons(state.shadowRoot);

      // 分段控件滑块跟随布局变化自动校准：
      // panel.css 经 <link> 异步加载，首次渲染时样式可能未生效（块级布局），
      // 以及按钮显隐/字体就绪都会改变控件尺寸，统一由 ResizeObserver 触发重算
      // （活动按钮切换但尺寸不变时，updateControls 已同步一次）。
      const segEl = state.shadowRoot.querySelector('.qh-seg');
      if (segEl && typeof ResizeObserver !== 'undefined') {
        const segObserver = new ResizeObserver(() => syncSegSlider(segEl));
        segObserver.observe(segEl);
        segEl._qhSegObserver = segObserver;
      }
    } finally {
      taskDone();
      state._createPanelTask = null;
    }
  }

  /**
   * 确保面板已创建
   * @param {number} totalQuestions
   */
  function ensurePanel(totalQuestions = state.questionsData.length) {
    if (state.panelElement) return;
    createPanel(totalQuestions);
  }

  /**
   * 销毁面板
   * @param {boolean} clearData - 是否清空题目数据
   */
  function destroyPanel(clearData = true) {
    globalThis.QuizHelperAnalyzer.stopElementPicker();
    // 移除分段控件滑块 ResizeObserver，避免面板重建时累积泄漏
    if (state.shadowRoot) {
      const segEl = state.shadowRoot.querySelector('.qh-seg');
      if (segEl && segEl._qhSegObserver) {
        segEl._qhSegObserver.disconnect();
        segEl._qhSegObserver = null;
      }
    }
    // 移除面板级 matchMedia 监听器，避免反复创建面板时累积泄漏
    if (darkMediaQueryRef && darkMediaQueryHandler) {
      darkMediaQueryRef.removeEventListener('change', darkMediaQueryHandler);
      darkMediaQueryRef = null;
      darkMediaQueryHandler = null;
    }
    removeAllPanelHosts();
    state.shadowRoot = null;
    state.panelElement = null;
    panelThemeRoot = null;
    state.isAnalyzing = false;
    state.isPaused = false;
    state.analysisRunId += 1;
    if (clearData) {
      state.questionsData = [];
    }
  }

  function minimizePanel(event) {
    if (!state.panelElement || !state.shadowRoot) return;

    const bar = state.shadowRoot.getElementById('qh-mini-bar');
    if (!bar) return;

    const barSize = 48;
    let barCX, barCY;
    if (event && typeof event.clientX === 'number') {
      barCX = event.clientX;
      barCY = event.clientY;
    } else {
      const panelRect = state.panelElement.getBoundingClientRect();
      barCX = panelRect.left + panelRect.width / 2;
      barCY = panelRect.top + panelRect.height / 2;
    }

    state.panelElement.style.display = 'none';

    bar.style.left = `${barCX - barSize / 2}px`;
    bar.style.top = `${barCY - barSize / 2}px`;
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    bar.style.display = 'flex';
  }

  function restorePanel() {
    if (!state.panelElement || !state.shadowRoot) return;

    const bar = state.shadowRoot.getElementById('qh-mini-bar');
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      const barCX = barRect.left + barRect.width / 2;
      const barCY = barRect.top + barRect.height / 2;
      const barHalf = barRect.width / 2;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 12;
      const margin = 20;
      const panelW = 420;
      const panelMaxH = 600;

      const openLeft = barCX > vw / 2;
      const openTop = barCY > vh / 2;

      state.panelElement.style.left = 'auto';
      state.panelElement.style.right = 'auto';
      state.panelElement.style.top = 'auto';
      state.panelElement.style.bottom = 'auto';

      if (openLeft) {
        let rightVal = vw - barCX + barHalf + gap;
        const leftEdge = vw - rightVal - panelW;
        if (leftEdge < margin) rightVal = vw - margin - panelW;
        if (rightVal < margin) rightVal = margin;
        state.panelElement.style.right = `${rightVal}px`;
      } else {
        let leftVal = barCX + barHalf + gap;
        if (leftVal + panelW > vw - margin) leftVal = vw - margin - panelW;
        if (leftVal < margin) leftVal = margin;
        state.panelElement.style.left = `${leftVal}px`;
      }

      if (openTop) {
        let bottomVal = vh - barCY + barHalf + gap;
        const topEdge = vh - bottomVal - panelMaxH;
        if (topEdge < margin) bottomVal = vh - margin - panelMaxH;
        if (bottomVal < margin) bottomVal = margin;
        state.panelElement.style.bottom = `${bottomVal}px`;
      } else {
        let topVal = barCY + barHalf + gap;
        if (topVal + panelMaxH > vh - margin) topVal = vh - margin - panelMaxH;
        if (topVal < margin) topVal = margin;
        state.panelElement.style.top = `${topVal}px`;
      }

      bar.style.display = 'none';
    }

    state.panelElement.style.display = 'flex';
  }

  function removePanel() {
    destroyPanel(true);
  }

  // 导出 API
  globalThis.QuizHelperPanelUI = {
    applyTheme,
    applyThemeStyle,
    createPanel,
    ensurePanel,
    restorePanel,
    removePanel,
    renderCards,
    showPanelMessage,
    updateAnswerStream,
    updateCardBody,
    updateProgress,
    updateControls,
    escapeHtml,
    formatAnswer,
    refreshModelNameDisplay
  };
})();
