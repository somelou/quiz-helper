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

  globalThis.QuizHelperThemeUtils = {
    applyBodyTheme,
    loadThemeMode,
    resolveIsDark,
    saveThemeMode,
    updateThemeToggleUI
  };
})();
