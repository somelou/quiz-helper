import { getApiConfig, postChatCompletion } from './api-client.js';
import { buildQuestionBankPrompt } from './prompt-builder.js';
import { normalizeParsedQuestions, normalizeQuestionType, parseQuestionBankResult } from './json-parser.js';

export async function handleParseQuestionBank(text, fileName) {
  try {
    const fallbackQuestions = parseQuestionBankByRules(text);
    const { apiUrl, apiKey, model } = await getApiConfig();

    if (!apiKey) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: '未配置 API Key，请先在设置页面配置' };
    }

    try {
      const prompt = await buildQuestionBankPrompt(text, fileName);
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
      const questions = normalizeParsedQuestions(parseQuestionBankResult(raw));
      if (questions.length > 0) {
        return { success: true, questions };
      }
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: 'AI 未解析到有效题目' };
    } catch (error) {
      if (fallbackQuestions.length > 0) {
        return { success: true, questions: fallbackQuestions };
      }
      return { success: false, error: error.message };
    }
  } catch (error) {
    return { success: false, error: '解析过程出错：' + error.message };
  }
}

export async function handleSearchQuestionBank(questionText) {
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

    for (const question of activeBank.questions) {
      const bankText = question.text.toLowerCase().replace(/\s+/g, '');
      const score = calculateSimilarity(searchText, bankText);

      if (score >= 0.6) {
        allMatches.push({
          answer: question.answer,
          analysis: question.analysis || '',
          questionId: question.id,
          questionText: question.text,
          score: Math.round(score * 100) / 100,
          source: activeBank.name
        });
      }
    }
  }

  allMatches.sort((a, b) => b.score - a.score);
  return allMatches.length > 0
    ? { success: true, found: true, matches: allMatches }
    : { success: true, found: false, matches: [] };
}

function getActiveBankIds(result, banks) {
  const bankIds = new Set((banks || []).map(bank => bank.id));
  let activeIds = Array.isArray(result.active_bank_ids) ? result.active_bank_ids : [];
  if (activeIds.length === 0 && result.active_bank_id) {
    activeIds = [result.active_bank_id];
  }
  return [...new Set(activeIds.filter(id => bankIds.has(id)))];
}

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
  if (inlineMatch) return normalizeAnswer(inlineMatch[1]);

  const labelMatch = String(text || '').match(/(?:参考答案|正确答案|答案)[：:]\s*([A-H]{1,8}|对|错|正确|错误)/i);
  if (labelMatch) return normalizeAnswer(labelMatch[1]);

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

function calculateSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = [...set1].filter(char => set2.has(char)).length;
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
