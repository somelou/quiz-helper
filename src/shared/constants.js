(() => {
  const STORAGE_KEYS = {
    ACTIVE_BANK_ID: 'active_bank_id',
    ACTIVE_BANK_IDS: 'active_bank_ids',
    ACTIVE_MODEL_ID: 'active_model_id',
    ALLOWED_DOMAINS: 'allowed_domains',
    API_KEY: 'api_key',
    API_URL: 'api_url',
    CUSTOM_SYSTEM_PROMPTS: 'custom_system_prompts',
    DEFAULT_PARSE_RULE_SEEDED: 'default_parse_rule_seeded_v1',
    EXAM_HISTORY: 'exam_history',
    EXTRA_CONTEXT_PROMPT: 'extra_context_prompt',
    LLM_MODELS: 'llm_models',
    MODEL: 'model',
    MODEL_BANK_ID: 'model_bank_id',
    MODEL_EXTRACT_ID: 'model_extract_id',
    PANEL_SHORTCUT: 'panel_shortcut',
    PARSE_RULES: 'parse_rules',
    QUESTION_BANK_ENABLED: 'question_bank_enabled',
    QUESTION_BANKS: 'question_banks',
    STATUS_CACHE: 'status_cache',
    SYSTEM_PROMPT: 'system_prompt',
    THEME_MODE: 'theme_mode',
    WEB_SEARCH_ENABLED: 'web_search_enabled',
    ACTIVE_SEARCH_PROVIDER_ID: 'active_search_provider_id',
    WEB_SEARCH_SETTINGS: 'web_search_settings',
    WEB_SEARCH_PROVIDERS: 'web_search_providers',
    WEB_SEARCH_USAGE: 'web_search_usage'
  };

  const DEFAULT_SHORTCUT = {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: 'KeyQ',
    key: 'q'
  };

  // 依赖 shared/i18n-utils.js：使用 chrome.i18n 提供本地化标签
  const i18n = globalThis.QuizHelperI18n;

  const TYPE_LABELS = {
    single: i18n.getMessage('typeSingle'),
    multiple: i18n.getMessage('typeMultiple'),
    judge: i18n.getMessage('typeJudge'),
    fill: i18n.getMessage('typeFill'),
    unknown: i18n.getMessage('typeUnknown')
  };

  const STATUS_LABELS = {
    pending: i18n.getMessage('statusPending'),
    loading: i18n.getMessage('statusLoading'),
    done: i18n.getMessage('statusDone'),
    error: i18n.getMessage('statusError')
  };

  // 题库导入模式配置（后台并发/批大小 + 设置页文案共用一份）
  const IMPORT_MODES = {
    eco: { concurrency: 5, batchSize: 100, label: i18n.getMessage('importModeEcoLabel') },
    balanced: { concurrency: 10, batchSize: 50, label: i18n.getMessage('importModeBalancedLabel') },
    precise: { concurrency: 10, batchSize: 25, label: i18n.getMessage('importModePreciseLabel') }
  };

  globalThis.QuizHelperConstants = {
    DEFAULT_SHORTCUT,
    IMPORT_MODES,
    STATUS_LABELS,
    STORAGE_KEYS,
    TYPE_LABELS
  };
})();
