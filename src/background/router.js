import { getApiConfig, postChatCompletion } from './api-client.js';
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

async function handleFetchAnswer(questionText, questionType) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
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
    temperature: 0.3
  });

  return { success: true, answer: answer || '未获取到有效答案' };
}

async function handleVerifyBankAnswer(questionText, _questionType, bankMatches) {
  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model } = await getApiConfig('answer');
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
    temperature: 0.2
  });

  return { success: true, answer: answer || '未获取到有效答案' };
}

async function handleFetchAnswerWithSearch(questionText, questionType, forceSearch = false) {
  console.log('[fetchAnswerWithSearch] forceSearch:', forceSearch);

  // 读取联网搜索配置
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

  console.log('[fetchAnswerWithSearch] 搜索状态:', { enabled, activeId, hasProvider: !!activeProvider });

  // 搜索未启用或无激活服务商 → 降级到普通答题（forceSearch 也不跳过此检查）
  if (!enabled || !activeProvider) {
    console.log('[fetchAnswerWithSearch] 搜索不可用，降级到普通 fetchAnswer');
    return handleFetchAnswer(questionText, questionType);
  }

  // 检查每月搜索次数限制
  const monthlyLimitOk = await checkMonthlySearchLimit(activeProvider.id);
  if (!monthlyLimitOk) {
    console.log('[fetchAnswerWithSearch] 本月搜索次数已达上限，降级到普通 fetchAnswer');
    return handleFetchAnswer(questionText, questionType);
  }

  const { apiUrl, apiKey, apiFormat, extraContextPrompt, model, systemPrompt: customPrompt } = await getApiConfig('answer');
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  // 第一次 LLM 调用（搜索感知提示词）
  const searchAwareSystem = await buildSearchAwarePrompt(questionType, customPrompt, extraContextPrompt);
  console.log('[fetchAnswerWithSearch] 第一次 LLM 调用（搜索感知）');

  const firstAnswer = await postChatCompletion({
    apiKey,
    apiUrl,
    apiFormat,
    messages: [
      { role: 'system', content: searchAwareSystem },
      { role: 'user', content: questionText }
    ],
    model,
    temperature: 0.3
  });

  // 检查是否需要搜索
  const needSearchMatch = firstAnswer.match(/\[NEED_SEARCH:\s*(.+?)\]/i);

  if (!needSearchMatch && !forceSearch) {
    console.log('[fetchAnswerWithSearch] 无需搜索，直接返回');
    const cleanedAnswer = firstAnswer.replace(/\[NEED_SEARCH:\s*.+?\]\s*/gi, '').trim();
    return { success: true, answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] };
  }

  // 提取搜索词：标记优先，否则用题目文本
  const searchQuery = needSearchMatch
    ? (needSearchMatch[1] || '').trim()
    : questionText.slice(0, 200);

  if (forceSearch) {
    console.log('[fetchAnswerWithSearch] 强制搜索，关键词:', searchQuery || '(使用题目文本)');
  } else {
    console.log('[fetchAnswerWithSearch] 需要搜索，关键词:', searchQuery);
  }

  const settings = storage.web_search_settings || { count: 10, timeRange: '', language: 'zh' };

  // 执行联网搜索
  let referenceLinks = [];
  let searchResultsText = '';
  try {
    const searchData = await executeWebSearch(activeProvider, settings, searchQuery || questionText.slice(0, 200));
    const results = extractSearchResults(searchData, activeProvider.id);
    referenceLinks = extractReferenceLinks(searchData, activeProvider.id);
    searchResultsText = formatSearchResultsForLLM(results);
    console.log('[fetchAnswerWithSearch] 搜索结果:', results.length, '条');
    incrementMonthlySearchCount(activeProvider.id);
  } catch (searchError) {
    console.error('[fetchAnswerWithSearch] 搜索失败:', searchError.message);
    // 搜索失败降级：返回首轮答案
    const cleanedAnswer = firstAnswer.replace(/\[NEED_SEARCH:\s*.+?\]\s*/gi, '').trim();
    return { success: true, answer: cleanedAnswer || '未获取到有效答案', referenceLinks: [] };
  }

  // 第二次 LLM 调用（带搜索结果）
  const searchResultPrompt = await buildSearchResultPrompt(questionText, questionType, searchResultsText, searchQuery, extraContextPrompt);
  console.log('[fetchAnswerWithSearch] 第二次 LLM 调用（带搜索结果）');

  const finalAnswer = await postChatCompletion({
    apiKey,
    apiUrl,
    apiFormat,
    messages: [
      { role: 'system', content: searchResultPrompt.system },
      { role: 'user', content: searchResultPrompt.user }
    ],
    model,
    temperature: 0.3
  });

  const filteredLinks = filterReferencedLinks(finalAnswer, referenceLinks);
  return { success: true, answer: finalAnswer || '未获取到有效答案', referenceLinks: filteredLinks, searchProviderName: activeProvider?.name || '' };
}

async function handleExtractQuestions(pageText, pageStructure, selectionText, elementHint, existingRule) {
  const { apiUrl, apiKey, apiFormat, model } = await getApiConfig('extract');
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
    temperature: 0.1
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
  });
}
