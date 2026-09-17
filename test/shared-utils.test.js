// 共享工具单元测试：题型归一化 / URL 匹配 / 种子规则合并
// 静态 import 按书写顺序求值：依赖（i18n→constants→text-utils→parse-rule-utils）先于断言。

import '../src/shared/i18n-utils.js';
import '../src/shared/constants.js';
import '../src/shared/text-utils.js';
import '../src/shared/parse-rule-utils.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeQuestionType, matchesUrlPattern, isDomainMatch } = globalThis.QuizHelperTextUtils;
const { mergeSeedRuleInto, applySeedRule } = globalThis.QuizHelperParseRuleUtils;

test('normalizeQuestionType: 中文与英文题型均可归一化', () => {
  assert.equal(normalizeQuestionType('单选'), 'single');
  assert.equal(normalizeQuestionType('多选'), 'multiple');
  assert.equal(normalizeQuestionType('判断'), 'judge');
  assert.equal(normalizeQuestionType('填空'), 'fill');
  assert.equal(normalizeQuestionType('single choice'), 'single');
  assert.equal(normalizeQuestionType('multiple-select'), 'multiple');
  assert.equal(normalizeQuestionType('true_false'), 'judge');
  assert.equal(normalizeQuestionType('未知题型'), 'unknown');
});

test('matchesUrlPattern: 支持 all_urls / 协议 / 子域名 / 路径通配', () => {
  assert.equal(matchesUrlPattern('https://a.com/page', '<all_urls>'), true);
  assert.equal(matchesUrlPattern('https://a.com/page', 'https://*.a.com/*'), true);
  assert.equal(matchesUrlPattern('https://sub.a.com/page', 'https://*.a.com/*'), true);
  assert.equal(matchesUrlPattern('https://b.com/page', 'https://*.a.com/*'), false);
  assert.equal(matchesUrlPattern('http://a.com/x', 'https://a.com/*'), false);
  assert.equal(matchesUrlPattern('https://a.com/api', 'https://a.com/*'), true);
  assert.equal(matchesUrlPattern('https://a.com', 'https://a.com/'), true);
  assert.equal(matchesUrlPattern('', 'https://a.com/*'), false);
});

test('isDomainMatch: 精确与子域名匹配，空值不匹配', () => {
  assert.equal(isDomainMatch('a.com', 'a.com'), true);
  assert.equal(isDomainMatch('sub.a.com', 'a.com'), true);
  assert.equal(isDomainMatch('b.com', 'a.com'), false);
  assert.equal(isDomainMatch('', 'a.com'), false);
});

test('mergeSeedRuleInto: 保留用户字段，仅补齐缺失的种子字段', () => {
  const existing = {
    id: 'default-example',
    domain: 'example.com',
    name: '我的规则',
    selectors: {
      questionItemSelector: '.my-item',
      typeIndicators: { single: ['mySingle'] }
    },
    typeKeywords: { single: ['单选'] }
  };
  const seed = {
    id: 'default-example',
    domain: 'example.com',
    name: '默认规则',
    selectors: {
      questionItemSelector: '.default-item',
      typeIndicators: { single: ['defaultSingle'], multiple: ['defaultMulti'] },
      optionItemSelector: 'dd'
    },
    typeKeywords: { single: ['单选'], multiple: ['多选'] }
  };

  const merged = mergeSeedRuleInto(existing, seed);

  // 用户自定义值优先
  assert.equal(merged.name, '我的规则');
  assert.equal(merged.selectors.questionItemSelector, '.my-item');
  assert.equal(merged.typeKeywords.single[0], '单选');
  // 缺失字段由种子补齐
  assert.equal(merged.selectors.typeIndicators.multiple[0], 'defaultMulti');
  assert.equal(merged.selectors.optionItemSelector, 'dd');
  // typeIndicators 同 key 由用户覆盖（与既有实现语义一致：浅合并）
  assert.deepEqual(merged.selectors.typeIndicators.single, ['mySingle']);
});

test('applySeedRule: 存在同 id 合并，不存在则推送', () => {
  const existing = [{ id: 'a', name: 'A' }];
  const merged = applySeedRule(existing, { id: 'a', name: 'A2', selectors: { optionItemSelector: 'dd' } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'A'); // 用户覆盖种子
  assert.equal(merged[0].selectors.optionItemSelector, 'dd');

  const appended = applySeedRule(existing, { id: 'b', name: 'B' });
  assert.equal(appended.length, 2);
  assert.equal(appended[1].name, 'B');
  // 不原地修改入参数组
  assert.equal(existing.length, 1);
});