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

  function showStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  function updateShortcutDisplay() {
    shortcutDisplayEl.classList.remove('recording');
    shortcutDisplayEl.textContent = currentShortcut ? currentShortcut.display : getMessage('optionsShortcutNotSet');
    const defaultLabel = sharedIsMacOS() ? '⌥ Q' : 'Alt+Q';
    shortcutHintEl.textContent = currentShortcut
      ? getMessage('optionsShortcutDefaultFormat', [defaultLabel])
      : getMessage('optionsShortcutNoneHint');
  }

  recordBtn.addEventListener('click', () => {
    isRecordingShortcut = true;
    shortcutDisplayEl.textContent = getMessage('optionsShortcutRecording');
    shortcutDisplayEl.classList.add('recording');
    const mods = sharedIsMacOS() ? getMessage('optionsShortcutModsMac') : getMessage('optionsShortcutModsWin');
    shortcutHintEl.textContent = getMessage('optionsShortcutModifierHintFormat', [mods]);
  });

  clearBtn.addEventListener('click', () => {
    isRecordingShortcut = false;
    currentShortcut = null;
    updateShortcutDisplay();
    showStatus(getMessage('optionsShortcutCleared'));
  });

  resetBtn.addEventListener('click', resetShortcut);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (isRecordingShortcut) {
        event.preventDefault();
        isRecordingShortcut = false;
        updateShortcutDisplay();
        showStatus(getMessage('optionsShortcutRecordingCancelled'));
      }
      return;
    }

    if (!isRecordingShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (sharedIsModifierKey(event.key)) return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      shortcutHintEl.textContent = getMessage('optionsShortcutNeedModifier');
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
    showStatus(getMessage('optionsShortcutRecorded'));
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
    showStatus(getMessage('optionsShortcutReset'));
  }

  return { setShortcutFromConfig, getCurrentShortcut, resetShortcut, updateShortcutDisplay };
}
