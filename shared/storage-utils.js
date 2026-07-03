(() => {
  const { STORAGE_KEYS = {} } = globalThis.QuizHelperConstants || {};

  async function getApiConfig() {
    const config = await chrome.storage.local.get([
      STORAGE_KEYS.API_URL || 'api_url',
      STORAGE_KEYS.API_KEY || 'api_key',
      STORAGE_KEYS.MODEL || 'model',
      STORAGE_KEYS.SYSTEM_PROMPT || 'system_prompt',
      STORAGE_KEYS.EXTRA_CONTEXT_PROMPT || 'extra_context_prompt'
    ]);

    return {
      apiUrl: (config[STORAGE_KEYS.API_URL || 'api_url'] || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      apiKey: config[STORAGE_KEYS.API_KEY || 'api_key'] || '',
      model: config[STORAGE_KEYS.MODEL || 'model'] || 'deepseek-v4-pro',
      systemPrompt: config[STORAGE_KEYS.SYSTEM_PROMPT || 'system_prompt'] || '',
      extraContextPrompt: config[STORAGE_KEYS.EXTRA_CONTEXT_PROMPT || 'extra_context_prompt'] || ''
    };
  }

  async function getParseRules() {
    const key = STORAGE_KEYS.PARSE_RULES || 'parse_rules';
    const result = await chrome.storage.local.get([key]);
    return result[key] || [];
  }

  async function setParseRules(rules) {
    const key = STORAGE_KEYS.PARSE_RULES || 'parse_rules';
    await chrome.storage.local.set({ [key]: rules });
  }

  async function getAllowedDomains() {
    const key = STORAGE_KEYS.ALLOWED_DOMAINS || 'allowed_domains';
    const result = await chrome.storage.local.get([key]);
    return result[key] || [];
  }

  globalThis.QuizHelperStorageUtils = {
    getAllowedDomains,
    getApiConfig,
    getParseRules,
    setParseRules
  };
})();
