let templatesPromise = null;

const { getMessage } = globalThis.QuizHelperI18n;

async function loadPromptTemplates() {
  if (!templatesPromise) {
    const url = globalThis.QuizHelperI18n.getPromptTemplatesUrl();
    templatesPromise = fetch(chrome.runtime.getURL(url)).then(async res => {
      if (!res.ok) {
        throw new Error(getMessage('bgPromptTemplatesLoadFailed', [res.status]));
      }
      return res.json();
    });
  }
  return templatesPromise;
}

function fillTemplate(template, values) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? '');
}

/**
 * 解析用户自定义系统提示词
 * 支持按题型配置的对象（customPrompt[questionType] || customPrompt.unknown）或单个字符串
 * @param {Object|string|undefined} customPrompt - 用户自定义提示词
 * @param {string} questionType - 题型
 * @returns {string} 解析后的自定义提示词（可能为空字符串）
 */
function resolveCustomPrompt(customPrompt, questionType) {
  if (customPrompt && typeof customPrompt === 'object') {
    return (customPrompt[questionType] || customPrompt.unknown || '').trim();
  }
  if (customPrompt && typeof customPrompt === 'string') {
    return customPrompt.trim();
  }
  return '';
}

export async function buildSystemPrompt(questionType, customPrompt, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const prompts = templates.answerSystemPrompts || {};

  let basePrompt = resolveCustomPrompt(customPrompt, questionType);

  if (!basePrompt) {
    basePrompt = prompts[questionType] || prompts.unknown || '';
  }

  const extraPrompt = String(extraContextPrompt || '').trim();
  return extraPrompt ? `${basePrompt}\n\n${getMessage('bgSupplementBackgroundInfo')}\n${extraPrompt}` : basePrompt;
}

export async function buildVerifyPrompt(questionText, bankMatches, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const systemPrompt = templates.verifyBankAnswerSystemPrompt || '';
  const extraPrompt = String(extraContextPrompt || '').trim();
  const refText = bankMatches.map((item, index) => {
    let text = getMessage('bgBankRefItem', [index + 1, item.score, item.source, item.questionText, item.answer]);
    if (item.analysis) text += getMessage('bgBankRefAnalysis', [item.analysis]);
    return text;
  }).join('\n\n');

  return {
    system: extraPrompt ? `${systemPrompt}\n\n${getMessage('bgSupplementBackground', [extraPrompt])}` : systemPrompt,
    user: getMessage('bgVerifyUserPrompt', [questionText, refText])
  };
}

function buildExistingRuleInfo(existingRule) {
  if (!existingRule || !existingRule.selectors) return '';

  const s = existingRule.selectors;
  const parts = [getMessage('bgExistingRuleHeading')];
  parts.push(getMessage('bgExistingRuleDomain', [existingRule.domain || '']));
  parts.push('');

  if (s.rootSelectors && s.rootSelectors.length) {
    parts.push(getMessage('bgRuleRootSelector', [s.rootSelectors.join(', ')]));
  }
  if (s.questionItemSelector) {
    parts.push(getMessage('bgRuleItemSelector', [s.questionItemSelector]));
  }
  if (s.typeHeadingSelector) {
    parts.push(getMessage('bgRuleTypeHeadingSelector', [s.typeHeadingSelector]));
  }
  if (s.questionTextSelectors && s.questionTextSelectors.length) {
    parts.push(getMessage('bgRuleTextSelectors', [s.questionTextSelectors.join(', ')]));
  }
  if (s.optionContainerSelectors && s.optionContainerSelectors.length) {
    parts.push(getMessage('bgRuleOptionContainerSelectors', [s.optionContainerSelectors.join(', ')]));
  }
  if (s.optionItemSelector) {
    parts.push(getMessage('bgRuleOptionItemSelector', [s.optionItemSelector]));
  }
  if (s.optionNumberSelector) {
    parts.push(getMessage('bgRuleOptionNumberSelector', [s.optionNumberSelector]));
  }
  if (s.typeIndicators) {
    const ti = s.typeIndicators;
    const tiParts = [];
    if (ti.single && ti.single.length) tiParts.push(`${getMessage('typeSingle')}: [${ti.single.join(', ')}]`);
    if (ti.multiple && ti.multiple.length) tiParts.push(`${getMessage('typeMultiple')}: [${ti.multiple.join(', ')}]`);
    if (ti.judge && ti.judge.length) tiParts.push(`${getMessage('typeJudge')}: [${ti.judge.join(', ')}]`);
    if (tiParts.length) parts.push(getMessage('bgTypeIndicatorKeywords', [tiParts.join(getMessage('bgListSeparator'))]));
  }
  if (existingRule.typeKeywords) {
    const tk = existingRule.typeKeywords;
    const tkParts = [];
    if (tk.multiple && tk.multiple.length) tkParts.push(`${getMessage('typeMultiple')}: [${tk.multiple.join(', ')}]`);
    if (tk.judge && tk.judge.length) tkParts.push(`${getMessage('typeJudge')}: [${tk.judge.join(', ')}]`);
    if (tk.fill && tk.fill.length) tkParts.push(`${getMessage('typeFill')}: [${tk.fill.join(', ')}]`);
    if (tkParts.length) parts.push(getMessage('bgTypeTextKeywords', [tkParts.join(getMessage('bgListSeparator'))]));
  }

  parts.push('');
  parts.push(getMessage('bgMergeOptimizationPrinciple'));
  parts.push(getMessage('bgMergePrinciple1'));
  parts.push(getMessage('bgMergePrinciple2'));
  parts.push(getMessage('bgMergePrinciple3'));
  parts.push(getMessage('bgMergePrinciple4'));
  parts.push(getMessage('bgMergePrinciple5'));

  return parts.join('\n');
}

export async function buildExtractPrompt(pageText, pageStructure, selectionText, elementHint, existingRule) {
  const templates = await loadPromptTemplates();
  return {
    system: templates.extractQuestionsSystemPrompt || '',
    user: fillTemplate(templates.extractPromptTemplate, {
      existingRuleInfo: buildExistingRuleInfo(existingRule),
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

export async function buildSearchAwarePrompt(questionType, customPrompt, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const basePrompt = templates.answerWithSearchSystemPrompt || '';

  // 合并用户自定义系统提示词（优先）
  const customPart = resolveCustomPrompt(customPrompt, questionType);

  const extraPrompt = String(extraContextPrompt || '').trim();

  let systemPrompt = basePrompt;
  if (customPart) {
    systemPrompt = systemPrompt + '\n\n' + getMessage('bgUserCustomRequirement') + '\n' + customPart;
  }
  if (extraPrompt) {
    systemPrompt = systemPrompt + '\n\n' + getMessage('bgSupplementBackgroundInfo') + '\n' + extraPrompt;
  }

  return systemPrompt;
}

export async function buildSearchResultPrompt(questionText, questionType, searchResults, searchQuery, extraContextPrompt) {
  const templates = await loadPromptTemplates();
  const prompts = templates.answerSystemPrompts || {};
  const systemPrompt = templates.answerWithSearchResultsSystemPrompt || '';

  let formatHint = '';
  if (questionType) {
    const typePrompt = prompts[questionType] || prompts.unknown || '';
    // 从题型提示中提取格式要求部分（兼容中英文提示词的开头句式）
    const fmtMatch = typePrompt.match(/(?:请按以下格式输出[：:]|Please answer in the following format\s*[:：])[\s\S]+/);
    if (fmtMatch) {
      formatHint = '\n\n' + fmtMatch[0];
    }
  }

  const extraPrompt = String(extraContextPrompt || '').trim();
  const finalSystem = [systemPrompt, formatHint, extraPrompt ? getMessage('bgSupplementBackground', [extraPrompt]) : '']
    .filter(Boolean).join('\n\n');

  const searchText = searchResults || getMessage('bgNoSearchResultsFetched');

  return {
    system: finalSystem,
    user: getMessage('bgSearchResultUserPrompt', [questionText, searchQuery || getMessage('bgAutoGenerated'), searchText])
  };
}
