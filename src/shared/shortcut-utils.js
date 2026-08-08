(() => {
  const { getMessage } = globalThis.QuizHelperI18n;
  const constants = globalThis.QuizHelperConstants || {};
  const defaultShortcut = constants.DEFAULT_SHORTCUT || {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: 'KeyQ',
    key: 'q'
  };

  function getDefaultShortcut() {
    return { ...defaultShortcut };
  }

  function normalizeShortcutConfig(shortcut) {
    if (!shortcut || typeof shortcut !== 'object') return null;

    const normalized = {
      altKey: !!shortcut.altKey,
      ctrlKey: !!shortcut.ctrlKey,
      metaKey: !!shortcut.metaKey,
      shiftKey: !!shortcut.shiftKey,
      code: String(shortcut.code || ''),
      key: String(shortcut.key || '')
    };

    if (!normalized.altKey && !normalized.ctrlKey && !normalized.metaKey && !normalized.shiftKey) {
      return null;
    }

    if (!normalized.code && !normalized.key) {
      return null;
    }

    return normalized;
  }

  // 通用键符号映射（两平台共用，方向键/Space/Enter/Tab/Backspace/Delete 等）
  const KEY_SYMBOLS = {
    Space: '␣',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '⏎',
    Tab: '⇥',
    Backspace: '⌫',
    Delete: '⌦'
  };

  function getShortcutKeyLabel(shortcut) {
    const code = shortcut.code || '';
    const key = shortcut.key || '';

    if (/^Key[A-Z]$/i.test(code)) return code.slice(3).toUpperCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    if (KEY_SYMBOLS[code]) return KEY_SYMBOLS[code];
    if (code) return code.replace(/^Key|^Digit|^Numpad/, '');
    return key.length === 1 ? key.toUpperCase() : key;
  }

  // macOS 上 Alt 对应 Option、Meta 对应 Cmd；Ctrl/Shift 两平台一致，无需切换
  function isMacOS() {
    const platform = (navigator.platform || '') + ' ' + (navigator.userAgent || '');
    return /mac|iphone|ipad|ipod/i.test(platform);
  }

  function formatShortcutDisplay(shortcut) {
    if (!shortcut) return getMessage('commonNotSet');
    const mac = isMacOS();
    const parts = [];
    if (mac) {
      // Apple 标准顺序：⇧ Shift, ⌃ Control, ⌥ Option, ⌘ Command
      if (shortcut.shiftKey) parts.push('⇧');
      if (shortcut.ctrlKey) parts.push('⌃');
      if (shortcut.altKey) parts.push('⌥');
      if (shortcut.metaKey) parts.push('⌘');
    } else {
      if (shortcut.ctrlKey) parts.push('Ctrl');
      if (shortcut.metaKey) parts.push('Meta');
      if (shortcut.altKey) parts.push('Alt');
      if (shortcut.shiftKey) parts.push('Shift');
    }

    const keyLabel = getShortcutKeyLabel(shortcut);
    if (keyLabel) parts.push(keyLabel);
    // macOS 用符号时以空格分隔，由 CSS letter-spacing 控制间距；Windows 用 +
    return parts.join(mac ? ' ' : '+') || getMessage('commonNotSet');
  }

  function shortcutMatches(event, shortcut) {
    if (!shortcut) return false;
    if (!!event.altKey !== !!shortcut.altKey) return false;
    if (!!event.ctrlKey !== !!shortcut.ctrlKey) return false;
    if (!!event.metaKey !== !!shortcut.metaKey) return false;
    if (!!event.shiftKey !== !!shortcut.shiftKey) return false;

    if (shortcut.code) {
      return event.code === shortcut.code;
    }

    return String(event.key || '').toLowerCase() === String(shortcut.key || '').toLowerCase();
  }

  function isModifierKey(key) {
    return ['Alt', 'Control', 'Meta', 'Shift'].includes(key);
  }

  globalThis.QuizHelperShortcutUtils = {
    formatShortcutDisplay,
    getDefaultShortcut,
    getShortcutKeyLabel,
    isMacOS,
    isModifierKey,
    normalizeShortcutConfig,
    shortcutMatches
  };
})();
