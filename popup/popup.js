// Popup 逻辑：向当前标签页发送分析指令 + 主题切换

window.QuizHelperIcons?.replaceIcons(document);
const { DEFAULT_SHORTCUT, STORAGE_KEYS } = globalThis.QuizHelperConstants;
const { normalizeShortcutConfig, formatShortcutDisplay } = globalThis.QuizHelperShortcutUtils;
const { applyBodyTheme, loadThemeMode, saveThemeMode, updateThemeToggleUI } = globalThis.QuizHelperThemeUtils;

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
  currentTheme = await loadThemeMode(STORAGE_KEYS.THEME_MODE);
  updateToggleUI();
  applyTheme();
}

async function setTheme(theme) {
  currentTheme = theme;
  await saveThemeMode(theme, STORAGE_KEYS.THEME_MODE);
  updateToggleUI();
  applyTheme();
}

function updateToggleUI() {
  updateThemeToggleUI(themeToggle, currentTheme);
}

function applyTheme() {
  applyBodyTheme(currentTheme, darkMediaQuery, document.body);
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
        files: [
          'icons.js',
          'shared/constants.js',
          'shared/shortcut-utils.js',
          'shared/theme-utils.js',
          'content/index.js'
        ]
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
  const config = await chrome.storage.local.get([STORAGE_KEYS.PANEL_SHORTCUT]);
  let shortcutText = '未设置';
  if (config[STORAGE_KEYS.PANEL_SHORTCUT] !== null) {
    const shortcut = normalizeShortcutConfig(config[STORAGE_KEYS.PANEL_SHORTCUT]) || { ...DEFAULT_SHORTCUT };
    shortcutText = formatShortcutDisplay(shortcut);
  }

  popupHint.innerHTML = `唤起助手快捷键：<strong>${shortcutText}</strong>`;
}
