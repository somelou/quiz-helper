(() => {
  'use strict';

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
   * 转义正则特殊字符
   * @param {string} str
   * @returns {string}
   */
  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
   * 判断主机名是否匹配目标域名（精确匹配或子域名后缀匹配）
   * @param {string} hostname - 当前页面主机名
   * @param {string} domain - 白名单/规则域名
   * @returns {boolean}
   */
  function isDomainMatch(hostname, domain) {
    if (!hostname || !domain) return false;
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  /**
   * 题型归一化：把 AI/Excel 中的英文或中文题型描述映射为内部题型
   * （single / multiple / judge / fill / unknown）
   * 注意：'multi' 已覆盖 'multiple'、'judge' 已覆盖 'judgement' 子串，无需重复判断；
   * 该函数为纯字符串匹配，对历史已存数据（题型为字符串）无需迁移，直接可复用。
   * @param {string|undefined} type - 原始题型描述
   * @returns {string} 内部题型
   */
  function normalizeQuestionType(type) {
    const value = String(type || '').toLowerCase();
    if (value.includes('single') || value.includes('单选')) return 'single';
    if (value.includes('multi') || value.includes('多选')) return 'multiple';
    if (value.includes('judge') || value.includes('truefalse') || value.includes('true_false') ||
        value.includes('boolean') || value.includes('判断')) return 'judge';
    if (value.includes('fill') || value.includes('blank') || value.includes('填空')) return 'fill';
    return 'unknown';
  }

  globalThis.QuizHelperTextUtils = {
    normalizeWhitespace,
    escapeRegex,
    escapeHtml,
    isDomainMatch,
    normalizeQuestionType
  };
})();
