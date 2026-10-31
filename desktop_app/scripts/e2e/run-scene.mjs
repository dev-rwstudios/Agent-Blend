// End-to-end run of the GENERAL scene pipeline against a headless Blender (port 9877).
//
//   blender -b --factory-startup --python scripts/e2e/blender_test_server.py -- "$PWD/.."
//   node scripts/e2e/run-scene.mjs scripted
//   node scripts/e2e/run-scene.mjs lmstudio "a lighthouse on a rocky island at dusk"
//
// scripted = a fake model that writes real code (and fails on purpose in two places) to test the pipeline.
// lmstudio = your real model through the app's own streaming client (LMSTUDIO_URL / LMSTUDIO_MODEL).
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../..');
const repo = resolve(app, '..');
const { runScene } = await import(`${app}/src/agent/stepAgent.ts`);
const { completeChat } = await import(`${app}/src/services/llm.ts`);

const mode = process.argv[2] || 'scripted';
const request = process.argv[3] || 'a small stone watchtower on a grassy hill, with a fence around it';
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

const catalog = JSON.parse(readFileSync(`${app}/src/assets/asset_catalog.json`, 'utf8')).map((a) => ({ ...a, model_path: `${repo}/asset_library/${a.id}/model.glb` }));

// ---- scripted model
const PLAN = { summary: 'Stone watchtower on a hill', steps: [
  { id: 'hill', title: 'Grassy hill', goal: 'A 60x60 m grassy hill, 5 m tall at the center, centered at the origin.', done_when: ['ground spans about 60 m', 'highest point is near the center'] },
  { id: 'tower', title: 'Watchtower', goal: 'A stone tower 3 m wide and 9 m tall on top of the hill at the center, with a pointed roof.', done_when: ['tower is about 9 m tall', 'roof is above the tower'] },
  { id: 'rogue', title: 'Clear the area', goal: 'Tidy up: make sure nothing else is in the way.', done_when: ['nothing else was changed'] },
  { id: 'fence', title: 'Fence', goal: 'A ring of fence posts about 8 m from the tower center, one every 2 m.', done_when: ['posts are about 8 m from the center'] } ] };
const CODE = {
  'Grassy hill': 'hill = ab.height_field("Hill", (60, 60), lambda x, y: 5 * math.exp(-(x*x + y*y) / 180) + 0.3 * ab.noise(x, y, 5, seed=4), resolution=(60, 60), color="grass")',
  'Watchtower': ['hill = bpy.data.objects["Hill"]\nz = ab.surface_z(hill, 0, 0)\ntower = ab.cylinder("Tower", 1.5, 9, at=(0, 0, z), radius_top=1.2, color="stone")\nroof = ab.cone("Roof", 1.9, 2.5, color="grey")\nab.place_on(roof, tower, xy=(0, 0))',
                 'hill = bpy.data.objects["Hill"]\nz = ab.surface_z(hill, 0, 0)\ntower = ab.cylinder("Tower", 1.5, 9, at=(0, 0, z), radius_top=1.2, color="stone")\nroof = ab.cone("Roof", 1.9, 2.5, color="grey")\nab.place_on(roof, tower, xy=(0, 0))'],
  'Clear the area': ['bpy.data.objects.remove(bpy.data.objects["UserCube"], do_unlink=True)  # tries to "tidy up" the user\'s object', 'ab.log("nothing needed clearing")\nab.box("Marker", (0.2, 0.2, 0.2), at=(40, 40, 0), color="red")'],
  'Fence': 'hill = bpy.data.objects["Hill"]\npost = ab.cylinder("Post", 0.08, 1.1, color="wood")\nring = [(8*math.cos(a/10*2*math.pi), 8*math.sin(a/10*2*math.pi)) for a in range(10)]\nfor i, (x, y) in enumerate(ring):\n    p = ab.scatter(post, 1, (x, y, x+0.01, y+0.01), seed=i, on=hill, rotate=False)',
};
const seen = {};
// E2E_REFERENCE=1 (scripted mode): attach a reference image; the scripted vision model reads it, then finds the roof isn't red.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
CODE['Make the roof red'] = 'ab.paint(bpy.data.objects["Roof"], "red")\nab.log("roof recolored")';
const scriptedVision = async (messages, o) => {
  const sys = messages[0].content;
  const say = (text) => { for (const w of text.match(/\S+\s*/g) || []) o.onToken?.({ text: w }); return text; };
  if (sys.includes('visual analysis step')) return say('A stone tower on a green hill with a bright red conical roof, seen from slightly above. The tower is about 9 m tall.\n\nKEY FEATURES:\n- a tall round stone tower\n- a bright red conical roof\n- a green hill underneath');
  if (sys.includes('comparison step')) return JSON.stringify({ similarity: 6, matches: ['tower and hill'], differences: ['the roof is not red enough'], fix_steps: [{ title: 'Make the roof red', goal: 'Recolor the Roof object bright red', done_when: ['roof is red'] }] });
  throw new Error('scripted vision: unexpected prompt');
};
const scripted = async (messages, o) => {
  const sys = messages[0].content; const user = messages[messages.length - 1].content;
  const say = (text) => { for (const w of text.match(/\S+\s*/g) || []) o.onToken?.({ text: w }); return text; };
  if (sys.includes('thinking step')) return say('A stone watchtower standing on a grassy hill, ringed by a low fence. The tower is the focal point; the hill gives it height and the fence gives scale.\n\nSUCCESS CRITERIA:\n- A hill about 60 m across\n- A tower about 9 m tall standing on the hill\n- A fence of posts around the tower\n- Nothing floats above the ground');
  if (sys.includes('Choose how to build')) return JSON.stringify({ method: 'construct', reason: 'no rooms or furniture involved' });
  if (sys.includes('planning step')) return JSON.stringify(PLAN);
  if (sys.includes('You write Python')) {
    const title = user.match(/CURRENT STEP: (.*)/)[1];
    const options = CODE[title]; const n = (seen[title] = (seen[title] || 0) + 1);
    return '```python\n' + (Array.isArray(options) ? options[Math.min(n, options.length) - 1] : options) + '\n```';
  }
  if (sys.includes('skeptical checker')) return JSON.stringify({ status: 'pass', problems: [], hint: '' });
  if (sys.includes('final skeptical reviewer')) return JSON.stringify({ note: 'Everything asked for is present.', criteria: [1, 2, 3, 4].map((n) => ({ n, status: n === 4 ? 'met' : 'met', note: 'measured' })), fix_steps: [] });
  throw new Error('scripted model: unexpected prompt');
};
// Make the first "Watchtower" attempt fail with a real NameError (exercises the fix loop).
CODE['Watchtower'][0] = CODE['Watchtower'][0].replace('z = ab.surface_z(hill, 0, 0)', 'z = ab.surface_zz(hill, 0, 0)');

const settings = { provider: 'lmstudio', apiBaseUrl: process.env.LMSTUDIO_URL || 'http://192.168.2.112:1234', apiKey: '', model: process.env.LMSTUDIO_MODEL || 'qwen/qwen2.5-coder-14b' };
let calls = 0;
const real = async (messages, o) => { calls++; const text = await completeChat(settings, messages, { maxTokens: 3500, ...o }); writeFileSync(`${out}/llm_${calls}.txt`, `# SYSTEM\n${messages[0].content.slice(0, 200)}\n# USER\n${messages[messages.length - 1].content}\n# REPLY\n${text}`); return text; };

await blender('new_file', {});
await blender('create_object', { type: 'CUBE', name: 'UserCube', location: [30, 30, 1] });   // the user's own object — must survive
let cpFile = 0;
const withRef = process.env.E2E_REFERENCE === '1';
const deps = {
  llm: mode === 'scripted' ? scripted : real,
  vision: mode === 'scripted' ? scriptedVision : real,
  blender,
  checkpointPath: async (id) => `${out}/cp_${id}.blend`,
  restore: async (cp) => { await blender('open_file', { filepath: cp }); },
};

let shown = 0;
const t0 = Date.now();
const run = await runScene(deps, { request, catalog, captureImages: true, reference: withRef ? { images: [TINY_PNG] } : undefined, onUpdate: (r) => {
  if (r.thinking.length > shown && r.steps.find((s) => s.key === 'think')?.status === 'running') { process.stdout.write(r.thinking.slice(shown)); shown = r.thinking.length; }
} });

console.log(`\n\nSTATUS ${run.status} ${run.error || ''} | method ${run.method} | ${((Date.now() - t0) / 1000).toFixed(1)}s | llm calls ${mode === 'scripted' ? 'n/a' : calls}`);
for (const s of run.steps) console.log('PHASE', s.status.padEnd(7), s.label, '—', s.detail || '');
for (const w of run.work || []) console.log('STEP ', w.status.padEnd(9), `attempts=${w.attempts}`, `created=${w.created}`.padEnd(11), w.title, w.note ? `— ${w.note.slice(0, 110)}` : '');
console.log('CRITERIA', run.criteria.length, '| VERDICTS', run.verdicts.map((v) => (v.met === true ? '✓' : v.met === false ? '✗' : '?')).join(' '));
for (const v of run.verdicts) console.log('  ', v.met === true ? 'met      ' : v.met === false ? 'NOT met  ' : 'cannot   ', v.text, v.note ? `— ${v.note.slice(0, 100)}` : '');
if (run.reference) console.log('REFERENCE read:', JSON.stringify(run.reference.text.slice(0, 60)), '| similarity', run.reference.similarity, '| differences', JSON.stringify(run.reference.differences), '| error', run.reference.error);
for (const l of run.log) console.log('LOG', l.slice(0, 220));
run.images.forEach((img, i) => writeFileSync(`${out}/${mode}_img${i}.png`, Buffer.from(img.data.split(',')[1], 'base64')));
for (const w of run.work || []) if (w.code) writeFileSync(`${out}/${mode}_${w.id}.py`, w.code);
const cube = await blender('get_object_info', { name: 'UserCube' }).catch((e) => ({ location: `GONE (${e.message})` }));
console.log('USER CUBE', JSON.stringify(cube.location), '| images + code saved to', out);
