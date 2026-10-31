// End-to-end run of the build agent against a headless Blender (port 9877).
//
//   blender -b --factory-startup --python scripts/e2e/blender_test_server.py -- "$PWD/.."   (in one terminal)
//   node scripts/e2e/run.mjs scripted                      deterministic fake model — tests the pipeline
//   node scripts/e2e/run.mjs lmstudio "build a small house"  your real model (LMSTUDIO_URL / LMSTUDIO_MODEL)
//
// Prints what the user would see: streamed thinking, steps, checklist, criteria verdicts.
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../..');
const repo = resolve(app, '..');
const { runBuild } = await import(`${app}/src/agent/buildAgent.ts`);
const { completeChat } = await import(`${app}/src/services/llm.ts`);

const mode = process.argv[2] || 'scripted';
const request = process.argv[3] || 'build a small house with a living room and a bedroom';
const out = process.env.E2E_OUT || '/tmp/agent-blend-e2e';
mkdirSync(out, { recursive: true });

function blender(command, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(9877, '127.0.0.1');
    const payload = Buffer.from(JSON.stringify({ command, params }));
    const head = Buffer.alloc(4); head.writeUInt32BE(payload.length);
    let buf = Buffer.alloc(0);
    sock.on('connect', () => sock.write(Buffer.concat([head, payload])));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const res = JSON.parse(buf.subarray(4, 4 + buf.readUInt32BE(0)).toString());
        sock.end();
        res.status === 'ok' ? resolve(res.result) : reject(new Error(String(res.result)));
      }
    });
    sock.on('error', reject);
  });
}

const catalog = JSON.parse(readFileSync(`${app}/src/assets/asset_catalog.json`, 'utf8'))
  .map((a) => ({ ...a, model_path: `${repo}/asset_library/${a.id}/model.glb` }));

// ---- scripted model: answers each stage the way a good model would
const PLAN = { kind: 'layout', summary: 'Small two-room house', structure: true, rooms: [
  { id: 'living', name: 'Living Room', purpose: 'living room', width: 5.5, depth: 4.5, windows: [{ wall: 'north' }] },
  { id: 'bedroom', name: 'Bedroom', purpose: 'bedroom', width: 4.5, depth: 4.5, windows: [{ wall: 'north' }, { wall: 'east' }] } ],
  items: [
    { id: 'tv', room: 'living', what: 'wall tv', size: [1.4, 0.08, 0.8], placement: 'on_wall', wall: 'south', reason: 'faces the seating' },
    { id: 'rug', room: 'living', what: 'area rug', size: [2.5, 2, 0.02], placement: 'center' },
    { id: 'bed', room: 'bedroom', what: 'bed', asset_id: 'bed/bed_frame_01', size: [1.7, 2.1, 0.5], placement: 'against_wall', wall: 'north', reason: 'headboard on the quiet wall' },
    { id: 'nightstand', room: 'bedroom', what: 'bedside table', size: [0.5, 0.45, 0.55], placement: 'next_to', target: 'bed', side: 'left' },
  ] };
let reviews = 0;
const scripted = async (messages, o) => {
  const sys = messages[0].content;
  const say = (text) => { for (const w of text.match(/\S+\s*/g) || []) o.onToken?.({ text: w }); return text; };
  if (sys.includes('thinking step')) return say('This is a small home: a living room to relax in and a bedroom to sleep in. It should feel lived-in, with the seating area facing the TV and the bed on the quietest wall.\n\nSUCCESS CRITERIA:\n- The bed is in the bedroom, against a wall\n- The living room has a TV\n- Every room has a window and a connecting door\n- Nothing blocks a doorway');
  if (sys.includes('planning step')) return JSON.stringify(PLAN);
  if (sys.includes('match planned objects')) return JSON.stringify({ tv: 'electronics/simple_wall_tv', rug: 'rug/carpet_square', nightstand: 'table/modern_bedside_table' });
  reviews++;
  return JSON.stringify({ complete: true, note: 'Looks right.', criteria: [1, 2, 3, 4].map((n) => ({ n, met: true, note: 'checked in the floor plan' })), edits: [] });
};

// ---- real model through the app's own streaming client
const settings = { provider: 'lmstudio', apiBaseUrl: process.env.LMSTUDIO_URL || 'http://192.168.2.112:1234', apiKey: '', model: process.env.LMSTUDIO_MODEL || 'qwen/qwen2.5-coder-14b' };
let calls = 0;
const real = async (messages, o) => { calls++; const text = await completeChat(settings, messages, { maxTokens: 3000, ...o }); writeFileSync(`${out}/llm_${calls}.txt`, text); return text; };

await blender('new_file', {});
await blender('create_object', { type: 'CUBE', name: 'UserCube', location: [0, 0, 1] }); // pre-existing user object must survive

let lastThinkLen = 0;
const t0 = Date.now();
const run = await runBuild(
  { llm: mode === 'scripted' ? scripted : real, blender, checkpointPath: async (id) => `${out}/cp_${id}.blend` },
  { request, catalog, captureImages: true, maxRounds: 3, onUpdate: (r) => {
      if (r.thinking.length > lastThinkLen && r.steps.find((s) => s.key === 'think')?.status === 'running') { process.stdout.write(r.thinking.slice(lastThinkLen)); lastThinkLen = r.thinking.length; }
  } },
);
console.log(`\n\nSTATUS ${run.status} ${run.error || ''} | rounds ${run.rounds} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const s of run.steps) console.log('STEP', s.status.padEnd(7), s.label, '—', s.detail || '');
console.log('CRITERIA', run.criteria.length, '| VERDICTS', run.verdicts.map((v) => (v.met ? '✓' : '✗')).join(' '));
for (const v of run.verdicts) console.log('  ', v.met ? 'met   ' : 'NOT met', v.text, v.note ? `— ${v.note}` : '');
for (const c of run.checklist) console.log('CHECK', c.status.padEnd(11), c.room, '/', c.label, c.note ? `— ${c.note.slice(0, 80)}` : '');
for (const i of run.issues) console.log('ISSUE', i.severity, i.code, i.message);
for (const l of run.log) console.log('LOG', l);
run.images.forEach((img, i) => writeFileSync(`${out}/${mode}_img${i}.png`, Buffer.from(img.data.split(',')[1], 'base64')));
const cube = await blender('get_object_info', { name: 'UserCube' });
console.log('USER CUBE untouched at', cube.location, '| images saved to', out);
