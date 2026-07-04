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

  globalThis.QuizHelperTextUtils = {
    normalizeWhitespace,
    escapeRegex,
    escapeHtml
  };
})();
