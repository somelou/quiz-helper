// 配置管理模块 - 助手设置 + 提示词配置

function initConfig({
  extraContextPromptInput, allowedDomainsInput,
  systemPromptTextareas, promptTypeTabs, promptResetBtns,
  saveBtn, resetBtn,
  questionBankEnabledInput, getCurrentShortcut, resetShortcut,
  loadQuestionBanks
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  let currentPromptType = 'single';
  let defaultPrompts = {};

  function showStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  async function loadDefaultPrompts() {
    try {
      const res = await fetch(chrome.runtime.getURL(globalThis.QuizHelperI18n.getPromptTemplatesUrl()));
      const data = await res.json();
      defaultPrompts = data.answerSystemPrompts || {};
    } catch (e) {
      defaultPrompts = {};
    }
  }

  function updatePromptPlaceholder() {
    const textarea = systemPromptTextareas[currentPromptType];
    if (textarea) {
      textarea.placeholder = defaultPrompts[currentPromptType] || defaultPrompts.unknown || '';
    }
  }

  function switchPromptType(type) {
    currentPromptType = type;
    const tabsEl = document.querySelector('.prompt-type-tabs');
    if (tabsEl) setSegValue(tabsEl, type);
    Object.keys(systemPromptTextareas).forEach(key => {
      if (systemPromptTextareas[key]) {
        systemPromptTextareas[key].style.display = key === type ? '' : 'none';
      }
    });
    if (promptResetBtns && promptResetBtns.length) {
      promptResetBtns.forEach(btn => {
        btn.dataset.type = type;
      });
    }
    updatePromptPlaceholder();
  }

  async function loadSettings() {
    await loadDefaultPrompts();

    const config = await chrome.storage.local.get([
      'custom_system_prompts', 'extra_context_prompt', 'allowed_domains',
      'panel_shortcut', 'question_bank_enabled'
    ]);

    const customPrompts = config.custom_system_prompts || {};
    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        systemPromptTextareas[type].value = customPrompts[type] || '';
      }
    });

    extraContextPromptInput.value = config.extra_context_prompt || '';
    allowedDomainsInput.value = (config.allowed_domains || []).join('\n');
    questionBankEnabledInput.checked = config.question_bank_enabled !== false;

    switchPromptType(currentPromptType);
  }

  promptTypeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchPromptType(tab.dataset.value);
    });
  });

  if (promptResetBtns && promptResetBtns.length) {
    promptResetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type || currentPromptType;
        if (systemPromptTextareas[type]) {
          systemPromptTextareas[type].value = defaultPrompts[type] || '';
          autoSave(); // 点击「默认」后立即生效
          showStatus(getMessage('optionsPromptResetDone', [TYPE_LABELS[type] || type]));
        }
      });
    });
  }

  // 输入区失焦自动保存：提示词 / 补充提示词 / 白名单
  Object.values(systemPromptTextareas).forEach(textarea => {
    if (textarea) textarea.addEventListener('blur', autoSave);
  });
  extraContextPromptInput.addEventListener('blur', autoSave);
  allowedDomainsInput.addEventListener('blur', autoSave);

  // 收集表单值并写入存储（「保存设置」与自动保存共用）
  async function persistSettings() {
    const domains = allowedDomainsInput.value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    const customPrompts = {};
    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        const val = systemPromptTextareas[type].value.trim();
        if (val) customPrompts[type] = val;
      }
    });

    await safeSet({
      custom_system_prompts: customPrompts,
      extra_context_prompt: extraContextPromptInput.value.trim(),
      allowed_domains: domains,
      panel_shortcut: getCurrentShortcut()
    });
  }

  // 失焦自动保存：静默写入，不弹提示
  function autoSave() {
    persistSettings().catch(() => {});
  }

  saveBtn.addEventListener('click', async () => {
    await persistSettings();
    showStatus(getMessage('optionsSettingsSaved'));
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm(getMessage('optionsResetConfirm'))) return;

    Object.keys(systemPromptTextareas).forEach(type => {
      if (systemPromptTextareas[type]) {
        systemPromptTextareas[type].value = '';
      }
    });
    extraContextPromptInput.value = '';
    allowedDomainsInput.value = '';
    questionBankEnabledInput.checked = true;
    resetShortcut();

    await chrome.storage.local.remove([
      'custom_system_prompts', 'extra_context_prompt', 'allowed_domains',
      'panel_shortcut', 'question_bank_enabled', 'theme_mode'
    ]);

    showStatus(getMessage('optionsSettingsReset'));
    await loadQuestionBanks();
    switchPromptType('single');
  });

  return { loadSettings };
}
