// Popup 逻辑：向当前标签页发送分析指令 + 主题切换 + 状态面板（模型/搜索切换与检测）

window.QuizHelperIcons?.replaceIcons(document);
const { DEFAULT_SHORTCUT, STORAGE_KEYS } = globalThis.QuizHelperConstants;
const { getMessage } = globalThis.QuizHelperI18n;
const { normalizeShortcutConfig, formatShortcutDisplay } = globalThis.QuizHelperShortcutUtils;
const { applyBodyTheme, loadThemeMode, saveThemeMode, updateThemeToggleUI } = globalThis.QuizHelperThemeUtils;

// 兜底本地化：处理 Chrome 未自动替换的 __MSG_xxx__ 静态文案
globalThis.QuizHelperI18n.localizePage(document);

const popupHint = document.getElementById('popupHint');
const themeToggle = document.getElementById('themeToggle');

// 版本号：与设置页"关于"一致，从 manifest 读取
const popupVersion = document.getElementById('popupVersion');
if (popupVersion) {
  const version = chrome?.runtime?.getManifest?.()?.version || '--';
  popupVersion.textContent = `v${version}`;
}

// ===== 主题管理 =====

let currentTheme = 'system';
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

loadTheme();
loadShortcutDisplay();
loadStatusPanel();

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
  // 应用主题风格（经典/苹果），与头部内联脚本互为兜底
  try {
    const { applyThemeStyle, loadThemeStyle } = globalThis.QuizHelperThemeUtils;
    applyThemeStyle(await loadThemeStyle(), document.documentElement);
  } catch (e) {}
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
  let shortcutText = getMessage('popupNoShortcut');
  // 注意：这里不能改成 `!= null`。存储中从未设置该键时值为 undefined，此时插件实际
  // 使用默认快捷键（见 content 侧 resolvePanelShortcut），应显示默认值；
  // 仅当用户显式清空（值为 null）时才显示"未设置"。
  if (config[STORAGE_KEYS.PANEL_SHORTCUT] !== null) {
    const shortcut = normalizeShortcutConfig(config[STORAGE_KEYS.PANEL_SHORTCUT]) || { ...DEFAULT_SHORTCUT };
    shortcutText = formatShortcutDisplay(shortcut);
  }

  popupHint.innerHTML = getMessage('popupShortcutHint', [shortcutText]);
}

// ===== 状态面板 =====
// 打开时读取上次检测的状态（status_cache）并渲染，零网络请求；
// 仅手动「重新检测」触发后台真实探测（detectStatus）。

const statusRedetect = document.getElementById('statusRedetect');
const llmDropdown = document.getElementById('llmDropdown');
const llmDropdownBtn = document.getElementById('llmDropdownBtn');
const llmDot = document.getElementById('llmDot');
const llmDropdownLabel = document.getElementById('llmDropdownLabel');
const llmDropdownMenu = document.getElementById('llmDropdownMenu');
const searchDropdown = document.getElementById('searchDropdown');
const searchDropdownBtn = document.getElementById('searchDropdownBtn');
const searchDot = document.getElementById('searchDot');
const searchDropdownLabel = document.getElementById('searchDropdownLabel');
const searchDropdownMenu = document.getElementById('searchDropdownMenu');
const bankCount = document.getElementById('bankCount');
const ruleStatus = document.getElementById('ruleStatus');

let statusModels = [];
let statusActiveModelId = '';
let statusSearchProviders = [];
let statusActiveSearchProviderId = '';
let statusCache = { llm: {}, search: {} };

/** 设置状态点样式：ok 绿 / err 红 / 其余灰 */
function applyDot(el, status) {
  el.classList.toggle('ok', status === 'ok');
  el.classList.toggle('err', status === 'err');
}

/** 构造按钮/选项的 title 提示（面板上不渲染状态文字） */
function statusTitle(entry) {
  if (!entry) return '';
  if (entry.status === 'ok' && entry.latencyMs != null) {
    return getMessage('statusTooltipOk', [entry.latencyMs]);
  }
  if (entry.status === 'err') {
    return getMessage('statusTooltipErr', [entry.error || getMessage('commonUnknownError')]);
  }
  return '';
}

/** 渲染单个下拉菜单项（带状态点） */
function buildStatusOption({ id, label, status, title, onPick }) {
  const opt = document.createElement('button');
  opt.type = 'button';
  opt.className = 'status-dropdown-option';
  const dot = document.createElement('i');
  dot.className = 'status-dot' + (status ? ` ${status}` : '');
  dot.setAttribute('aria-hidden', 'true');
  opt.appendChild(dot);
  opt.appendChild(document.createTextNode(label));
  if (title) opt.title = title;
  opt.addEventListener('mousedown', async e => {
    e.preventDefault();
    await onPick(id, label);
  });
  return opt;
}

async function loadStatusPanel() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.LLM_MODELS,
    STORAGE_KEYS.ACTIVE_MODEL_ID,
    STORAGE_KEYS.WEB_SEARCH_PROVIDERS,
    STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER_ID,
    STORAGE_KEYS.QUESTION_BANKS,
    STORAGE_KEYS.ACTIVE_BANK_IDS,
    STORAGE_KEYS.QUESTION_BANK_ENABLED,
    STORAGE_KEYS.PARSE_RULES,
    STORAGE_KEYS.DEFAULT_PARSE_RULE_SEEDED,
    STORAGE_KEYS.STATUS_CACHE
  ]);

  statusModels = result[STORAGE_KEYS.LLM_MODELS] || [];
  statusActiveModelId = result[STORAGE_KEYS.ACTIVE_MODEL_ID] || '';
  statusSearchProviders = result[STORAGE_KEYS.WEB_SEARCH_PROVIDERS] || [];
  statusActiveSearchProviderId = result[STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER_ID] || '';
  statusCache = result[STORAGE_KEYS.STATUS_CACHE] || { llm: {}, search: {} };

  renderLlmStatus();
  renderSearchStatus();
  renderBankStatus(result);
  renderRuleStatus(result);
}

/**
 * 渲染单个服务下拉：当前项 label/状态点/title + 重建菜单（选中态）
 * @param {object} cfg - { items, current, cacheMap, labelEl, dotEl, btnEl, menuEl, getLabel, onPick }
 */
function renderStatusDropdown({ items, current, cacheMap, labelEl, dotEl, btnEl, menuEl, getLabel, onPick }) {
  const currentEntry = current ? cacheMap[current.id] : null;
  labelEl.textContent = current ? getLabel(current) : getMessage('statusNotConfigured');
  applyDot(dotEl, currentEntry ? currentEntry.status : '');
  btnEl.title = statusTitle(currentEntry);

  menuEl.innerHTML = '';
  items.forEach(item => {
    const entry = cacheMap[item.id] ? cacheMap[item.id] : null;
    const opt = buildStatusOption({
      id: item.id,
      label: getLabel(item),
      status: entry ? entry.status : '',
      title: statusTitle(entry),
      onPick
    });
    if (current && item.id === current.id) opt.classList.add('selected');
    menuEl.appendChild(opt);
  });
}

/** 选择服务：写生效项到 storage 并刷新选中态 */
async function selectStatusItem({ id, label, setActiveId, storageKey, labelEl, menuEl }) {
  setActiveId(id);
  await chrome.storage.local.set({ [storageKey]: id });
  labelEl.textContent = label;
  menuEl.querySelectorAll('.status-dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.textContent.trim() === label);
  });
  closeDropdowns();
}

function renderLlmStatus() {
  const activeModels = statusModels.filter(m => m.isActive);
  const current = activeModels.find(m => m.id === statusActiveModelId) || activeModels[0] || null;
  renderStatusDropdown({
    items: activeModels,
    current,
    cacheMap: statusCache.llm,
    labelEl: llmDropdownLabel,
    dotEl: llmDot,
    btnEl: llmDropdownBtn,
    menuEl: llmDropdownMenu,
    getLabel: m => m.name || m.modelId,
    onPick: selectModel
  });
}

function renderSearchStatus() {
  const configured = statusSearchProviders.filter(p => p.apiKey);
  const current = configured.find(p => p.id === statusActiveSearchProviderId) || configured[0] || null;
  renderStatusDropdown({
    items: configured,
    current,
    cacheMap: statusCache.search,
    labelEl: searchDropdownLabel,
    dotEl: searchDot,
    btnEl: searchDropdownBtn,
    menuEl: searchDropdownMenu,
    getLabel: p => p.name || p.id,
    onPick: selectSearchProvider
  });
}

function renderBankStatus(result) {
  const banks = result[STORAGE_KEYS.QUESTION_BANKS] || [];
  const activeIds = Array.isArray(result[STORAGE_KEYS.ACTIVE_BANK_IDS]) ? result[STORAGE_KEYS.ACTIVE_BANK_IDS] : [];
  const enabled = result[STORAGE_KEYS.QUESTION_BANK_ENABLED] !== false;
  bankCount.textContent = enabled ? banks.filter(b => activeIds.includes(b.id)).length : 0;
}

function renderRuleStatus(result) {
  const rules = result[STORAGE_KEYS.PARSE_RULES] || [];
  const active = rules.length > 0 || result[STORAGE_KEYS.DEFAULT_PARSE_RULE_SEEDED] === true;
  ruleStatus.classList.toggle('on', active);
  ruleStatus.classList.toggle('off', !active);
  const label = ruleStatus.querySelector('span');
  if (label) label.textContent = getMessage(active ? 'statusActive' : 'statusNone');
}

function selectModel(id, label) {
  return selectStatusItem({
    id,
    label,
    setActiveId: v => { statusActiveModelId = v; },
    storageKey: STORAGE_KEYS.ACTIVE_MODEL_ID,
    labelEl: llmDropdownLabel,
    menuEl: llmDropdownMenu
  });
}

function selectSearchProvider(id, label) {
  return selectStatusItem({
    id,
    label,
    setActiveId: v => { statusActiveSearchProviderId = v; },
    storageKey: STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER_ID,
    labelEl: searchDropdownLabel,
    menuEl: searchDropdownMenu
  });
}

function toggleDropdown(dd) {
  const wasOpen = dd.classList.contains('open');
  closeDropdowns();
  if (!wasOpen) dd.classList.add('open');
}

function closeDropdowns() {
  [llmDropdown, searchDropdown].forEach(dd => dd.classList.remove('open'));
}

llmDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  toggleDropdown(llmDropdown);
});
searchDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  toggleDropdown(searchDropdown);
});
document.addEventListener('click', closeDropdowns);

// 重新检测：触发后台全量探测，结果写回缓存并刷新渲染
statusRedetect.addEventListener('click', async () => {
  statusRedetect.disabled = true;
  statusRedetect.classList.add('is-loading');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'detectStatus' });
    if (res && res.success) {
      await loadStatusPanel();
    } else if (res && res.error) {
      console.error('状态检测失败:', res.error);
    }
  } catch (err) {
    console.error('状态检测调用失败:', err);
  } finally {
    statusRedetect.classList.remove('is-loading');
    statusRedetect.disabled = false;
  }
});
