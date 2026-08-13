// 主题风格引导脚本（独立文件，规避 MV3 扩展 CSP 对内联脚本的限制）
// 功能：尽早为 <html> 设置 data-theme-style（经典/苹果），避免样式闪烁。
// 读取顺序：localStorage（同步，即时）→ chrome.storage（异步，校准）。
(() => {
  'use strict';

  function apply(style) {
    document.documentElement.setAttribute('data-theme-style', style === 'apple' ? 'apple' : 'classic');
  }

  try {
    // 同步：saveThemeStyle 会镜像到 localStorage
    let ts = null;
    try { ts = localStorage.getItem('theme_style'); } catch (e) {}
    if (ts) apply(ts);
  } catch (e) {}

  // 异步校准：chrome.storage 为权威来源
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['theme_style']).then((r) => {
        apply(r.theme_style || 'classic');
      });
    }
  } catch (e) {}
})();
