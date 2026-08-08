const DEFAULT_API_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_TIMEOUT_MS = 120_000; // 2 分钟超时

// 大模型请求与 SSE 解析统一实现于 shared/llm-utils.js（background 与 options 测试共用）
import '../shared/llm-utils.js';

const {
  parseOpenAISSE,
  parseAnthropicSSE,
  parseResponsesSSE,
  splitSystemMessages,
  convertToResponsesFormat,
  buildOpenAIBody,
  buildAnthropicBody,
  buildResponsesBody
} = globalThis.QuizHelperLLMUtils;

const { getMessage } = globalThis.QuizHelperI18n;

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
  let enableThinking = false;
  let thinkingEffort = 'high';
  let tools = [];
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
      enableThinking = activeModel.enableThinking || false;
      thinkingEffort = activeModel.thinkingEffort || 'high';
      tools = activeModel.tools || [];
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
    tools,
    enableThinking,
    thinkingEffort,
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
  let onExternalAbort = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    // 显式移除外部信号监听，避免共用 signal 时监听器累积
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  });
}

/**
 * 统一聊天请求入口（非流式）
 * @param {Object} params - 请求参数（见 callChatCompletion）
 * @returns {Promise<string>} 完整回答文本
 */
export async function postChatCompletion(params) {
  return callChatCompletion({ ...params, stream: false });
}

/**
 * 统一聊天请求入口（流式）
 * @param {Object} params - 请求参数
 * @param {Function} [params.onChunk] - 流式回调
 * @returns {Promise<string>} 完整回答文本
 */
export async function streamChatCompletion(params) {
  return callChatCompletion({ ...params, stream: true });
}

/**
 * 按 API 格式分发到对应的统一请求函数（openai / anthropic / responses）
 * @param {Object} params
 * @param {string} [params.apiKey] - API 密钥
 * @param {string} [params.apiUrl] - API 基础地址
 * @param {string} [params.apiFormat='openai']
 * @param {Array} [params.messages] - 消息数组（含 role 为 system 的消息）
 * @param {string} [params.model]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.timeoutMs=DEFAULT_TIMEOUT_MS]
 * @param {AbortSignal} [params.signal] - 外部取消信号
 * @param {boolean} [params.enableThinking=false]
 * @param {string} [params.thinkingEffort='high']
 * @param {Array} [params.tools] - 工具列表（仅 responses 格式使用）
 * @param {boolean} [params.stream=false]
 * @param {Function} [params.onChunk] - 流式回调
 * @returns {Promise<string>} 完整回答文本
 */
async function callChatCompletion({
  apiKey,
  apiUrl,
  apiFormat = 'openai',
  messages,
  model,
  temperature = 0.2,
  timeoutMs,
  signal,
  enableThinking,
  thinkingEffort,
  tools,
  stream = false,
  onChunk
}) {
  const base = { apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort };
  if (apiFormat === 'anthropic') {
    return callAnthropicMessage({ ...base, stream, onChunk });
  }
  if (apiFormat === 'responses') {
    const result = await callResponses({ ...base, tools, stream, onChunk });
    return result.text;
  }
  return callOpenAIChatCompletion({ ...base, stream, onChunk });
}

/**
 * OpenAI Chat Completions 请求（流式/非流式统一）
 * @param {Object} params
 * @param {Array} [params.messages] - 消息数组
 * @param {string} [params.model]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.timeoutMs=DEFAULT_TIMEOUT_MS]
 * @param {AbortSignal} [params.signal]
 * @param {boolean} [params.enableThinking=false]
 * @param {string} [params.thinkingEffort='high']
 * @param {boolean} [params.stream=false]
 * @param {Function} [params.onChunk] - 流式回调
 * @returns {Promise<string>} 完整回答文本
 */
async function callOpenAIChatCompletion({
  apiKey,
  apiUrl,
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  enableThinking = false,
  thinkingEffort = 'high',
  stream = false,
  onChunk
}) {
  const body = buildOpenAIBody({
    model,
    messages,
    temperature,
    enableThinking,
    thinkingEffort,
    stream
  });

  const response = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(getMessage('bgApiRequestFailed', [response.status, errText]));
  }

  if (stream) {
    return parseOpenAISSE(response.body.getReader(), onChunk);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Anthropic Messages 请求（流式/非流式统一）
 * @param {Object} params
 * @param {Array} [params.messages] - 消息数组（system 消息会拼到顶层）
 * @param {string} [params.model]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.timeoutMs=DEFAULT_TIMEOUT_MS]
 * @param {AbortSignal} [params.signal]
 * @param {boolean} [params.enableThinking=false]
 * @param {string} [params.thinkingEffort='high']
 * @param {boolean} [params.stream=false]
 * @param {Function} [params.onChunk] - 流式回调
 * @returns {Promise<string>} 完整回答文本
 */
async function callAnthropicMessage({
  apiKey,
  apiUrl,
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  enableThinking = false,
  thinkingEffort = 'high',
  stream = false,
  onChunk
}) {
  // 分离 system 消息（Anthropic 要求 system 放在顶层）
  const { system, nonSystem } = splitSystemMessages(messages);

  const body = buildAnthropicBody({
    model,
    messages: nonSystem,
    maxTokens: 4096,
    system,
    temperature,
    enableThinking,
    thinkingEffort,
    stream
  });

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
    throw new Error(getMessage('bgApiRequestFailed', [response.status, errText]));
  }

  if (stream) {
    return parseAnthropicSSE(response.body.getReader(), onChunk);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// ==================== OpenAI Responses API ====================

/**
 * Responses API 统一调用入口
 * @param {Object} params
 * @param {boolean} [params.stream=false] - 是否流式
 * @param {Function} [params.onChunk] - 流式回调
 * @returns {Promise<{text: string, annotations: Array}>}
 */
async function callResponses({
  apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort, tools,
  stream = false, onChunk
}) {
  const { instructions, input } = convertToResponsesFormat(messages);

  const body = buildResponsesBody({
    model,
    input,
    tools,
    instructions,
    temperature,
    enableThinking,
    thinkingEffort,
    stream
  });

  const response = await fetchWithTimeout(`${apiUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(getMessage('bgApiRequestFailed', [response.status, errText]));
  }

  if (stream) {
    const result = await parseResponsesSSE(response.body.getReader(), onChunk);
    if (result.annotations.length > 0) {
      onChunk({ type: 'referenceLinks', links: result.annotations });
    }
    return result;
  }

  // 非流式：从 JSON 响应中提取 text 和 annotations
  const data = await response.json();
  const output = data.output?.find(o => o.type === 'message');
  let text = '';
  const annotations = [];
  if (output) {
    const textContent = output.content?.find(c => c.type === 'output_text');
    if (textContent) {
      text = textContent.text || '';
      if (textContent.annotations) {
        for (const ann of textContent.annotations) {
          if (ann.type === 'url_citation' && ann.url) {
            annotations.push({ title: ann.title || ann.url, url: ann.url });
          }
        }
      }
    }
  }
  return { text, annotations };
}
