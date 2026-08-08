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

export async function postChatCompletion({
  apiKey,
  apiUrl,
  apiFormat = 'openai',
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  enableThinking = false,
  thinkingEffort = 'high',
  tools = []
}) {
  if (apiFormat === 'anthropic') {
    return postAnthropicMessage({ apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort });
  }
  if (apiFormat === 'responses') {
    const result = await callResponses({ apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort, tools });
    return result.text;
  }

  // OpenAI Chat Completions 格式
  const body = {
    model,
    messages
  };

  // 思考模式下不支持 temperature 参数
  if (enableThinking) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = thinkingEffort;
  } else {
    body.temperature = temperature;
  }

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
  signal,
  enableThinking = false,
  thinkingEffort = 'high'
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
    max_tokens: 4096
  };

  // 思考模式下不支持 temperature 参数
  if (enableThinking) {
    body.thinking = { type: 'enabled' };
    body.output_config = { effort: thinkingEffort };
  } else {
    body.temperature = temperature;
  }

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

/**
 * 流式 Chat Completion，通过 onChunk 回调逐块推送
 * @param {Object} params
 * @param {Function} params.onChunk - ({ type: 'thinking'|'text', content: string }) => void
 * @returns {Promise<string>} 完整文本
 */
export async function streamChatCompletion({
  apiKey,
  apiUrl,
  apiFormat = 'openai',
  messages,
  model,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  enableThinking = false,
  thinkingEffort = 'high',
  tools = [],
  onChunk
}) {
  if (apiFormat === 'anthropic') {
    return streamAnthropicMessage({ apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort, onChunk });
  }
  if (apiFormat === 'responses') {
    const result = await callResponses({ apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort, tools, stream: true, onChunk });
    return result.text;
  }

  // OpenAI Chat Completions 流式
  const body = {
    model,
    messages,
    stream: true
  };
  if (enableThinking) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = thinkingEffort;
  } else {
    body.temperature = temperature;
  }

  const response = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  return parseOpenAISSEStream(response.body.getReader(), onChunk);
}

async function streamAnthropicMessage({
  apiKey, apiUrl, messages, model, temperature, timeoutMs, signal, enableThinking, thinkingEffort, onChunk
}) {
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
    stream: true
  };
  if (enableThinking) {
    body.thinking = { type: 'enabled' };
    body.output_config = { effort: thinkingEffort };
  } else {
    body.temperature = temperature;
  }
  if (systemPrompt) body.system = systemPrompt;

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

  return parseAnthropicSSEStream(response.body.getReader(), onChunk);
}

async function parseOpenAISSEStream(reader, onChunk) {
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          onChunk({ type: 'thinking', content: delta.reasoning_content });
        }
        if (delta.content) {
          fullText += delta.content;
          onChunk({ type: 'text', content: delta.content });
        }
      } catch (_) { /* ignore */ }
    }
  }

  return fullText;
}

async function parseAnthropicSSEStream(reader, onChunk) {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();

      try {
        const json = JSON.parse(data);

        if (currentEvent === 'content_block_start' || currentEvent === 'content_block_delta') {
          const thinking = json.delta?.thinking || json.content_block?.thinking || '';
          const text = json.delta?.text || json.content_block?.text || '';

          if (thinking) onChunk({ type: 'thinking', content: thinking });
          if (text) {
            fullText += text;
            onChunk({ type: 'text', content: text });
          }
        }
      } catch (_) { /* ignore */ }
    }
  }

  return fullText;
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

  const body = { model, input };
  if (stream) body.stream = true;
  if (instructions) body.instructions = instructions;
  if (tools && tools.length > 0) body.tools = tools;
  if (enableThinking) {
    body.reasoning = { effort: thinkingEffort };
  } else {
    body.temperature = temperature;
  }

  const response = await fetchWithTimeout(`${apiUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  }, timeoutMs, signal);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  if (stream) {
    const result = await parseResponsesSSEStream(response.body.getReader(), onChunk);
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

/**
 * 将 Chat Completions 格式的 messages 转为 Responses API 格式
 * - system 角色 → instructions 字段
 * - 其余 → input 数组
 */
function convertToResponsesFormat(messages) {
  let instructions = '';
  const input = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      instructions += (instructions ? '\n' : '') + msg.content;
    } else {
      input.push(msg);
    }
  }
  return { instructions, input };
}

/**
 * 解析 Responses API SSE 流式响应
 * 事件类型: response.reasoning_text.delta / response.output_text.delta / response.output_text.done
 */
async function parseResponsesSSEStream(reader, onChunk) {
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let currentEvent = '';
  const annotations = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);

        if (currentEvent === 'response.reasoning_text.delta') {
          onChunk({ type: 'thinking', content: json.delta || '' });
        }
        if (currentEvent === 'response.output_text.delta') {
          fullText += json.delta || '';
          onChunk({ type: 'text', content: json.delta || '' });
        }

        // 联网搜索状态事件
        if (currentEvent === 'response.web_search_call.in_progress' ||
            currentEvent === 'response.web_search_call.searching') {
          onChunk({ type: 'searchStatus', status: 'searching' });
        }
        if (currentEvent === 'response.web_search_call.completed') {
          onChunk({ type: 'searchStatus', status: 'completed' });
        }
        if (currentEvent === 'response.output_item.done' && json.item?.type === 'web_search_call') {
          const action = json.item.action;
          if (action?.type === 'open_page' && action.url) {
            onChunk({ type: 'searchStatus', status: 'completed', url: action.url });
          }
        }

        // response.output_text.done 携带 annotations（引用标注）
        if (currentEvent === 'response.output_text.done' && json.annotations) {
          for (const ann of json.annotations) {
            if (ann.type === 'url_citation' && ann.url) {
              annotations.push({ title: ann.title || ann.url, url: ann.url });
            }
          }
        }
      } catch (_) { /* ignore */ }
    }
  }

  return { text: fullText, annotations };
}
