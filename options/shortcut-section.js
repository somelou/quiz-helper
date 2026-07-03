// 快捷键管理模块 - 录制/显示/格式化

const DEFAULT_SHORTCUT = {
  altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
  code: 'KeyQ', key: 'q', display: 'Alt+Q'
};

function initShortcut({
  shortcutDisplayEl, shortcutHintEl,
  recordBtn, clearBtn, resetBtn, statusDiv
}) {
  let currentShortcut = getDefaultShortcut();
  let isRecordingShortcut = false;

  function getDefaultShortcut() {
    return { ...DEFAULT_SHORTCUT };
  }

  function normalizeShortcutConfig(shortcut) {
    if (!shortcut || typeof shortcut !== 'object') return null;
    const normalized = {
      altKey: !!shortcut.altKey, ctrlKey: !!shortcut.ctrlKey,
      metaKey: !!shortcut.metaKey, shiftKey: !!shortcut.shiftKey,
      code: String(shortcut.code || ''), key: String(shortcut.key || '')
    };
    if (!normalized.altKey && !normalized.ctrlKey && !normalized.metaKey && !normalized.shiftKey) return null;
    if (!normalized.code && !normalized.key) return null;
    normalized.display = formatShortcutDisplay(normalized);
    return normalized;
  }

  function formatShortcutDisplay(shortcut) {
    if (!shortcut) return '未设置';
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.metaKey) parts.push('Meta');
    if (shortcut.altKey) parts.push('Alt');
    if (shortcut.shiftKey) parts.push('Shift');
    const keyLabel = getShortcutKeyLabel(shortcut);
    if (keyLabel) parts.push(keyLabel);
    return parts.join('+') || '未设置';
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

  function isModifierKey(key) {
    return ['Alt', 'Control', 'Meta', 'Shift'].includes(key);
  }

  function showStatus(msg) {
    statusDiv.textContent = msg;
    setTimeout(() => {
      if (statusDiv.textContent === msg) statusDiv.textContent = '';
    }, 3000);
  }

  function updateShortcutDisplay() {
    shortcutDisplayEl.classList.remove('recording');
    shortcutDisplayEl.textContent = currentShortcut ? currentShortcut.display : '未设置';
    shortcutHintEl.textContent = currentShortcut
      ? '默认快捷键为 Alt+Q，macOS 上对应 Option+Q'
      : '当前未设置快捷键，保存后将关闭快捷键功能。';
  }

  recordBtn.addEventListener('click', () => {
    isRecordingShortcut = true;
    shortcutDisplayEl.textContent = '请按下新的快捷键组合...';
    shortcutDisplayEl.classList.add('recording');
    shortcutHintEl.textContent = '请至少包含一个修饰键，如 Alt、Ctrl、Shift 或 Meta。按 Esc 可取消。';
  });

  clearBtn.addEventListener('click', () => {
    isRecordingShortcut = false;
    currentShortcut = null;
    updateShortcutDisplay();
    showStatus('已清空快捷键，保存后生效');
  });

  resetBtn.addEventListener('click', () => {
    isRecordingShortcut = false;
    currentShortcut = getDefaultShortcut();
    updateShortcutDisplay();
    showStatus('已恢复默认快捷键，保存后生效');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (isRecordingShortcut) {
        event.preventDefault();
        isRecordingShortcut = false;
        updateShortcutDisplay();
        showStatus('已取消快捷键录制');
      }
      return;
    }

    if (!isRecordingShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (isModifierKey(event.key)) return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      shortcutHintEl.textContent = '快捷键至少需要一个修饰键，请重新录制。';
      return;
    }

    currentShortcut = {
      altKey: !!event.altKey, ctrlKey: !!event.ctrlKey,
      metaKey: !!event.metaKey, shiftKey: !!event.shiftKey,
      code: event.code || '', key: event.key || '',
      display: formatShortcutDisplay({
        altKey: !!event.altKey, ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey, shiftKey: !!event.shiftKey,
        code: event.code || '', key: event.key || ''
      })
    };

    isRecordingShortcut = false;
    updateShortcutDisplay();
    showStatus('快捷键已录制，点击"保存设置"后生效');
  }, true);

  function setShortcutFromConfig(panelShortcut) {
    currentShortcut = panelShortcut === null
      ? null
      : normalizeShortcutConfig(panelShortcut) || getDefaultShortcut();
    updateShortcutDisplay();
  }

  function getCurrentShortcut() {
    return currentShortcut;
  }

  function resetShortcut() {
    isRecordingShortcut = false;
    currentShortcut = getDefaultShortcut();
    updateShortcutDisplay();
    showStatus('已恢复默认快捷键，保存后生效');
  }

  return { setShortcutFromConfig, getCurrentShortcut, resetShortcut, updateShortcutDisplay };
}
