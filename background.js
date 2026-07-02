// Service Worker: 处理 API 配置读取和 LLM 请求代理

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchAnswer') {
    handleFetchAnswer(request.data, request.questionType)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道打开，支持异步响应
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
});

// ===== API 请求 =====

/**
 * 调用 LLM API 获取单题答案
 * @param {string} questionText - 题目文本
 * @param {string} questionType - 题型标识
 * @returns {Promise<Object>} { success: true, answer: string }
 */
async function handleFetchAnswer(questionText, questionType) {
  const config = await chrome.storage.local.get(['api_url', 'api_key', 'model', 'system_prompt']);
  const apiUrl = (config.api_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = config.api_key || '';
  const model = config.model || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  const systemPrompt = buildSystemPrompt(questionType, config.system_prompt);
  const endpoint = apiUrl + '/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: questionText }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content || '未获取到有效答案';
  return { success: true, answer };
}

/**
 * 使用 AI 从选中的页面区域中提取题目
 * @param {string} pageText - 区域完整文本
 * @param {string} pageStructure - 区域 HTML 结构
 * @param {string} selectionText - 选中文本摘要
 * @param {string} elementHint - 元素描述
 * @returns {Promise<Object>} { success: true, questions: Array }
 */
async function handleExtractQuestions(pageText, pageStructure, selectionText, elementHint) {
  const config = await chrome.storage.local.get(['api_url', 'api_key', 'model']);
  const apiUrl = (config.api_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = config.api_key || '';
  const model = config.model || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('未配置 API Key');
  }

  const endpoint = apiUrl + '/chat/completions';
  const extractPrompt = buildExtractPrompt(pageText, pageStructure, selectionText, elementHint);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是一个网页解析工具，只输出JSON格式的数据，不要输出任何其他文字或markdown标记。' },
        { role: 'user', content: extractPrompt }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`提取题目失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  try {
    const questions = parseExtractedQuestions(raw);
    if (!Array.isArray(questions) || questions.length === 0) {
      return { success: false, error: 'AI 未提取到有效题目' };
    }

    return {
      success: true,
      questions: questions.map((q, i) => ({
        id: q.id || i + 1,
        text: (q.text || '').trim(),
        type: normalizeQuestionType(q.type),
        answer: null,
        status: 'pending'
      })).filter(q => q.text.length > 0)
    };
  } catch (e) {
    return { success: false, error: 'AI 返回的数据格式无法解析: ' + raw.slice(0, 300) };
  }
}

// ===== 提示词构建 =====

/**
 * 构建题目提取提示词
 * @returns {string}
 */
function buildExtractPrompt(pageText, pageStructure, selectionText, elementHint) {
  return `你是一个网页题目提取助手。用户从网页中选中了一块局部 DOM 区域，请只基于这块区域提取题目，不要假设整页上下文。

要求：
1. 每道题独立提取，保留完整题号
2. 判断每道题的题型：single(单选)、multiple(多选)、judge(判断)、fill(填空)
3. 优先结合局部 HTML 结构判断题型：
   - 有 checkbox 通常是 multiple
   - 有 radio 且选项为 正确/错误 或 对/错 通常是 judge
   - 有 radio 且存在 A/B/C/D 等选项通常是 single
   - 有明显空格线、填空提示通常是 fill
4. 输出为严格的JSON数组格式，每个元素包含：
   - "id": 题号（数字）
   - "text": 完整题目文本（题干+选项）
   - "type": 题型（single/multiple/judge/fill）
5. 如果这块区域包含多道题，需要全部拆分出来
6. 只输出JSON数组，不要输出其他文字、不要输出 markdown

区域说明：
- 选中元素：${elementHint || 'unknown'}
- 选中文本摘要：
${(selectionText || pageText || '').slice(0, 2000)}

局部 HTML：
${(pageStructure || '').slice(0, 12000)}

局部文本：
${pageText.slice(0, 8000)}`;
}

/**
 * 根据题型和自定义提示词构建系统提示词
 * @param {string} questionType
 * @param {string} customPrompt
 * @returns {string}
 */
function buildSystemPrompt(questionType, customPrompt) {
  if (customPrompt && customPrompt.trim()) {
    return customPrompt;
  }

  const prompts = {
    single: '你是一个专业的答题助手。用户将提供一道单选题，请按以下格式输出：\n答案：X（仅一个选项字母）\n解析：简要解析\n不要替用户选择，只输出文字。',
    multiple: '你是一个专业的答题助手。用户将提供一道多选题，请按以下格式输出：\n答案：XY（所有正确选项字母连写，如 AB、ACD）\n解析：简要解析\n必须明确列出多个正确选项，不能只给一个。不要替用户选择，只输出文字。',
    judge: '你是一个专业的答题助手。用户将提供一道判断题，请按以下格式输出：\n答案：对 / 错\n解析：简要解析\n不要替用户选择，只输出文字。',
    fill: '你是一个专业的答题助手。用户将提供一道填空题，请按以下格式输出：\n答案：详细参考答案\n解析：简要解析\n不要替用户选择，只输出文字。',
    unknown: '你是一个专业的答题助手。请根据用户提供的题目，给出详细的解题思路、分析过程和参考答案。注意：不要直接替用户勾选或选择答案选项，只提供文字参考。'
  };

  return prompts[questionType] || prompts.unknown;
}

// ===== 数据解析 =====

/**
 * 从 AI 返回的文本中解析 JSON 题目数组
 * @param {string} raw
 * @returns {Array}
 */
function parseExtractedQuestions(raw) {
  const cleaned = stripMarkdownFence(raw);

  // 尝试直接解析
  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) return direct;
  if (direct && Array.isArray(direct.questions)) return direct.questions;

  // 尝试从文本中提取 JSON 数组
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed;
  }

  // 尝试从文本中提取 JSON 对象（含 questions 字段）
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  }

  throw new Error('未找到可解析的 JSON');
}

/**
 * 移除 Markdown 代码块标记
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFence(text) {
  return (text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * 安全解析 JSON，失败返回 null
 * @param {string} text
 * @returns {any|null}
 */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * 规范化题型标识
 * @param {string} type
 * @returns {string}
 */
function normalizeQuestionType(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('single')) return 'single';
  if (value.includes('multiple') || value.includes('multi')) return 'multiple';
  if (value.includes('judge') || value.includes('judgement') || value.includes('truefalse')) return 'judge';
  if (value.includes('fill') || value.includes('blank')) return 'fill';
  return 'unknown';
}
