// 全局轻量消息提示：顶部居中（对齐 antd message：深色底 + 白字 + 类型色图标，自动消失）
// 仅设置页使用；样式定义在 options.css，Token 见 shared/variables.css
(function () {
  'use strict';

  const DEFAULT_DURATION = 3000;
  const EXIT_DURATION = 220;

  // 各类型的 SVG 图标（与 src/icons/ 一致的线性描边风格，颜色由 CSS 的 currentColor 控制）
  const ICONS = {
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 7v3.8"/><path d="M8 4.7h.01"/></svg>',
    success: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.1 8.2l1.9 1.9 3.9-4"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6 14.4 13H1.6Z"/><path d="M8 7v2.6"/><path d="M8 11.6h.01"/></svg>',
    error: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4"/></svg>'
  };

  let container = null;

  function ensureContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.className = 'qh-message-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * 显示一条全局消息
   * @param {string} content - 文本内容
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   * @param {number} [duration=3000] - 展示毫秒数，<=0 不自动消失
   */
  function showMessage(content, type = 'info', duration = DEFAULT_DURATION) {
    // 空内容视为清空消息，不创建气泡（兼容历史 showStatus('') 的清空语义）
    if (!content || String(content).trim() === '') return;
    const messageType = ICONS[type] ? type : 'info';
    const el = document.createElement('div');
    el.className = `qh-message qh-message-${messageType}`;
    // 无障碍：错误使用 alert 角色，其余使用 status
    el.setAttribute('role', messageType === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-atomic', 'true');

    const icon = document.createElement('span');
    icon.className = 'qh-message-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ICONS[messageType];

    const text = document.createElement('span');
    text.className = 'qh-message-text';
    text.textContent = content;

    let timer = null;
    let dismissed = false;

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      el.classList.remove('qh-message-show');
      el.classList.add('qh-message-hide');
      setTimeout(() => {
        el.remove();
      }, EXIT_DURATION);
    };

    el.append(icon, text);
    ensureContainer().appendChild(el);

    // 入场动画
    requestAnimationFrame(() => el.classList.add('qh-message-show'));

    if (Number.isFinite(duration) && duration > 0) {
      timer = setTimeout(dismiss, duration);
    }
  }

  globalThis.QuizHelperMessage = {
    info: (content, duration) => showMessage(content, 'info', duration),
    success: (content, duration) => showMessage(content, 'success', duration),
    warning: (content, duration) => showMessage(content, 'warning', duration),
    error: (content, duration) => showMessage(content, 'error', duration)
  };
})();
