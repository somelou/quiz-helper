const DEFAULT_API_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_TIMEOUT_MS = 120_000; // 2 分钟超时

/**
 * 获取 API 配置。支持按任务类型选择不同模型。
 * @param {'answer'|'bank'|'extract'} [taskType] - 任务类型，不传则使用首选模型
 */
export async function getApiConfig(taskType) {
  const storageKeys = [
    'llm_models',
    'active_model_id',
    'model_bank_id',
    'model_extract_id',
    'custom_system_prompts',
    'extra_context_prompt',
    'api_url',
    'api_key',
    'model',
    'system_prompt'
  ];
  const config = await chrome.storage.local.get(storageKeys);

  let apiUrl = '';
  let apiKey = '';
  let model = '';
  let apiFormat = 'openai';
  let systemPrompt = '';
  let extraContextPrompt = config.extra_context_prompt || '';

  const models = config.llm_models || [];
  const activeModelId = config.active_model_id || '';

  // 按任务类型选择优先模型 ID
  let preferredModelId = activeModelId;
  if (taskType === 'bank' && config.model_bank_id) {
    preferredModelId = config.model_bank_id;
  } else if (taskType === 'extract' && config.model_extract_id) {
    preferredModelId = config.model_extract_id;
  }

  if (models.length > 0) {
    const preferredModel = models.find(m => m.id === preferredModelId && m.isActive);
    const activeModel = preferredModel || models.find(m => m.isActive);
    if (activeModel) {
      apiUrl = activeModel.apiUrl || '';
      apiKey = activeModel.apiKey || '';
      model = activeModel.modelId || '';
      apiFormat = activeModel.apiFormat || 'openai';
    }
  }

  if (!apiKey) {
    apiUrl = (config.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
    apiKey = config.api_key || '';
    model = config.model || DEFAULT_MODEL;
  }

  const customPrompts = config.custom_system_prompts;
  if (customPrompts && typeof customPrompts === 'object') {
    systemPrompt = customPrompts;
  } else if (config.system_prompt) {
    systemPrompt = { unknown: config.system_prompt };
  }

  return {
    apiUrl: apiUrl || DEFAULT_API_URL,
    apiKey,
    apiFormat,
    extraContextPrompt,
    model: model || DEFAULT_MODEL,
    systemPrompt
  };
}

/**
 * 带超时的 fetch 封装，支持外部 AbortSignal
 */
function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 外部取消信号也关联到同一个 controller
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

export async function postChatCompletion({
  apiKey,
  apiUrl,
  apiFormat = 'openai',
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
}) {
  if (apiFormat === 'anthropic') {
    return postAnthropicMessage({ apiKey, apiUrl, messages, model, temperature, timeoutMs, signal });
  }

  // OpenAI Chat Completions 格式
  const response = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function postAnthropicMessage({
  apiKey,
  apiUrl,
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
}) {
  // 分离 system 消息（Anthropic 要求 system 放在顶层）
  let systemPrompt = '';
  const nonSystemMsgs = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
    } else {
      nonSystemMsgs.push(msg);
    }
  }

  const body = {
    model,
    messages: nonSystemMsgs,
    max_tokens: 4096,
    temperature
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetchWithTimeout(`${apiUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}
