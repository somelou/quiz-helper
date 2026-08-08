import { getApiConfig, postChatCompletion } from './api-client.js';
import { buildQuestionBankPrompt } from './prompt-builder.js';
import { normalizeParsedQuestions, parseQuestionBankResult } from './json-parser.js';
import { splitTextByQuestions } from '../shared/text-splitter.js';
// 导入模式配置（并发/批大小）统一来自共享常量
import '../shared/constants.js';

const { IMPORT_MODES } = globalThis.QuizHelperConstants;

export async function handleParseQuestionBank(text, fileName) {
  try {
    const fallbackQuestions = parseQuestionBankByRules(text);
    const { apiUrl, apiKey, apiFormat, model, enableThinking, thinkingEffort } = await getApiConfig('bank');
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
        apiFormat,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        model,
        temperature: 0.1,
        enableThinking,
        thinkingEffort
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

/**
 * 分批解析题库（通过 port 上报进度）
 * @param {string} text - 题库文本
 * @param {string} fileName - 文件名
 * @param {chrome.runtime.Port} port - 通信端口
 */
export async function handleParseQuestionBankBatched(text, fileName, port) {
  const sendProgress = (current, total, totalQuestions, message) => {
    try {
      port.postMessage({ type: 'progress', current, total, totalQuestions, message });
    } catch (_) {
      // 端口已断开，忽略
    }
  };

  const sendResult = (result) => {
    try {
      port.postMessage({ type: 'result', ...result });
    } catch (_) {
      // 端口已断开，忽略
    }
  };

  try {
    // 读取导入模式，映射并发数和每批题数
    const modeConfig = await chrome.storage.local.get(['import_mode']);
    const mode = IMPORT_MODES[modeConfig.import_mode] || IMPORT_MODES.balanced;
    const CONCURRENCY = mode.concurrency;
    const batchSize = mode.batchSize;

    // 拆分为批次
    const { batches, totalQuestions } = splitTextByQuestions(text, batchSize);
    const totalBatches = batches.length;

    // 本地规则全量解析作为全局 fallback
    const allFallbackQuestions = parseQuestionBankByRules(text);

    const { apiUrl, apiKey, apiFormat, model, enableThinking, thinkingEffort } = await getApiConfig('bank');

    if (!apiKey) {
      if (allFallbackQuestions.length > 0) {
        sendResult({ success: true, questions: allFallbackQuestions });
      } else {
        sendResult({ success: false, error: '未配置 API Key，请先在设置页面配置' });
      }
      return;
    }

    // 构建初始进度消息
    const countLabel = totalQuestions > 0 ? `共 ${totalQuestions} 题` : '';
    const batchLabel = totalBatches > 1 ? `分 ${totalBatches} 批` : '';
    const concurrencyLabel = totalBatches > 1 ? `并发 ${CONCURRENCY}` : '';
    const desc = [countLabel, batchLabel, concurrencyLabel].filter(Boolean).join('，');
    sendProgress(0, totalBatches, totalQuestions,
      `正在解析题库${desc ? `（${desc}）` : ''}...`);

    const allQuestions = [];
    const parseErrors = [];

    let completed = 0;
    let nextIndex = 0;
    let inFlight = 0;
    let cancelled = false;

    // AbortController 用于取消所有进行中的请求
    const abortController = new AbortController();

    // 监听端口断开（用户点击取消或关闭页面）
    port.onDisconnect.addListener(() => {
      cancelled = true;
      abortController.abort();
    });

    await new Promise((resolve) => {
      /**
       * 单批 AI 解析（首次失败且未取消时重试 1 次，应对限流/抖动）
       * @param {number} i - 批次下标
       * @returns {Promise<string>} AI 原始返回
       */
      async function parseBatchWithRetry(i) {
        const attempt = async () => {
          const prompt = await buildQuestionBankPrompt(batches[i], fileName);
          return postChatCompletion({
            apiKey, apiUrl, apiFormat,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ],
            model,
            temperature: 0.1,
            signal: abortController.signal,
            enableThinking,
            thinkingEffort
          });
        };
        try {
          return await attempt();
        } catch (firstError) {
          if (cancelled) throw firstError;
          // 退避 1s 后重试一次（退避期间可能被取消，需复查）
          await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
          if (cancelled) throw firstError;
          return attempt();
        }
      }

      function runNext() {
        if (cancelled) {
          if (inFlight === 0) resolve();
          return;
        }
        while (inFlight < CONCURRENCY && nextIndex < batches.length && !cancelled) {
          const i = nextIndex++;
          inFlight++;

          (async () => {
            let batchSuccess = false;
            try {
              const raw = await parseBatchWithRetry(i);
              const questions = normalizeParsedQuestions(parseQuestionBankResult(raw));
              if (questions.length > 0) {
                allQuestions.push(...questions);
                batchSuccess = true;
              }
            } catch (error) {
              if (cancelled) {
                parseErrors.push(`第 ${i + 1} 批已取消`);
              } else {
                parseErrors.push(`第 ${i + 1} 批 AI 解析失败: ${error.message}`);
              }
            }

            // AI 解析失败或返回空，使用本批的本地规则解析兜底
            if (!batchSuccess && !cancelled) {
              try {
                const fallback = parseQuestionBankByRules(batches[i]);
                if (fallback.length > 0) {
                  allQuestions.push(...fallback);
                }
              } catch (_) {
                // 本批彻底失败，跳过
              }
            }

            completed++;
            inFlight--;

            if (!cancelled) {
              const concurrentInfo = inFlight > 0 ? `（进行中 ${inFlight}）` : '';
              sendProgress(completed, totalBatches, totalQuestions,
                `正在 AI 解析第 ${completed}/${totalBatches} 批${concurrentInfo}`);
            }

            if (cancelled && inFlight === 0) {
              resolve();
            } else if (completed >= batches.length) {
              resolve();
            } else {
              runNext();
            }
          })();
        }
      }
      runNext();
    });

    // 去重（按题号 id）
    const deduped = deduplicateQuestions(allQuestions);

    if (cancelled) {
      if (deduped.length > 0) {
        sendResult({
          success: true,
          questions: deduped,
          cancelled: true,
          warnings: [`解析已取消，已获取 ${deduped.length} 道题目（共 ${completed}/${totalBatches} 批）`]
        });
      } else {
        sendResult({ success: false, error: '解析已取消', cancelled: true });
      }
      return;
    }

    if (deduped.length === 0) {
      if (allFallbackQuestions.length > 0) {
        sendResult({
          success: true,
          questions: allFallbackQuestions,
          warnings: parseErrors.length > 0
            ? ['部分批次 AI 解析失败，已使用本地规则解析']
            : []
        });
      } else {
        sendResult({ success: false, error: 'AI 未解析到有效题目' });
      }
      return;
    }

    sendResult({
      success: true,
      questions: deduped,
      totalBatches,
      warnings: parseErrors.length > 0
        ? [`共 ${parseErrors.length} 批 AI 解析失败，已用本地规则解析兜底`]
        : []
    });
  } catch (error) {
    sendResult({ success: false, error: '解析过程出错：' + error.message });
  }
}

/**
 * 题目去重（按 id 保留首次出现）
 */
function deduplicateQuestions(questions) {
  const seen = new Set();
  return questions.filter(q => {
    const key = q.id != null ? String(q.id) : q.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ===== 题库搜索索引（SW 内存级缓存） =====
// 高可用策略：缓存仅用于加速，签名不一致/缓存丢失/超限时回退实时构建，不影响正确性；
// SW 随时可能被回收，缓存丢失后下次调用自动重建。

// 内存保护：索引条目（题目）超过该数量时不缓存，避免大库拖垮 SW
const MAX_INDEX_ENTRIES = 3000;

let searchBankIndexCache = null; // { key: string, entries: Array }

/**
 * 筛选激活状态的题库
 * @param {Array} banks - 全部题库
 * @param {Array} activeBankIds - 激活题库 id 列表
 * @returns {Array} 激活题库
 */
function getActiveBanks(banks, activeBankIds) {
  return banks.filter(bank => activeBankIds.includes(bank.id));
}

/**
 * 生成激活题库的签名（id + 题数），storage 变更会自动改变签名使缓存失效
 */
function buildSearchBankKey(banks, activeBankIds) {
  return getActiveBanks(banks, activeBankIds)
    .map(bank => `${bank.id}:${bank.questions ? bank.questions.length : 0}`)
    .join('|');
}

/**
 * 构建规范化题目索引（每题含规范化文本、字符集、来源库名）
 */
function buildSearchBankIndex(banks, activeBankIds) {
  const entries = [];
  for (const activeBank of getActiveBanks(banks, activeBankIds)) {
    if (!activeBank.questions || activeBank.questions.length === 0) continue;
    for (const question of activeBank.questions) {
      const normalized = question.text.toLowerCase().replace(/\s+/g, '');
      entries.push({
        question,
        normalized,
        charSet: normalized ? new Set(normalized.split('')) : new Set(),
        source: activeBank.name
      });
    }
  }
  return entries;
}

/**
 * 获取题库索引：优先复用内存缓存，缓存不可用时实时构建
 */
function getSearchBankIndex(banks, activeBankIds) {
  const key = buildSearchBankKey(banks, activeBankIds);
  // 缓存仅在条目数不超过 MAX_INDEX_ENTRIES 时写入，命中即复用
  if (searchBankIndexCache && searchBankIndexCache.key === key) {
    return searchBankIndexCache.entries;
  }
  const entries = buildSearchBankIndex(banks, activeBankIds);
  searchBankIndexCache = entries.length <= MAX_INDEX_ENTRIES ? { key, entries } : null;
  return entries;
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
  const searchCharSet = searchText ? new Set(searchText.split('')) : new Set();
  const allMatches = [];

  // 预计算/缓存题库索引（规范化文本 + 字符集），避免逐题重复计算
  const indexEntries = getSearchBankIndex(banks, activeBankIds);

  for (const { question, normalized, charSet, source } of indexEntries) {
    const score = calculateSimilarity(searchText, normalized, searchCharSet, charSet);

    if (score >= 0.6) {
      allMatches.push({
        answer: question.answer,
        analysis: question.analysis || '',
        questionId: question.id,
        questionText: question.text,
        score: Math.round(score * 100) / 100,
        source
      });
    }
  }

  allMatches.sort((a, b) => b.score - a.score);
  const topMatches = allMatches.slice(0, 3);
  return topMatches.length > 0
    ? { success: true, found: true, matches: topMatches }
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

// 题号起始行匹配（如 "1、", "2.", "3．", "4,"），捕获组为题号
const QUESTION_START_RE = /^(\d+)\s*[、，,.．]/;

function isQuestionStartLine(line) {
  return QUESTION_START_RE.test(line);
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
  const idMatch = line.match(QUESTION_START_RE);
  const id = idMatch ? Number(idMatch[1]) : '';
  const answer = extractAnswerFromText(line);
  const type = inferQuestionType(line, answer);
  let text = line.replace(QUESTION_START_RE, '').trim();

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

/**
 * 计算两个规范化文本的字符集 Jaccard 相似度
 * 支持传入预计算的字符集，避免重复 split/建 Set
 * @param {string} s1
 * @param {string} s2
 * @param {Set} [set1] - s1 的预计算字符集
 * @param {Set} [set2] - s2 的预计算字符集
 * @returns {number}
 */
function calculateSimilarity(s1, s2, set1 = null, set2 = null) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const a = set1 || new Set(s1.split(''));
  const b = set2 || new Set(s2.split(''));
  const intersection = [...a].filter(char => b.has(char)).length;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
