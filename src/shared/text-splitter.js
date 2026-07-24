/**
 * 按题目边界拆分文本，确保不截断题目。
 * 当无法识别题号时，退化为按段落+字符数拆分。
 */

// 匹配题号起始行，如 "1、", "2.", "3．", "4,"
const QUESTION_START_RE = /^\d+\s*[、，,.．]/;

// fallback：每块最大字符数
const FALLBACK_CHUNK_SIZE = 6000;

/**
 * 将题库文本按题目边界拆分为多个批次。
 * @param {string} text - 题库原文
 * @param {number} questionsPerBatch - 每批题目数，默认 25
 * @returns {{ batches: string[], totalQuestions: number }}
 *   totalQuestions: 识别到的题数，0 表示无法识别题号（Word/非结构化文本）
 */
export function splitTextByQuestions(text, questionsPerBatch = 25) {
  const raw = String(text || '');
  if (raw.length < 10) {
    return { batches: [raw], totalQuestions: 1 };
  }

  const lines = raw.split('\n');

  // 找到所有题目起始行位置
  const questionStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (QUESTION_START_RE.test(lines[i])) {
      questionStarts.push(i);
    }
  }

  // 没有识别到题号 → 退化为按字符数拆分（Word 等非结构化文本）
  if (questionStarts.length === 0) {
    return { batches: splitByChars(raw), totalQuestions: 0 };
  }

  // 构建题目区间 [startLine, endLine)
  const questionRanges = [];
  for (let i = 0; i < questionStarts.length; i++) {
    const start = questionStarts[i];
    const end = (i + 1 < questionStarts.length)
      ? questionStarts[i + 1]
      : lines.length;
    questionRanges.push({ start, end });
  }

  const totalQuestions = questionRanges.length;
  const batches = [];

  for (let i = 0; i < questionRanges.length; i += questionsPerBatch) {
    // 第一批从文本开头开始，保留可能的前置说明内容
    const isFirstBatch = i === 0;
    const batchStartLine = isFirstBatch ? 0 : questionRanges[i].start;

    const batchEndLine = (i + questionsPerBatch < questionRanges.length)
      ? questionRanges[i + questionsPerBatch].start
      : lines.length;

    if (batchStartLine < batchEndLine) {
      batches.push(lines.slice(batchStartLine, batchEndLine).join('\n'));
    }
  }

  return { batches, totalQuestions };
}

/**
 * fallback：无法识别题号时，按段落边界 + 字符数拆分。
 * 优先在双换行（段落边界）处切分，避免截断句子。
 */
function splitByChars(text) {
  const raw = String(text || '').trim();
  if (!raw) return [raw];

  // 按段落切分（双换行及以上的空白行）
  const paragraphs = raw.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  if (paragraphs.length <= 1) {
    // 只有一段，按单行+字符数切分
    return splitLongText(raw);
  }

  const batches = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;

    if (candidate.length > FALLBACK_CHUNK_SIZE && current.length > 0) {
      // 当前累积已够一档，先存
      batches.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }

  if (current) {
    // 最后一块如果还是太长，强制切分
    if (current.length > FALLBACK_CHUNK_SIZE * 1.5 && batches.length > 0) {
      splitLongText(current).forEach(b => batches.push(b));
    } else {
      batches.push(current);
    }
  }

  return batches.length > 0 ? batches : [raw];
}

/**
 * 对单段超长文本按字符数切分，尽量在换行处切断。
 */
function splitLongText(text) {
  const lines = String(text || '').split('\n');
  const batches = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > FALLBACK_CHUNK_SIZE && current.length > 0) {
      batches.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) batches.push(current);
  return batches.length > 0 ? batches : [text];
}
