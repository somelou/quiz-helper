// 国际化工具：统一封装 chrome.i18n，并暴露全局对象 QuizHelperI18n
// 该文件同时用于：
// 1. 页面（popup/options）通过 <script> 引入
// 2. content_scripts 通过 manifest 注入（经典脚本，非模块）
// 3. background Service Worker 通过 background.js 以 ES module 副作用导入
//
// 说明：由于 options 页多个经典脚本会共享全局词法作用域，若各脚本都写
// `const { getMessage } = ...` 会导致重复声明报错，因此这里直接挂到全局，
// 各脚本无需再声明，直接使用 getMessage(key) 即可（background 等模块内部
// 仍可各自 const 解构，模块作用域相互隔离，不冲突）。
(() => {
  'use strict';

  const getMessage = (key, substitutions) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.i18n || !chrome.i18n.getMessage) {
        return key;
      }
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch (e) {
      return key;
    }
  };

  // 根据当前界面语言返回对应的提示词模板文件地址
  const getPromptTemplatesUrl = () => {
    try {
      const lang = (chrome.i18n && chrome.i18n.getUILanguage() || '').toLowerCase();
      if (lang.startsWith('en')) {
        return 'data/prompt-templates.en.json';
      }
    } catch (e) {
      // 忽略异常，回退默认语言
    }
    return 'data/prompt-templates.json';
  };

  /**
   * 本地化页面静态文案。HTML 中的用法：
   * - data-i18n="key"：元素文本（元素内保留中文默认文案，本地化成功才替换）
   * - data-i18n-title="key"：title 属性
   * - data-i18n-placeholder="key"：placeholder 属性
   * 全部走 chrome.i18n.getMessage（与 JS 动态文案同一机制，不依赖浏览器对
   * __MSG_ 的静态替换）。
   * 注意：data-i18n 仅用于纯文本元素；含子元素（图标/输入框）时请把文本包进
   * <span data-i18n>，避免 textContent 覆盖破坏子节点。
   * 由 popup.js / options/index.js 在页面脚本末尾显式调用。
   * @param {Document|Element} [root] 根节点，默认 document
   * @returns {number} 实际替换的次数
   */
  const localizePage = (root) => {
    const target = root || (typeof document !== 'undefined' ? document : null);
    if (!target) return 0;
    let count = 0;

    // 仅在拿到真实翻译时替换；取不到（locale 缺失等）则保留中文默认文案
    const localized = (key) => {
      const t = getMessage(key);
      return t === key ? null : t;
    };

    try {
      // 同步页面 lang 属性（仅当能取到 UI 语言时）
      if (target === document && document.documentElement && chrome.i18n && chrome.i18n.getUILanguage) {
        document.documentElement.lang = chrome.i18n.getUILanguage().replace('_', '-');
      }

      // data-i18n 主机制
      const els = target.querySelectorAll
        ? target.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder]')
        : [];
      for (const el of els) {
        const k = el.getAttribute('data-i18n');
        if (k) {
          const t = localized(k);
          if (t && t !== el.textContent) { el.textContent = t; count += 1; }
        }
        const kt = el.getAttribute('data-i18n-title');
        if (kt) {
          const t = localized(kt);
          if (t && t !== el.getAttribute('title')) { el.setAttribute('title', t); count += 1; }
        }
        const kp = el.getAttribute('data-i18n-placeholder');
        if (kp) {
          const t = localized(kp);
          if (t && t !== el.getAttribute('placeholder')) { el.setAttribute('placeholder', t); count += 1; }
        }
      }
    } catch (e) {
      // 忽略异常
    }
    return count;
  };

  globalThis.QuizHelperI18n = {
    getMessage,
    t: getMessage,
    getPromptTemplatesUrl,
    localizePage
  };
  // 提供全局 getMessage，供各经典脚本直接调用（避免重复 const 声明报错）
  globalThis.getMessage = getMessage;
})();
