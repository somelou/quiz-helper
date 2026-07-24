(() => {
  'use strict';

  const state = globalThis.QuizHelperContentState;
  const { normalizeWhitespace, escapeRegex } = globalThis.QuizHelperTextUtils;

  /**
   * 安全执行 querySelectorAll，选择器无效时返回空数组
   * @param {Element} el
   * @param {string} selector
   * @returns {Element[]}
   */
  function safeQuerySelectorAll(el, selector) {
    try {
      return Array.from(el.querySelectorAll(selector));
    } catch (_e) {
      console.warn('[QuizHelper] 无效的 CSS 选择器，已跳过:', selector);
      return [];
    }
  }

  // ===== 文本工具 =====

  /**
   * 提取元素的纯文本内容，移除脚本、样式和无关元素
   * @param {Element} el
   * @returns {string}
   */
  function getCleanText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll([
      'script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe',
      '.ads', '.comments', '.show-left', '.show-right', '.side-content',
      '.achievement-side', '.achievement-known', '.achievement-head',
      '.bottom-favorite', '.watermark'
    ].join(',')).forEach(node => node.remove());
    return normalizeWhitespace(clone.innerText || '');
  }

  function sliceWithTail(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    const marker = '\n...\n';
    const headLen = Math.floor((limit - marker.length) / 2);
    const tailLen = Math.max(0, limit - marker.length - headLen);
    return value.slice(0, headLen) + marker + value.slice(-tailLen);
  }

  /**
   * 提取元素的外层 HTML，移除脚本和样式，并限制长度
   * @param {Element} el
   * @param {number} limit - 最大长度限制
   * @returns {string}
   */
  function sanitizeOuterHTML(el, limit = 12000) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, iframe').forEach(node => node.remove());
    return sliceWithTail(normalizeWhitespace(clone.outerHTML || ''), limit);
  }

  // ===== 选择器获取 =====

  /**
   * 获取当前生效的选择器配置
   * @returns {Object}
   */
  function getSelectors() {
    return (state.currentRule && state.currentRule.selectors) || state.DEFAULT_SELECTORS;
  }

  /**
   * 获取当前生效的题型关键词
   * @returns {Object}
   */
  function getTypeKeywords() {
    return (state.currentRule && state.currentRule.typeKeywords) || state.DEFAULT_TYPE_KEYWORDS;
  }

  // ===== 题型识别 =====

  /**
   * 根据文本内容判断题型
   * @param {string} text
   * @returns {string} 题型标识
   */
  function detectQuestionType(text) {
    const normalized = normalizeWhitespace(text);
    const kw = getTypeKeywords();

    if (kw.multiple && kw.multiple.some(k => normalized.includes(k))) return 'multiple';

    if (kw.judge && kw.judge.length > 0) {
      const pattern = kw.judge.map(escapeRegex).join('|');
      if (new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*(?:$|\\n)`, 'm').test(normalized)) return 'judge';
    }

    if (kw.fill && kw.fill.some(k => normalized.includes(k))) return 'fill';

    if (/(?:^|\n)\s*[A-Ha-h][\.\、\)]\s*/m.test(normalized)) return 'single';

    return 'unknown';
  }

  /**
   * 从标题文本中提取题型
   * @param {string} text
   * @returns {string}
   */
  function getHeadingType(text) {
    const title = normalizeWhitespace(text);
    if (title.includes('单选')) return 'single';
    if (title.includes('多选')) return 'multiple';
    if (title.includes('判断')) return 'judge';
    if (title.includes('填空')) return 'fill';
    return 'unknown';
  }

  /**
   * 从 data-current 属性中提取题型
   * @param {string} value
   * @returns {string}
   */
  function getTypeFromDataCurrent(value) {
    const current = (value || '').toLowerCase();
    if (current.includes('judgement')) return 'judge';
    if (current.includes('fill')) return 'fill';
    if (current.includes('choise') || current.includes('choice')) return 'unknown';
    return 'unknown';
  }

  /**
   * 检查题目元素及其祖先元素的 class 是否包含指定的关键词
   * @param {Element} questionEl - 题目元素
   * @param {string[]} keywords - 关键词列表
   * @returns {boolean}
   */
  function hasClassIndicator(questionEl, keywords) {
    if (!questionEl || !keywords || keywords.length === 0) return false;
    const classChain = [];
    let el = questionEl;
    let depth = 0;
    while (el && el !== document.body && depth < 5) {
      if (el.className && typeof el.className === 'string') {
        classChain.push(el.className.toLowerCase());
      }
      el = el.parentElement;
      depth += 1;
    }
    const allClasses = classChain.join(' ');
    return keywords.some(kw => kw && allClasses.includes(kw.toLowerCase()));
  }

  /**
   * 综合多种信息推断题型
   * @param {Element} questionEl
   * @param {string} fallbackType
   * @param {string} questionText
   * @param {string} optionText
   * @returns {string}
   */
  function inferTypeFromElement(questionEl, fallbackType, questionText, optionText) {
    const selectors = getSelectors();
    const typeIndicators = selectors.typeIndicators || {};

    if (typeIndicators.single && hasClassIndicator(questionEl, typeIndicators.single)) return 'single';
    if (typeIndicators.multiple && hasClassIndicator(questionEl, typeIndicators.multiple)) return 'multiple';
    if (typeIndicators.judge && hasClassIndicator(questionEl, typeIndicators.judge)) return 'judge';

    const dataCurrentType = getTypeFromDataCurrent(questionEl.getAttribute('data-current'));
    if (dataCurrentType !== 'unknown') return dataCurrentType;

    if (questionEl.querySelector('input[type="checkbox"]')) return 'multiple';

    if (questionEl.querySelector('input[type="radio"]')) {
      if (/(?:正确|错误|对|错)/.test(optionText || questionText)) {
        return 'judge';
      }
      return fallbackType !== 'unknown' ? fallbackType : 'single';
    }

    const detectedByText = detectQuestionType([questionText, optionText].filter(Boolean).join('\n'));
    if (detectedByText !== 'unknown') return detectedByText;
    return fallbackType;
  }

  // ===== 选项提取 =====

  /**
   * 从选项容器中提取选项文本列表
   * @param {Element} optionsEl
   * @returns {string[]}
   */
  function collectOptionLines(optionsEl) {
    if (!optionsEl) return [];

    const selectors = getSelectors();
    const optionItemSel = selectors.optionItemSelector || state.DEFAULT_SELECTORS.optionItemSelector || 'dd';
    const optionNumSel = selectors.optionNumberSelector || '.option-num';

    const optionItems = safeQuerySelectorAll(optionsEl, optionItemSel);
    if (optionItems.length > 0) {
      return optionItems.map((item, index) => {
        const number = normalizeWhitespace(item.querySelector(optionNumSel)?.textContent || '');
        let text = normalizeWhitespace(getCleanText(item));
        if (!text) return '';

        if (number && text.startsWith(number)) {
          return text.replace(/^([A-Ha-h][\.\、\)])\s*\n\s*/, '$1 ');
        }

        if (number) {
          text = text.replace(/^[A-Ha-h][\.\、\)]\s*\n\s*/, '');
          return `${number} ${text}`.trim();
        }

        return text || `${String.fromCharCode(65 + index)}.`;
      }).filter(Boolean);
    }

    const labelItems = Array.from(optionsEl.querySelectorAll('label')).filter(label => {
      if (label.querySelector('input[type="radio"], input[type="checkbox"]')) return true;
      const forId = label.getAttribute('for');
      if (!forId) return false;
      try {
        return Boolean(optionsEl.querySelector(`#${CSS.escape(forId)}`));
      } catch (e) {
        return false;
      }
    });
    if (labelItems.length >= 2) {
      return labelItems.map((label, index) => {
        const text = normalizeWhitespace(getCleanText(label) || label.innerText || '');
        if (!text) return '';
        if (/^[A-Ha-h][\.\、\)]\s*/.test(text)) return text;
        return `${String.fromCharCode(65 + index)}. ${text}`.trim();
      }).filter(Boolean);
    }

    const raw = getCleanText(optionsEl);
    return raw ? raw.split('\n').map(line => normalizeWhitespace(line)).filter(Boolean) : [];
  }

  // ===== 题目提取 =====

  function findCommonAncestor(root, elements) {
    if (!root || !elements || elements.length === 0) return null;
    let candidate = elements[0] instanceof Element ? elements[0] : elements[0]?.parentElement;
    while (candidate && candidate !== root) {
      if (elements.every(el => candidate.contains(el))) return candidate;
      candidate = candidate.parentElement;
    }
    if (root instanceof Element && elements.every(el => root.contains(el))) return root;
    return null;
  }

  function findOptionsElement(questionEl) {
    const selectors = getSelectors();
    const direct = selectors.optionContainerSelectors
      .map(sel => questionEl.querySelector(sel))
      .find(Boolean);
    if (direct) return direct;

    const inputs = Array.from(questionEl.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputs.length >= 2) {
      return findCommonAncestor(questionEl, inputs);
    }

    const labels = Array.from(questionEl.querySelectorAll('label'));
    if (labels.length >= 2) {
      return findCommonAncestor(questionEl, labels);
    }

    return null;
  }

  function buildQuestionRecord(questionEl, fallbackType, index) {
    const selectors = getSelectors();
    const questionNode = selectors.questionTextSelectors
      .map(sel => questionEl.querySelector(sel))
      .find(Boolean);
    if (!questionNode) return null;

    const questionText = normalizeWhitespace(getCleanText(questionNode)).replace(/^(\d+[\.\、\)\】\]])\s*\n\s*/, '$1 ');
    if (!questionText) return null;

    const optionsEl = findOptionsElement(questionEl);
    const optionLines = collectOptionLines(optionsEl);
    const optionText = optionLines.join('\n');
    const fullText = optionText ? `${questionText}\n${optionText}` : questionText;
    const type = inferTypeFromElement(questionEl, fallbackType, questionText, optionText);

    return {
      id: index + 1,
      text: fullText,
      type: type || 'unknown',
      answer: null,
      status: 'pending'
    };
  }

  /**
   * 从结构化容器中提取题目
   * @param {Element} root
   * @returns {Array|null}
   */
  function extractQuestionsFromStructuredContainer(root) {
    if (!root || !(root instanceof Element)) return null;

    const selectors = getSelectors();
    const itemSel = selectors.questionItemSelector;
    const headingSel = selectors.typeHeadingSelector;

    if (!itemSel) return null;
    const structuredQuestions = safeQuerySelectorAll(root, itemSel);
    if (structuredQuestions.length === 0) return null;

    const questions = [];
    let currentType = 'unknown';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Element)) continue;

      if (headingSel && node.matches(headingSel)) {
        currentType = getHeadingType(node.textContent);
        continue;
      }

      if (node.matches(itemSel)) {
        const question = buildQuestionRecord(node, currentType, questions.length);
        if (question) {
          questions.push(question);
        }
      }
    }

    return questions.length > 0 ? questions : null;
  }

  /**
   * 主入口：尝试提取页面中的题目
   * @returns {Array|null}
   */
  function extractExamQuestions() {
    const selectors = getSelectors();
    const roots = selectors.rootSelectors
      .map(sel => document.querySelector(sel))
      .filter(Boolean);

    const expandedRoots = [];
    for (const root of roots) {
      expandedRoots.push(root);
      const childPreview = root.querySelector(':scope > .preview-content');
      if (childPreview) expandedRoots.push(childPreview);
    }

    for (const root of expandedRoots) {
      const questions = extractQuestionsFromStructuredContainer(root);
      if (questions && questions.length > 0) {
        return questions;
      }
    }

    return null;
  }

  /**
   * 从页面中提取包含题目的文本块（降级方案）
   * @param {Document|Element} root
   * @returns {string}
   */
  function extractQuestionText(root = document) {
    const selectors = getSelectors().fallbackTextSelectors;

    for (const selector of selectors) {
      const elements = safeQuerySelectorAll(root, selector);
      if (elements.length === 0) continue;

      let bestElement = null;
      let bestLength = 0;
      elements.forEach(element => {
        const text = getCleanText(element);
        if (text.length > bestLength) {
          bestLength = text.length;
          bestElement = element;
        }
      });

      if (bestElement && bestLength > 10) {
        return getCleanText(bestElement);
      }
    }

    return getCleanText(root === document ? document.body : root).slice(0, 8000);
  }

  /**
   * 将文本按题号拆分为多道题目
   * @param {string} text
   * @returns {Array}
   */
  function splitQuestions(text) {
    if (!text || text.length < 10) return [];

    const createQuestion = (part, index) => ({
      id: index + 1,
      text: part,
      type: detectQuestionType(part),
      answer: null,
      status: 'pending'
    });

    const numberPattern = /(?:\n|\r|^)\s*(?:\(?\d+[\.\、\)\】\]]\s*|\(\d+\)\s*|（\d+）\s*)/;
    const parts = text.split(numberPattern).map(item => normalizeWhitespace(item)).filter(item => item.length > 5);
    if (parts.length >= 2) {
      return parts.map(createQuestion);
    }

    const blankParts = text.split(/\n\s*\n/).map(item => normalizeWhitespace(item)).filter(item => item.length > 10);
    if (blankParts.length >= 2) {
      return blankParts.map(createQuestion);
    }

    return [createQuestion(normalizeWhitespace(text), 0)];
  }

  /**
   * 解析页面题目（结构化提取 → 文本提取降级）
   * @returns {Promise<boolean>}
   */
  async function parseExamQuestions() {
    state.currentRule = await globalThis.QuizHelperApp.getDomainRule();
    if (!state.currentRule) return false;

    const preciseQuestions = extractExamQuestions();
    if (preciseQuestions && preciseQuestions.length > 0) {
      state.questionsData = preciseQuestions;
      await globalThis.QuizHelperApp.incrementRuleUseCount(state.currentRule);
      return true;
    }

    const rawText = extractQuestionText();
    if (!rawText || rawText.length < 5) return false;

    const generalQuestions = splitQuestions(rawText);
    if (!generalQuestions.length) return false;

    state.questionsData = generalQuestions;
    await globalThis.QuizHelperApp.incrementRuleUseCount(state.currentRule);
    return true;
  }

  // 导出 API
  globalThis.QuizHelperDomParser = {
    getCleanText,
    normalizeWhitespace,
    sliceWithTail,
    sanitizeOuterHTML,
    getSelectors,
    getTypeKeywords,
    parseExamQuestions
  };
})();
