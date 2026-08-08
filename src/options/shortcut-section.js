// 快捷键管理模块 - 录制/显示/格式化

const {
  normalizeShortcutConfig: sharedNormalizeShortcut,
  formatShortcutDisplay: sharedFormatShortcut,
  getDefaultShortcut: sharedGetDefaultShortcut,
  isModifierKey: sharedIsModifierKey,
  isMacOS: sharedIsMacOS
} = globalThis.QuizHelperShortcutUtils;

function initShortcut({
  shortcutDisplayEl, shortcutHintEl,
  recordBtn, clearBtn, resetBtn
}) {
  let currentShortcut = getDefaultShortcut();
  let isRecordingShortcut = false;

  function getDefaultShortcut() {
    const s = sharedGetDefaultShortcut();
    s.display = sharedFormatShortcut(s);
    return s;
  }

  function normalizeShortcutConfig(shortcut) {
    const normalized = sharedNormalizeShortcut(shortcut);
    if (!normalized) return null;
    normalized.display = sharedFormatShortcut(normalized);
    return normalized;
  }

  function isModifierKey(key) {
    return sharedIsModifierKey(key);
  }

  function showStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  function updateShortcutDisplay() {
    shortcutDisplayEl.classList.remove('recording');
    shortcutDisplayEl.textContent = currentShortcut ? currentShortcut.display : '未设置';
    const defaultLabel = sharedIsMacOS() ? '⌥ Q' : 'Alt+Q';
    shortcutHintEl.textContent = currentShortcut
      ? `默认快捷键为 ${defaultLabel}`
      : '当前未设置快捷键，保存后将关闭快捷键功能。';
  }

  recordBtn.addEventListener('click', () => {
    isRecordingShortcut = true;
    shortcutDisplayEl.textContent = '请按下新的快捷键组合...';
    shortcutDisplayEl.classList.add('recording');
    const mods = sharedIsMacOS() ? 'Option、Ctrl、Shift 或 Cmd' : 'Alt、Ctrl、Shift 或 Meta';
    shortcutHintEl.textContent = `请至少包含一个修饰键，如 ${mods}。按 Esc 可取消。`;
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
      display: sharedFormatShortcut({
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
