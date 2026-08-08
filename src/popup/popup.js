// Popup 逻辑：向当前标签页发送分析指令 + 主题切换 + 模型选择

window.QuizHelperIcons?.replaceIcons(document);
const { DEFAULT_SHORTCUT, STORAGE_KEYS } = globalThis.QuizHelperConstants;
const { normalizeShortcutConfig, formatShortcutDisplay } = globalThis.QuizHelperShortcutUtils;
const { applyBodyTheme, loadThemeMode, saveThemeMode, updateThemeToggleUI } = globalThis.QuizHelperThemeUtils;

const popupHint = document.getElementById('popupHint');
const themeToggle = document.getElementById('themeToggle');
const modelDropdown = document.getElementById('modelDropdown');
const modelDropdownBtn = document.getElementById('modelDropdownBtn');
const modelDropdownLabel = modelDropdownBtn.querySelector('.model-dropdown-label');
const modelDropdownMenu = document.getElementById('modelDropdownMenu');

// ===== 主题管理 =====

let currentTheme = 'system';
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

loadTheme();
loadShortcutDisplay();
loadModelSelector();

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
    // 注入文件清单直接取自 manifest 的 content_scripts（单一数据源，避免与 manifest 重复维护）
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files
      });
      // executeScript 的 Promise 在所有文件注入完成后才 resolve，可直接发送消息，无需延时
      await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
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
  // 注意：这里不能改成 `!= null`。存储中从未设置该键时值为 undefined，此时插件实际
  // 使用默认快捷键（见 content 侧 resolvePanelShortcut），应显示默认值；
  // 仅当用户显式清空（值为 null）时才显示"未设置"。
  if (config[STORAGE_KEYS.PANEL_SHORTCUT] !== null) {
    const shortcut = normalizeShortcutConfig(config[STORAGE_KEYS.PANEL_SHORTCUT]) || { ...DEFAULT_SHORTCUT };
    shortcutText = formatShortcutDisplay(shortcut);
  }

  popupHint.innerHTML = `唤起助手快捷键：<strong>${shortcutText}</strong>`;
}

// ===== 模型选择 =====

let activeModelId = '';

async function loadModelSelector() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.LLM_MODELS, STORAGE_KEYS.ACTIVE_MODEL_ID]);
  const models = result[STORAGE_KEYS.LLM_MODELS] || [];
  activeModelId = result[STORAGE_KEYS.ACTIVE_MODEL_ID] || '';

  const activeModels = models.filter(m => m.isActive);

  if (activeModels.length === 0) {
    modelDropdownLabel.textContent = '无可用模型';
    modelDropdownBtn.disabled = true;
    modelDropdownMenu.innerHTML = '';
    return;
  }

  modelDropdownBtn.disabled = false;
  const currentModel = activeModels.find(m => m.id === activeModelId);
  modelDropdownLabel.textContent = currentModel ? (currentModel.name || currentModel.modelId) : '选择模型';

  modelDropdownMenu.innerHTML = '';
  activeModels.forEach(m => {
    const opt = document.createElement('button');
    opt.className = 'model-dropdown-option';
    if (m.id === activeModelId) opt.classList.add('selected');
    // 选中态按显示文本（name）判断：name 在保存时被强制唯一（见 model-section.js saveModelFromDrawer），不会误选
    opt.textContent = m.name || m.modelId;
    opt.addEventListener('mousedown', async e => {
      e.preventDefault();
      await selectModel(m.id, m.name || m.modelId);
    });
    modelDropdownMenu.appendChild(opt);
  });
}

async function selectModel(id, label) {
  activeModelId = id;
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_MODEL_ID]: id });
  modelDropdownLabel.textContent = label;
  // 与初始渲染保持一致：显示文本即 name（唯一），按文本比较选中态
  modelDropdownMenu.querySelectorAll('.model-dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.textContent === label);
  });
  closeModelDropdown();
}

function toggleModelDropdown() {
  if (modelDropdownBtn.disabled) return;
  modelDropdown.classList.toggle('open');
}

function closeModelDropdown() {
  modelDropdown.classList.remove('open');
}

modelDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  toggleModelDropdown();
});

document.addEventListener('click', () => {
  closeModelDropdown();
});
