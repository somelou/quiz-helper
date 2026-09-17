// llm-utils SSE 流解析单元测试
// 通过构造内存 ReadableStream 注入线数据，验证三种 API 的解析与 token 拼接

import { test } from 'node:test';
import assert from 'node:assert/strict';

// 副作用导入使 globalThis.QuizHelperLLMUtils 可用（IIFE 挂载）
await import('../src/shared/llm-utils.js');

const { parseOpenAISSE, parseAnthropicSSE, parseResponsesSSE } = globalThis.QuizHelperLLMUtils;

/**
 * 将 SSE 文本行编码为 ReadableStream reader
 * @param {string} sseText
 * @returns {ReadableStreamDefaultReader}
 */
function sseReader(sseText) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sseText);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  return stream.getReader();
}

test('parseOpenAISSE: 拼接 content 并触发 text/thinking 事件', async () => {
  const events = [];
  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"先思考"}}]}',
    'data: {"choices":[{"delta":{"content":"答"}}]}',
    'data: {"choices":[{"delta":{"content":"案A"}}]}',
    'data: [DONE]'
  ].join('\n') + '\n';

  const text = await parseOpenAISSE(sseReader(sse), (ev) => events.push(ev));

  assert.equal(text, '答案A');
  assert.deepEqual(events, [
    { type: 'thinking', content: '先思考' },
    { type: 'text', content: '答' },
    { type: 'text', content: '案A' }
  ]);
});

test('parseOpenAISSE: 含非法 JSON 行时忽略但不中断，并发出 warning 事件', async () => {
  const events = [];
  const sse = [
    'data: not-json',
    'data: {"choices":[{"delta":{"content":"好"}}]}'
  ].join('\n') + '\n';

  const text = await parseOpenAISSE(sseReader(sse), (ev) => events.push(ev));

  assert.equal(text, '好');
  assert.ok(events.some(ev => ev.type === 'warning' && ev.count >= 1), '应发出解析中断 warning');
});

test('parseOpenAISSE: [DONE] 与空行安全处理', async () => {
  const events = [];
  const text = await parseOpenAISSE(sseReader('data: [DONE]\n\n'), (ev) => events.push(ev));
  assert.equal(text, '');
  assert.deepEqual(events, []);
});

test('parseAnthropicSSE: content_block_delta 拼接文本与思考', async () => {
  const events = [];
  const sse = [
    'event: content_block_delta',
    'data: {"delta":{"thinking":"推理中"}}',
    'event: content_block_delta',
    'data: {"delta":{"text":"选择B"}}'
  ].join('\n') + '\n';

  const text = await parseAnthropicSSE(sseReader(sse), (ev) => events.push(ev));

  assert.equal(text, '选择B');
  assert.deepEqual(events, [
    { type: 'thinking', content: '推理中' },
    { type: 'text', content: '选择B' }
  ]);
});

test('parseResponsesSSE: 文本增量、搜索状态与 annotations 收集', async () => {
  const events = [];
  const sse = [
    'event: response.output_text.delta',
    'data: {"delta":"部分"}',
    'event: response.web_search_call.in_progress',
    'data: {}',
    'event: response.output_text.done',
    'data: {"annotations":[{"type":"url_citation","url":"https://a.com","title":"A"}]}'
  ].join('\n') + '\n';

  const { text, annotations } = await parseResponsesSSE(sseReader(sse), (ev) => events.push(ev));

  assert.equal(text, '部分');
  assert.deepEqual(annotations, [{ title: 'A', url: 'https://a.com' }]);
  assert.ok(events.some(ev => ev.type === 'searchStatus' && ev.status === 'searching'));
});