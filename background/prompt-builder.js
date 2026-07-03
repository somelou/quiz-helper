let templatesPromise = null;

async function loadPromptTemplates() {
  if (!templatesPromise) {
    templatesPromise = fetch(chrome.runtime.getURL('data/prompt-templates.json')).then(async res => {
      if (!res.ok) {
        throw new Error(`加载提示词模板失败: ${res.status}`);
      }
      return res.json();
    });
  }
  return templatesPromise;
}

function fillTemplate(template, values) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? '');
}

export async function buildSystemPrompt(questionType, customPrompt, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const prompts = templates.answerSystemPrompts || {};
  const basePrompt = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : (prompts[questionType] || prompts.unknown || '');
  const extraPrompt = String(extraContextPrompt || '').trim();

  return extraPrompt ? `${basePrompt}\n\n补充背景信息：\n${extraPrompt}` : basePrompt;
}

export async function buildVerifyPrompt(questionText, bankMatches, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const systemPrompt = templates.verifyBankAnswerSystemPrompt || '';
  const extraPrompt = String(extraContextPrompt || '').trim();
  const refText = bankMatches.map((item, index) => {
    let text = `题库参考${index + 1}（相似度${item.score}）[${item.source}]：\n${item.questionText}\n题库答案：${item.answer}`;
    if (item.analysis) text += `\n题库解析：${item.analysis}`;
    return text;
  }).join('\n\n');

  return {
    system: extraPrompt ? `${systemPrompt}\n\n补充背景：${extraPrompt}` : systemPrompt,
    user: `当前考试题目：
${questionText}

${refText}

请根据当前题目的选项内容，综合参考上述题库信息，输出正确答案字母和解析。`
  };
}

export async function buildExtractPrompt(pageText, pageStructure, selectionText, elementHint) {
  const templates = await loadPromptTemplates();
  return {
    system: templates.extractQuestionsSystemPrompt || '',
    user: fillTemplate(templates.extractPromptTemplate, {
      elementHint: elementHint || 'unknown',
      pageStructure: (pageStructure || '').slice(0, 12000),
      pageText: (pageText || '').slice(0, 8000),
      selectionText: (selectionText || pageText || '').slice(0, 2000)
    })
  };
}

export async function buildQuestionBankPrompt(text, fileName) {
  const templates = await loadPromptTemplates();
  return {
    system: templates.questionBankSystemPrompt || '',
    user: fillTemplate(templates.questionBankPromptTemplate, {
      fileName,
      text: String(text || '').slice(0, 15000)
    })
  };
}
