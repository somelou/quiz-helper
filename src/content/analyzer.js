(() => {
  'use strict';

  const state = globalThis.QuizHelperContentState;
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const D = globalThis.QuizHelperDomParser;
  const UI = globalThis.QuizHelperPanelUI;

  /**
   * 校验 CSS 选择器是否有效
   * @param {string} selector
   * @returns {boolean}
   */
  function isValidCSSSelector(selector) {
    if (!selector || typeof selector !== 'string') return false;
    try {
      document.querySelector(selector);
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ===== 分析控制 =====

  /**
   * 保存历史记录到本地存储
   */
  async function saveHistory() {
    if (state.questionsData.length === 0) return;

    const record = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      url: location.href,
      title: document.title,
      questions: state.questionsData.map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
        answer: q.answer,
        status: q.status
      }))
    };

    const result = await chrome.storage.local.get(['exam_history']);
    const history = result.exam_history || [];
    history.unshift(record);
    if (history.length > 50) history.length = 50;
    await safeSet({ exam_history: history });
  }

  /**
   * 重置所有题目为待分析状态
   */
  function resetQuestionsForAnalysis() {
    state.questionsData = state.questionsData.map((question, index) => ({
      ...question,
      id: index + 1,
      answer: null,
      status: 'pending'
    }));
    UI.renderCards();
  }

  /**
   * 获取下一个待分析题目的索引
   * @returns {number}
   */
  function getNextPendingQuestionIndex() {
    return state.questionsData.findIndex(q => q.status === 'pending' || q.status === 'error');
  }

  /**
   * 获取恢复分析的起始索引：从最后一道已处理（done/loading）的题目开始
   * 如果该题正在加载中，从该题开始；如果已完成，从下一题开始
   * @returns {number}
   */
  function getResumeStartIndex() {
    let lastActiveIndex = -1;
    for (let i = state.questionsData.length - 1; i >= 0; i--) {
      const q = state.questionsData[i];
      if (q.status === 'done' || q.status === 'loading') {
        lastActiveIndex = i;
        break;
      }
    }
    if (lastActiveIndex === -1) return 0;
    if (state.questionsData[lastActiveIndex].status === 'loading') return lastActiveIndex;
    return lastActiveIndex + 1;
  }

  /**
   * 单题流式答题（port 通道），返回 Promise 在完成/出错时 resolve
   */
  function streamQuestion(question, index, runId, forceSearch = false) {
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'streamAnswer' });
      let thinkingText = '';
      let answerText = '';

      port.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (runId !== state.analysisRunId) { port.disconnect(); resolve(); return; }

        if (msg.type === 'connected') return;
        if (msg.type === 'thinking') {
          thinkingText += msg.content;
          UI.updateAnswerStream(index, thinkingText, answerText, !answerText);
        } else if (msg.type === 'text') {
          answerText += msg.content;
          UI.updateAnswerStream(index, thinkingText, answerText, false);
        } else if (msg.type === 'done') {
          question.status = 'done';
          question.answer = msg.answer;
          question.webSearchRefs = msg.referenceLinks || [];
          question.searchProviderName = msg.searchProviderName || '';
          UI.updateCardBody(index, UI.formatAnswer(msg.answer));
          port.disconnect();
          resolve();
        } else if (msg.type === 'error') {
          question.status = 'error';
          UI.updateCardBody(index, `请求失败：${UI.escapeHtml(msg.message)}`, true);
          port.disconnect();
          resolve();
        }
      });

      port.onDisconnect.addListener(() => {
        if (runId === state.analysisRunId && question.status === 'loading') {
          question.status = 'error';
          UI.updateCardBody(index, '连接中断', true);
        }
        resolve();
      });

      port.postMessage({
        data: question.text,
        questionType: question.type,
        forceSearch
      });
    });
  }

  /**
   * 查询题库并校验答案，命中则直接写入题目结果
   * analyzeSingleQuestion 与 analyzeAllQuestions 共用
   * @param {Object} question - 当前题目对象（会原地修改状态与答案）
   * @param {number} index - 题目下标（用于更新卡片）
   * @param {number} runId - 分析运行 ID（防止过期回调）
   * @returns {Promise<boolean>} true 表示题库命中并已处理
   */
  async function resolveQuestionFromBank(question, index, runId) {
    const bankResponse = await chrome.runtime.sendMessage({
      action: 'searchQuestionBank',
      questionText: question.text
    });

    if (runId !== state.analysisRunId) return false;

    if (!bankResponse.success || !bankResponse.found || bankResponse.matches.length === 0) {
      return false;
    }

    UI.updateCardBody(index, '<div class="qh-loading-text">匹配到题库，正在校验选项顺序...</div>');

    const verifyResponse = await chrome.runtime.sendMessage({
      action: 'verifyBankAnswer',
      questionText: question.text,
      questionType: question.type,
      bankMatches: bankResponse.matches
    });

    if (runId !== state.analysisRunId) return false;

    if (verifyResponse.success) {
      question.status = 'done';
      question.answer = verifyResponse.answer;
      question.bankMatches = bankResponse.matches;
      UI.updateCardBody(index, UI.formatAnswer(verifyResponse.answer));
    } else {
      question.status = 'done';
      const firstMatch = bankResponse.matches[0];
      let fallbackAnswer = `⚠️ 校验失败，以下为原始题库答案（选项顺序可能与当前考试不同）\n答案：${firstMatch.answer}`;
      if (firstMatch.analysis) {
        fallbackAnswer += `\n解析：${firstMatch.analysis}`;
      }
      fallbackAnswer += `\n来源：题库「${firstMatch.source}」`;
      if (firstMatch.questionText) {
        fallbackAnswer += `\n题库原题：${firstMatch.questionText}`;
      }
      question.answer = fallbackAnswer;
      question.bankMatches = bankResponse.matches;
      UI.updateCardBody(index, UI.formatAnswer(fallbackAnswer));
    }

    return true;
  }

  /**
   * 分析单道题目（优先搜索题库，题库无匹配时调用 AI）
   * @param {number} index
   * @param {Object} [options]
   * @param {boolean} [options.forceSearch] - 强制联网搜索
   */
  async function analyzeSingleQuestion(index, options = {}) {
    if (state.isAnalyzing) return;

    const question = state.questionsData[index];
    if (!question) return;

    const wasPaused = state.isPaused;
    state.isPaused = false;
    state.isAnalyzing = true;
    const runId = ++state.analysisRunId;
    question.status = 'loading';
    question.answer = null;
    question.webSearchRefs = null;
    UI.updateCardBody(index, '<div class="qh-loading-text">正在分析...</div>');

    // 流式与非流式路径共用的收尾逻辑
    function finalizeQuestion(idx, wasPausedLocal, runIdLocal) {
      if (runIdLocal !== state.analysisRunId) return;
      state.isAnalyzing = false;
      state.isPaused = wasPausedLocal;
      UI.updateControls();
      UI.updateProgress();
      if (wasPausedLocal) UI.renderCards();
    }

    try {
      const bankMatched = await resolveQuestionFromBank(question, index, runId);
      if (runId !== state.analysisRunId) return;

      if (!bankMatched) {
        await streamQuestion(question, index, runId, options.forceSearch || false);
        finalizeQuestion(index, wasPaused, runId);
        return;
      }
    } catch (error) {
      if (runId !== state.analysisRunId) return;
      question.status = 'error';
      UI.updateCardBody(index, `通信错误：${UI.escapeHtml(error.message)}`, true);
    } finally {
      if (runId === state.analysisRunId && question.status !== 'loading') {
        finalizeQuestion(index, wasPaused, runId);
      }
    }
  }

  /**
   * 分析所有题目（优先搜索题库）
   * @param {Object} options
   * @param {boolean} options.resume - 是否从上次暂停处继续
   */
  async function analyzeAllQuestions({ resume = false } = {}) {
    if (state.questionsData.length === 0) return;
    if (state.isAnalyzing) return;

    state.isPaused = false;
    state.isAnalyzing = true;
    const runId = ++state.analysisRunId;
    UI.updateControls();
    UI.updateProgress();

    let startIndex = 0;
    if (resume) {
      startIndex = getResumeStartIndex();
    }

    for (let index = startIndex; index < state.questionsData.length; index += 1) {
      if (runId !== state.analysisRunId) return;
      if (state.isPaused) {
        state.isAnalyzing = false;
        UI.updateControls();
        UI.updateProgress();
        await saveHistory();
        return;
      }

      const question = state.questionsData[index];
      if (!question || question.status === 'done') continue;

      question.status = 'loading';
      UI.updateCardBody(index, '<div class="qh-loading-text">正在分析...</div>');

      try {
        const bankMatched = await resolveQuestionFromBank(question, index, runId);
        if (runId !== state.analysisRunId) return;

        if (bankMatched) continue;

        await streamQuestion(question, index, runId);

        if (runId !== state.analysisRunId) return;
      } catch (error) {
        if (runId !== state.analysisRunId) return;
        question.status = 'error';
        UI.updateCardBody(index, `通信错误：${UI.escapeHtml(error.message)}`, true);
      }
    }

    if (runId !== state.analysisRunId) return;

    state.isAnalyzing = false;
    UI.updateControls();
    UI.updateProgress();
    await saveHistory();
  }

  function togglePauseAnalysis() {
    if (state.pickerState) return;

    if (state.isPaused) {
      state.isPaused = false;
      UI.updateControls();
      UI.updateProgress();
      UI.renderCards();
      analyzeAllQuestions({ resume: true });
      return;
    }

    if (!state.isAnalyzing) return;
    state.isPaused = true;
    UI.updateControls();
    UI.updateProgress();
    UI.renderCards();
  }

  async function restartAnalysis() {
    if (state.isAnalyzing || state.questionsData.length === 0) return;
    resetQuestionsForAnalysis();
    await analyzeAllQuestions();
  }

  async function reparseAndAnalyze() {
    if (state.isAnalyzing || state.pickerState) return;
    const success = await D.parseExamQuestions();
    if (!success) {
      state.questionsData = [];
      UI.createPanel(0);
      UI.showPanelMessage('规则解析未提取到题目。点击"AI 选区解析"后，在页面中点选包含题目的区域，再由 AI 做局部解析。');
      return;
    }

    UI.createPanel(state.questionsData.length);
    UI.renderCards();
    await analyzeAllQuestions();
  }

  // ===== 元素选择器（AI 选区解析） =====

  /**
   * 获取可选中的目标元素
   * @param {EventTarget} target
   * @returns {Element|null}
   */
  function getPickableElement(target) {
    let current = target instanceof Element ? target : target?.parentElement;
    let fallback = null;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current.id === 'quiz-helper-host' || current.closest('#quiz-helper-host')) {
        return null;
      }

      const text = D.getCleanText(current);
      if (!fallback && text.length >= 20) {
        fallback = current;
      }

      const sel = D.getSelectors();
      const rulePickable = [
        sel.questionItemSelector,
        ...sel.rootSelectors,
        ...sel.questionTextSelectors,
        ...sel.optionContainerSelectors
      ].filter(Boolean).join(', ');
      if (current.matches(`${rulePickable}, [data-current], section, article, form, table`)) {
        return current;
      }

      current = current.parentElement;
    }

    return fallback;
  }

  /**
   * 描述元素的标签名、ID 和类名
   * @param {Element} element
   * @returns {string}
   */
  function describeElement(element) {
    if (!element) return '';
    const classes = Array.from(element.classList || []).slice(0, 3).join('.');
    const id = element.id ? `#${element.id}` : '';
    return `${element.tagName.toLowerCase()}${id}${classes ? '.' + classes : ''}`;
  }

  /**
   * 停止元素选择模式
   */
  function stopElementPicker() {
    if (!state.pickerState) return;

    document.removeEventListener('mousemove', state.pickerState.onMouseMove, true);
    document.removeEventListener('click', state.pickerState.onClick, true);
    document.removeEventListener('keydown', state.pickerState.onKeyDown, true);
    state.pickerState.overlay.remove();
    state.pickerState = null;
    UI.updateControls();
    UI.updateProgress();
  }

  /**
   * 启动元素选择模式（用户点击页面区域）
   */
  function startElementPicker() {
    if (state.pickerState || state.isAnalyzing) return;

    UI.ensurePanel(state.questionsData.length);

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483646';
    overlay.style.border = '2px solid #667eea';
    overlay.style.background = 'rgba(102, 126, 234, 0.12)';
    overlay.style.borderRadius = '8px';
    overlay.style.display = 'none';
    document.documentElement.appendChild(overlay);

    const moveOverlayTo = element => {
      if (!element) {
        overlay.style.display = 'none';
        return;
      }
      const rect = element.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    const onMouseMove = event => {
      const element = getPickableElement(event.target);
      moveOverlayTo(element);
      state.pickerState.currentElement = element;
    };

    const onClick = async event => {
      const element = getPickableElement(event.target) || state.pickerState.currentElement;
      if (!element) return;

      event.preventDefault();
      event.stopPropagation();
      stopElementPicker();
      await aiParseAndAnalyze(element);
    };

    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      stopElementPicker();
      UI.showPanelMessage('已取消 AI 选区解析。可继续规则解析，或再次点击"AI 选区解析"后选择页面区域。');
    };

    state.pickerState = {
      overlay,
      currentElement: null,
      onMouseMove,
      onClick,
      onKeyDown
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    UI.showPanelMessage('请选择页面中的题目区域。按 Esc 可取消。');
  }

  function toggleAiPicker() {
    if (state.pickerState) {
      stopElementPicker();
      UI.showPanelMessage('已取消 AI 选区解析。');
      return;
    }
    startElementPicker();
  }

  // ===== AI 选区解析 =====

  /**
   * 合并两个数组，去重
   * @param {Array} existing
   * @param {Array} newArr
   * @returns {Array}
   */
  function mergeArray(existing, newArr) {
    if (!Array.isArray(newArr) || newArr.length === 0) return existing || [];
    if (!Array.isArray(existing) || existing.length === 0) return newArr;
    const set = new Set([...existing, ...newArr]);
    return [...set];
  }

  /**
   * 合并题型关键词对象
   * @param {Object} existing - { multiple: [], judge: [], fill: [] }
   * @param {Object} newKw - { multiple: [], judge: [], fill: [] }
   * @returns {Object}
   */
  function mergeTypeKeywords(existing, newKw) {
    if (!newKw) return existing || state.DEFAULT_TYPE_KEYWORDS;
    if (!existing) return newKw;
    const result = {};
    for (const key of ['single', 'multiple', 'judge', 'fill']) {
      result[key] = mergeArray(existing[key], newKw[key]);
    }
    return result;
  }

  /**
   * 合并选择器对象
   * @param {Object} existing - 已有的 selectors 对象
   * @param {Object} aiSelectors - AI 返回的 selectors 对象
   * @returns {Object} 合并后的 selectors
   */
  function mergeSelectors(existing, aiSelectors) {
    if (!existing) return aiSelectors;
    if (!aiSelectors) return existing;

    return {
      rootSelectors: isValidCSSSelector(aiSelectors.rootSelector)
        ? mergeArray(existing.rootSelectors, [aiSelectors.rootSelector])
        : existing.rootSelectors,
      questionItemSelector: isValidCSSSelector(aiSelectors.questionItemSelector) ? aiSelectors.questionItemSelector : (existing.questionItemSelector || ''),
      typeHeadingSelector: isValidCSSSelector(aiSelectors.typeHeadingSelector)
        ? aiSelectors.typeHeadingSelector
        : (existing.typeHeadingSelector || ''),
      questionTextSelectors: isValidCSSSelector(aiSelectors.questionTextSelector)
        ? mergeArray(existing.questionTextSelectors, [aiSelectors.questionTextSelector])
        : existing.questionTextSelectors,
      optionContainerSelectors: isValidCSSSelector(aiSelectors.optionContainerSelector)
        ? mergeArray(existing.optionContainerSelectors, [aiSelectors.optionContainerSelector])
        : existing.optionContainerSelectors,
      optionItemSelector: isValidCSSSelector(aiSelectors.optionItemSelector) ? aiSelectors.optionItemSelector : (existing.optionItemSelector || ''),
      optionNumberSelector: isValidCSSSelector(aiSelectors.optionNumberSelector)
        ? aiSelectors.optionNumberSelector
        : (existing.optionNumberSelector || ''),
      typeIndicators: aiSelectors.typeIndicators
        ? {
            single: mergeArray(existing.typeIndicators?.single, aiSelectors.typeIndicators.single),
            multiple: mergeArray(existing.typeIndicators?.multiple, aiSelectors.typeIndicators.multiple),
            judge: mergeArray(existing.typeIndicators?.judge, aiSelectors.typeIndicators.judge)
          }
        : (existing.typeIndicators || state.DEFAULT_SELECTORS.typeIndicators),
      fallbackTextSelectors: existing.fallbackTextSelectors || state.DEFAULT_SELECTORS.fallbackTextSelectors
    };
  }

  /**
   * 合并 AI 返回的 selectors 和 typeKeywords 到已有规则，返回完整规则对象
   * @param {Object} existingRule - 已有的完整规则（含 selectors 和 typeKeywords）
   * @param {Object} aiSelectors - AI 返回的 selectors
   * @param {Object} aiTypeKeywords - AI 返回的 typeKeywords（如果 AI 没返回则为 null）
   * @returns {Object} 合并后的完整规则
   */
  function mergeRuleWithExisting(existingRule, aiSelectors, aiTypeKeywords) {
    const mergedSelectors = mergeSelectors(existingRule.selectors, aiSelectors);
    const mergedTypeKeywords = aiTypeKeywords
      ? mergeTypeKeywords(existingRule.typeKeywords, aiTypeKeywords)
      : existingRule.typeKeywords;

    return {
      ...existingRule,
      selectors: mergedSelectors,
      typeKeywords: mergedTypeKeywords,
      lastUsed: Date.now(),
      timestamp: Date.now()
    };
  }

  /**
   * 从 AI 返回的 selectors 构建完整的规则对象（无已有规则时使用）
   * @param {Object} responseSelectors - AI 返回的 selectors
   * @returns {Object} 规则对象
   */
  function buildNewRuleFromAI(responseSelectors) {
    return {
      id: `ai-${Date.now()}`,
      domain: location.hostname,
      name: location.hostname,
      timestamp: Date.now(),
      useCount: 1,
      selectors: {
        rootSelectors: isValidCSSSelector(responseSelectors.rootSelector)
          ? [responseSelectors.rootSelector]
          : ['.main-padding-content', 'main', '#content'],
        questionItemSelector: isValidCSSSelector(responseSelectors.questionItemSelector) ? responseSelectors.questionItemSelector : '.question-type-item',
        typeHeadingSelector: isValidCSSSelector(responseSelectors.typeHeadingSelector) ? responseSelectors.typeHeadingSelector : '',
        questionTextSelectors: isValidCSSSelector(responseSelectors.questionTextSelector)
          ? [responseSelectors.questionTextSelector]
          : ['.question', '[data-region="content"]'],
        optionContainerSelectors: isValidCSSSelector(responseSelectors.optionContainerSelector)
          ? [responseSelectors.optionContainerSelector]
          : state.DEFAULT_SELECTORS.optionContainerSelectors,
        optionItemSelector: isValidCSSSelector(responseSelectors.optionItemSelector) ? responseSelectors.optionItemSelector : (state.DEFAULT_SELECTORS.optionItemSelector || 'dd'),
        optionNumberSelector: isValidCSSSelector(responseSelectors.optionNumberSelector) ? responseSelectors.optionNumberSelector : (state.DEFAULT_SELECTORS.optionNumberSelector || '.option-num'),
        typeIndicators: responseSelectors.typeIndicators || state.DEFAULT_SELECTORS.typeIndicators,
        fallbackTextSelectors: state.DEFAULT_SELECTORS.fallbackTextSelectors
      },
      typeKeywords: state.DEFAULT_TYPE_KEYWORDS
    };
  }

  /**
   * 获取要传递给 AI 的已有规则信息（用于提示词上下文）
   * @param {Object} rule
   * @returns {Object|null}
   */
  function getExistingRuleContext(rule) {
    if (!rule) return null;
    return {
      domain: rule.domain,
      selectors: rule.selectors,
      typeKeywords: rule.typeKeywords
    };
  }

  /**
   * 将 AI 提取的题目数据转换为内部格式
   * @param {Object} item
   * @param {number} index
   * @returns {Object}
   */
  function createQuestionPayload(item, index) {
    const rawType = (item.type || '').toLowerCase();
    let type = 'unknown';
    if (rawType.includes('single') || rawType.includes('单选')) {
      type = 'single';
    } else if (rawType.includes('multiple') || rawType.includes('multi') || rawType.includes('多选')) {
      type = 'multiple';
    } else if (rawType.includes('judge') || rawType.includes('judgement') || rawType.includes('truefalse') ||
               rawType.includes('true_false') || rawType.includes('boolean') || rawType.includes('判断')) {
      type = 'judge';
    } else if (rawType.includes('fill') || rawType.includes('blank') || rawType.includes('填空')) {
      type = 'fill';
    }

    return {
      id: item.id || index + 1,
      text: D.normalizeWhitespace(item.text || ''),
      type,
      answer: null,
      status: 'pending'
    };
  }

  /**
   * 使用 AI 从选中的元素中提取题目
   * @param {Element} element
   * @returns {Promise<boolean>}
   */
  async function aiParseQuestionsFromElement(element) {
    if (!element) return false;

    const selectedText = D.getCleanText(element);
    if (!selectedText || selectedText.length < 10) {
      UI.showPanelMessage('所选区域文本过少，请重新选择包含完整题目的区域。');
      return false;
    }

    // 当前域名已有规则时，提示用户正在进行合并优化
    const existingRule = state.currentRule;
    const loadingMsg = existingRule
      ? `AI 优化规则中...\n（${location.hostname}）`
      : `AI 解析选中区域...`;
    UI.ensurePanel(state.questionsData.length || 1);
    UI.showPanelMessage(loadingMsg);

    // 获取已有规则的上下文信息用于提示词
    const existingRuleContext = getExistingRuleContext(existingRule);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'extractQuestions',
        pageText: D.sliceWithTail(selectedText, 8000),
        pageStructure: D.sanitizeOuterHTML(element, 12000),
        selectionText: D.sliceWithTail(selectedText, 2000),
        elementHint: describeElement(element),
        existingRule: existingRuleContext
      });

      if (response.success && Array.isArray(response.questions) && response.questions.length > 0) {
        state.questionsData = response.questions.map(createQuestionPayload);

        if (response.selectors) {
          if (existingRule) {
            // 已有规则：合并 AI 解析结果
            const mergedRule = mergeRuleWithExisting(
              existingRule,
              response.selectors,
              null // AI 暂不返回 typeKeywords，保留已有值
            );
            await globalThis.QuizHelperApp.saveParseRule(mergedRule);
          } else {
            // 无已有规则：构建全新规则
            const newRule = buildNewRuleFromAI(response.selectors);
            await globalThis.QuizHelperApp.saveParseRule(newRule);
          }
        }

        return true;
      }

      console.log('[QuizHelper] AI 提取失败:', response.error);
      return false;
    } catch (error) {
      console.log('[QuizHelper] AI 提取异常:', error);
      return false;
    }
  }

  /**
   * 自动查找页面主内容区域
   * @returns {Element|null}
   */
  function findMainContentElement() {
    const candidates = [
      '.main-padding-content', 'main', '#content', '#main',
      '.content', '.exam-content', '.quiz-content', '.paper-content'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && D.getCleanText(el).length > 50) return el;
    }
    let best = null;
    let bestLen = 0;
    document.querySelectorAll('div, section, article').forEach(el => {
      const len = D.getCleanText(el).length;
      if (len > bestLen && len > 200) {
        bestLen = len;
        best = el;
      }
    });
    return best;
  }

  /**
   * AI 全页面解析并分析（无规则时的首次解析流程）
   */
  async function aiParseFullPageAndAnalyze() {
    const target = findMainContentElement();
    if (!target) {
      UI.createPanel(0);
      UI.showPanelMessage('未找到页面主内容区域，请点击"AI 选区解析"手动选择题目区域。');
      return;
    }

    UI.showPanelMessage('AI 解析页面中...');

    const success = await aiParseQuestionsFromElement(target);
    if (!success) {
      state.questionsData = [];
      UI.createPanel(0);
      UI.showPanelMessage('AI 未能自动解析出题目。请点击"AI 选区解析"后，在页面中手动点选一块题目区域。');
      return;
    }

    UI.createPanel(state.questionsData.length);
    UI.renderCards();
    await analyzeAllQuestions();
  }

  /**
   * AI 选区解析并分析完整流程
   * @param {Element} element
   */
  async function aiParseAndAnalyze(element) {
    const success = await aiParseQuestionsFromElement(element);
    if (!success) {
      state.questionsData = [];
      UI.createPanel(0);
      UI.showPanelMessage('AI 未能从该区域解析出题目，请换一块更完整的题目区域再试。');
      return;
    }

    UI.createPanel(state.questionsData.length);
    UI.renderCards();
    await analyzeAllQuestions();
  }

  // 导出 API
  globalThis.QuizHelperAnalyzer = {
    analyzeAllQuestions,
    analyzeSingleQuestion,
    togglePauseAnalysis,
    restartAnalysis,
    reparseAndAnalyze,
    toggleAiPicker,
    aiParseAndAnalyze,
    aiParseFullPageAndAnalyze,
    stopElementPicker
  };
})();
