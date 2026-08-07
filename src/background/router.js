import { getApiConfig, postChatCompletion, streamChatCompletion } from './api-client.js';
import { parseExtractedQuestions, normalizeQuestionType } from './json-parser.js';
import { buildExtractPrompt, buildSystemPrompt, buildVerifyPrompt, buildSearchAwarePrompt, buildSearchResultPrompt } from './prompt-builder.js';
import { handleParseQuestionBank, handleParseQuestionBankBatched, handleSearchQuestionBank } from './question-bank.js';
import { executeWebSearch, extractSearchResults, formatSearchResultsForLLM, extractReferenceLinks } from './search-proxy.js';

/**
 * 检查每月搜索次数限制（按服务商）
 * @param {string} providerId
 * @returns {Promise<boolean>} true 表示可用，false 表示达到上限
 */
async function checkMonthlySearchLimit(providerId) {
  const result = await chrome.storage.local.get(['web_search_providers', 'web_search_usage']);
  const providers = result.web_search_providers || [];
  const provider = providers.find(p => p.id === providerId);
  const limit = parseInt(provider?.monthlyLimit, 10) || 0;
  if (limit <= 0) return true; // 0 表示不限制

  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = result.web_search_usage || {};
  const pu = usage[providerId] || { month: '', count: 0 };
  if (pu.month !== currentMonth) {
    pu.month = currentMonth;
    pu.count = 0;
  }
  return pu.count < limit;
}

/**
 * 递增每月搜索次数（按服务商）
 * @param {string} providerId
 */
async function incrementMonthlySearchCount(providerId) {
  const result = await chrome.storage.local.get(['web_search_usage']);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = result.web_search_usage || {};
  const pu = usage[providerId] || { month: '', count: 0 };
  if (pu.month !== currentMonth) {
    pu.month = currentMonth;
    pu.count = 0;
  }
  pu.count += 1;
  usage[providerId] = pu;
  await chrome.storage.local.set({ web_search_usage: usage });
}

/**
 * 从答案中提取引用的来源编号，过滤参考链接
 * @param {string} answer - 大模型答案
 * @param {Array} referenceLinks - 全部参考链接
 * @returns {Array} 只保留被引用的链接
 */
function filterReferencedLinks(answer, referenceLinks) {
  if (!answer || referenceLinks.length === 0) return referenceLinks;
  const citedIndices = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(answer)) !== null) {
    const idx = parseInt(m[1], 10);
    if (idx >= 1 && idx <= referenceLinks.length) citedIndices.add(idx);
  }
  if (citedIndices.size === 0) return referenceLinks;
  return referenceLinks.filter((_, i) => citedIndices.has(i + 1));
}

async function handleFetchAnswer(questionText, questionType, sendChunk) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  if (sendChunk) {
    const collectedLinks = [];
    const collectChunk = (data) => {
      if (data.type === 'referenceLinks') {
        collectedLinks.push(...data.links);
      } else {
        sendChunk(data);
      }
    };
    const answer = await streamChatCompletion({
      apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
      messages: [
        { role: 'system', content: await buildSystemPrompt(questionType, systemPrompt, extraContextPrompt) },
        { role: 'user', content: questionText }
      ],
      onChunk: collectChunk
    });
    sendChunk({ type: 'done', answer: answer || '未获取到有效答案', referenceLinks: collectedLinks });
    return;
  }

  const answer = await postChatCompletion({
    apiKey,
    apiUrl,
    apiFormat,
    messages: [
      { role: 'system', content: await buildSystemPrompt(questionType, systemPrompt, extraContextPrompt) },
      { role: 'user', content: questionText }
    ],
    model,
    temperature: 0.3,
    enableThinking,
    thinkingEffort,
    tools
  });

  return { success: true, answer: answer || '未获取到有效答案' };
}

async function handleVerifyBankAnswer(questionText, _questionType, bankMatches) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
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

  return { success: true, answer: answer || '未获取到有效答案' };
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

  if (!enabled || !activeProvider) {
    return sendChunk
      ? handleFetchAnswer(questionText, questionType, sendChunk)
      : handleFetchAnswer(questionText, questionType);
  }

  const monthlyLimitOk = await checkMonthlySearchLimit(activeProvider.id);
  if (!monthlyLimitOk) {
    return sendChunk
      ? handleFetchAnswer(questionText, questionType, sendChunk)
      : handleFetchAnswer(questionText, questionType);
  }

  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt: customPrompt, enableThinking, thinkingEffort, tools } = await getApiConfig('answer');
  if (!apiKey) throw new Error('未配置 API Key，请先打开设置页面配置');

  const searchAwareSystem = await buildSearchAwarePrompt(questionType, customPrompt, extraContextPrompt);
  const messages = [
    { role: 'system', content: searchAwareSystem },
    { role: 'user', content: questionText }
  ];

  // 第一次 LLM 调用
  let firstFull;
  if (sendChunk) {
    firstFull = await streamChatCompletion({
      apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
      messages,
      onChunk: sendChunk
    });
  } else {
    firstFull = await postChatCompletion({
      apiKey, apiUrl, apiFormat, messages, model, temperature: 0.3, enableThinking, thinkingEffort, tools
    });
  }

  const needSearchMatch = firstFull.match(/\[NEED_SEARCH:\s*(.+?)\]/i);
  if (!needSearchMatch && !forceSearch) {
    const cleanedAnswer = firstFull.replace(/\[NEED_SEARCH:\s*.+?\]\s*/gi, '').trim();
    if (sendChunk) {
      sendChunk({ type: 'done', answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] });
      return;
    }
    return { success: true, answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] };
  }

  const searchQuery = needSearchMatch ? (needSearchMatch[1] || '').trim() : questionText.slice(0, 200);
  const settings = storage.web_search_settings || { count: 10, timeRange: '', language: 'zh' };

  let referenceLinks = [];
  let searchResultsText = '';
  try {
    const searchData = await executeWebSearch(activeProvider, settings, searchQuery || questionText.slice(0, 200));
    const results = extractSearchResults(searchData, activeProvider.id);
    referenceLinks = extractReferenceLinks(searchData, activeProvider.id);
    searchResultsText = formatSearchResultsForLLM(results);
    incrementMonthlySearchCount(activeProvider.id);
  } catch (searchError) {
    const cleanedAnswer = firstFull.replace(/\[NEED_SEARCH:\s*.+?\]\s*/gi, '').trim();
    if (sendChunk) {
      sendChunk({ type: 'done', answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] });
      return;
    }
    return { success: true, answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] };
  }

  // 第二次 LLM 调用
  const searchResultPrompt = await buildSearchResultPrompt(questionText, questionType, searchResultsText, searchQuery, extraContextPrompt);
  const resultMessages = [
    { role: 'system', content: searchResultPrompt.system },
    { role: 'user', content: searchResultPrompt.user }
  ];

  let finalAnswer;
  if (sendChunk) {
    finalAnswer = await streamChatCompletion({
      apiKey, apiUrl, apiFormat, model, enableThinking, thinkingEffort, tools,
      messages: resultMessages,
      onChunk: sendChunk
    });
  } else {
    finalAnswer = await postChatCompletion({
      apiKey, apiUrl, apiFormat, messages: resultMessages, model, temperature: 0.3, enableThinking, thinkingEffort, tools
    });
  }

  const filteredLinks = filterReferencedLinks(finalAnswer, referenceLinks);
  if (sendChunk) {
    sendChunk({ type: 'done', answer: finalAnswer || '未获取到有效答案', referenceLinks: filteredLinks, searchProviderName: activeProvider?.name || '' });
    return;
  }
  return { success: true, answer: finalAnswer || '未获取到有效答案', referenceLinks: filteredLinks, searchProviderName: activeProvider?.name || '' };
}

async function handleExtractQuestions(pageText, pageStructure, selectionText, elementHint, existingRule) {
  const { apiUrl, apiKey, apiFormat, model, enableThinking, thinkingEffort, tools } = await getApiConfig('extract');
  if (!apiKey) {
    throw new Error('未配置 API Key');
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
      return { success: false, error: 'AI 未提取到有效题目' };
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
    return { success: false, error: 'AI 返回的数据格式无法解析: ' + raw.slice(0, 300) };
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
      handleVerifyBankAnswer(request.questionText, request.questionType, request.bankMatches)
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
