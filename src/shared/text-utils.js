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

  globalThis.QuizHelperTextUtils = {
    normalizeWhitespace,
    escapeRegex,
    escapeHtml,
    isDomainMatch
  };
})();
