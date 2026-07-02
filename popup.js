// Popup 逻辑：向当前标签页发送分析指令 + 主题切换

const DEFAULT_SHORTCUT = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code: 'KeyQ',
  key: 'q',
  display: 'Alt+Q'
};

const popupHint = document.getElementById('popupHint');
const themeToggle = document.getElementById('themeToggle');

// ===== 主题管理 =====

let currentTheme = 'system';
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

loadTheme();
loadShortcutDisplay();

// 主题切换按钮事件
themeToggle.addEventListener('click', event => {
  const btn = event.target.closest('.theme-btn');
  if (!btn) return;
  setTheme(btn.dataset.theme);
});

// 系统主题变化时，若为 system 模式则同步
darkMediaQuery.addEventListener('change', () => {
  if (currentTheme === 'system') applyTheme();
});

async function loadTheme() {
  const config = await chrome.storage.local.get(['theme_mode']);
  currentTheme = config.theme_mode || 'system';
  updateToggleUI();
  applyTheme();
}

async function setTheme(theme) {
  currentTheme = theme;
  await chrome.storage.local.set({ theme_mode: theme });
  updateToggleUI();
  applyTheme();
}

function updateToggleUI() {
  themeToggle.dataset.theme = currentTheme;
  themeToggle.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });
}

function applyTheme() {
  let isDark;
  if (currentTheme === 'dark') {
    isDark = true;
  } else if (currentTheme === 'light') {
    isDark = false;
  } else {
    isDark = darkMediaQuery.matches;
  }
  document.body.classList.toggle('dark', isDark);
}

// 分析当前页面按钮
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    // 尝试直接发送消息（Content Script 已加载时）
    await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
  } catch (e) {
    // Content Script 未加载，动态注入后再发送
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
      }, 300);
    } catch (injectErr) {
      console.error('注入失败:', injectErr);
    }
  }

  window.close();
});

// 打开设置页面按钮
document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

async function loadShortcutDisplay() {
  const config = await chrome.storage.local.get(['panel_shortcut']);
  let shortcutText = '未设置';
  if (config.panel_shortcut !== null) {
    const shortcut = normalizeShortcutConfig(config.panel_shortcut) || { ...DEFAULT_SHORTCUT };
    shortcutText = formatShortcutDisplay(shortcut);
  }

  popupHint.innerHTML = `唤起助手快捷键：<strong>${shortcutText}</strong>`;
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
