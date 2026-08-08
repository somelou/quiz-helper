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

function buildExistingRuleInfo(existingRule) {
  if (!existingRule || !existingRule.selectors) return '';

  const s = existingRule.selectors;
  const parts = ['## 已有解析规则（请在此基础上优化合并）'];
  parts.push(`该域名「${existingRule.domain || ''}」已有以下解析规则。请对比当前页面结构，判断已有选择器是否仍然有效：`);
  parts.push('');

  if (s.rootSelectors && s.rootSelectors.length) {
    parts.push(`- 根容器选择器：${s.rootSelectors.join(', ')}`);
  }
  if (s.questionItemSelector) {
    parts.push(`- 单题容器选择器：${s.questionItemSelector}`);
  }
  if (s.typeHeadingSelector) {
    parts.push(`- 题型标题选择器：${s.typeHeadingSelector}`);
  }
  if (s.questionTextSelectors && s.questionTextSelectors.length) {
    parts.push(`- 题干文本选择器：${s.questionTextSelectors.join(', ')}`);
  }
  if (s.optionContainerSelectors && s.optionContainerSelectors.length) {
    parts.push(`- 选项容器选择器：${s.optionContainerSelectors.join(', ')}`);
  }
  if (s.optionItemSelector) {
    parts.push(`- 选项元素选择器：${s.optionItemSelector}`);
  }
  if (s.optionNumberSelector) {
    parts.push(`- 选项编号选择器：${s.optionNumberSelector}`);
  }
  if (s.typeIndicators) {
    const ti = s.typeIndicators;
    const tiParts = [];
    if (ti.single && ti.single.length) tiParts.push(`单选: [${ti.single.join(', ')}]`);
    if (ti.multiple && ti.multiple.length) tiParts.push(`多选: [${ti.multiple.join(', ')}]`);
    if (ti.judge && ti.judge.length) tiParts.push(`判断: [${ti.judge.join(', ')}]`);
    if (tiParts.length) parts.push(`- 题型指示器 class 关键词：${tiParts.join('，')}`);
  }
  if (existingRule.typeKeywords) {
    const tk = existingRule.typeKeywords;
    const tkParts = [];
    if (tk.multiple && tk.multiple.length) tkParts.push(`多选: [${tk.multiple.join(', ')}]`);
    if (tk.judge && tk.judge.length) tkParts.push(`判断: [${tk.judge.join(', ')}]`);
    if (tk.fill && tk.fill.length) tkParts.push(`填空: [${tk.fill.join(', ')}]`);
    if (tkParts.length) parts.push(`- 题型文本关键词：${tkParts.join('，')}`);
  }

  parts.push('');
  parts.push('合并优化原则：');
  parts.push('1. 如果已有选择器在当前页面中仍然有效且命中稳定，保留它们');
  parts.push('2. 如果当前页面结构有变化（class 名不同、DOM 层级不同），请用新的选择器替换');
  parts.push('3. 如果已有选择器过于宽泛（如只用了 "div"），请用更精确的选择器优化');
  parts.push('4. 题型指示器关键词和题型文本关键词应与已有值合并去重，保留有效的并补充新发现的');
  parts.push('5. 返回的 selectors 应该是合并优化后的完整结果，而非增量');

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
    systemPrompt = systemPrompt + '\n\n用户自定义要求：\n' + customPart;
  }
  if (extraPrompt) {
    systemPrompt = systemPrompt + '\n\n补充背景信息：\n' + extraPrompt;
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
    // 从题型提示中提取格式要求部分
    const fmtMatch = typePrompt.match(/请按以下格式输出[：:][\s\S]+/);
    if (fmtMatch) {
      formatHint = '\n\n' + fmtMatch[0];
    }
  }

  const extraPrompt = String(extraContextPrompt || '').trim();
  const finalSystem = [systemPrompt, formatHint, extraPrompt ? `补充背景：${extraPrompt}` : '']
    .filter(Boolean).join('\n\n');

  const searchText = searchResults || '（未获取到搜索结果）';

  return {
    system: finalSystem,
    user: `用户题目：
${questionText}

搜索关键词：${searchQuery || '（自动生成）'}

联网搜索结果：
${searchText}

请基于以上搜索结果作答。`
  };
}
