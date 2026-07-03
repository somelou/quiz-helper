import { getApiConfig, postChatCompletion } from './api-client.js';
import { parseExtractedQuestions, normalizeQuestionType } from './json-parser.js';
import { buildExtractPrompt, buildSystemPrompt, buildVerifyPrompt } from './prompt-builder.js';
import { handleParseQuestionBank, handleSearchQuestionBank } from './question-bank.js';

async function handleFetchAnswer(questionText, questionType) {
  const { apiUrl, apiKey, extraContextPrompt, model, systemPrompt } = await getApiConfig();
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  const answer = await postChatCompletion({
    apiKey,
    apiUrl,
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
  const { apiUrl, apiKey, extraContextPrompt, model } = await getApiConfig();
  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  const prompt = await buildVerifyPrompt(questionText, bankMatches, extraContextPrompt);
  const answer = await postChatCompletion({
    apiKey,
    apiUrl,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    model,
    temperature: 0.2
  });

  return { success: true, answer: answer || '未获取到有效答案' };
}

async function handleExtractQuestions(pageText, pageStructure, selectionText, elementHint) {
  const { apiUrl, apiKey, model } = await getApiConfig();
  if (!apiKey) {
    throw new Error('未配置 API Key');
  }

  const prompt = await buildExtractPrompt(pageText, pageStructure, selectionText, elementHint);
  const raw = await postChatCompletion({
    apiKey,
    apiUrl,
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
        request.elementHint
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
}
