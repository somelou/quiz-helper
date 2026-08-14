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
  const { safeSet } = globalThis.QuizHelperStorageUtils;
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
    shortcutDisplayEl.classList.toggle('is-empty', !currentShortcut); // 未设置时弱化为 12px 描述文本
    setShortcutText(currentShortcut ? currentShortcut.display : getMessage('optionsShortcutNotSet'));
    // 未设置快捷键时隐藏胶囊内的清除按钮
    if (clearBtn) clearBtn.hidden = !currentShortcut;
    const defaultLabel = sharedIsMacOS() ? '⌥ Q' : 'Alt+Q';
    shortcutHintEl.textContent = currentShortcut
      ? getMessage('optionsShortcutDefaultFormat', [defaultLabel])
      : getMessage('optionsShortcutNoneHint');
  }

  // 只更新文本节点，保留钥匙图标（.shortcut-key-icon）
  function setShortcutText(text) {
    const textEl = shortcutDisplayEl.querySelector('#shortcutText');
    if (textEl) textEl.textContent = text;
    else shortcutDisplayEl.textContent = text;
  }

  // 自动保存：操作后立即写入存储，无需再点「保存设置」即可生效
  function persistShortcut() {
    safeSet({ panel_shortcut: currentShortcut }).catch(() => {});
  }

  recordBtn.addEventListener('click', () => {
    isRecordingShortcut = true;
    setShortcutText(getMessage('optionsShortcutRecording'));
    shortcutDisplayEl.classList.add('recording');
    const mods = sharedIsMacOS() ? getMessage('optionsShortcutModsMac') : getMessage('optionsShortcutModsWin');
    shortcutHintEl.textContent = getMessage('optionsShortcutModifierHintFormat', [mods]);
  });

  clearBtn.addEventListener('click', event => {
    event.stopPropagation(); // 清除按钮位于胶囊内部，避免触发胶囊的录制
    isRecordingShortcut = false;
    currentShortcut = null;
    updateShortcutDisplay();
    shortcutDisplayEl.blur();
    persistShortcut(); // 清空后立即生效
    showStatus(getMessage('optionsShortcutCleared'));
  });

  resetBtn.addEventListener('click', resetShortcut);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (isRecordingShortcut) {
        event.preventDefault();
        isRecordingShortcut = false;
        updateShortcutDisplay();
        recordBtn.blur(); // 退出录制时移除焦点，避免键盘交互触发 :focus-visible 焦点环
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
    recordBtn.blur(); // 同上：键盘完成录制后移除焦点
    persistShortcut(); // 录制成功后立即生效
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
    persistShortcut(); // 恢复默认后立即生效
    showStatus(getMessage('optionsShortcutReset'));
  }

  return { setShortcutFromConfig, getCurrentShortcut, resetShortcut, updateShortcutDisplay };
}
