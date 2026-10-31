/**
 * The general scene pipeline — works for any scene.
 *
 *   think → (route) → plan steps → for each step: write code → run → observe → check → fix
 *         → final skeptical review (may add up to two fix steps) → report
 *
 * The model writes Blender code against the `ab` toolkit; every step is run in a
 * sandbox, its real result is measured, and a separate critic judges it. If the
 * job is mainly placing library assets into rooms, the router hands over to the
 * layout engine (runBuild) instead — a tool, chosen by the model, not a scene rule.
 *
 * Models and Blender are injected (AgentDeps), so this runs the same in the app
 * and in a test against headless Blender.
 */

import type { AgentDeps, BuildOptions, BuildRun, LlmMessage, StageHooks, StepKey, StepStatus } from './buildAgent.ts';
import { Stopped, makeSteps, runBuild, thinkStage } from './buildAgent.ts';
import { extractJson } from './plan.ts';
import {
  CHECK_SCHEMA, CHECK_SYSTEM, CODE_SYSTEM, ROUTER_SCHEMA, ROUTER_SYSTEM, SCENE_REVIEW_SCHEMA, SCENE_REVIEW_SYSTEM,
  STEPS_PLAN_SYSTEM, checkUser, codeUser, sceneReviewUser, stepsPlanUser,
} from './prompts.ts';
import { catalogForPrompt, catalogSummary } from './resolve.ts';
import type { Comparison } from './reference.ts';
import { compareStage, referenceStage } from './reference.ts';
import type { SceneState } from './sceneView.ts';
import { asciiViews, describeIssues, describeState, foreignLine } from './sceneView.ts';
import { parseKeyFeatures } from './reference.ts';
import type { WorkStep } from './steps.ts';
import { STEPS_SCHEMA, extractCode, makeFixStep, normalizeSteps } from './steps.ts';

export interface SceneOptions extends BuildOptions {
  /** Steps the user already approved (skips thinking and planning). */
  approvedSteps?: WorkStep[];
  /** Attempts per step before moving on (default 3). */
  maxAttempts?: number;
  /** Steps the final review may add (default 2). */
  maxFixSteps?: number;
  /** Skip the router and use this method. */
  method?: 'arrange' | 'construct';
}

interface RunStepResult {
  ok: boolean;
  output: string;
  error: string | null;
  error_line: number | null;
  created: string[];
  created_count: number;
  touched_foreign: string[];
}

interface Check {
  status: 'pass' | 'fail' | 'cannot_judge';
  problems: string[];
  hint: string;
}

const SCENE_STEP_KEYS: StepKey[] = ['think', 'plan', 'build', 'report'];

export async function runScene(deps: AgentDeps, opts: SceneOptions): Promise<BuildRun> {
  const run: BuildRun = {
    id: Math.random().toString(36).slice(2, 8),
    request: opts.request,
    status: 'running',
    method: 'steps',
    steps: makeSteps(opts.reference?.images?.length ? ['reference', ...SCENE_STEP_KEYS] : SCENE_STEP_KEYS),
    log: [],
    thinking: '',
    criteria: [],
    verdicts: [],
    checklist: [],
    issues: [],
    rounds: 0,
    images: [],
    work: [],
  };
  const emit = () =>
    opts.onUpdate?.({
      ...run,
      steps: run.steps.map((s) => ({ ...s })),
      log: [...run.log],
      images: [...run.images],
      work: run.work?.map((w) => ({ ...w, done_when: [...w.done_when] })),
    });
  const step = (key: StepKey, status: StepStatus, detail?: string) => {
    const s = run.steps.find((x) => x.key === key)!;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    emit();
  };
  const log = (line: string) => {
    run.log.push(line);
    emit();
  };
  const checkStop = () => {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
  };
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const emitSoon = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emit();
    }, 90);
  };
  const hooks: StageHooks = { step, log, emitSoon, checkStop };
  const maxAttempts = opts.maxAttempts ?? 3;
  let current: StepKey = 'think';

  const getState = async (): Promise<SceneState> => (await deps.blender('scene_state', { collection: run.collection ?? '', limit: 80 })) as SceneState;

  try {
    // 0. Reference image, then think ----------------------------------------------
    await referenceStage(deps, opts, run, hooks);
    checkStop();
    await thinkStage(deps, opts, run, hooks);
    checkStop();

    // 0b. Route: hand library-into-rooms jobs to the layout engine ----------------
    if (!opts.approvedSteps && !opts.approvedPlan) {
      const method = opts.method ?? (await route(deps, opts, log));
      if (method === 'arrange') {
        log('Method: arrange library assets with the layout engine.');
        const prior = run.thinking.trim() ? { thinking: run.thinking, criteria: run.criteria } : undefined;
        const reference = run.reference ? { images: run.reference.images, text: run.reference.text } : opts.reference;
        return await runBuild(deps, { ...opts, prior, reference });
      }
    }

    // 1. Plan ---------------------------------------------------------------
    current = 'plan';
    step('plan', 'running');
    let summary = 'Scene build';
    if (opts.approvedSteps) {
      run.work = opts.approvedSteps.map((s) => ({ ...s, status: 'pending', attempts: 0, created: 0, note: undefined, code: undefined }));
      step('plan', 'done', 'Using the approved steps');
    } else {
      const planned = await planSteps(deps, opts, run, log);
      summary = planned.summary;
      run.work = planned.steps;
      step('plan', 'done', `${planned.steps.length} step(s)`);
    }
    run.summary = summary;
    emit();
    if (opts.planOnly) {
      run.status = 'awaiting_approval';
      emit();
      return run;
    }
    checkStop();

    // 2. Protect: undo point + a look at what is already there --------------------
    run.collection = `Scene ${run.id} – ${summary}`.slice(0, 60);
    const cp = deps.checkpointPath ? await deps.checkpointPath(run.id) : null;
    if (cp) {
      await deps.blender('save_checkpoint', { name: `before-scene-${run.id}`, filepath: cp });
      run.checkpoint = cp;
      log('Saved an undo checkpoint.');
    }
    const start = await getState();
    const hasForeign = (start.foreign?.count ?? 0) > 0;
    const foreign = foreignLine(start);
    if (hasForeign) log(`The scene already has ${start.foreign.count} object(s) — they will be left alone.`);

    const assets = Object.fromEntries(
      opts.catalog.filter((a) => a.model_path).slice(0, 3000).map((a) => [a.id, { path: a.model_path, name: a.name, category: a.category }])
    );
    const assetIds = Object.keys(assets).length ? catalogForPrompt(opts.catalog, 120) : '';

    // 3. Build, step by step ------------------------------------------------------
    current = 'build';
    step('build', 'running');
    const work = run.work!;

    const doStep = async (target: WorkStep, index: number) => {
      target.status = 'running';
      step('build', 'running', `Step ${index + 1}/${work.length}: ${target.title}`);
      let problem = '';
      let lastCode = '';
      let ranOk = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        checkStop();
        target.attempts = attempt;
        emit();
        await deps.blender('remove_step', { step_id: target.id }); // every attempt starts clean

        // A restore point before running code that could touch the user's own objects.
        let attemptCp: string | null = null;
        if (hasForeign && deps.restore && deps.checkpointPath) {
          attemptCp = await deps.checkpointPath(`${run.id}-${target.id}-${attempt}`);
          if (attemptCp) await deps.blender('save_checkpoint', { name: `before-${target.id}`, filepath: attemptCp });
        }

        // Write
        const state = await getState();
        let reply: string;
        try {
          reply = await deps.llm(
          [
            { role: 'system', content: CODE_SYSTEM },
            {
              role: 'user',
              content: codeUser({
                request: opts.request,
                thinking: run.thinking.trim().replace(/\n?\s*SUCCESS CRITERIA:[\s\S]*$/i, '').trim().slice(0, 1200) || undefined,
                steps: work.map((w) => ({ title: w.title, status: w.status === 'passed' || w.status === 'unchecked' || w.status === 'unmet' ? 'done' : w === target ? 'current' : 'to come' })),
                current: target,
                state: describeState(state, 50),
                foreign,
                assets: assetIds || undefined,
                attempt: attempt > 1 ? { n: attempt - 1, code: lastCode, problem } : undefined,
                reference: run.reference ? referenceDigest(run.reference.text) : undefined,
              }),
            },
          ],
          { signal: opts.signal, maxTokens: 6000 }
          );
        } catch (e: any) {
          if (opts.signal?.aborted || e instanceof Stopped) throw e;
          const why = e?.message || String(e);
          // The server itself being unreachable is fatal; one empty or failed reply is just a failed attempt.
          if (/Cannot reach|didn't answer within/i.test(why)) throw e;
          log(`Step "${target.title}", attempt ${attempt}: the model gave no usable answer (${why}).`);
          problem = `You gave no usable answer (${why}). Reply with ONE complete \`\`\`python code block for this step.`;
          ranOk = false;
          continue;
        }
        lastCode = extractCode(reply);
        if (!lastCode.trim()) {
          problem = 'Your reply contained no code. Reply with ONE complete ```python code block for this step.';
          ranOk = false;
          continue;
        }
        target.code = lastCode.slice(0, 6000);

        // Run
        const res = (await deps.blender('run_step', { code: lastCode, collection: run.collection, step_id: target.id, assets, timeout: 40 })) as RunStepResult;
        ranOk = res.ok;

        if (res.touched_foreign.length > 0) {
          // The code changed objects it didn't create: put everything back, then tell it off.
          if (attemptCp && deps.restore) {
            await deps.restore(attemptCp);
            log(`Step "${target.title}" changed existing objects (${res.touched_foreign.slice(0, 3).join(', ')}) — restored them.`);
          } else {
            log(`Step "${target.title}" changed existing objects (${res.touched_foreign.slice(0, 3).join(', ')}) and could not be restored.`);
          }
          problem = `Your code modified or deleted objects you did not create (${res.touched_foreign.slice(0, 5).join(', ')}). Never touch existing objects.`;
          ranOk = false;
          continue;
        }
        if (!res.ok) {
          problem = `The code failed: ${res.error}${res.output ? `\nIt printed: ${res.output}` : ''}`;
          continue;
        }
        target.created = res.created_count;

        // Observe
        const after = await getState();
        const mine = new Set(res.created);
        const rows = after.objects.filter((o) => o.step === target.id || mine.has(o.name));
        const issues = after.issues.filter((i) => mine.has(i.object) || (i.other && mine.has(i.other)));
        const broken = issues.filter((i) => ['invalid', 'empty', 'degenerate'].includes(i.code));

        // Check
        let check: Check;
        // A step may legitimately only change earlier objects; it fails only if nothing changed at all.
        const fingerprint = (st: SceneState) => JSON.stringify(st.objects.map((o) => [o.name, o.bbox_min, o.bbox_max, o.material]));
        if (res.created_count === 0 && fingerprint(state) === fingerprint(after)) {
          check = { status: 'fail', problems: ['The code ran but neither created nor changed anything.'], hint: 'Create the objects the step asks for with ab.* functions, or change the existing ones it names.' };
        } else if (broken.length) {
          check = { status: 'fail', problems: broken.map((i) => i.message), hint: 'Fix the invalid or empty geometry.' };
        } else {
          check = await critique(deps, opts, target, res, { ...after, objects: rows }, describeState(after, 50), asciiViews(after), describeIssues(issues));
        }

        if (check.status === 'pass' || check.status === 'cannot_judge') {
          target.status = check.status === 'pass' ? 'passed' : 'unchecked';
          target.note = check.status === 'cannot_judge' ? check.problems.join(' ') || 'Could not be judged from measurements alone.' : undefined;
          return;
        }
        problem = `A reviewer measured the result and found:\n${check.problems.map((p) => `- ${p}`).join('\n')}${check.hint ? `\nHint: ${check.hint}` : ''}`;
        target.note = check.problems.join('; ');
      }
      // Out of attempts.
      if (ranOk) {
        target.status = 'unmet';
        log(`Step "${target.title}" is not fully met after ${maxAttempts} attempts — continuing with the best attempt.`);
      } else {
        await deps.blender('remove_step', { step_id: target.id });
        target.created = 0;
        target.status = 'failed';
        target.note = problem.split('\n')[0].slice(0, 240);
        log(`Step "${target.title}" failed after ${maxAttempts} attempts — skipped.`);
      }
    };

    for (let i = 0; i < work.length; i++) {
      await doStep(work[i], i);
      if (opts.captureImages && work[i].status !== 'failed') await snapshot(deps, run, `After: ${work[i].title}`, log);
      emit();
    }
    const failed = work.filter((w) => w.status === 'failed').length;
    step('build', failed === work.length ? 'failed' : 'done', `${work.filter((w) => w.status === 'passed' || w.status === 'unchecked').length}/${work.length} steps met${failed ? `, ${failed} failed` : ''}`);

    // 4. Final skeptical review (may add fix steps) -----------------------------
    current = 'report';
    step('report', 'running');
    let review = await finalReview(deps, opts, run, await getState(), log);
    // With a reference image: render, then compare the renders with the picture it should resemble.
    let comparison: Comparison = { similarity: null, differences: [], fix_steps: [] };
    if (run.reference && deps.vision && opts.captureImages) {
      const s0 = await getState();
      await snapshot(deps, run, 'For comparison — 3/4 view', log, s0);
      await snapshot(deps, run, 'For comparison — front', log, s0, { view: 'persp', azimuth: 0, elevation: 12 });
      comparison = await compareStage(deps, opts, run, run.images.slice(-2).map((i) => i.data), describeState(s0, 40), log);
    }
    const maxFix = opts.maxFixSteps ?? 2;
    const extra = [...review.fix_steps, ...comparison.fix_steps]
      .map((raw: any) => makeFixStep(raw, work))
      .filter((s): s is WorkStep => !!s)
      .slice(0, maxFix);
    if (extra.length) {
      log(`Review found gaps — adding ${extra.length} step(s).`);
      for (const s of extra) {
        work.push(s);
        emit();
        await doStep(s, work.length - 1);
      }
      review = await finalReview(deps, opts, run, await getState(), log);
    }
    const finalState = await getState();
    if (finalState.issues.length) log(`Generic checks flagged ${finalState.issues.length} thing(s): ${finalState.issues.slice(0, 4).map((i) => i.message).join(' · ')}`);
    if (opts.captureImages && finalState.bounds) {
      await snapshot(deps, run, 'Finished — 3/4 view', log, finalState);
      await snapshot(deps, run, 'Finished — top view', log, finalState, { view: 'top' });
      await snapshot(deps, run, 'Finished — from the front', log, finalState, { view: 'persp', azimuth: 0, elevation: 12 });
    }
    const met = work.filter((w) => w.status === 'passed' || w.status === 'unchecked').length;
    step('report', 'done', `${met}/${work.length} steps met`);
    run.status = 'done';
    emit();
    return run;
  } catch (e: any) {
    const stopped = e instanceof Stopped;
    run.status = stopped ? 'stopped' : 'failed';
    run.error = e?.message || String(e);
    step(current, 'failed', run.error ?? undefined);
    return run;
  }
}

// ------------------------------------------------------------------ stages

/** A short version of the image analysis for prompts that need the gist: opening lines + key features. */
export function referenceDigest(text: string): string {
  const features = parseKeyFeatures(text);
  const prose = text.replace(/key features\s*:?[\s\S]*$/i, '').trim();
  return [prose.slice(0, 700), features.length ? `Key features:\n${features.map((f) => `- ${f}`).join('\n')}` : ''].filter(Boolean).join('\n');
}

async function route(deps: AgentDeps, opts: SceneOptions, log: (s: string) => void): Promise<'arrange' | 'construct'> {
  try {
    const reply = await deps.llm(
      [
        { role: 'system', content: ROUTER_SYSTEM },
        { role: 'user', content: [`REQUEST: ${opts.request}`, opts.brief ? `PROJECT BRIEF: ${opts.brief}` : '', `ASSET LIBRARY (categories): ${catalogSummary(opts.catalog)}`].filter(Boolean).join('\n\n') },
      ],
      { signal: opts.signal, schema: ROUTER_SCHEMA }
    );
    return extractJson(reply).method === 'arrange' ? 'arrange' : 'construct';
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    log(`Couldn't choose a method (${e?.message || e}) — building with code.`);
    return 'construct';
  }
}

async function planSteps(deps: AgentDeps, opts: SceneOptions, run: BuildRun, log: (s: string) => void): Promise<{ summary: string; steps: WorkStep[] }> {
  const user = stepsPlanUser(opts.request, {
    brief: opts.brief,
    thinking: run.thinking.trim().replace(/\n?\s*SUCCESS CRITERIA:[\s\S]*$/i, '').trim() || undefined,
    criteria: run.criteria,
    scene: opts.sceneSummary,
    assets: opts.catalog.length ? catalogForPrompt(opts.catalog, 120) : undefined,
    reference: run.reference?.text || undefined,
  });
  const messages: LlmMessage[] = [
    { role: 'system', content: STEPS_PLAN_SYSTEM },
    { role: 'user', content: user },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await deps.llm(messages, { signal: opts.signal, schema: STEPS_SCHEMA });
    try {
      const { plan, errors, notes } = normalizeSteps(extractJson(reply));
      if (errors.length) throw new Error(errors.join(' '));
      notes.forEach(log);
      return plan;
    } catch (e: any) {
      if (attempt === 1) throw new Error(`The model's step plan couldn't be used: ${e?.message || e}`);
      log('The step plan was not valid — asking the model to correct it.');
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `Your reply could not be used: ${e?.message || e}\nReply again with ONLY the corrected JSON.` });
    }
  }
  throw new Error('unreachable');
}

async function critique(
  deps: AgentDeps,
  opts: SceneOptions,
  target: WorkStep,
  res: RunStepResult,
  mineState: SceneState,
  wholeState: string,
  views: string,
  issues: string
): Promise<Check> {
  try {
    const reply = await deps.llm(
      [
        { role: 'system', content: CHECK_SYSTEM },
        { role: 'user', content: checkUser({ step: target, output: res.output, created: describeState(mineState, 40), state: wholeState, views, issues }) },
      ],
      { signal: opts.signal, schema: CHECK_SCHEMA }
    );
    const json = extractJson(reply);
    const status = json.status === 'pass' || json.status === 'fail' || json.status === 'cannot_judge' ? json.status : 'cannot_judge';
    const problems = (Array.isArray(json.problems) ? json.problems : []).filter((p: unknown) => typeof p === 'string' && p.trim()).slice(0, 6);
    // A "fail" with nothing to fix can't be acted on — treat it as not judged rather than loop on it.
    return status === 'fail' && problems.length === 0
      ? { status: 'cannot_judge', problems: [], hint: '' }
      : { status, problems, hint: typeof json.hint === 'string' ? json.hint : '' };
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    return { status: 'cannot_judge', problems: [`The check itself failed (${e?.message || e}).`], hint: '' };
  }
}

async function finalReview(deps: AgentDeps, opts: SceneOptions, run: BuildRun, state: SceneState, log: (s: string) => void): Promise<{ fix_steps: any[] }> {
  try {
    const reply = await deps.llm(
      [
        { role: 'system', content: SCENE_REVIEW_SYSTEM },
        { role: 'user', content: sceneReviewUser({ request: opts.request, criteria: run.criteria, state: describeState(state, 60), views: asciiViews(state), issues: describeIssues(state.issues, undefined, 12) }) },
      ],
      { signal: opts.signal, schema: SCENE_REVIEW_SCHEMA }
    );
    const json = extractJson(reply);
    run.verdicts = (Array.isArray(json.criteria) ? json.criteria : [])
      .filter((c: any) => c && Number.isInteger(c.n) && run.criteria[c.n - 1])
      .map((c: any) => ({
        text: run.criteria[c.n - 1],
        met: c.status === 'met' ? true : c.status === 'not_met' ? false : null,
        note: typeof c.note === 'string' ? c.note : undefined,
      }));
    if (typeof json.note === 'string' && json.note) log(`Review: ${json.note}`);
    return { fix_steps: Array.isArray(json.fix_steps) ? json.fix_steps : [] };
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    log(`The final review failed (${e?.message || e}).`);
    return { fix_steps: [] };
  }
}

async function snapshot(deps: AgentDeps, run: BuildRun, label: string, log: (s: string) => void, known?: SceneState, view: { view?: 'persp' | 'top'; azimuth?: number; elevation?: number } = {}) {
  try {
    const state = known ?? ((await deps.blender('scene_state', { collection: run.collection ?? '', limit: 5 })) as SceneState);
    if (!state.bounds) return;
    const img = await deps.blender('capture_review', { bbox_min: state.bounds.min, bbox_max: state.bounds.max, view: 'persp', width: 720, height: 450, ...view });
    run.images.push({ label, data: `data:image/png;base64,${img.base64}` });
    if (run.images.length > 4) run.images.splice(0, run.images.length - 4);
  } catch (e: any) {
    log(`Couldn't capture an image: ${e?.message || e}`);
  }
}
