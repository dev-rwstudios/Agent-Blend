import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicContent, geminiParts, isNoVisionError, ollamaImages, openAiContent, parseDataUrl } from './vision.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQ';

test('data URLs are parsed and junk is rejected', () => {
  assert.deepEqual(parseDataUrl(PNG), { mime: 'image/png', base64: 'iVBORw0KGgo=' });
  assert.equal(parseDataUrl('data:text/plain;base64,aGk='), null);
  assert.equal(parseDataUrl('https://example.com/a.png'), null);
  assert.equal(parseDataUrl(''), null);
});

test('each provider gets the shape it expects, images first', () => {
  assert.equal(openAiContent('hi', []), 'hi', 'no images → plain text, nothing changes for text-only models');
  assert.deepEqual(openAiContent('hi', [PNG, JPG]), [
    { type: 'image_url', image_url: { url: PNG } }, { type: 'image_url', image_url: { url: JPG } }, { type: 'text', text: 'hi' },
  ]);
  assert.deepEqual(anthropicContent('hi', [JPG]), [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } }, { type: 'text', text: 'hi' }]);
  assert.equal(anthropicContent('hi', []), 'hi');
  assert.deepEqual(geminiParts('hi', [PNG]), [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }, { text: 'hi' }]);
  assert.deepEqual(ollamaImages([PNG, 'nope']), ['iVBORw0KGgo='], 'invalid entries are dropped');
});

test('"model can\'t see" errors are recognised', () => {
  for (const m of ['Model does not support image input', 'vision is not supported', 'this model is not multimodal', 'Invalid content type: image_url']) assert.ok(isNoVisionError(m), m);
  assert.ok(!isNoVisionError('connection refused'));
});
