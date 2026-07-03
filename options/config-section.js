// 配置管理模块 - 读取/保存 API 配置

function initConfig({
  apiUrlInput, apiKeyInput, modelInput,
  systemPromptInput, extraContextPromptInput, allowedDomainsInput,
  saveBtn, resetBtn, toggleKeyBtn, statusDiv,
  questionBankEnabledInput, getCurrentShortcut, resetShortcut,
  loadQuestionBanks
}) {
  function showStatus(msg) {
    statusDiv.textContent = msg;
    setTimeout(() => {
      if (statusDiv.textContent === msg) statusDiv.textContent = '';
    }, 3000);
  }

  async function loadSettings() {
    const config = await chrome.storage.local.get([
      'api_url', 'api_key', 'model',
      'system_prompt', 'extra_context_prompt', 'allowed_domains',
      'panel_shortcut', 'question_bank_enabled'
    ]);

    apiUrlInput.value = config.api_url || 'https://api.deepseek.com/v1';
    apiKeyInput.value = config.api_key || '';
    modelInput.value = config.model || 'deepseek-v4-pro';
    systemPromptInput.value = config.system_prompt || '';
    extraContextPromptInput.value = config.extra_context_prompt || '';
    allowedDomainsInput.value = (config.allowed_domains || []).join('\n');
    questionBankEnabledInput.checked = config.question_bank_enabled !== false;
  }

  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '隐藏';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '显示';
    }
  });

  saveBtn.addEventListener('click', async () => {
    const domains = allowedDomainsInput.value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    await chrome.storage.local.set({
      api_url: apiUrlInput.value.trim(),
      api_key: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || 'deepseek-v4-pro',
      system_prompt: systemPromptInput.value.trim(),
      extra_context_prompt: extraContextPromptInput.value.trim(),
      allowed_domains: domains,
      panel_shortcut: getCurrentShortcut()
    });

    showStatus('设置已保存');
  });

  resetBtn.addEventListener('click', async () => {
    apiUrlInput.value = 'https://api.deepseek.com/v1';
    apiKeyInput.value = '';
    modelInput.value = 'deepseek-v4-pro';
    systemPromptInput.value = '';
    extraContextPromptInput.value = '';
    allowedDomainsInput.value = '';
    questionBankEnabledInput.checked = true;
    resetShortcut();

    await chrome.storage.local.remove([
      'api_url', 'api_key', 'model',
      'system_prompt', 'extra_context_prompt', 'allowed_domains',
      'panel_shortcut', 'question_bank_enabled', 'theme_mode'
    ]);

    showStatus('已恢复默认设置');
    await loadQuestionBanks();
  });

  return { loadSettings };
}
