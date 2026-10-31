import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineSplitter, parseAnthropicLine, parseOllamaLine, parseOpenAiLine, readStream } from './stream.ts';

const bytes = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
      controller.close();
    },
  });

test('lines split across chunks are reassembled', () => {
  const s = new LineSplitter();
  assert.deepEqual(s.push('data: {"a":'), []);
  assert.deepEqual(s.push('1}\r\ndata: 2\ndata'), ['data: {"a":1}', 'data: 2']);
  assert.deepEqual(s.push(': 3\n'), ['data: 3']);
  assert.deepEqual(s.flush(), []);
});

test('OpenAI-compatible deltas: text, reasoning (both spellings), done, errors', () => {
  assert.deepEqual(parseOpenAiLine('data: {"choices":[{"delta":{"content":"Hi"}}]}'), { text: 'Hi', reasoning: undefined });
  assert.deepEqual(parseOpenAiLine('data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}'), { text: undefined, reasoning: 'hmm' });
  assert.deepEqual(parseOpenAiLine('data: {"choices":[{"delta":{"reasoning":"ok"}}]}'), { text: undefined, reasoning: 'ok' });
  assert.equal(parseOpenAiLine('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}'), null);
  assert.equal(parseOpenAiLine('data: [DONE]'), 'done');
  assert.equal(parseOpenAiLine(': keep-alive'), null);
  assert.equal(parseOpenAiLine('data: not json'), null);
  assert.throws(() => parseOpenAiLine('data: {"error":{"message":"model crashed"}}'), /model crashed/);
});

test('Ollama and Anthropic formats', () => {
  assert.deepEqual(parseOllamaLine('{"message":{"content":"yo"},"done":false}'), { text: 'yo', reasoning: undefined });
  assert.deepEqual(parseOllamaLine('{"message":{"thinking":"let me see"},"done":false}'), { text: undefined, reasoning: 'let me see' });
  assert.equal(parseOllamaLine('{"message":{"content":""},"done":true}'), 'done');
  assert.throws(() => parseOllamaLine('{"error":"model not found"}'), /model not found/);
  assert.deepEqual(parseAnthropicLine('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}'), { text: 'A' });
  assert.deepEqual(parseAnthropicLine('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"B"}}'), { reasoning: 'B' });
  assert.equal(parseAnthropicLine('data: {"type":"message_stop"}'), 'done');
  assert.equal(parseAnthropicLine('event: ping'), null);
});

test('readStream delivers pieces as they arrive and returns the whole answer', async () => {
  const seen: string[] = [];
  const stream = bytes(
    'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n\ndata: {"choices":[{"delta":{"con',
    'tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: [DONE]\n\n'
  );
  const out = await readStream(stream, 'openai', (d) => seen.push(d.text ?? `(${d.reasoning})`));
  assert.deepEqual(seen, ['(think )', 'Hel', 'lo']);
  assert.deepEqual(out, { text: 'Hello', reasoning: 'think ' });
});

test('a stream that ends without a trailing newline still yields its last event', async () => {
  const out = await readStream(bytes('{"message":{"content":"a"}}\n{"message":{"content":"b"},"done":false}'), 'ollama');
  assert.equal(out.text, 'ab');
});
