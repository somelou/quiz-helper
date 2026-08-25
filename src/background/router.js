import { getApiConfig, postChatCompletion, streamChatCompletion } from './api-client.js';
import { parseExtractedQuestions, normalizeQuestionType } from './json-parser.js';
import { buildExtractPrompt, buildSystemPrompt, buildVerifyPrompt, buildSearchAwarePrompt, buildSearchResultPrompt } from './prompt-builder.js';
import { handleParseQuestionBank, handleParseQuestionBankBatched, handleSearchQuestionBank } from './question-bank.js';
import { executeWebSearch, extractSearchResults, formatSearchResultsForLLM } from './search-proxy.js';
import { checkMonthlySearchLimit, incrementMonthlySearchCount } from './search-usage.js';
import { handleDetectStatus } from './status.js';

const { getMessage } = globalThis.QuizHelperI18n;

/**
 * 从答案中提取引用的来源编号，过滤参考链接
 * @param {string} answer - 大模型答案
 * @param {Array} referenceLinks - 全部参考链接
 * @returns {Array} 只保留被引用的链接
 */
function filterReferencedLinks(answer, referenceLinks) {
  if (!answer || referenceLinks.length === 0) return referenceLinks.map((ref, i) => ({ ...ref, originalIndex: i + 1 }));
  const citedIndices = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(answer)) !== null) {
    const idx = parseInt(m[1], 10);
    if (idx >= 1 && idx <= referenceLinks.length) citedIndices.add(idx);
  }
  if (citedIndices.size === 0) return referenceLinks.map((ref, i) => ({ ...ref, originalIndex: i + 1 }));
  return referenceLinks
    .map((ref, i) => ({ ...ref, originalIndex: i + 1 }))
    .filter(ref => citedIndices.has(ref.originalIndex));
}

/**
 * 流式输出是否开启（全局公用设置，默认开启）
 * 关闭时，大模型答题与测试均一次性返回完整结果
 * @returns {Promise<boolean>}
 */
async function isStreamOutputEnabled() {
  const { stream_output } = await chrome.storage.local.get(['stream_output']);
  return stream_output !== false;
}

async function handleFetchAnswer(questionText, questionType, sendChunk) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error(getMessage('bgNoApiKeyConfig'));
  }

  const system = await buildSystemPrompt(questionType, systemPrompt, extraContextPrompt);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: questionText }
  ];

  if (sendChunk && await isStreamOutputEnabled()) {
    const collectedLinks = [];
    const collectChunk = (data) => {
      if (data.type === 'referenceLinks') {
        collectedLinks.push(...data.links);
      } else {
        sendChunk(data);
      }
    };
    const answer = await callAnswerWithFallback(messages, {
      apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
      sendChunk: collectChunk
    });
    sendChunk({ type: 'done', answer: answer || getMessage('bgNoValidAnswer'), referenceLinks: collectedLinks });
    return;
  }

  const answer = await callAnswerWithFallback(messages, {
    apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
    temperature: 0.3
  });

  if (sendChunk) {
    // 关闭流式输出：通过流式通道一次性回传完整结果
    sendChunk({ type: 'done', answer: answer || getMessage('bgNoValidAnswer'), referenceLinks: [] });
    return;
  }
  return { success: true, answer: answer || getMessage('bgNoValidAnswer') };
}

/**
 * 根据是否流式选择对应的 LLM 请求入口
 * 流式走 streamChatCompletion（默认 temperature 0.2），非流式走 postChatCompletion（传入 temperature）
 * @param {Array} messages - 消息数组
 * @param {Object} options - 请求参数
 * @param {Function} [options.sendChunk] - 流式回调，存在时走流式
 * @param {number} [options.temperature] - 非流式请求的采样温度
 * @returns {Promise<string>} 完整回答文本
 */
async function callLLM(messages, { sendChunk, temperature, ...rest }) {
  if (sendChunk) {
    return streamChatCompletion({ ...rest, messages, onChunk: sendChunk });
  }
  return postChatCompletion({ ...rest, messages, temperature });
}

/**
 * 判断工具列表中是否包含内置联网搜索工具（web_search）
 * @param {Array} tools
 * @returns {boolean}
 */
function hasBuiltinWebSearchTool(tools) {
  return Array.isArray(tools) && tools.some(t => t && t.type === 'web_search');
}

/**
 * 过滤掉内置联网搜索工具
 * @param {Array} tools
 * @returns {Array}
 */
function stripBuiltinWebSearchTool(tools) {
  return (tools || []).filter(t => !(t && t.type === 'web_search'));
}

/**
 * 大模型作答（带内置搜索循环兜底）
 * 内置 web_search 工具下，模型可能陷入「思考→搜索」循环，直到服务端截断且不输出任何文本；
 * 此时去掉搜索工具重试一次，强制模型直接输出最终答案
 * @param {Array} messages - 消息数组
 * @param {Object} params - 同 callLLM 的参数
 * @returns {Promise<string>} 完整回答文本
 */
async function callAnswerWithFallback(messages, { apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools, sendChunk, temperature }) {
  const first = await callLLM(messages, {
    apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
    sendChunk, temperature
  });
  // 无任何文本输出且原请求携带内置 web_search 工具 → 去工具重试一次
  if (!String(first || '').trim() && hasBuiltinWebSearchTool(tools)) {
    return callLLM(messages, {
      apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort,
      tools: stripBuiltinWebSearchTool(tools),
      sendChunk, temperature
    });
  }
  return first;
}

async function handleVerifyBankAnswer(questionText, bankMatches) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error(getMessage('bgNoApiKeyConfig'));
  }

  const prompt = await buildVerifyPrompt(questionText, bankMatches, extraContextPrompt);
  const answer = await postChatCompletion({
    apiKey,
    apiUrl,
    apiFormat,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    model,
    temperature: 0.2,
    enableThinking,
    thinkingEffort,
    tools
  });

  return { success: true, answer: answer || getMessage('bgNoValidAnswer') };
}

/**
 * 剥离 [NEED_SEARCH: ...] 标记并返回降级答案
 * 搜索不需要/搜索失败时共用，统一流式与非流式两种返回
 * @param {string} firstFull - 第一次 LLM 的完整回答
 * @param {Function} [sendChunk] - 流式回调，存在时通过其发送 done
 * @returns {Object|undefined} 非流式时返回 { success, answer, referenceLinks }
 */
function fallbackToCleanedAnswer(firstFull, sendChunk) {
  const cleanedAnswer = String(firstFull || '').replace(/\[NEED_SEARCH:\s*.+?\]\s*/gi, '').trim();
  const answer = cleanedAnswer || getMessage('bgNoValidAnswer');
  if (sendChunk) {
    sendChunk({ type: 'done', answer, referenceLinks: [] });
    return undefined;
  }
  return { success: true, answer, referenceLinks: [] };
}

async function handleFetchAnswerWithSearch(questionText, questionType, forceSearch = false, sendChunk) {
  const storage = await chrome.storage.local.get([
    'web_search_enabled',
    'active_search_provider_id',
    'web_search_providers',
    'web_search_settings'
  ]);

  const enabled = storage.web_search_enabled === true;
  const activeId = storage.active_search_provider_id || '';
  const providers = storage.web_search_providers || [];
  const activeProvider = providers.find(p => p.id === activeId && p.apiKey);

  // 搜索不可用/达限额时降级为普通答题（流式/非流式两态）
  const fallbackToBasicAnswer = () => (sendChunk
    ? handleFetchAnswer(questionText, questionType, sendChunk)
    : handleFetchAnswer(questionText, questionType));

  if (!enabled || !activeProvider) {
    return fallbackToBasicAnswer();
  }

  const monthlyLimitOk = await checkMonthlySearchLimit(activeProvider.id);
  if (!monthlyLimitOk) {
    return fallbackToBasicAnswer();
  }

  // 流式输出开关：关闭时两次 LLM 调用均走非流式，最终结果一次性回传
  const streamingEnabled = await isStreamOutputEnabled();
  const effectiveSendChunk = streamingEnabled ? sendChunk : undefined;

  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt: customPrompt, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) throw new Error(getMessage('bgNoApiKeyConfig'));

  const searchAwareSystem = await buildSearchAwarePrompt(questionType, customPrompt, extraContextPrompt);
  const messages = [
    { role: 'system', content: searchAwareSystem },
    { role: 'user', content: questionText }
  ];

  // 第一次 LLM 调用
  const firstFull = await callAnswerWithFallback(messages, {
    apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
    sendChunk: effectiveSendChunk, temperature: 0.3
  });

  const needSearchMatch = firstFull.match(/\[NEED_SEARCH:\s*(.+?)\]/i);
  if (!needSearchMatch && !forceSearch) {
    return fallbackToCleanedAnswer(firstFull, sendChunk);
  }

  const searchQuery = needSearchMatch ? (needSearchMatch[1] || '').trim() : questionText.slice(0, 200);
  const settings = storage.web_search_settings || { count: 10, timeRange: '', language: 'zh' };

  let referenceLinks = [];
  let searchResultsText = '';
  try {
    const searchData = await executeWebSearch(activeProvider, settings, searchQuery || questionText.slice(0, 200));
    // 搜索结果与参考链接同源，一次提取两处复用
    referenceLinks = extractSearchResults(searchData, activeProvider.id);
    searchResultsText = formatSearchResultsForLLM(referenceLinks);
    incrementMonthlySearchCount(activeProvider.id);
  } catch (searchError) {
    return fallbackToCleanedAnswer(firstFull, sendChunk);
  }

  // 第二次 LLM 调用
  const searchResultPrompt = await buildSearchResultPrompt(questionText, questionType, searchResultsText, searchQuery, extraContextPrompt);
  const resultMessages = [
    { role: 'system', content: searchResultPrompt.system },
    { role: 'user', content: searchResultPrompt.user }
  ];

  const finalAnswer = await callAnswerWithFallback(resultMessages, {
    apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
    sendChunk: effectiveSendChunk, temperature: 0.3
  });

  const filteredLinks = filterReferencedLinks(finalAnswer, referenceLinks);
  if (sendChunk) {
    sendChunk({ type: 'done', answer: finalAnswer || getMessage('bgNoValidAnswer'), referenceLinks: filteredLinks, searchProviderName: activeProvider?.name || '' });
    return;
  }
  return { success: true, answer: finalAnswer || getMessage('bgNoValidAnswer'), referenceLinks: filteredLinks, searchProviderName: activeProvider?.name || '' };
}

async function handleExtractQuestions(pageText, pageStructure, selectionText, elementHint, existingRule) {
  const { apiUrl, apiKey, apiFormat, model, enableThinking, thinkingEffort, tools } = await getApiConfig('extract');
  if (!apiKey) {
    throw new Error(getMessage('bgNoApiKey'));
  }

  const prompt = await buildExtractPrompt(pageText, pageStructure, selectionText, elementHint, existingRule);
  const raw = await postChatCompletion({
    apiKey,
    apiUrl,
    apiFormat,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    model,
    temperature: 0.1,
    enableThinking,
    thinkingEffort,
    tools
  });

  try {
    const parsed = parseExtractedQuestions(raw);
    const questions = parsed.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      return { success: false, error: getMessage('bgNoExtractedQuestions') };
    }

    return {
      success: true,
      questions: questions.map((question, index) => ({
        id: question.id || index + 1,
        text: (question.text || '').trim(),
        type: normalizeQuestionType(question.type),
        answer: null,
        status: 'pending'
      })).filter(question => question.text.length > 0),
      selectors: parsed.selectors || null
    };
  } catch (_error) {
    return { success: false, error: getMessage('bgExtractParseError', [raw.slice(0, 300)]) };
  }
}

export function registerBackgroundRouter() {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'fetchAnswer') {
      handleFetchAnswer(request.data, request.questionType)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'fetchAnswerWithSearch') {
      handleFetchAnswerWithSearch(request.data, request.questionType, request.forceSearch)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'verifyBankAnswer') {
      handleVerifyBankAnswer(request.questionText, request.bankMatches)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'extractQuestions') {
      handleExtractQuestions(
        request.pageText,
        request.pageStructure,
        request.selectionText,
        request.elementHint,
        request.existingRule
      )
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'parseQuestionBank') {
      handleParseQuestionBank(request.text, request.fileName)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'searchQuestionBank') {
      handleSearchQuestionBank(request.questionText)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'detectStatus') {
      handleDetectStatus()
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    return false;
  });

  // 分批题库解析（port 通道，支持进度上报）
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'parseQuestionBank') {
      port.onMessage.addListener((msg) => {
        if (msg.text && msg.fileName) {
          handleParseQuestionBankBatched(msg.text, msg.fileName, port);
        }
      });
    }
    if (port.name === 'streamAnswer') {
      port.onMessage.addListener((msg) => {
        const { data: questionText, questionType, forceSearch } = msg;
        const send = (data) => { try { port.postMessage(data); } catch (_) {} };
        send({ type: 'connected' });
        handleFetchAnswerWithSearch(questionText, questionType, forceSearch, send)
          .catch(err => send({ type: 'error', message: err.message }));
      });
    }
  });
}
