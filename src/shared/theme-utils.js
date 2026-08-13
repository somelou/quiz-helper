(() => {
  function resolveIsDark(themeMode, darkMediaQuery) {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return !!darkMediaQuery?.matches;
  }

  function updateThemeToggleUI(themeToggle, themeMode) {
    if (!themeToggle) return;
    themeToggle.dataset.theme = themeMode;
    themeToggle.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === themeMode);
    });
  }

  function applyBodyTheme(themeMode, darkMediaQuery, body = document.body) {
    if (!body) return;
    body.classList.toggle('dark', resolveIsDark(themeMode, darkMediaQuery));
  }

  async function loadThemeMode(storageKey = 'theme_mode') {
    const config = await chrome.storage.local.get([storageKey]);
    return config[storageKey] || 'system';
  }

  async function saveThemeMode(themeMode, storageKey = 'theme_mode') {
    const safeSet = globalThis.QuizHelperStorageUtils && globalThis.QuizHelperStorageUtils.safeSet;
    if (safeSet) {
      await safeSet({ [storageKey]: themeMode });
    } else {
      await chrome.storage.local.set({ [storageKey]: themeMode });
    }
  }

  // ===== 主题风格（经典 / 苹果） =====

  const THEME_STYLE_KEY = 'theme_style';

  async function loadThemeStyle() {
    const config = await chrome.storage.local.get([THEME_STYLE_KEY]);
    return config[THEME_STYLE_KEY] || 'classic';
  }

  async function saveThemeStyle(themeStyle) {
    // 同步镜像到 localStorage，供 popup/options 头部脚本即时读取（避免闪烁）
    try { localStorage.setItem(THEME_STYLE_KEY, themeStyle); } catch (e) {}
    const safeSet = globalThis.QuizHelperStorageUtils && globalThis.QuizHelperStorageUtils.safeSet;
    if (safeSet) {
      await safeSet({ [THEME_STYLE_KEY]: themeStyle });
    } else {
      await chrome.storage.local.set({ [THEME_STYLE_KEY]: themeStyle });
    }
  }

  /**
   * 应用主题风格到指定根元素（页面为 documentElement，内容面板为 shadow 内根容器）
   * @param {string} themeStyle - 'classic' | 'apple'
   * @param {HTMLElement} [root] - 默认 document.documentElement
   */
  function applyThemeStyle(themeStyle, root = document.documentElement) {
    if (!root) return;
    const style = themeStyle === 'apple' ? 'apple' : 'classic';
    root.setAttribute('data-theme-style', style);
  }

  globalThis.QuizHelperThemeUtils = {
    applyBodyTheme,
    loadThemeMode,
    saveThemeMode,
    updateThemeToggleUI,
    loadThemeStyle,
    saveThemeStyle,
    applyThemeStyle
  };
})();
