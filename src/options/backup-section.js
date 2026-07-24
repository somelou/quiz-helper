// 备份与恢复模块

function initBackup({
  moduleListEl,
  exportBtn,
  exportStatusEl,
  fileInputEl,
  fileNameEl,
  importBtn,
  importStatusEl,
  onImportComplete
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;

  const MODULE_DEFS = [
    {
      id: 'settings',
      label: '基本设置',
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
      label: '大模型',
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
      label: '联网搜索',
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
      label: '解析规则',
      keys: [
        'parse_rules',
        'default_parse_rule_seeded_v1'
      ]
    },
    {
      id: 'banks',
      label: '题库',
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
      label: '历史记录',
      keys: ['exam_history']
    }
  ];

  const MODULE_MAP = MODULE_DEFS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  function showStatus(targetEl, msg, type) {
    targetEl.textContent = msg || '';
    targetEl.classList.remove('is-error', 'is-success');
    if (type === 'error') {
      targetEl.classList.add('is-error');
    } else if (type === 'success') {
      targetEl.classList.add('is-success');
    }
    if (msg) {
      window.setTimeout(() => {
        if (targetEl.textContent === msg) {
          targetEl.textContent = '';
          targetEl.classList.remove('is-error', 'is-success');
        }
      }, 3000);
    }
  }

  function getSelectedModules() {
    return Array.from(moduleListEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value)
      .filter(id => MODULE_MAP[id]);
  }

  function updateFileName() {
    const file = fileInputEl.files && fileInputEl.files[0];
    fileNameEl.textContent = file ? file.name : '未选择文件';
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
        showStatus(exportStatusEl, '请至少选择一个导出模块', 'error');
        return;
      }

      const payload = await buildBackupPayload(selectedModules);
      downloadBackupFile(payload);
      showStatus(exportStatusEl, '备份导出成功', 'success');
    } catch (error) {
      showStatus(exportStatusEl, `导出失败：${error.message || '未知错误'}`, 'error');
    }
  });

  fileInputEl.addEventListener('change', updateFileName);

  importBtn.addEventListener('click', async () => {
    const file = fileInputEl.files && fileInputEl.files[0];
    if (!file) {
      showStatus(importStatusEl, '请先选择备份文件', 'error');
      return;
    }

    try {
      const text = await file.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch (_) {
        showStatus(importStatusEl, '导入失败：备份文件不是有效的 JSON', 'error');
        return;
      }

      const moduleIds = validateBackupPayload(payload);
      if (!moduleIds) {
        showStatus(importStatusEl, '导入失败：备份文件格式无效', 'error');
        return;
      }

      if (!confirm('将覆盖备份文件中包含的模块数据，未包含的本地数据不会变更，是否继续？')) {
        return;
      }

      await importBackupPayload(payload, moduleIds);
      updateFileName();
      showStatus(importStatusEl, `备份导入成功，已恢复 ${moduleIds.length} 个模块`, 'success');

      if (typeof onImportComplete === 'function') {
        await onImportComplete(moduleIds);
      }
    } catch (error) {
      showStatus(importStatusEl, `导入失败：${error.message || '未知错误'}`, 'error');
    }
  });

  updateFileName();

  return {
    getSelectedModules
  };
}
