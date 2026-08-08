// 题型归一化统一实现于 shared/text-utils.js（content/options/background 三端共用）
import '../shared/text-utils.js';

const { normalizeQuestionType } = globalThis.QuizHelperTextUtils;
const { getMessage } = globalThis.QuizHelperI18n;

export { normalizeQuestionType };

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

/**
 * 从 AI 返回文本中提取题目数据
 * 探测顺序：直接 JSON.parse 命中（数组或含 questions 的对象）→ 正则抠出 [...] → 正则抠出 {...}
 * @param {string} cleaned - 已剥离 markdown 围栏的文本
 * @returns {{isArray: boolean, value: Array, selectors: Object|null}}
 *   isArray: 直接命中数组时为 true；命中含 questions 的对象时为 false
 *   selectors: 仅对象形式携带，其余为 null
 * @throws {Error} 无法提取到可解析的 JSON 时抛出
 */
function extractJsonResult(cleaned) {
  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) {
    return { isArray: true, value: direct, selectors: null };
  }
  if (direct && Array.isArray(direct.questions)) {
    return { isArray: false, value: direct.questions, selectors: direct.selectors || null };
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) {
      return { isArray: true, value: parsed, selectors: null };
    }
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed && Array.isArray(parsed.questions)) {
      return { isArray: false, value: parsed.questions, selectors: parsed.selectors || null };
    }
  }

  throw new Error(getMessage('bgJsonNotFound'));
}

/**
 * 解析 AI 提取题目的返回
 * @param {string} raw - AI 原始返回文本
 * @returns {{questions: Array, selectors: Object|null}}
 * @throws {Error} 无法解析时抛出
 */
export function parseExtractedQuestions(raw) {
  const cleaned = stripMarkdownFence(raw);
  const { isArray, value, selectors } = extractJsonResult(cleaned);
  return isArray
    ? { questions: value, selectors: null }
    : { questions: value, selectors };
}

/**
 * 解析题库导入的 AI 返回
 * @param {string} raw - AI 原始返回文本
 * @returns {Array} 题目数组
 * @throws {Error} 无法解析时抛出
 */
export function parseQuestionBankResult(raw) {
  const cleaned = stripMarkdownFence(raw);
  return extractJsonResult(cleaned).value;
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
