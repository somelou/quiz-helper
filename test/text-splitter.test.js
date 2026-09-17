// text-splitter 按题号/按字符分批单元测试

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitTextByQuestions } from '../src/shared/text-splitter.js';

test('splitTextByQuestions: 按题号分批不截断题目', () => {
  const text = [
    '说明：下列关于法律的表述',
    '1、第一题题干',
    'A. 选项一',
    'B. 选项二',
    '2、第二题题干',
    'C. 选项三',
    'D. 选项四'
  ].join('\n');

  const { batches, totalQuestions } = splitTextByQuestions(text, 1);

  assert.equal(totalQuestions, 2);
  assert.equal(batches.length, 2);
  // 第一批保留前置说明与第一题
  assert.ok(batches[0].includes('说明：下列关于法律的表述'));
  assert.ok(batches[0].includes('1、第一题题干'));
  // 第二批从第二题开始
  assert.ok(batches[1].includes('2、第二题题干'));
  assert.ok(!batches[1].includes('1、第一题题干'));
});

test('splitTextByQuestions: 中文全角题号分隔符可识别', () => {
  const text = ['1．甲说我是题干的延长描述内容甲说我是题干的延长描述内容', '2．乙说我是题干的延长描述内容乙说我是题干的延长描述内容'].join('\n');
  const { totalQuestions } = splitTextByQuestions(text, 10);
  assert.equal(totalQuestions, 2);
});

test('splitTextByQuestions: 无题号时按字符退化拆分并标注 0 题', () => {
  // 含换行、总长超过单块上限的段落文本（splitLongText 只能按换行切分）
  const longPara = Array.from({ length: 40 }, (_, i) => `第${i}段内容`.repeat(300)).join('\n');
  const { batches, totalQuestions } = splitTextByQuestions(longPara, 25);
  assert.equal(totalQuestions, 0);
  assert.ok(batches.length >= 2, '应拆分为多批');
});

test('splitTextByQuestions: 超短文本回退为单批', () => {
  const { batches, totalQuestions } = splitTextByQuestions('简短', 25);
  assert.equal(totalQuestions, 1);
  assert.equal(batches.length, 1);
});