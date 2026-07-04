const DEFAULT_API_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';

export async function getApiConfig() {
  const config = await chrome.storage.local.get([
    'llm_models',
    'active_model_id',
    'custom_system_prompts',
    'extra_context_prompt',
    'api_url',
    'api_key',
    'model',
    'system_prompt'
  ]);

  let apiUrl = '';
  let apiKey = '';
  let model = '';
  let apiFormat = 'openai';
  let systemPrompt = '';
  let extraContextPrompt = config.extra_context_prompt || '';

  const models = config.llm_models || [];
  const activeModelId = config.active_model_id || '';

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

export async function postChatCompletion({
  apiKey,
  apiUrl,
  apiFormat = 'openai',
  messages,
  model,
  temperature = 0.2
}) {
  if (apiFormat === 'anthropic') {
    return postAnthropicMessage({ apiKey, apiUrl, messages, model, temperature });
  }

  // OpenAI Chat Completions 格式
  const response = await fetch(`${apiUrl}/chat/completions`, {
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
  });

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
  temperature = 0.2
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

  const response = await fetch(`${apiUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}
