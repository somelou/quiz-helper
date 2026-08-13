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

  const MODULE_DEFS = [
    {
      id: 'settings',
      labelKey: 'optionsModuleSettings',
      keys: [
        'custom_system_prompts',
        'extra_context_prompt',
        'allowed_domains',
        'panel_shortcut',
        'theme_mode'
      ]
    },
    {
      id: 'models',
      labelKey: 'optionsModuleModels',
      keys: [
        'llm_models',
        'active_model_id',
        'model_bank_id',
        'model_extract_id',
        'api_url',
        'api_key',
        'model'
      ]
    },
    {
      id: 'search',
      labelKey: 'optionsModuleSearch',
      keys: [
        'web_search_enabled',
        'active_search_provider_id',
        'web_search_settings',
        'web_search_providers',
        'web_search_usage'
      ]
    },
    {
      id: 'rules',
      labelKey: 'optionsModuleRules',
      keys: [
        'parse_rules',
        'default_parse_rule_seeded_v1'
      ]
    },
    {
      id: 'banks',
      labelKey: 'optionsModuleBanks',
      keys: [
        'question_banks',
        'active_bank_id',
        'active_bank_ids',
        'question_bank_enabled',
        'import_mode'
      ]
    },
    {
      id: 'history',
      labelKey: 'optionsModuleHistory',
      keys: ['exam_history']
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
