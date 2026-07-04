// 配置管理模块 - 助手设置 + 提示词配置

function initConfig({
  extraContextPromptInput, allowedDomainsInput,
  systemPromptTextareas, promptTypeTabs, promptClearBtns,
  saveBtn, resetBtn, statusDiv,
  questionBankEnabledInput, getCurrentShortcut, resetShortcut,
  loadQuestionBanks
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  let currentPromptType = 'single';
  let defaultPrompts = {};

  function showStatus(msg) {
    statusDiv.textContent = msg;
    setTimeout(() => {
      if (statusDiv.textContent === msg) statusDiv.textContent = '';
    }, 3000);
  }

  async function loadDefaultPrompts() {
    try {
      const res = await fetch(chrome.runtime.getURL('data/prompt-templates.json'));
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
    if (promptClearBtns && promptClearBtns.length) {
      promptClearBtns.forEach(btn => {
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

  if (promptClearBtns && promptClearBtns.length) {
    promptClearBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type || currentPromptType;
        if (systemPromptTextareas[type]) {
          systemPromptTextareas[type].value = '';
          showStatus(`已清空${TYPE_LABELS[type] || type}自定义提示词`);
        }
      });
    });
  }

  saveBtn.addEventListener('click', async () => {
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

    showStatus('设置已保存');
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('确定要恢复默认设置吗？这将清空自定义提示词、白名单等配置。')) return;

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

    showStatus('已恢复默认设置');
    await loadQuestionBanks();
    switchPromptType('single');
  });

  return { loadSettings };
}
