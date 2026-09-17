// 备份与恢复模块

function initBackup({
  moduleListEl,
  exportNoteEl,
  exportBtn,
  fileInputEl,
  fileNameEl,
  clearFileBtn,
  restoreHintEl,
  importBtn,
  onImportComplete
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const { STORAGE_KEYS: K } = globalThis.QuizHelperConstants;

  // 模块 → 存储 key 映射（key 统一来自 shared/constants.js 单一来源，避免字面量漂移）
  const MODULE_DEFS = [
    {
      id: 'settings',
      labelKey: 'optionsModuleSettings',
      keys: [
        K.CUSTOM_SYSTEM_PROMPTS,
        K.EXTRA_CONTEXT_PROMPT,
        K.ALLOWED_DOMAINS,
        K.BLOCKED_DOMAINS,
        K.PANEL_SHORTCUT,
        K.RULE_PARSE_APPEND_MODE,
        K.THEME_MODE,
        K.THEME_STYLE
      ]
    },
    {
      id: 'models',
      labelKey: 'optionsModuleModels',
      keys: [
        K.LLM_MODELS,
        K.ACTIVE_MODEL_ID,
        K.MODEL_BANK_ID,
        K.MODEL_EXTRACT_ID,
        K.API_URL,
        K.API_KEY,
        K.MODEL,
        K.STREAM_OUTPUT
      ]
    },
    {
      id: 'search',
      labelKey: 'optionsModuleSearch',
      keys: [
        K.WEB_SEARCH_ENABLED,
        K.ACTIVE_SEARCH_PROVIDER_ID,
        K.WEB_SEARCH_SETTINGS,
        K.WEB_SEARCH_PROVIDERS,
        K.WEB_SEARCH_USAGE
      ]
    },
    {
      id: 'rules',
      labelKey: 'optionsModuleRules',
      keys: [
        K.PARSE_RULES,
        K.DEFAULT_PARSE_RULE_SEEDED
      ]
    },
    {
      id: 'banks',
      labelKey: 'optionsModuleBanks',
      keys: [
        K.QUESTION_BANKS,
        K.ACTIVE_BANK_ID,
        K.ACTIVE_BANK_IDS,
        K.QUESTION_BANK_ENABLED,
        K.IMPORT_MODE
      ]
    },
    {
      id: 'history',
      labelKey: 'optionsModuleHistory',
      keys: [K.EXAM_HISTORY]
    },
    {
      id: 'userscripts',
      labelKey: 'optionsModuleUserScripts',
      keys: [K.USER_SCRIPTS]
    }
  ];

  const MODULE_MAP = MODULE_DEFS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  function showStatus(msg, type) {
    const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
    globalThis.QuizHelperMessage[method](msg);
  }

  function getSelectedModules() {
    return Array.from(moduleListEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value)
      .filter(id => MODULE_MAP[id]);
  }

  function updateExportNote() {
    if (!exportNoteEl) return;
    exportNoteEl.textContent = getMessage('optionsExportReadyFormat', [getSelectedModules().length]);
  }

  function updateFileName() {
    const file = fileInputEl.files && fileInputEl.files[0];
    fileNameEl.textContent = file ? file.name : getMessage('optionsBackupNoFile');
    if (clearFileBtn) clearFileBtn.style.display = file ? '' : 'none';
    if (!file && restoreHintEl) {
      restoreHintEl.style.display = 'none';
      restoreHintEl.textContent = '';
    }
  }

  // 选择文件后解析备份内容，提示将恢复的模块
  async function updateRestoreHint() {
    const file = fileInputEl.files && fileInputEl.files[0];
    if (!file || !restoreHintEl) return;
    try {
      const moduleIds = validateBackupPayload(JSON.parse(await file.text()));
      if (!moduleIds || moduleIds.length === 0) {
        restoreHintEl.style.display = 'none';
        restoreHintEl.textContent = '';
        return;
      }
      const names = moduleIds.map(id => getMessage(MODULE_MAP[id].labelKey)).join('、');
      restoreHintEl.textContent = getMessage('optionsBackupRestoreFormat', [names]);
      restoreHintEl.style.display = '';
    } catch (_) {
      restoreHintEl.style.display = 'none';
      restoreHintEl.textContent = '';
    }
  }

  async function buildBackupPayload(moduleIds) {
    const keys = [...new Set(moduleIds.flatMap(id => MODULE_MAP[id].keys))];
    const storageData = await chrome.storage.local.get(keys);
    const backupData = {};

    moduleIds.forEach(id => {
      const moduleData = {};
      MODULE_MAP[id].keys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(storageData, key)) {
          moduleData[key] = storageData[key];
        }
      });
      backupData[id] = moduleData;
    });

    return {
      app: 'quiz-helper',
      format: 'local-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      modules: moduleIds,
      data: backupData
    };
  }

  function downloadBackupFile(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function validateBackupPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.app !== 'quiz-helper') return null;
    if (payload.format !== 'local-backup') return null;
    if (payload.version !== 1) return null;
    if (!Array.isArray(payload.modules)) return null;
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) return null;

    const moduleIds = [...new Set(payload.modules.filter(id => MODULE_MAP[id]))];
    if (moduleIds.length === 0) return null;

    for (const id of moduleIds) {
      const moduleData = payload.data[id];
      if (!moduleData || typeof moduleData !== 'object' || Array.isArray(moduleData)) {
        return null;
      }
    }

    return moduleIds;
  }

  async function importBackupPayload(payload, moduleIds) {
    const updates = {};
    const removeKeys = [];

    moduleIds.forEach(id => {
      const moduleData = payload.data[id];
      MODULE_MAP[id].keys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(moduleData, key)) {
          updates[key] = moduleData[key];
        } else {
          removeKeys.push(key);
        }
      });
    });

    if (Object.keys(updates).length > 0) {
      await safeSet(updates);
    }
    if (removeKeys.length > 0) {
      await chrome.storage.local.remove([...new Set(removeKeys)]);
    }
  }

  exportBtn.addEventListener('click', async () => {
    try {
      const selectedModules = getSelectedModules();
      if (selectedModules.length === 0) {
        showStatus(getMessage('optionsBackupSelectModule'), 'error');
        return;
      }

      const payload = await buildBackupPayload(selectedModules);
      downloadBackupFile(payload);
      showStatus(getMessage('optionsBackupExportSuccess'), 'success');
    } catch (error) {
      showStatus(getMessage('optionsBackupExportFailedFormat', [error.message || getMessage('commonUnknownError')]), 'error');
    }
  });

  fileInputEl.addEventListener('change', () => {
    updateFileName();
    updateRestoreHint();
  });
  if (clearFileBtn) {
    clearFileBtn.addEventListener('click', () => {
      fileInputEl.value = '';
      updateFileName();
      updateRestoreHint();
    });
  }
  moduleListEl.addEventListener('change', updateExportNote);

  importBtn.addEventListener('click', async () => {
    const file = fileInputEl.files && fileInputEl.files[0];
    if (!file) {
      showStatus(getMessage('optionsBackupSelectFile'), 'error');
      return;
    }

    try {
      const text = await file.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch (_) {
        showStatus(getMessage('optionsBackupInvalidJson'), 'error');
        return;
      }

      const moduleIds = validateBackupPayload(payload);
      if (!moduleIds) {
        showStatus(getMessage('optionsBackupInvalidFormat'), 'error');
        return;
      }

      if (!confirm(getMessage('optionsBackupConfirm'))) {
        return;
      }

      await importBackupPayload(payload, moduleIds);
      updateFileName();
      showStatus(getMessage('optionsBackupImportedFormat', [moduleIds.length]), 'success');

      if (typeof onImportComplete === 'function') {
        await onImportComplete(moduleIds);
      }
    } catch (error) {
      showStatus(getMessage('optionsBackupImportFailedFormat', [error.message || getMessage('commonUnknownError')]), 'error');
    }
  });

  updateFileName();
  updateExportNote();

  return {
    getSelectedModules
  };
}
