(function() {
  'use strict';

  // 防止重复注入
  if (window.__quizHelperInjected) return;
  window.__quizHelperInjected = true;

  // ===== 状态变量 =====
  let shadowRoot = null;
  let panelElement = null;
  let questionsData = [];
  let isAnalyzing = false;
  let isPaused = false;
  let analysisRunId = 0;
  let pickerState = null;

  // ===== 常量 =====
  const TYPE_LABELS = {
    single: '单选',
    multiple: '多选',
    judge: '判断',
    fill: '填空',
    unknown: '其他'
  };

  const STATUS_LABELS = {
    pending: '待分析',
    loading: '分析中...',
    done: '已完成',
    error: '出错'
  };

  // ===== 工具函数 =====

  /**
   * 检查当前域名是否在白名单中
   * @returns {Promise<boolean>}
   */
  async function checkDomainAllowed() {
    const config = await chrome.storage.local.get(['allowed_domains']);
    const domains = config.allowed_domains || [];
    if (domains.length === 0) return true;
    const hostname = location.hostname;
    return domains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  }

  /**
   * 规范化空白字符
   * @param {string} text
   * @returns {string}
   */
  function normalizeWhitespace(text) {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

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
    return normalizeWhitespace(clone.outerHTML || '').slice(0, limit);
  }

  // ===== 题型识别 =====

  /**
   * 根据文本内容判断题型
   * @param {string} text
   * @returns {string} 题型标识
   */
  function detectQuestionType(text) {
    const normalized = normalizeWhitespace(text);
    if (/多选|以下哪些|至少选|多项选择|可多选|不止一个|多个正确/.test(normalized)) return 'multiple';
    if (/(?:^|\n)\s*(?:正确|错误|对|错)\s*(?:$|\n)/m.test(normalized)) return 'judge';
    if (/_{3,}|【.*?】|填空/.test(normalized)) return 'fill';
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
   * 综合多种信息推断题型
   * @param {Element} questionEl
   * @param {string} fallbackType
   * @param {string} questionText
   * @param {string} optionText
   * @returns {string}
   */
  function inferTypeFromElement(questionEl, fallbackType, questionText, optionText) {
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

    // 优先查找 dd 元素（结构化选项）
    const optionItems = Array.from(optionsEl.querySelectorAll('dd'));
    if (optionItems.length > 0) {
      return optionItems.map((item, index) => {
        const number = normalizeWhitespace(item.querySelector('.option-num')?.textContent || '');
        let text = normalizeWhitespace(getCleanText(item));
        if (!text) return '';

        if (number && text.startsWith(number)) {
          return text;
        }

        if (number) {
          text = text.replace(/^[A-Ha-h][\.\、\)]\s*/, '');
          return `${number} ${text}`.trim();
        }

        return text || `${String.fromCharCode(65 + index)}.`;
      }).filter(Boolean);
    }

    // 降级为直接文本拆分
    const raw = getCleanText(optionsEl);
    return raw ? raw.split('\n').map(line => normalizeWhitespace(line)).filter(Boolean) : [];
  }

  // ===== 题目提取 =====

  /**
   * 构建题目记录对象
   * @param {Element} questionEl
   * @param {string} fallbackType
   * @param {number} index
   * @returns {Object|null}
   */
  function buildQuestionRecord(questionEl, fallbackType, index) {
    const questionNode = questionEl.querySelector('.question') || questionEl.querySelector('[data-region="content"]');
    if (!questionNode) return null;

    const questionText = normalizeWhitespace(getCleanText(questionNode));
    if (!questionText) return null;

    const optionsEl = questionEl.querySelector('.options') || questionEl.querySelector('[data-region="options"]');
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
   * 从结构化容器中提取题目（支持 .question-type-item 结构）
   * @param {Element} root
   * @returns {Array|null}
   */
  function extractQuestionsFromStructuredContainer(root) {
    if (!root || !(root instanceof Element)) return null;

    const structuredQuestions = Array.from(root.querySelectorAll('.question-type-item'));
    if (structuredQuestions.length === 0) return null;

    const questions = [];
    let currentType = 'unknown';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Element)) continue;

      if (node.matches('.h3.m-bottom')) {
        currentType = getHeadingType(node.textContent);
        continue;
      }

      if (node.matches('.question-type-item')) {
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
    const mainPadding = document.querySelector('.main-padding-content');
    if (!mainPadding) return null;

    const roots = [
      mainPadding.querySelector(':scope > .preview-content'),
      mainPadding
    ].filter(Boolean);

    for (const root of roots) {
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
    const selectors = [
      '.main-padding-content .preview-content',
      '.achievement-main', '.main-content', '.question-type-item',
      '[data-current*="exam/exam/question/types/answer/"]',
      '[class*="question"]', '[id*="question"]',
      '[class*="quiz"]', '[id*="quiz"]',
      '[class*="exam"]', '[id*="exam"]',
      '.q-main', '.q-title', '.problem', '.item-title'
    ];

    for (const selector of selectors) {
      const elements = root.querySelectorAll(selector);
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

    // 尝试按题号模式拆分
    const numberPattern = /(?:\n|\r|^)\s*(?:\(?\d+[\.\、\)\】\]]\s*|\(\d+\)\s*|（\d+）\s*)/;
    const parts = text.split(numberPattern).map(item => normalizeWhitespace(item)).filter(item => item.length > 5);
    if (parts.length >= 2) {
      return parts.map(createQuestion);
    }

    // 尝试按空行拆分
    const blankParts = text.split(/\n\s*\n/).map(item => normalizeWhitespace(item)).filter(item => item.length > 10);
    if (blankParts.length >= 2) {
      return blankParts.map(createQuestion);
    }

    // 无法拆分，作为单道题目返回
    return [createQuestion(normalizeWhitespace(text), 0)];
  }

  /**
   * 解析页面题目（结构化提取 → 文本提取降级）
   * @returns {Promise<boolean>}
   */
  async function parseExamQuestions() {
    const preciseQuestions = extractExamQuestions();
    if (preciseQuestions && preciseQuestions.length > 0) {
      questionsData = preciseQuestions;
      return true;
    }

    const rawText = extractQuestionText();
    if (!rawText || rawText.length < 5) return false;

    const generalQuestions = splitQuestions(rawText);
    if (!generalQuestions.length) return false;

    questionsData = generalQuestions;
    return true;
  }

  // ===== UI 面板管理 =====

  /**
   * 创建助手面板（Shadow DOM 隔离样式）
   * @param {number} totalQuestions
   */
  function createPanel(totalQuestions) {
    if (panelElement) {
      destroyPanel(false);
    }

    const host = document.createElement('div');
    host.id = 'quiz-helper-host';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    // 面板样式
    const style = document.createElement('style');
    style.textContent = `
      .qh-panel {
        position: fixed; bottom: 20px; right: 20px;
        width: 420px; max-height: 600px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        z-index: 2147483647;
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      .qh-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        cursor: move;
        user-select: none;
      }
      .qh-title { font-weight: 600; font-size: 14px; }
      .qh-progress { font-size: 12px; opacity: 0.9; margin-left: 6px; }
      .qh-header-btns { display: flex; gap: 6px; }
      .qh-header-btn {
        width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.15);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 13px;
        cursor: pointer;
        font-family: Arial, sans-serif;
        transition: background 0.15s;
        line-height: 1;
        padding: 0;
      }
      .qh-header-btn:hover { background: rgba(255,255,255,0.35); }
      .qh-body {
        padding: 10px;
        overflow-y: auto;
        flex: 1;
        background: #f8f9fa;
        max-height: 420px;
      }
      .qh-card {
        background: #fff;
        border-radius: 8px;
        margin-bottom: 8px;
        border: 1px solid #eee;
        box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        overflow: hidden;
      }
      .qh-card-header {
        display: flex; align-items: center;
        padding: 8px 10px;
        cursor: pointer;
        gap: 6px;
      }
      .qh-card-header:hover { background: #fafafa; }
      .qh-card-num {
        background: #667eea;
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 4px;
        min-width: 24px;
        text-align: center;
      }
      .qh-card-type { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 500; }
      .qh-type-single { background: #e3f2fd; color: #1565c0; }
      .qh-type-multiple { background: #f3e5f5; color: #6a1b9a; }
      .qh-type-judge { background: #e8f5e9; color: #2e7d32; }
      .qh-type-fill { background: #fff3e0; color: #e65100; }
      .qh-type-unknown { background: #f5f5f5; color: #616161; }
      .qh-card-summary {
        flex: 1;
        font-size: 12px;
        color: #333;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .qh-card-answer {
        font-size: 11px;
        color: #2e7d32;
        background: #e8f5e9;
        padding: 1px 6px;
        border-radius: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100px;
      }
      .qh-card-status { font-size: 11px; }
      .qh-status-pending { color: #999; }
      .qh-status-loading { color: #667eea; }
      .qh-status-done { color: #2e7d32; }
      .qh-status-error { color: #d32f2f; }
      .qh-card-body {
        padding: 10px;
        border-top: 1px solid #eee;
        font-size: 13px;
        line-height: 1.6;
        color: #333;
        display: none;
        user-select: text;
      }
      .qh-card-body.open { display: block; }
      .qh-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #888;
        margin-bottom: 4px;
      }
      .qh-question-text {
        user-select: text;
        background: #f8f8f8;
        padding: 8px;
        border-radius: 4px;
        font-size: 13px;
        line-height: 1.5;
        color: #333;
        max-height: 200px;
        overflow-y: auto;
      }
      .qh-answer-section { margin-top: 10px; }
      .qh-card-body pre {
        background: #f5f5f5;
        padding: 6px;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 12px;
        user-select: text;
      }
      .qh-card-body code {
        background: #f5f5f5;
        padding: 2px 4px;
        border-radius: 3px;
        font-size: 12px;
        user-select: text;
      }
      .qh-loading-text { color: #667eea; font-style: italic; }
      .qh-error-text { color: #d32f2f; }
      .qh-answer-text { white-space: pre-wrap; }
      .qh-footer {
        padding: 8px 10px;
        border-top: 1px solid #eee;
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        background: #fff;
      }
      .qh-btn {
        padding: 5px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: opacity 0.2s;
      }
      .qh-btn:hover { opacity: 0.9; }
      .qh-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .qh-btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
      .qh-btn-secondary { background: #e0e0e0; color: #333; }
      .qh-btn-warning { background: #ff9800; color: white; }
      .qh-empty { text-align: center; padding: 20px; color: #888; font-size: 13px; }
      .qh-mini-bar {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 50%;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,0.2);
        z-index: 2147483647;
        overflow: hidden;
        padding: 0;
      }
      .qh-mini-bar img {
        width: 28px;
        height: 28px;
        display: block;
        border-radius: 4px;
      }
    `;
    shadowRoot.appendChild(style);

    // 主面板
    panelElement = document.createElement('div');
    panelElement.className = 'qh-panel';
    panelElement.innerHTML = `
      <div class="qh-header">
        <div>
          <span class="qh-title">题目助手</span>
          <span class="qh-progress">- 共 ${totalQuestions} 题</span>
        </div>
        <div class="qh-header-btns">
          <button class="qh-header-btn" id="qh-minimize" title="最小化">_</button>
          <button class="qh-header-btn" id="qh-close" title="关闭">X</button>
        </div>
      </div>
      <div class="qh-body" id="qh-body"></div>
      <div class="qh-footer">
        <button class="qh-btn qh-btn-secondary" id="qh-ai-parse">AI选区解析</button>
        <button class="qh-btn qh-btn-secondary" id="qh-reparse">规则重解析</button>
        <button class="qh-btn qh-btn-warning" id="qh-pause">暂停</button>
        <button class="qh-btn qh-btn-primary" id="qh-retry">重新分析</button>
      </div>
    `;
    shadowRoot.appendChild(panelElement);

    // 最小化悬浮球
    const miniBar = document.createElement('div');
    miniBar.className = 'qh-mini-bar';
    miniBar.id = 'qh-mini-bar';
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    miniBar.innerHTML = `<img src="${iconUrl}" width="28" height="28" alt="题目助手" draggable="false">`;
    shadowRoot.appendChild(miniBar);

    // 绑定事件
    shadowRoot.getElementById('qh-minimize').addEventListener('click', minimizePanel);
    shadowRoot.getElementById('qh-close').addEventListener('click', removePanel);
    shadowRoot.getElementById('qh-ai-parse').addEventListener('click', toggleAiPicker);
    shadowRoot.getElementById('qh-reparse').addEventListener('click', reparseAndAnalyze);
    shadowRoot.getElementById('qh-pause').addEventListener('click', togglePauseAnalysis);
    shadowRoot.getElementById('qh-retry').addEventListener('click', restartAnalysis);
    miniBar.addEventListener('click', restorePanel);

    // 启用拖拽
    makeDraggable(shadowRoot.querySelector('.qh-header'), panelElement);
    makeDraggable(miniBar, miniBar);

    renderCards();
  }

  /**
   * 确保面板已创建
   * @param {number} totalQuestions
   */
  function ensurePanel(totalQuestions = questionsData.length) {
    if (panelElement) return;
    createPanel(totalQuestions);
  }

  /**
   * 销毁面板
   * @param {boolean} clearData - 是否清空题目数据
   */
  function destroyPanel(clearData = true) {
    stopElementPicker();
    const host = document.getElementById('quiz-helper-host');
    if (host) host.remove();
    shadowRoot = null;
    panelElement = null;
    isAnalyzing = false;
    isPaused = false;
    analysisRunId += 1;
    if (clearData) {
      questionsData = [];
    }
  }

  function minimizePanel() {
    if (!panelElement || !shadowRoot) return;
    panelElement.style.display = 'none';
    const bar = shadowRoot.getElementById('qh-mini-bar');
    if (bar) bar.style.display = 'flex';
  }

  function restorePanel() {
    if (!panelElement || !shadowRoot) return;
    panelElement.style.display = 'flex';
    const bar = shadowRoot.getElementById('qh-mini-bar');
    if (bar) bar.style.display = 'none';
  }

  function removePanel() {
    destroyPanel(true);
  }

  // ===== 渲染函数 =====

  function getTypeLabel(type) {
    return TYPE_LABELS[type] || '其他';
  }

  function getTypeClass(type) {
    return `qh-type-${type}`;
  }

  function getStatusLabel(status) {
    return STATUS_LABELS[status] || '待分析';
  }

  function getStatusClass(status) {
    return `qh-status-${status}`;
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

    // 优先按 "答案：X" 格式提取
    const answerMatch = t.match(/答案[：:]\s*(.+)/i);
    if (answerMatch) {
      const ans = answerMatch[1].trim();
      // 连续字母（多选/单选）
      const letters = ans.match(/^([A-H]+)$/i);
      if (letters) return letters[1].toUpperCase();
      // 判断结论
      if (/^(正确|对|是|true)$/i.test(ans)) return '对';
      if (/^(错误|错|否|false)$/i.test(ans)) return '错';
      return ans.length > 10 ? ans.slice(0, 10) + '...' : ans;
    }

    // 多行选项模式（如 C.电瓷 / D.绝缘纸）
    const optionLines = lines.filter(line => /^[A-H][\.\、\)\s]/.test(line));
    if (optionLines.length >= 2) {
      return optionLines.map(line => line[0].toUpperCase()).join('');
    }

    // 单行连续字母模式（如 "AB" / "A, B, C"）
    const multiMatch = firstLine.match(/(?:答案[：:]?\s*)?([A-H](?:[\s,]+[A-H]){1,})/i);
    if (multiMatch) return multiMatch[1].replace(/[\s,]/g, '').toUpperCase();

    // 单选项（带点号/顿号）
    const singleMatch = firstLine.match(/^([A-H])[\.\、\)]/);
    if (singleMatch) return singleMatch[1].toUpperCase();

    // 判断题结论（无"答案："前缀的兜底）
    if (/^(正确|对|是|true)\b/i.test(firstLine)) return '对';
    if (/^(错误|错|否|false)\b/i.test(firstLine)) return '错';

    return firstLine.length > 10 ? firstLine.slice(0, 10) + '...' : firstLine;
  }

  /**
   * 渲染所有题目卡片
   */
  function renderCards() {
    if (!shadowRoot) return;
    const body = shadowRoot.getElementById('qh-body');
    if (!body) return;

    if (questionsData.length === 0) {
      body.innerHTML = '<div class="qh-empty">未提取到题目。可先尝试规则解析，或点击"AI选区解析"后在页面中点选一块题目区域。</div>';
      updateControls();
      updateProgress();
      return;
    }

    body.innerHTML = '';
    questionsData.forEach((question, index) => {
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
        <div class="qh-card-body" id="card-body-${index}">
          <div class="qh-loading-text">${question.answer ? '已生成答案' : '待分析'}</div>
        </div>
      `;

      card.querySelector('.qh-card-header').addEventListener('click', () => {
        card.querySelector(`#card-body-${index}`).classList.toggle('open');
      });

      body.appendChild(card);

      if (question.answer) {
        updateCardBody(index, formatAnswer(question.answer), question.status === 'error');
      }
    });

    updateProgress();
    updateControls();
  }

  /**
   * 在面板中显示消息
   * @param {string} message
   */
  function showPanelMessage(message) {
    ensurePanel(questionsData.length);
    const body = shadowRoot.getElementById('qh-body');
    if (body) {
      body.innerHTML = `<div class="qh-empty">${escapeHtml(message).replace(/\n/g, '<br>')}</div>`;
    }
    updateControls();
    updateProgress();
  }

  /**
   * 更新单张卡片的内容区域
   * @param {number} index
   * @param {string} content
   * @param {boolean} isError
   */
  function updateCardBody(index, content, isError = false) {
    if (!shadowRoot) return;
    const bodyEl = shadowRoot.getElementById(`card-body-${index}`);
    if (!bodyEl) return;

    const question = questionsData[index];
    bodyEl.innerHTML = `
      <div class="qh-question-section">
        <div class="qh-section-title">题目</div>
        <div class="qh-question-text">${escapeHtml(question.text).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="qh-answer-section">
        <div class="qh-section-title">参考答案</div>
        <div class="${isError ? 'qh-error-text' : 'qh-answer-text'}">${content}</div>
      </div>
    `;

    if (question.status === 'done' || question.status === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'qh-btn qh-btn-primary';
      retryBtn.style.marginTop = '10px';
      retryBtn.textContent = '重新分析';
      retryBtn.addEventListener('click', event => {
        event.stopPropagation();
        analyzeSingleQuestion(index);
      });
      bodyEl.appendChild(retryBtn);
    }

    // 同步更新卡片头部的答案预览和状态
    const card = bodyEl.closest('.qh-card');
    if (card) {
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

    updateProgress();
    updateControls();
  }

  /**
   * 更新进度文本
   */
  function updateProgress() {
    if (!shadowRoot) return;
    const progressEl = shadowRoot.querySelector('.qh-progress');
    if (!progressEl) return;

    const total = questionsData.length;
    const finished = questionsData.filter(q => q.status === 'done' || q.status === 'error').length;
    let text = `- 共 ${total} 题，已完成 ${finished}/${total}`;

    if (pickerState) {
      text += '，请选择区域';
    } else if (isPaused) {
      text += '，已暂停';
    } else if (isAnalyzing) {
      text += '，分析中';
    }

    progressEl.textContent = text;
  }

  /**
   * 更新控制按钮状态
   */
  function updateControls() {
    if (!shadowRoot) return;

    const aiBtn = shadowRoot.getElementById('qh-ai-parse');
    const reparseBtn = shadowRoot.getElementById('qh-reparse');
    const pauseBtn = shadowRoot.getElementById('qh-pause');
    const retryBtn = shadowRoot.getElementById('qh-retry');

    if (aiBtn) {
      aiBtn.textContent = pickerState ? '取消选区' : 'AI选区解析';
      aiBtn.disabled = isAnalyzing;
    }

    if (reparseBtn) {
      reparseBtn.disabled = isAnalyzing || pickerState !== null;
    }

    if (pauseBtn) {
      pauseBtn.textContent = isPaused ? '继续' : '暂停';
      pauseBtn.disabled = pickerState !== null || (!isAnalyzing && !isPaused);
    }

    if (retryBtn) {
      retryBtn.disabled = pickerState !== null || questionsData.length === 0 || isAnalyzing;
    }
  }

  /**
   * HTML 转义
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 使元素可拖拽
   * @param {Element} handle - 拖拽手柄
   * @param {Element} target - 实际移动的元素
   */
  function makeDraggable(handle, target) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    handle.addEventListener('mousedown', event => {
      if (event.target.closest('.qh-header-btn')) return;
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
      target.style.left = `${initLeft + event.clientX - startX}px`;
      target.style.top = `${initTop + event.clientY - startY}px`;
      target.style.right = 'auto';
      target.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  /**
   * 将 AI 提取的题目数据转换为内部格式
   * @param {Object} item
   * @param {number} index
   * @returns {Object}
   */
  function createQuestionPayload(item, index) {
    return {
      id: item.id || index + 1,
      text: normalizeWhitespace(item.text || ''),
      type: (item.type || '').toLowerCase().includes('single') ? 'single' :
            (item.type || '').toLowerCase().includes('multiple') || (item.type || '').toLowerCase().includes('multi') ? 'multiple' :
            (item.type || '').toLowerCase().includes('judge') || (item.type || '').toLowerCase().includes('judgement') || (item.type || '').toLowerCase().includes('truefalse') ? 'judge' :
            (item.type || '').toLowerCase().includes('fill') || (item.type || '').toLowerCase().includes('blank') ? 'fill' : 'unknown',
      answer: null,
      status: 'pending'
    };
  }

  // ===== 分析控制 =====

  /**
   * 保存历史记录到本地存储
   */
  async function saveHistory() {
    if (questionsData.length === 0) return;

    const record = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      url: location.href,
      title: document.title,
      questions: questionsData.map(q => ({
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
    await chrome.storage.local.set({ exam_history: history });
  }

  /**
   * 重置所有题目为待分析状态
   */
  function resetQuestionsForAnalysis() {
    questionsData = questionsData.map((question, index) => ({
      ...question,
      id: index + 1,
      answer: null,
      status: 'pending'
    }));
    renderCards();
  }

  /**
   * 获取下一个待分析题目的索引
   * @returns {number}
   */
  function getNextPendingQuestionIndex() {
    return questionsData.findIndex(q => q.status === 'pending' || q.status === 'error');
  }

  /**
   * 分析单道题目
   * @param {number} index
   */
  async function analyzeSingleQuestion(index) {
    if (isAnalyzing) return;

    const question = questionsData[index];
    if (!question) return;

    isPaused = false;
    isAnalyzing = true;
    const runId = ++analysisRunId;
    question.status = 'loading';
    question.answer = null;
    updateCardBody(index, '<div class="qh-loading-text">正在请求 AI 分析...</div>');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'fetchAnswer',
        data: question.text,
        questionType: question.type
      });

      if (runId !== analysisRunId) return;

      if (response.success) {
        question.status = 'done';
        question.answer = response.answer;
        updateCardBody(index, formatAnswer(response.answer));
      } else {
        question.status = 'error';
        updateCardBody(index, `请求失败：${escapeHtml(response.error)}`, true);
      }
    } catch (error) {
      if (runId !== analysisRunId) return;
      question.status = 'error';
      updateCardBody(index, `通信错误：${escapeHtml(error.message)}`, true);
    } finally {
      if (runId === analysisRunId) {
        isAnalyzing = false;
        updateControls();
        updateProgress();
      }
    }
  }

  /**
   * 分析所有题目
   * @param {Object} options
   * @param {boolean} options.resume - 是否从上次暂停处继续
   */
  async function analyzeAllQuestions({ resume = false } = {}) {
    if (questionsData.length === 0) return;
    if (isAnalyzing) return;

    isPaused = false;
    isAnalyzing = true;
    const runId = ++analysisRunId;
    updateControls();
    updateProgress();

    let startIndex = 0;
    if (resume) {
      const pendingIndex = getNextPendingQuestionIndex();
      startIndex = pendingIndex === -1 ? questionsData.length : pendingIndex;
    }

    for (let index = startIndex; index < questionsData.length; index += 1) {
      if (runId !== analysisRunId) return;
      if (isPaused) {
        isAnalyzing = false;
        updateControls();
        updateProgress();
        return;
      }

      const question = questionsData[index];
      if (!question || question.status === 'done') continue;

      question.status = 'loading';
      updateCardBody(index, '<div class="qh-loading-text">正在请求 AI 分析...</div>');

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'fetchAnswer',
          data: question.text,
          questionType: question.type
        });

        if (runId !== analysisRunId) return;

        if (response.success) {
          question.status = 'done';
          question.answer = response.answer;
          updateCardBody(index, formatAnswer(response.answer));
        } else {
          question.status = 'error';
          updateCardBody(index, `请求失败：${escapeHtml(response.error)}`, true);
        }
      } catch (error) {
        if (runId !== analysisRunId) return;
        question.status = 'error';
        updateCardBody(index, `通信错误：${escapeHtml(error.message)}`, true);
      }
    }

    if (runId !== analysisRunId) return;

    isAnalyzing = false;
    updateControls();
    updateProgress();
    await saveHistory();
  }

  function togglePauseAnalysis() {
    if (pickerState) return;

    if (isPaused) {
      isPaused = false;
      updateControls();
      updateProgress();
      analyzeAllQuestions({ resume: true });
      return;
    }

    if (!isAnalyzing) return;
    isPaused = true;
    updateControls();
    updateProgress();
  }

  async function restartAnalysis() {
    if (isAnalyzing || questionsData.length === 0) return;
    resetQuestionsForAnalysis();
    await analyzeAllQuestions();
  }

  async function reparseAndAnalyze() {
    if (isAnalyzing || pickerState) return;
    const success = await parseExamQuestions();
    if (!success) {
      questionsData = [];
      createPanel(0);
      showPanelMessage('规则解析未提取到题目。点击"AI选区解析"后，在页面中点选包含题目的区域，再由 AI 做局部解析。');
      return;
    }

    createPanel(questionsData.length);
    renderCards();
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

      const text = getCleanText(current);
      if (!fallback && text.length >= 20) {
        fallback = current;
      }

      if (current.matches('.question-type-item, .preview-content, .main-padding-content, [data-current], section, article, form, table')) {
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
    if (!pickerState) return;

    document.removeEventListener('mousemove', pickerState.onMouseMove, true);
    document.removeEventListener('click', pickerState.onClick, true);
    document.removeEventListener('keydown', pickerState.onKeyDown, true);
    pickerState.overlay.remove();
    pickerState = null;
    updateControls();
    updateProgress();
  }

  /**
   * 启动元素选择模式（用户点击页面区域）
   */
  function startElementPicker() {
    if (pickerState || isAnalyzing) return;

    ensurePanel(questionsData.length);

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
      pickerState.currentElement = element;
    };

    const onClick = async event => {
      const element = getPickableElement(event.target) || pickerState.currentElement;
      if (!element) return;

      event.preventDefault();
      event.stopPropagation();
      stopElementPicker();
      await aiParseAndAnalyze(element);
    };

    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      stopElementPicker();
      showPanelMessage('已取消 AI 选区解析。可继续规则解析，或再次点击"AI选区解析"后选择页面区域。');
    };

    pickerState = {
      overlay,
      currentElement: null,
      onMouseMove,
      onClick,
      onKeyDown
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    showPanelMessage('请选择页面中的题目区域。按 Esc 可取消。');
  }

  function toggleAiPicker() {
    if (pickerState) {
      stopElementPicker();
      showPanelMessage('已取消 AI 选区解析。');
      return;
    }
    startElementPicker();
  }

  // ===== AI 选区解析 =====

  /**
   * 使用 AI 从选中的元素中提取题目
   * @param {Element} element
   * @returns {Promise<boolean>}
   */
  async function aiParseQuestionsFromElement(element) {
    if (!element) return false;

    const selectedText = getCleanText(element);
    if (!selectedText || selectedText.length < 10) {
      showPanelMessage('所选区域文本过少，请重新选择包含完整题目的区域。');
      return false;
    }

    showPanelMessage(`正在使用 AI 解析选中区域：${describeElement(element)}`);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'extractQuestions',
        pageText: selectedText.slice(0, 8000),
        pageStructure: sanitizeOuterHTML(element, 12000),
        selectionText: selectedText.slice(0, 2000),
        elementHint: describeElement(element)
      });

      if (response.success && Array.isArray(response.questions) && response.questions.length > 0) {
        questionsData = response.questions.map(createQuestionPayload);
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
   * AI 选区解析并分析完整流程
   * @param {Element} element
   */
  async function aiParseAndAnalyze(element) {
    const success = await aiParseQuestionsFromElement(element);
    if (!success) {
      questionsData = [];
      createPanel(0);
      showPanelMessage('AI 未能从该区域解析出题目，请换一块更完整的题目区域再试。');
      return;
    }

    createPanel(questionsData.length);
    renderCards();
    await analyzeAllQuestions();
  }

  // ===== 主入口 =====

  /**
   * 启动完整分析流程
   */
  async function startAnalysis() {
    const allowed = await checkDomainAllowed();
    if (!allowed) {
      createPanel(0);
      showPanelMessage('当前域名不在白名单中，请在设置页面添加生效域名。');
      return;
    }

    const success = await parseExamQuestions();
    if (!success) {
      questionsData = [];
      createPanel(0);
      showPanelMessage('规则解析未能提取到题目。点击"AI选区解析"后，在页面中点选一块题目区域，再自动解析。');
      return;
    }

    createPanel(questionsData.length);
    renderCards();
    await analyzeAllQuestions();
  }

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

  // ===== 消息监听 =====

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'analyze') {
      startAnalysis();
      sendResponse({ status: 'started' });
    }
    return true;
  });
})();
