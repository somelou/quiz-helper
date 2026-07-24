export function stripMarkdownFence(text) {
  return (text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

export function normalizeQuestionType(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('single') || value.includes('单选')) return 'single';
  if (value.includes('multiple') || value.includes('multi') || value.includes('多选')) return 'multiple';
  if (value.includes('judge') || value.includes('judgement') || value.includes('truefalse') || value.includes('判断')) return 'judge';
  if (value.includes('fill') || value.includes('blank') || value.includes('填空')) return 'fill';
  return 'unknown';
}

export function parseExtractedQuestions(raw) {
  const cleaned = stripMarkdownFence(raw);

  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) {
    return { questions: direct, selectors: null };
  }
  if (direct && Array.isArray(direct.questions)) {
    return { questions: direct.questions, selectors: direct.selectors || null };
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed && Array.isArray(parsed.questions)) {
      return { questions: parsed.questions, selectors: parsed.selectors || null };
    }
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) {
      return { questions: parsed, selectors: null };
    }
  }

  throw new Error('未找到可解析的 JSON');
}

export function parseQuestionBankResult(raw) {
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

export function normalizeParsedQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.map((q, i) => ({
    id: q.id || i + 1,
    text: (q.text || '').trim(),
    type: normalizeQuestionType(q.type),
    answer: (q.answer || '').trim(),
    analysis: (q.analysis || '').trim()
  })).filter(q => q.text.length > 0);
}
