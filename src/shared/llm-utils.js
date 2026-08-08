// 大模型相关共享工具（IIFE + globalThis）
// 目前包含 SSE 流式解析；后续大模型相关的通用工具可继续放入本文件
// 供 background api-client.js（onChunk 回调）与 options model-section.js（测试 UI 更新）复用
(() => {
  'use strict';

  /**
   * 逐块读取流并逐行回调（自动拆行、过滤空行）
   * @param {ReadableStreamDefaultReader} reader - 响应体 reader
   * @param {Function} onLine - 每行回调（不含空行）
   */
  async function readSSELines(reader, onLine) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer);
  }

  /**
   * OpenAI Chat Completions SSE 解析
   * @param {ReadableStreamDefaultReader} reader
   * @param {Function} onEvent - ({type: 'thinking'|'text', content: string}) => void
   * @returns {Promise<string>} 完整回答文本
   */
  async function parseOpenAISSE(reader, onEvent) {
    let fullText = '';
    await readSSELines(reader, (line) => {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.reasoning_content) {
          onEvent({ type: 'thinking', content: delta.reasoning_content });
        }
        if (delta.content) {
          fullText += delta.content;
          onEvent({ type: 'text', content: delta.content });
        }
      } catch (_) { /* 忽略解析错误 */ }
    });
    return fullText;
  }

  /**
   * Anthropic Messages SSE 解析
   * @param {ReadableStreamDefaultReader} reader
   * @param {Function} onEvent - ({type: 'thinking'|'text', content: string}) => void
   * @returns {Promise<string>} 完整回答文本
   */
  async function parseAnthropicSSE(reader, onEvent) {
    let fullText = '';
    let currentEvent = '';
    await readSSELines(reader, (line) => {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        return;
      }
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();

      try {
        const json = JSON.parse(data);

        if (currentEvent === 'content_block_start' || currentEvent === 'content_block_delta') {
          const thinking = json.delta?.thinking || json.content_block?.thinking || '';
          const text = json.delta?.text || json.content_block?.text || '';

          if (thinking) onEvent({ type: 'thinking', content: thinking });
          if (text) {
            fullText += text;
            onEvent({ type: 'text', content: text });
          }
        }
      } catch (_) { /* 忽略解析错误 */ }
    });
    return fullText;
  }

  /**
   * OpenAI Responses SSE 解析
   * @param {ReadableStreamDefaultReader} reader
   * @param {Function} onEvent - ({type: 'thinking'|'text'|'searchStatus'|'referenceLinks', ...}) => void
   * @returns {Promise<{text: string, annotations: Array}>} 完整文本与引用标注
   */
  async function parseResponsesSSE(reader, onEvent) {
    let fullText = '';
    let currentEvent = '';
    const annotations = [];
    await readSSELines(reader, (line) => {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        return;
      }
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);

        if (currentEvent === 'response.reasoning_text.delta') {
          onEvent({ type: 'thinking', content: json.delta || '' });
        }
        if (currentEvent === 'response.output_text.delta') {
          fullText += json.delta || '';
          onEvent({ type: 'text', content: json.delta || '' });
        }

        // 联网搜索状态事件
        if (currentEvent === 'response.web_search_call.in_progress' ||
            currentEvent === 'response.web_search_call.searching') {
          onEvent({ type: 'searchStatus', status: 'searching' });
        }
        if (currentEvent === 'response.web_search_call.completed') {
          onEvent({ type: 'searchStatus', status: 'completed' });
        }
        if (currentEvent === 'response.output_item.done' && json.item?.type === 'web_search_call') {
          const action = json.item.action;
          if (action?.type === 'open_page' && action.url) {
            onEvent({ type: 'searchStatus', status: 'completed', url: action.url });
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
      } catch (_) { /* 忽略解析错误 */ }
    });
    return { text: fullText, annotations };
  }

  /**
   * 分离 system 消息：拼接为字符串、其余消息放入数组
   * （Anthropic 顶层 system / Responses instructions 共用）
   * @param {Array<{role: string, content: string}>} messages - 原始消息数组
   * @returns {{system: string, nonSystem: Array}} 拼接后的 system 字符串与非 system 消息数组
   */
  function splitSystemMessages(messages) {
    let system = '';
    const nonSystem = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n' : '') + msg.content;
      } else {
        nonSystem.push(msg);
      }
    }
    return { system, nonSystem };
  }

  /**
   * 将 Chat Completions 格式的 messages 转为 Responses API 格式
   * - system 角色 → instructions 字段
   * - 其余 → input 数组
   * @param {Array} messages - 原始消息数组
   * @returns {{instructions: string, input: Array}}
   */
  function convertToResponsesFormat(messages) {
    const { system, nonSystem } = splitSystemMessages(messages);
    return { instructions: system, input: nonSystem };
  }

  /**
   * 组装 OpenAI Chat Completions 请求体
   * @param {Object} params
   * @param {string} params.model - 模型名
   * @param {Array} params.messages - 消息数组
   * @param {number} [params.temperature=0.2] - 采样温度（思考模式下忽略）
   * @param {boolean} [params.enableThinking=false] - 是否开启思考模式
   * @param {string} [params.thinkingEffort='high'] - 思考强度
   * @param {boolean} [params.stream=false] - 是否流式
   * @returns {Object} 请求体
   */
  function buildOpenAIBody({ model, messages, temperature = 0.2, enableThinking = false, thinkingEffort = 'high', stream = false }) {
    const body = { model, messages };
    if (stream) body.stream = true;
    if (enableThinking) {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = thinkingEffort;
    } else {
      body.temperature = temperature;
    }
    return body;
  }

  /**
   * 组装 Anthropic Messages 请求体
   * @param {Object} params
   * @param {string} params.model - 模型名
   * @param {Array} params.messages - 已分离 system 后的非 system 消息
   * @param {number} [params.maxTokens=4096] - 最大输出 token 数
   * @param {string} [params.system=''] - 顶层 system 提示词
   * @param {number} [params.temperature=0.2] - 采样温度（思考模式下忽略）
   * @param {boolean} [params.enableThinking=false] - 是否开启思考模式
   * @param {string} [params.thinkingEffort='high'] - 思考强度
   * @param {boolean} [params.stream=false] - 是否流式
   * @returns {Object} 请求体
   */
  function buildAnthropicBody({ model, messages, maxTokens = 4096, system = '', temperature = 0.2, enableThinking = false, thinkingEffort = 'high', stream = false }) {
    const body = { model, messages, max_tokens: maxTokens };
    if (stream) body.stream = true;
    if (enableThinking) {
      body.thinking = { type: 'enabled' };
      body.output_config = { effort: thinkingEffort };
    } else {
      body.temperature = temperature;
    }
    if (system) body.system = system;
    return body;
  }

  /**
   * 组装 OpenAI Responses 请求体
   * @param {Object} params
   * @param {string} params.model - 模型名
   * @param {Array} params.input - 已转换的 input 消息
   * @param {Array} [params.tools] - 工具列表
   * @param {string} [params.instructions=''] - 顶层 instructions（system 消息）
   * @param {number} [params.temperature=0.2] - 采样温度（思考模式下忽略）
   * @param {boolean} [params.enableThinking=false] - 是否开启思考模式
   * @param {string} [params.thinkingEffort='high'] - 思考强度
   * @param {boolean} [params.stream=false] - 是否流式
   * @returns {Object} 请求体
   */
  function buildResponsesBody({ model, input, tools, instructions = '', temperature = 0.2, enableThinking = false, thinkingEffort = 'high', stream = false }) {
    const body = { model, input };
    if (stream) body.stream = true;
    if (instructions) body.instructions = instructions;
    if (tools && tools.length > 0) body.tools = tools;
    if (enableThinking) {
      body.reasoning = { effort: thinkingEffort };
    } else {
      body.temperature = temperature;
    }
    return body;
  }

  globalThis.QuizHelperLLMUtils = {
    parseOpenAISSE,
    parseAnthropicSSE,
    parseResponsesSSE,
    splitSystemMessages,
    convertToResponsesFormat,
    buildOpenAIBody,
    buildAnthropicBody,
    buildResponsesBody
  };
})();
