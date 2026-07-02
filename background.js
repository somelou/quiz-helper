// Service Worker: 处理 API 配置读取和 LLM 请求代理

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchAnswer') {
    handleFetchAnswer(request.data, request.questionType)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'verifyBankAnswer') {
    handleVerifyBankAnswer(
      request.questionText,
      request.questionType,
      request.bankMatches
    )
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
});

// ===== API 请求 =====

/**
 * 调用 LLM API 获取单题答案
 * @param {string} questionText - 题目文本
 * @param {string} questionType - 题型标识
 * @returns {Promise<Object>} { success: true, answer: string }
 */
async function handleFetchAnswer(questionText, questionType) {
  const config = await chrome.storage.local.get([
    'api_url',
    'api_key',
    'model',
    'system_prompt',
    'extra_context_prompt'
  ]);
  const apiUrl = (config.api_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = config.api_key || '';
  const model = config.model || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  const systemPrompt = buildSystemPrompt(
    questionType,
    config.system_prompt,
    config.extra_context_prompt
  );
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
 * 使用 AI 校验题库答案：将题库答案按当前题目的选项内容做语义匹配
 * @param {string} questionText - 当前考试题目文本
 * @param {string} questionType - 题型
 * @param {Array} bankMatches - 题库匹配结果数组 [{answer, analysis, source, questionText, score}]
 * @returns {Promise<Object>}
 */
async function handleVerifyBankAnswer(questionText, questionType, bankMatches) {
  const config = await chrome.storage.local.get([
    'api_url',
    'api_key',
    'model',
    'extra_context_prompt'
  ]);
  const apiUrl = (config.api_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = config.api_key || '';
  const model = config.model || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('未配置 API Key，请先打开设置页面配置');
  }

  const systemPrompt = `你是一个专业的题库答案校验助手。用户会提供当前考试题目和多个题库中的参考答案（含题库原题、题库答案）。

你的任务：
1. 比较各题库原题和当前题目的选项内容，做语义匹配
2. 题库的选项字母可能与当前题目不同，必须根据选项的实际内容来确定正确答案
3. 直接输出当前题目的答案和解析，不要输出"来源"信息
4. 按以下格式输出：
答案：X（当前题目中正确选项的字母）
解析：简要解析

示例：
当前题目：1. 路由器工作在 OSI 的哪一层？（ ）
A. 传输层 B. 网络层 C. 数据链路层 D. 物理层

题库参考1（相似度0.95）：1. 路由器工作在 OSI 的哪一层？A. 物理层 B. 网络层 C. 传输层 D. 数据链路层
题库答案：B

你应输出：
答案：B
解析：路由器工作在网络层，负责 IP 分组转发和路由选择。

只输出文字，不要输出其他格式。`;
  const extraPrompt = String(config.extra_context_prompt || '').trim();

  // 构建参考内容
  const refText = bankMatches.map((m, i) => {
    let text = `题库参考${i + 1}（相似度${m.score}）[${m.source}]：\n${m.questionText}\n题库答案：${m.answer}`;
    if (m.analysis) text += `\n题库解析：${m.analysis}`;
    return text;
  }).join('\n\n');

  const userMessage = `当前考试题目：
${questionText}

${refText}

请根据当前题目的选项内容，综合参考上述题库信息，输出正确答案字母和解析。`;

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
        { role: 'system', content: extraPrompt ? `${systemPrompt}\n\n补充背景：${extraPrompt}` : systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`校验请求失败 (${response.status}): ${errText}`);
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
    const parsed = parseExtractedQuestions(raw);
    const questions = parsed.questions;
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
      })).filter(q => q.text.length > 0),
      selectors: parsed.selectors || null
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
   - 有 checkbox 通常是 multiple，但要注意某些考试系统用 checkbox 模拟单选（外层 class 含 singleContainer 等）
   - 题目容器或其父元素的 class 名往往直接表明题型：如 singleContainer/单选、multipleContainer/多选、judgeContainer/判断
   - 有 radio 且选项为 正确/错误 或 对/错 通常是 judge
   - 有 radio 且存在 A/B/C/D 等选项通常是 single
   - 有明显空格线、填空提示通常是 fill
4. 同时分析 HTML 结构，提取 CSS 选择器配置，用于后续自动解析：
   - rootSelector: 包含所有题目的根容器选择器
   - questionItemSelector: 单个题目元素的选择器
   - typeHeadingSelector: 题型标题元素的选择器（如"单选题"标题，如无则为空字符串）
   - questionTextSelector: 题干内容元素的选择器
   - optionContainerSelector: 选项容器元素的选择器
   - optionItemSelector: 单个选项元素的选择器
   - optionNumberSelector: 选项编号元素的选择器（如无则为空字符串）
5. 提取题型指示器（typeIndicators），用于通过 class 名判断题型（当 checkbox/radio 无法准确区分时尤为重要）：
   - single: 题目元素或其祖先元素 class 中表示"单选"的关键词列表（如 singleContainer、single-question）
   - multiple: 表示"多选"的关键词列表（如 multipleContainer、multi-question）
   - judge: 表示"判断"的关键词列表（如 judgeContainer、true-false）
   - 如果 HTML 中没有明显的 class 区分，对应数组留空 []
6. 输出为严格的 JSON 对象格式（不要输出 markdown）：
{
  "questions": [
    { "id": 1, "text": "完整题目文本", "type": "single" }
  ],
  "selectors": {
    "rootSelector": ".main-padding-content",
    "questionItemSelector": ".question-type-item",
    "typeHeadingSelector": ".h3.m-bottom",
    "questionTextSelector": ".question",
    "optionContainerSelector": ".options",
    "optionItemSelector": "dd",
    "optionNumberSelector": ".option-num",
    "typeIndicators": {
      "single": ["singleContainer"],
      "multiple": ["multipleContainer"],
      "judge": ["judgeContainer"]
    }
  }
}
7. 如果这块区域包含多道题，需要全部拆分出来
8. 只输出 JSON 对象，不要输出其他文字、不要输出 markdown

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
 * 根据题型、自定义提示词和补充背景构建系统提示词
 * @param {string} questionType
 * @param {string} customPrompt
 * @param {string} extraContextPrompt
 * @returns {string}
 */
function buildSystemPrompt(questionType, customPrompt, extraContextPrompt) {
  const prompts = {
    single: '你是一个专业的答题助手。用户将提供一道单选题，请按以下格式输出：\n答案：X（仅一个选项字母，基于当前题目实际选项顺序）\n解析：简要解析\n重要：如果上下文附带了题库参考信息，题库的选项字母可能与当前题目不同，你必须根据当前题目的选项内容语义来匹配，不能直接套用题库的字母。',
    multiple: '你是一个专业的答题助手。用户将提供一道多选题，请按以下格式输出：\n答案：XY（所有正确选项字母连写，如 AB、ACD，基于当前题目实际选项顺序）\n解析：简要解析\n必须明确列出多个正确选项，不能只给一个。重要：如果上下文附带了题库参考信息，题库的选项字母排列可能与当前题目不同，必须根据选项内容来匹配。',
    judge: '你是一个专业的答题助手。用户将提供一道判断题，请按以下格式输出：\n答案：对 / 错\n解析：简要解析\n重要：如果上下文附带了题库参考信息，题库的答案结论可直接参考，但解析需结合当前题目说明。',
    fill: '你是一个专业的答题助手。用户将提供一道填空题，请按以下格式输出：\n答案：详细参考答案\n解析：简要解析\n重要：如果上下文附带了题库参考信息，请结合题库答案和当前题目语境给出最合适的回答。',
    unknown: '你是一个专业的答题助手。请根据用户提供的题目，给出详细的解题思路、分析过程和参考答案。注意：不要直接替用户勾选或选择答案选项，只提供文字参考。如果上下文附带了题库参考信息，请以选项内容语义为准进行匹配，不要直接套用题库字母。'
  };

  const basePrompt = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : (prompts[questionType] || prompts.unknown);
  const extraPrompt = String(extraContextPrompt || '').trim();

  if (!extraPrompt) {
    return basePrompt;
  }

  return `${basePrompt}\n\n补充背景信息：\n${extraPrompt}`;
}

// ===== 数据解析 =====

/**
 * 从 AI 返回的文本中解析 JSON 题目数组
 * @param {string} raw
 * @returns {Array}
 */
function parseExtractedQuestions(raw) {
  const cleaned = stripMarkdownFence(raw);
  const result = { questions: [], selectors: null };

  // 尝试直接解析
  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) {
    return { questions: direct, selectors: null };
  }
  if (direct && Array.isArray(direct.questions)) {
    return { questions: direct.questions, selectors: direct.selectors || null };
  }

  // 尝试从文本中提取 JSON 对象（含 questions 字段）
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed && Array.isArray(parsed.questions)) {
      return { questions: parsed.questions, selectors: parsed.selectors || null };
    }
  }

  // 尝试从文本中提取 JSON 数组（兼容旧格式）
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) {
      return { questions: parsed, selectors: null };
    }
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
  if (value.includes('single') || value.includes('单选')) return 'single';
  if (value.includes('multiple') || value.includes('multi') || value.includes('多选')) return 'multiple';
  if (value.includes('judge') || value.includes('judgement') || value.includes('truefalse') || value.includes('判断')) return 'judge';
  if (value.includes('fill') || value.includes('blank') || value.includes('填空')) return 'fill';
  return 'unknown';
}

// ===== 题库解析与搜索 =====

/**
 * 使用 AI 解析题库文本，提取题目和答案
 * @param {string} text - 题库文本内容
 * @param {string} fileName - 文件名
 * @returns {Promise<Object>} { success: true, questions: Array }
 */
async function handleParseQuestionBank(text, fileName) {
  try {
    const fallbackQuestions = parseQuestionBankByRules(text);
    const config = await chrome.storage.local.get(['api_url', 'api_key', 'model']);
    const apiUrl = (config.api_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey = config.api_key || '';
    const model = config.model || 'gpt-3.5-turbo';

    if (!apiKey) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: '未配置 API Key，请先在设置页面配置' };
    }

    const endpoint = apiUrl + '/chat/completions';
    const prompt = buildQuestionBankPrompt(text, fileName);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: '你是一个题库解析工具，只输出JSON格式的数据，不要输出任何其他文字或markdown标记。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        }),
        timeout: 60000
      });
    } catch (fetchErr) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: '网络请求失败：' + fetchErr.message };
    }

    if (!response.ok) {
      const errText = await response.text();
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: `解析题库失败 (${response.status}): ${errText}` };
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: 'API 返回数据格式错误：' + jsonErr.message };
    }

    const raw = data.choices?.[0]?.message?.content || '';

    try {
      const questions = normalizeParsedQuestions(parseQuestionBankResult(raw));
      if (questions.length > 0) {
        return { success: true, questions };
      }

      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }

      return { success: false, error: 'AI 未解析到有效题目' };
    } catch (e) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: 'AI 返回的数据格式无法解析: ' + raw.slice(0, 300) };
    }
  } catch (err) {
    return { success: false, error: '解析过程出错：' + err.message };
  }
}

/**
 * 在激活的题库中搜索匹配的题目（返回所有匹配结果供 AI 参考）
 * @param {string} questionText - 待搜索的题目文本
 * @returns {Promise<Object>} { success: true, found: boolean, matches: Array }
 */
async function handleSearchQuestionBank(questionText) {
  const result = await chrome.storage.local.get([
    'question_banks',
    'active_bank_id',
    'active_bank_ids',
    'question_bank_enabled'
  ]);
  const banks = result.question_banks || [];
  const questionBankEnabled = result.question_bank_enabled !== false;
  const activeBankIds = getActiveBankIds(result, banks);

  if (!questionBankEnabled || activeBankIds.length === 0) {
    return { success: true, found: false, matches: [] };
  }

  const searchText = questionText.toLowerCase().replace(/\s+/g, '');
  const allMatches = [];

  for (const activeBank of banks) {
    if (!activeBankIds.includes(activeBank.id)) continue;
    if (!activeBank.questions || activeBank.questions.length === 0) continue;

    for (const q of activeBank.questions) {
      const bankText = q.text.toLowerCase().replace(/\s+/g, '');
      const score = calculateSimilarity(searchText, bankText);

      if (score >= 0.6) {
        allMatches.push({
          answer: q.answer,
          analysis: q.analysis || '',
          source: activeBank.name,
          questionId: q.id,
          questionText: q.text,
          score: Math.round(score * 100) / 100
        });
      }
    }
  }

  // 按相似度降序排列
  allMatches.sort((a, b) => b.score - a.score);

  if (allMatches.length > 0) {
    return {
      success: true,
      found: true,
      matches: allMatches
    };
  }

  return { success: true, found: false, matches: [] };
}

function getActiveBankIds(result, banks) {
  const bankIds = new Set((banks || []).map(bank => bank.id));
  let activeIds = Array.isArray(result.active_bank_ids)
    ? result.active_bank_ids
    : [];

  if (activeIds.length === 0 && result.active_bank_id) {
    activeIds = [result.active_bank_id];
  }

  return [...new Set(activeIds.filter(id => bankIds.has(id)))];
}

/**
 * 构建题库解析提示词
 * @param {string} text - 题库文本
 * @param {string} fileName - 文件名
 * @returns {string}
 */
function buildQuestionBankPrompt(text, fileName) {
  return `你是一个专业的题库解析助手。请从以下文本中提取所有题目，包括题目内容、题型、参考答案和解析。

要求：
1. 每道题独立提取，保留完整题号和题干
2. 判断每道题的题型：single(单选)、multiple(多选)、judge(判断)、fill(填空)
3. 题型判断规则：
   - 选项为 A/B/C/D 且只有一个正确答案的是 single
   - 选项为 A/B/C/D 且可能有多个正确答案的是 multiple
   - 只有正确/错误、对/错两个选项的是 judge
   - 需要填写空白的是 fill
4. 输出为严格的JSON数组格式，每个元素包含：
   - "id": 题号（数字）
   - "text": 完整题目文本（题干+选项）
   - "type": 题型（single/multiple/judge/fill）
   - "answer": 参考答案（如果文本中有答案的话）
   - "analysis": 题目解析（如果文本中包含"解析"/"答案解析"等内容则提取，否则留空字符串）
5. 必须优先检查题号行和题干本身是否已经包含答案，不要只看单独的"答案："行
6. 以下都属于"文本中有答案"，必须正确提取到 answer 字段：
   - 题干后直接带答案，如：1. 下列说法正确的是（A）
   - 题干或题型标记附近带答案，如：2. xxxx（AB）【多选】
   - 方括号或其他标记中带答案，如：【答案：C】、[答案:B]
   - 判断题题干直接带答案，如：（对）、（错）、（正确）、（错误）
7. 如果题干中已经出现答案标记，answer 不能为空，不能漏掉
8. 不要凭空猜答案和解析；只有文本中明确出现时才填写，否则留空字符串
9. 只输出JSON数组，不要输出其他文字、不要输出 markdown

示例：
[
  {
    "id": 1,
    "text": "1. 路由器工作在网络层。（对）",
    "type": "judge",
    "answer": "对",
    "analysis": "路由器是网络层设备，负责路由选择和分组转发。"
  },
  {
    "id": 2,
    "text": "2. IPv6 地址长度是（B）。A. 32位 B. 128位 C. 64位 D. 256位",
    "type": "single",
    "answer": "B",
    "analysis": "IPv6 地址长度为 128 位，是 IPv4（32 位）的 4 倍。"
  },
  {
    "id": 3,
    "text": "3. 以下属于 AI 大模型应用场景的是（AC）。A. 文本生成 C. 智能问答",
    "type": "multiple",
    "answer": "AC",
    "analysis": ""
  }
]

文件来源：${fileName}

文本内容：
${text.slice(0, 15000)}`;
}

/**
 * 从 AI 返回的文本中解析题库题目数组
 * @param {string} raw
 * @returns {Array}
 */
function parseQuestionBankResult(raw) {
  const cleaned = stripMarkdownFence(raw);

  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) return direct;
  if (direct && Array.isArray(direct.questions)) return direct.questions;

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed;
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  }

  throw new Error('未找到可解析的 JSON');
}

/**
 * 统一清洗题库题目结构，避免 AI 返回中文题型或空字段时导入失败。
 * @param {Array} questions
 * @returns {Array}
 */
function normalizeParsedQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.map((q, i) => ({
    id: q.id || i + 1,
    text: (q.text || '').trim(),
    type: normalizeQuestionType(q.type),
    answer: (q.answer || '').trim(),
    analysis: (q.analysis || '').trim()
  })).filter(q => q.text.length > 0);
}

/**
 * 针对结构化题库文本做本地兜底解析，覆盖 Word/Excel 中常见的题号、选项和答案格式。
 * @param {string} text
 * @returns {Array}
 */
function parseQuestionBankByRules(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanBankLine)
    .filter(Boolean);

  const questions = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.stem) return;
    questions.push({
      id: current.id,
      text: [current.stem, ...current.extraLines, ...current.options].filter(Boolean).join('\n').trim(),
      type: current.type,
      answer: current.answer,
      analysis: current.analysis || ''
    });
  };

  for (const line of lines) {
    if (isQuestionStartLine(line)) {
      pushCurrent();
      const questionInfo = parseQuestionStartLine(line);
      current = {
        id: questionInfo.id,
        stem: questionInfo.text,
        type: questionInfo.type,
        answer: questionInfo.answer,
        analysis: '',
        extraLines: [],
        options: []
      };
      continue;
    }

    if (!current) continue;

    if (isAnalysisLine(line)) {
      current.analysis = extractAnalysisFromText(line);
      continue;
    }

    if (isAnswerLine(line)) {
      if (!current.answer) {
        current.answer = extractAnswerFromText(line);
        if (current.type === 'unknown') {
          current.type = inferQuestionType('', current.answer);
        }
      }
      continue;
    }

    if (isOptionLine(line)) {
      current.options.push(line);
      if (current.type === 'unknown') {
        current.type = inferQuestionType(line, current.answer);
      }
      continue;
    }

    if (current.options.length > 0) {
      current.options[current.options.length - 1] += '\n' + line;
      continue;
    }

    current.extraLines.push(line);
  }

  pushCurrent();
  return normalizeParsedQuestions(questions);
}

function cleanBankLine(line) {
  return String(line || '')
    .replace(/^\s*[•·●▪■\-]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestionStartLine(line) {
  return /^\d+\s*[、，,.．]/.test(line);
}

function isOptionLine(line) {
  return /^[A-H][、，\.．:：\s]/i.test(line);
}

function isAnswerLine(line) {
  return /^(参考答案|正确答案|答案)[：:]/.test(line);
}

function isAnalysisLine(line) {
  return /^(答案解析|解析|参考解析|答案说明)[：:]/.test(line);
}

function extractAnalysisFromText(text) {
  const match = String(text || '').match(/^(?:答案解析|解析|参考解析|答案说明)[：:]\s*(.+)/i);
  return match ? match[1].trim() : '';
}

function parseQuestionStartLine(line) {
  const idMatch = line.match(/^(\d+)\s*[、，,.．]/);
  const id = idMatch ? Number(idMatch[1]) : '';
  const answer = extractAnswerFromText(line);
  const type = inferQuestionType(line, answer);
  let text = line.replace(/^\d+\s*[、，,.．]\s*/, '').trim();

  text = text
    .replace(/[（(]\s*([A-H]{1,8}|对|错|正确|错误)\s*[)）]\s*(?=【|$)/ig, '')
    .replace(/【[^】]+】/g, '')
    .trim();

  return { id, text, type, answer };
}

function extractAnswerFromText(text) {
  const inlineMatch = String(text || '').match(/[（(]\s*([A-H]{1,8}|对|错|正确|错误)\s*[)）]\s*(?=【|$)/i);
  if (inlineMatch) {
    return normalizeAnswer(inlineMatch[1]);
  }

  const labelMatch = String(text || '').match(/(?:参考答案|正确答案|答案)[：:]\s*([A-H]{1,8}|对|错|正确|错误)/i);
  if (labelMatch) {
    return normalizeAnswer(labelMatch[1]);
  }

  return '';
}

function normalizeAnswer(answer) {
  const raw = String(answer || '').trim();
  const upper = raw.toUpperCase().replace(/[\s,，、/]/g, '');

  if (!upper) return '';
  if (upper === 'TRUE' || raw === '正确' || raw === '对') return '对';
  if (upper === 'FALSE' || raw === '错误' || raw === '错') return '错';

  const letters = upper.match(/[A-H]/g);
  if (letters && letters.length === upper.length) {
    return [...new Set(letters)].join('');
  }

  return raw;
}

function inferQuestionType(line, answer) {
  const value = String(line || '');
  if (value.includes('多选')) return 'multiple';
  if (value.includes('单选')) return 'single';
  if (value.includes('判断')) return 'judge';
  if (value.includes('填空')) return 'fill';
  if (answer === '对' || answer === '错') return 'judge';
  if (/^[A-H]{2,}$/i.test(answer || '')) return 'multiple';
  if (/^[A-H]$/i.test(answer || '')) return 'single';
  return 'unknown';
}

/**
 * 计算两个字符串的相似度（简化版 Jaccard 相似度）
 * @param {string} s1
 * @param {string} s2
 * @returns {number} 0-1 的相似度分数
 */
function calculateSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));

  const intersection = [...set1].filter(c => set2.has(c)).length;
  const union = set1.size + set2.size - intersection;

  return union === 0 ? 0 : intersection / union;
}
