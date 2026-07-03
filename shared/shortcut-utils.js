(() => {
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

  function getShortcutKeyLabel(shortcut) {
    const code = shortcut.code || '';
    const key = shortcut.key || '';

    if (/^Key[A-Z]$/i.test(code)) return code.slice(3).toUpperCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    if (code === 'Space') return 'Space';
    if (code.startsWith('Arrow')) return code.replace('Arrow', '');
    if (code) return code.replace(/^Key|^Digit|^Numpad/, '');
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function formatShortcutDisplay(shortcut) {
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.metaKey) parts.push('Meta');
    if (shortcut.altKey) parts.push('Alt');
    if (shortcut.shiftKey) parts.push('Shift');

    const keyLabel = getShortcutKeyLabel(shortcut);
    if (keyLabel) parts.push(keyLabel);
    return parts.join('+') || '未设置';
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
    isModifierKey,
    normalizeShortcutConfig,
    shortcutMatches
  };
})();
