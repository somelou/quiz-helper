// 题库规则解析与相似度工具单元测试
// 只测纯函数（parseQuestionBankByRules / calculateSimilarity），不触碰 chrome API 调用路径。
// 注意：静态 import 按书写顺序求值——依赖（i18n→constants→text-utils）必须先于被测模块。

import '../src/shared/i18n-utils.js';
import '../src/shared/constants.js';
import '../src/shared/text-utils.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseQuestionBankByRules, calculateSimilarity } from '../src/background/question-bank.js';

test('parseQuestionBankByRules: 识别题号/选项/答案/解析', () => {
  const text = [
    '1、下列关于法律的表述正确的是（）【单选题】',
    'A. 法律由国家制定',
    'B. 法律由社会自发形成',
    'C. 法律无强制力',
    '参考答案：A',
    '解析：法律具有国家意志性。'
  ].join('\n');

  const questions = parseQuestionBankByRules(text);

  assert.equal(questions.length, 1);
  const q = questions[0];
  assert.equal(q.type, 'single');
  assert.equal(q.id, 1);
  assert.equal(q.answer, 'A');
  assert.ok(q.analysis.includes('国家意志'));
  assert.ok(q.text.includes('下列关于法律'));
  assert.ok(q.text.includes('A. 法律由国家制定'));
});

test('parseQuestionBankByRules: 判断题型与多选辨识', () => {
  const text = [
    '1、（对）法律面前人人平等【判断题】',
    '参考答案：对',
    '2、以下哪些属于宪法原则【多选题】',
    'A. 主权在民',
    'B. 分权制衡',
    'C. 法制原则',
    'D. 以上都是',
    '答案：AB'
  ].join('\n');

  const questions = parseQuestionBankByRules(text);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, 'judge');
  assert.equal(questions[0].answer, '对');
  assert.equal(questions[1].type, 'multiple');
  assert.equal(questions[1].answer, 'AB');
});

test('parseQuestionBankByRules: 空串与无题号文本安全返回空数组', () => {
  assert.deepEqual(parseQuestionBankByRules(''), []);
  assert.deepEqual(parseQuestionBankByRules('只有一段无题号的说明文字'), []);
});

test('calculateSimilarity: 相同文本得 1，空值为 0', () => {
  assert.equal(calculateSimilarity('abc', 'abc'), 1);
  assert.equal(calculateSimilarity('', 'abc'), 0);
  assert.equal(calculateSimilarity('abc', ''), 0);
});

test('calculateSimilarity: Jaccard 字符集相似度与传入预计算 Set 一致', () => {
  const s1 = 'abcd';
  const s2 = 'abce';
  const direct = calculateSimilarity(s1, s2);
  const withSets = calculateSimilarity(s1, s2, new Set(s1.split('')), new Set(s2.split('')));
  assert.equal(withSets, direct);
  assert.ok(direct > 0 && direct < 1);
});