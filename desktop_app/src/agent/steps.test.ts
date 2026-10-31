import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_STEPS, STEPS_SCHEMA, extractCode, makeFixStep, normalizeSteps } from './steps.ts';
import { asciiViews, describeIssues, describeState, foreignLine } from './sceneView.ts';
import type { SceneState } from './sceneView.ts';
import * as prompts from './prompts.ts';

// ------------------------------------------------------------------ step plan

test('a step plan is cleaned, deduplicated and capped', () => {
  const { plan, errors, notes } = normalizeSteps({
    summary: 'x'.repeat(500),
    steps: [
      { id: 'a', title: 'Ground', goal: 'A flat 40 m ground', done_when: ['ground exists', '', 5, 'x'.repeat(500)] },
      { id: 'a', title: 'Ground again', goal: 'More ground' },
      { title: '', goal: '' },
      { goal: 'Only a goal, no title' },
      ...Array.from({ length: 20 }, (_, n) => ({ title: `Step ${n}`, goal: 'g' })),
    ],
  });
  assert.deepEqual(errors, []);
  assert.equal(plan.steps.length, MAX_STEPS);
  assert.equal(new Set(plan.steps.map((s) => s.id)).size, plan.steps.length, 'ids are unique');
  assert.equal(plan.summary.length, 160);
  assert.deepEqual(plan.steps[0].done_when.length, 2, 'blank and non-string checks are dropped');
  assert.ok(plan.steps[0].done_when[1].length <= 220);
  assert.ok(plan.steps.every((s) => s.status === 'pending' && s.attempts === 0));
  assert.ok(notes.some((n) => /Skipped a step/.test(n)) && notes.some((n) => /first 12/.test(n)));
});

test('a plan with no usable steps is an error, not a crash', () => {
  assert.ok(normalizeSteps(null).errors.length);
  assert.ok(normalizeSteps({ steps: [] }).errors.length);
  assert.ok(normalizeSteps({ steps: 'nope' }).errors.length);
});

test('review fix steps get fresh ids', () => {
  const existing = normalizeSteps({ steps: [{ id: 'detail', title: 'Detail', goal: 'g' }] }).plan.steps;
  const fix = makeFixStep({ id: 'detail', title: 'Detail', goal: 'more' }, existing);
  assert.equal(fix?.id, 'detail_2');
  assert.equal(makeFixStep({ title: '' }, existing), null);
});

test('the step schema is serialisable and requires only what is needed', () => {
  assert.doesNotThrow(() => JSON.stringify(STEPS_SCHEMA));
  assert.deepEqual((STEPS_SCHEMA.schema as any).required, ['summary', 'steps']);
});

test('code is pulled out of a model reply however it is fenced', () => {
  assert.equal(extractCode('Sure!\n```python\nab.box("a", (1,1,1))\n```\nDone.'), 'ab.box("a", (1,1,1))');
  assert.equal(extractCode('```\nx = 1\n```'), 'x = 1');
  assert.equal(extractCode('```py\ny = 2'), 'y = 2', 'an unclosed fence (model hit its token limit) still yields the code');
  assert.equal(extractCode('  z = 3  '), 'z = 3');
  assert.equal(extractCode('```python\na = 1\n```\n```python\nb = 2\n```'), 'a = 1', 'first block wins');
});

// ------------------------------------------------------------------ what the model sees

const STATE: SceneState = {
  unit_count: 3,
  truncated: false,
  bounds: { min: [-10, -10, 0], max: [10, 10, 8] },
  foreign: { count: 2, bbox_min: [20, 0, 0], bbox_max: [24, 4, 2] },
  issues: [{ code: 'floating', object: 'Lamp', message: 'Lamp has nothing underneath it (bottom at z=5.00)' }],
  objects: [
    { name: 'Ground', type: 'MESH', bbox_min: [-10, -10, 0], bbox_max: [10, 10, 0], step: 's1' },
    { name: 'Tower', type: 'MESH', bbox_min: [-1, -1, 0], bbox_max: [1, 1, 8], step: 's2' },
    { name: 'Post', type: 'MESH', count: 40, bbox_min: [-9, -9, 0], bbox_max: [9, 9, 1], each_size: [0.2, 0.2, 1], step: 's3' },
  ],
};

test('the scene table lists every object with extents, sizes and its step', () => {
  const text = describeState(STATE);
  assert.match(text, /SCENE BOUNDS x -10\.0\.\.10\.0/);
  assert.match(text, /^"Tower" \[MESH\] x -1\.0\.\.1\.0, y -1\.0\.\.1\.0, z 0\.0\.\.8\.0 · 2\.0×2\.0×8\.0 m · s2 · view letter B/m, 'the exact name is quoted and starts the line');
  assert.match(text, /"Post" ×40 .* each 0\.2×0\.2×1\.0 m/, 'a family of copies is one row');
  assert.ok(!/^[A-Za-z0-9] "?Tower/m.test(text), 'no letter prefix that a model could copy into a name');
  assert.equal(describeState({ ...STATE, objects: [], unit_count: 0 }), 'Nothing has been built yet.');
});

test('the ASCII views draw each object under its letter, in proportion', () => {
  const views = asciiViews(STATE);
  assert.match(views, /TOP VIEW/);
  assert.match(views, /FRONT VIEW/);
  const topRows = views.split('\n').filter((l) => /^\|.*\|$/.test(l));
  assert.ok(topRows.length > 10);
  assert.equal(new Set(topRows.slice(0, 12).map((l) => l.length)).size, 1, 'the grid is a rectangle');
  assert.ok(views.includes('B'), 'the tower (second row) is drawn as B');
  // The tower is tall in the front view: its letter appears on many rows there.
  const front = views.slice(views.indexOf('FRONT VIEW')).split('\n').filter((l) => l.includes('B'));
  assert.ok(front.length >= 6, `tower spans many rows of the front view (${front.length})`);
  assert.equal(asciiViews({ ...STATE, objects: [] }), '');
});

test('existing objects and problems are described plainly', () => {
  assert.match(foreignLine(STATE), /EXISTING OBJECTS .*never modify.*x 20\.0\.\.24\.0/);
  assert.equal(foreignLine({ ...STATE, foreign: { count: 0 } }), '');
  assert.match(describeIssues(STATE.issues), /\[floating\] Lamp has nothing underneath/);
  assert.equal(describeIssues(STATE.issues, new Set(['Other'])), 'none', 'filtered to the step\'s own objects');
});

// ------------------------------------------------------------------ the prompt can't drift from the toolkit

function pythonToolkitFunctions(): string[] {
  const src = readFileSync(new URL('../../../addon/toolkit.py', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('class Toolkit'));
  return [...body.matchAll(/^    def ([a-z][a-z0-9_]*)\(/gm)].map((m) => m[1]).filter((n) => !n.startsWith('_'));
}

test('every toolkit function is documented in the prompt, and nothing else is', () => {
  const documented = [...prompts.TOOLKIT_REFERENCE.matchAll(/^ab\.([a-z_]+)\(/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(documented)].sort(), pythonToolkitFunctions().sort());
});

test('the general-engine prompts never name a kind of scene', () => {
  const general = [prompts.CODE_SYSTEM, prompts.STEPS_PLAN_SYSTEM, prompts.CHECK_SYSTEM, prompts.SCENE_REVIEW_SYSTEM, prompts.TOOLKIT_REFERENCE, prompts.REFERENCE_SYSTEM, prompts.COMPARE_SYSTEM].join('\n').toLowerCase();
  const banned = ['house', 'kitchen', 'bedroom', 'living room', 'forest', 'tunnel', 'desert', 'airplane', 'aircraft', 'furniture', 'sofa', 'tree', 'castle', 'city'];
  for (const word of banned) assert.ok(!new RegExp(`\\b${word}\\b`).test(general), `"${word}" appears in a general-engine prompt`);
});

// ------------------------------------------------------------------ reference images

import { NEEDS_VISION, compareStage, parseKeyFeatures, referenceStage } from './reference.ts';
import type { AgentDeps, BuildRun } from './buildAgent.ts';

const blankRun = (): BuildRun => ({ id: 'r', request: 'x', status: 'running', steps: [], log: [], thinking: '', criteria: [], verdicts: [], checklist: [], issues: [], rounds: 0, images: [] });
const hooks = () => {
  const calls: string[] = [];
  return { calls, h: { step: (k: string, s: string, d?: string) => calls.push(`${k}:${s}${d ? `:${d}` : ''}`), log: () => undefined, emitSoon: () => undefined, checkStop: () => undefined } as any };
};
const IMG = 'data:image/jpeg;base64,/9j/4AAQ';
const baseDeps = (over: Partial<AgentDeps>): AgentDeps => ({ llm: async () => '', blender: async () => ({}), ...over });

test('key features are read from the end of the analysis', () => {
  assert.deepEqual(parseKeyFeatures('prose\n\nKEY FEATURES:\n- a tall narrow structure\n* two windows\n3. warm light'), ['a tall narrow structure', 'two windows', 'warm light']);
  assert.deepEqual(parseKeyFeatures('no list'), []);
});

test('an attached image with no vision model stops the run with a clear message', async () => {
  const run = blankRun();
  const { h, calls } = hooks();
  await assert.rejects(() => referenceStage(baseDeps({}), { request: 'build this', reference: { images: [IMG] } }, run, h), (e: Error) => e.message === NEEDS_VISION);
  assert.equal(run.reference?.error, NEEDS_VISION);
  assert.ok(calls.some((c) => c.startsWith('reference:failed')));
});

test('the reference is read once, streamed, and its images go only to the vision model', async () => {
  const run = blankRun();
  const { h, calls } = hooks();
  const seen: any[] = [];
  const vision: AgentDeps['vision'] = async (messages, o) => {
    seen.push(messages);
    for (const w of ['A wide ', 'view.\n\nKEY FEATURES:\n- a long low shape\n- warm side light']) o.onToken?.({ text: w });
    return 'A wide view.\n\nKEY FEATURES:\n- a long low shape\n- warm side light';
  };
  await referenceStage(baseDeps({ vision }), { request: 'build this', reference: { images: [IMG] } }, run, h);
  assert.equal(run.reference?.text, 'A wide view.\n\nKEY FEATURES:\n- a long low shape\n- warm side light');
  assert.deepEqual(seen[0][1].images, [IMG], 'the picture is attached to the vision request');
  assert.ok(calls.includes('reference:done:2 key features'));

  const again = blankRun();
  let called = false;
  await referenceStage(baseDeps({ vision: async () => ((called = true), '') }), { request: 'x', reference: { images: [IMG], text: 'already read' } }, again, hooks().h);
  assert.equal(called, false, 'an analysed reference is not sent to the model again');
  assert.equal(again.reference?.text, 'already read');
});

test('a vision failure surfaces as the run\'s error, with the reason', async () => {
  const { h } = hooks();
  const run = blankRun();
  const vision: AgentDeps['vision'] = async () => {
    throw new Error('This model can\'t read images.');
  };
  await assert.rejects(() => referenceStage(baseDeps({ vision }), { request: 'x', reference: { images: [IMG] } }, run, h), /can't read images/);
  assert.match(run.reference?.error ?? '', /can't read images/);
});

test('comparison returns differences and fix steps, and never breaks the build when it fails', async () => {
  const run = blankRun();
  run.reference = { images: [IMG], text: 'a wide view' };
  const sent: any[] = [];
  const vision: AgentDeps['vision'] = async (messages) => {
    sent.push(messages[1]);
    return JSON.stringify({ similarity: 6.5, matches: ['layout'], differences: ['the roof should be red', 'too few windows'], fix_steps: [{ title: 'Recolor roof', goal: 'Make the roof red', done_when: ['roof is red'] }] });
  };
  const r1 = 'data:image/png;base64,AAAA', r2 = 'data:image/png;base64,BBBB';
  const result = await compareStage(baseDeps({ vision }), { request: 'x' }, run, [r1, r2], 'state', () => undefined);
  assert.equal(result.similarity, 6.5);
  assert.deepEqual(result.differences.length, 2);
  assert.equal(result.fix_steps.length, 1);
  assert.deepEqual(sent[0].images, [IMG, r1, r2], 'the reference comes first, then the renders');
  assert.equal(run.reference.similarity, 6.5);

  const failing: AgentDeps['vision'] = async () => 'not json at all';
  const none = await compareStage(baseDeps({ vision: failing }), { request: 'x' }, run, [r1], 's', () => undefined);
  assert.deepEqual(none, { similarity: null, differences: [], fix_steps: [] });
  assert.deepEqual(await compareStage(baseDeps({}), { request: 'x' }, run, [r1], 's', () => undefined), { similarity: null, differences: [], fix_steps: [] }, 'no vision model → just no comparison');
});

// ------------------------------------------------------------------ regressions from a real run

import { runScene, referenceDigest } from './stepAgent.ts';
import { thinkStage } from './buildAgent.ts';

const EMPTY_STATE = { unit_count: 0, objects: [], truncated: false, bounds: null, foreign: { count: 0 }, issues: [] };
const fakeBlender = (calls: string[]) => async (command: string) => {
  calls.push(command);
  if (command === 'scene_state') return EMPTY_STATE;
  if (command === 'run_step') return { ok: true, output: '', error: null, error_line: null, created: ['A'], created_count: 1, touched_foreign: [] };
  return {};
};

test('one empty model reply is a failed attempt that is retried, not the end of the run', async () => {
  let codeCalls = 0;
  const codePrompts: string[] = [];
  const llm: AgentDeps['llm'] = async (messages) => {
    const sys = messages[0].content;
    if (sys.includes('thinking step')) return 'Plan to build a thing.\n\nSUCCESS CRITERIA:\n- the thing exists';
    if (sys.includes('Choose how to build')) return '{"method":"construct"}';
    if (sys.includes('planning step')) return JSON.stringify({ summary: 'Thing', steps: [{ title: 'Make the thing', goal: 'Build the thing', done_when: ['it exists'] }] });
    if (sys.includes('You write Python')) {
      codePrompts.push(messages[1].content);
      if (++codeCalls === 1) throw new Error('The model returned an empty reply.');
      return '```python\nab.box("A", (1,1,1))\n```';
    }
    if (sys.includes('skeptical checker')) return '{"status":"pass","problems":[],"hint":""}';
    return '{"criteria":[{"n":1,"status":"met"}],"fix_steps":[]}';
  };
  const calls: string[] = [];
  const run = await runScene({ llm, blender: fakeBlender(calls) as any }, { request: 'make a thing', catalog: [] });
  assert.equal(run.status, 'done', run.error);
  assert.equal(run.work?.[0].status, 'passed');
  assert.equal(run.work?.[0].attempts, 2, 'the second attempt succeeded');
  assert.ok(run.log.some((l) => /no usable answer/.test(l)));
  assert.match(codePrompts[1], /You gave no usable answer/, 'the retry tells the model what went wrong');
});

test('an unreachable model server still aborts instead of retrying forever', async () => {
  const llm: AgentDeps['llm'] = async (messages) => {
    const sys = messages[0].content;
    if (sys.includes('thinking step')) return 'x\n\nSUCCESS CRITERIA:\n- a thing';
    if (sys.includes('Choose how to build')) return '{"method":"construct"}';
    if (sys.includes('planning step')) return JSON.stringify({ summary: 'T', steps: [{ title: 'S', goal: 'g' }] });
    throw new Error('Cannot reach http://x/v1 — is the server running and the URL correct?');
  };
  const run = await runScene({ llm, blender: fakeBlender([]) as any }, { request: 'x', catalog: [] });
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /Cannot reach/);
});

test('a reasoning model\'s chain of thought is kept out of the design thinking', async () => {
  const run = blankRun();
  const llm: AgentDeps['llm'] = async (_m, o) => {
    o.onToken?.({ reasoning: 'Hmm, I do not have the image, let me guess... ' });
    o.onToken?.({ text: 'A scene with two facing seats.\n\nSUCCESS CRITERIA:\n- two seats face each other' });
    return 'A scene with two facing seats.\n\nSUCCESS CRITERIA:\n- two seats face each other';
  };
  await thinkStage(baseDeps({ llm }), { request: 'x', catalog: [] } as any, run, hooks().h);
  assert.equal(run.thinking.includes('I do not have the image'), false, 'chain of thought is not design thinking');
  assert.match(run.reasoning ?? '', /I do not have the image/, 'but it is kept so the user can read it');
  assert.deepEqual(run.criteria, ['two seats face each other']);
});

test('the code writer is told what the reference image shows, and the think prompt says the picture was already seen', async () => {
  const text = 'A symmetrical room with two long sofas facing each other.\n\nKEY FEATURES:\n- two identical sofas face each other\n- marble wall behind the TV';
  const digest = referenceDigest(text);
  assert.match(digest, /two long sofas/);
  assert.match(digest, /Key features:\n- two identical sofas face each other/);

  let thinkPrompt = '';
  const run = blankRun();
  run.reference = { images: [IMG], text };
  await thinkStage(baseDeps({ llm: async (m) => ((thinkPrompt = m[1].content), 'x\n\nSUCCESS CRITERIA:\n- a thing') }), { request: 'build a scene like this', catalog: [] } as any, run, hooks().h);
  assert.match(thinkPrompt, /A vision model has already looked at it/);
  assert.match(thinkPrompt, /do not say you cannot see the image/i);
  assert.ok(thinkPrompt.includes('two long sofas facing each other'));
});

test('inline <think> blocks are split from the answer, whichever way the model wrote them', async () => {
  const { splitThinkTags } = await import('./plan.ts');
  assert.deepEqual(splitThinkTags('<think>hmm no image</think>The plan.'), { answer: 'The plan.', reasoning: 'hmm no image' });
  assert.deepEqual(splitThinkTags('a<think>x</think>b<think>y</think>c'), { answer: 'abc', reasoning: 'xy' });
  assert.deepEqual(splitThinkTags('Answer first <think>never closed'), { answer: 'Answer first', reasoning: 'never closed' });
  assert.deepEqual(splitThinkTags('reasoning without an opening tag</think>The real answer'), { answer: 'The real answer', reasoning: 'reasoning without an opening tag' });
  assert.deepEqual(splitThinkTags('no tags at all'), { answer: 'no tags at all', reasoning: '' });

  const run = blankRun();
  const llm: AgentDeps['llm'] = async (_m, o) => {
    const full = '<think>I cannot see any image.</think>Two seats face each other.\n\nSUCCESS CRITERIA:\n- two seats face each other';
    o.onToken?.({ text: full });
    return full;
  };
  await thinkStage(baseDeps({ llm }), { request: 'x', catalog: [] } as any, run, hooks().h);
  assert.equal(run.thinking.includes('cannot see'), false);
  assert.match(run.reasoning ?? '', /cannot see any image/);
  assert.deepEqual(run.criteria, ['two seats face each other']);
});
