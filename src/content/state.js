(() => {
  'use strict';

  const state = {
    // 状态变量
    shadowRoot: null,
    panelElement: null,
    questionsData: [],
    isAnalyzing: false,
    isStarting: false,
    _createPanelTask: null,
    isPaused: false,
    analysisRunId: 0,
    pickerState: null,
    panelShortcut: null,
    themeMode: 'system',
    isDarkMode: false,
    currentRule: null,

    DEFAULT_SELECTORS: {
      rootSelectors: ['.main-padding-content > .preview-content', '.main-padding-content'],
      questionItemSelector: '.question-type-item',
      typeHeadingSelector: '.h3.m-bottom',
      questionTextSelectors: ['.question', '[data-region="content"]'],
      optionContainerSelectors: [
        '.options', '[data-region="options"]',
        '.option', '.option-list', '.optionList',
        '.choices', '.choice', '.answers', '.answer', '.answer-list',
        '[role="radiogroup"]', '[role="listbox"]',
        'ul', 'ol'
      ],
      optionItemSelector: 'dd, li, label, .option-item, .choice, .answer-item, [role="option"]',
      optionNumberSelector: '.option-num',
      typeIndicators: {
        single: ['singleContainer', 'single-question', 'singleChoice'],
        multiple: ['multipleContainer', 'multi-question', 'multipleChoice'],
        judge: ['judgeContainer', 'true-false', 'judgeQuestion']
      },
      fallbackTextSelectors: [
        '.main-padding-content .preview-content',
        '.achievement-main', '.main-content', '.question-type-item',
        '[data-current*="exam/exam/question/types/answer/"]',
        '[class*="question"]', '[id*="question"]',
        '[class*="quiz"]', '[id*="quiz"]',
        '[class*="exam"]', '[id*="exam"]',
        '.q-main', '.q-title', '.problem', '.item-title'
      ]
    },

    DEFAULT_TYPE_KEYWORDS: {
      single: ['单选', '单项选择', 'single choice', 'single-choice', 'single question'],
      multiple: ['多选', '以下哪些', '至少选', '多项选择', '可多选', '不止一个', '多个正确', 'multiple choice', 'multi choice', 'multi-select', 'multiple answers'],
      judge: ['正确', '错误', '对', '错', 'true', 'false', 'correct', 'incorrect', 'right or wrong'],
      fill: ['___', '【', '填空', 'fill in the blank', 'fill-in-the-blank', 'blank']
    },

    defaultRuleSeedPromise: null
  };

  globalThis.QuizHelperContentState = state;
})();
