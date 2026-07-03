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
    PANEL_SHORTCUT: 'panel_shortcut',
    PARSE_RULES: 'parse_rules',
    QUESTION_BANK_ENABLED: 'question_bank_enabled',
    QUESTION_BANKS: 'question_banks',
    SYSTEM_PROMPT: 'system_prompt',
    THEME_MODE: 'theme_mode'
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
    loading: '分析中...',
    done: '已完成',
    error: '出错'
  };

  globalThis.QuizHelperConstants = {
    DEFAULT_SHORTCUT,
    STATUS_LABELS,
    STORAGE_KEYS,
    TYPE_LABELS
  };
})();
