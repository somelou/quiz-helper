(() => {
  'use strict';

  // 题型中文关键词单一来源（shared/constants.js，早于本文件被注入）
  const TYPE_CN_KEYWORDS = globalThis.QuizHelperConstants?.TYPE_CN_KEYWORDS || {};

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
   * @param {string} domain - 白名单/黑名单/规则域名
   * @returns {boolean}
   */
  function isDomainMatch(hostname, domain) {
    if (!hostname || !domain) return false;
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  /**
   * Chrome match pattern 匹配（用户脚本 matches 校验用，popup / options / background 共用）
   * 与 chrome.userScripts 的注册匹配语义保持一致，避免各端自行解析造成偏差。
   * @param {string} url - 完整 URL（含协议）
   * @param {string} pattern - 匹配模式，如 `<all_urls>`、`https://*.example.com/*`
   * @returns {boolean}
   */
  function matchesUrlPattern(url, pattern) {
    if (!url || !pattern) return false;
    const p = String(pattern).trim();
    if (p === '<all_urls>') return true;
    const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)?$/.exec(p);
    if (!m) return false;
    const scheme = m[1];
    const host = m[2];
    const pathGlob = m[3] || '/';
    const targetUrl = new URL(url);
    if (scheme !== '*' && targetUrl.protocol.replace(/:$/, '') !== scheme) return false;
    if (host !== '*') {
      if (host.startsWith('*.')) {
        const base = host.slice(2);
        if (targetUrl.hostname !== base && !targetUrl.hostname.endsWith('.' + base)) return false;
      } else if (targetUrl.hostname !== host) {
        return false;
      }
    }
    const pathRegex = new RegExp('^' + pathGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return pathRegex.test(targetUrl.pathname + targetUrl.search);
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
    const cnSingle = TYPE_CN_KEYWORDS.single || ['单选'];
    const cnMultiple = TYPE_CN_KEYWORDS.multiple || ['多选'];
    const cnJudge = TYPE_CN_KEYWORDS.judge || ['判断'];
    const cnFill = TYPE_CN_KEYWORDS.fill || ['填空'];

    if (value.includes('single') || cnSingle.some(kw => value.includes(kw))) return 'single';
    if (value.includes('multi') || cnMultiple.some(kw => value.includes(kw))) return 'multiple';
    if (value.includes('judge') || value.includes('truefalse') || value.includes('true_false') ||
        value.includes('boolean') || cnJudge.some(kw => value.includes(kw))) return 'judge';
    if (value.includes('fill') || value.includes('blank') || cnFill.some(kw => value.includes(kw))) return 'fill';
    return 'unknown';
  }

  /**
   * 复制文本到剪贴板，优先使用 Clipboard API，失败时降级到 execCommand。
   * 面板与设置页共用一份实现（此前各自维护一份）。
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

  globalThis.QuizHelperTextUtils = {
    normalizeWhitespace,
    escapeRegex,
    escapeHtml,
    isDomainMatch,
    normalizeQuestionType,
    matchesUrlPattern,
    copyText
  };
})();
