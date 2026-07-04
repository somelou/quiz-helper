(() => {
  const { STORAGE_KEYS = {} } = globalThis.QuizHelperConstants || {};

  // 配额超限提示语
  const QUOTA_EXCEEDED_HINT = '本地存储空间已满，无法保存数据。请前往设置页清理题库或历史记录后重试。';

  // 统一的写入封装：捕获配额超限错误并提示用户
  async function safeSet(items) {
    try {
      await chrome.storage.local.set(items);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (/quota/i.test(msg)) {
        // service worker 中 alert 不可用，降级为 console
        if (typeof alert === 'function') {
          try { alert(QUOTA_EXCEEDED_HINT); } catch (_) { console.error(QUOTA_EXCEEDED_HINT); }
        } else {
          console.error(QUOTA_EXCEEDED_HINT);
        }
      }
      throw err;
    }
  }

  async function getApiConfig() {
    const config = await chrome.storage.local.get([
      STORAGE_KEYS.LLM_MODELS || 'llm_models',
      STORAGE_KEYS.ACTIVE_MODEL_ID || 'active_model_id',
      STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS || 'custom_system_prompts',
      STORAGE_KEYS.EXTRA_CONTEXT_PROMPT || 'extra_context_prompt',
      STORAGE_KEYS.API_URL || 'api_url',
      STORAGE_KEYS.API_KEY || 'api_key',
      STORAGE_KEYS.MODEL || 'model',
      STORAGE_KEYS.SYSTEM_PROMPT || 'system_prompt'
    ]);

    const DEFAULT_API_URL = 'https://api.deepseek.com/v1';
    const DEFAULT_MODEL = 'deepseek-v4-pro';

    let apiUrl = '';
    let apiKey = '';
    let model = '';
    let apiFormat = 'openai';
    let systemPrompt = '';
    const extraContextPrompt = config[STORAGE_KEYS.EXTRA_CONTEXT_PROMPT || 'extra_context_prompt'] || '';

    const models = config[STORAGE_KEYS.LLM_MODELS || 'llm_models'] || [];
    const activeModelId = config[STORAGE_KEYS.ACTIVE_MODEL_ID || 'active_model_id'] || '';

    if (models.length > 0) {
      const preferredModel = models.find(m => m.id === activeModelId && m.isActive);
      const activeModel = preferredModel || models.find(m => m.isActive);
      if (activeModel) {
        apiUrl = activeModel.apiUrl || '';
        apiKey = activeModel.apiKey || '';
        model = activeModel.modelId || '';
        apiFormat = activeModel.apiFormat || 'openai';
      }
    }

    if (!apiKey) {
      apiUrl = (config[STORAGE_KEYS.API_URL || 'api_url'] || DEFAULT_API_URL).replace(/\/+$/, '');
      apiKey = config[STORAGE_KEYS.API_KEY || 'api_key'] || '';
      model = config[STORAGE_KEYS.MODEL || 'model'] || DEFAULT_MODEL;
    }

    const customPrompts = config[STORAGE_KEYS.CUSTOM_SYSTEM_PROMPTS || 'custom_system_prompts'];
    if (customPrompts && typeof customPrompts === 'object') {
      systemPrompt = customPrompts;
    } else if (config[STORAGE_KEYS.SYSTEM_PROMPT || 'system_prompt']) {
      systemPrompt = { unknown: config[STORAGE_KEYS.SYSTEM_PROMPT || 'system_prompt'] };
    }

    return {
      apiUrl: apiUrl || DEFAULT_API_URL,
      apiKey,
      apiFormat,
      model: model || DEFAULT_MODEL,
      systemPrompt,
      extraContextPrompt
    };
  }

  async function getParseRules() {
    const key = STORAGE_KEYS.PARSE_RULES || 'parse_rules';
    const result = await chrome.storage.local.get([key]);
    return result[key] || [];
  }

  async function setParseRules(rules) {
    const key = STORAGE_KEYS.PARSE_RULES || 'parse_rules';
    await safeSet({ [key]: rules });
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
    safeSet,
    setParseRules
  };
})();
