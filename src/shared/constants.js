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

  const TYPE_LABELS = {
    single: '单选',
    multiple: '多选',
    judge: '判断',
    fill: '填空',
    unknown: '其他'
  };

  const STATUS_LABELS = {
    pending: '待分析',
    loading: '作答中',
    done: '已完成',
    error: '出错'
  };

  // 题库导入模式配置（后台并发/批大小 + 设置页文案共用一份）
  const IMPORT_MODES = {
    eco: { concurrency: 5, batchSize: 100, label: '并发 5 批 · 每批 100 题，速度较慢，适合 token 不足或 API 限流严格的场景' },
    balanced: { concurrency: 10, batchSize: 50, label: '并发 10 批 · 每批 50 题，均衡速度与稳定性，推荐日常使用' },
    precise: { concurrency: 10, batchSize: 25, label: '并发 10 批 · 每批 25 题，小批次高精度，适合题目格式复杂、容易解析出错的题库' }
  };

  globalThis.QuizHelperConstants = {
    DEFAULT_SHORTCUT,
    IMPORT_MODES,
    STATUS_LABELS,
    STORAGE_KEYS,
    TYPE_LABELS
  };
})();
