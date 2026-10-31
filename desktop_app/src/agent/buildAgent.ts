/**
 * The build agent: plan → resolve assets → layout → build → verify → repair → report.
 *
 * The model and Blender are injected (`AgentDeps`), so this runs the same in
 * the app and in an end-to-end test against a headless Blender. See
 * docs/BUILD_AGENT.md for the design.
 */

import type { CatalogAsset } from '../types.ts';
import type { WorkStep } from './steps.ts';
import { referenceStage } from './reference.ts';
import type { AssetDims, LayoutResult } from './layout.ts';
import { solveLayout } from './layout.ts';
import type { Item, PlanEdit, ScenePlan } from './plan.ts';
import { PLAN_SCHEMA, applyEdits, extractJson, normalizePlan, parseCriteria, splitThinkTags } from './plan.ts';
import { describeLayout } from './floorplan.ts';
import { MATCHER_SYSTEM, PLANNER_SYSTEM, REPAIR_JSON, REVIEWER_SYSTEM, THINK_SYSTEM, matcherUser, plannerUser, reviewerUser, thinkUser } from './prompts.ts';
import { catalogForPrompt, catalogSummary, dimsOf, implausible, placeholderDims, rankCandidates } from './resolve.ts';
import type { SpaceLimits } from './resolve.ts';
import type { Issue, Unit } from './verify.ts';
import { measuredDims, sizeMismatches, verifyBuild } from './verify.ts';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Images (data URLs) shown with this message — only sent through `deps.vision`. */
  images?: string[];
}

export interface AgentDeps {
  llm: (
    messages: LlmMessage[],
    opts: {
      signal?: AbortSignal;
      /** Ask the server for output that follows this JSON schema. */
      schema?: { name: string; schema: Record<string, unknown> };
      /** Called with each piece of the reply as it is written. */
      onToken?: (delta: { text?: string; reasoning?: string }) => void;
      /** Reply length limit; reasoning models need room for their reasoning AND the answer. */
      maxTokens?: number;
    }
  ) => Promise<string>;
  /** Run an addon command; resolves with its result, throws with its error message. */
  blender: (command: string, params?: Record<string, unknown>) => Promise<any>;
  /** Absolute path for this run's undo checkpoint, or null to skip. */
  checkpointPath?: (runId: string) => Promise<string | null>;
  /** A model that can read images (may differ from `llm`). Required when a reference image is attached. */
  vision?: (
    messages: LlmMessage[],
    opts: { signal?: AbortSignal; schema?: { name: string; schema: Record<string, unknown> }; onToken?: (delta: { text?: string; reasoning?: string }) => void }
  ) => Promise<string>;
  /** Put Blender back to a saved checkpoint (used when generated code damages objects it didn't create). */
  restore?: (checkpoint: string) => Promise<void>;
}

export interface BuildOptions {
  request: string;
  catalog: CatalogAsset[];
  /** Asset ids the user approved in the Asset Bucket — preferred when they fit. */
  preferredAssetIds?: string[];
  brief?: string;
  sceneSummary?: string;
  /** A picture the scene should resemble. `text` is its analysis once it has been read (so it is only read once). */
  reference?: { images: string[]; text?: string };
  /** Skip planning and build this (e.g. a plan the user approved). */
  approvedPlan?: ScenePlan;
  /** The thinking and criteria that produced `approvedPlan`, so the review still judges against them. */
  prior?: { thinking: string; criteria: string[] };
  /** Stop after planning so the user can approve. */
  planOnly?: boolean;
  maxRounds?: number;
  captureImages?: boolean;
  /** Put a sized, labeled stand-in where no library asset fits (default true). */
  placeholders?: boolean;
  /** Real sizes measured earlier (asset id → dims), reused and extended across runs. */
  measuredSizes?: Record<string, AssetDims>;
  signal?: AbortSignal;
  onUpdate?: (run: BuildRun) => void;
}

export type StepKey = 'reference' | 'think' | 'plan' | 'build' | 'assets' | 'layout' | 'structure' | 'place' | 'verify' | 'report';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface ChecklistEntry {
  id: string;
  label: string;
  room: string;
  status: 'ok' | 'placeholder' | 'issue' | 'missing';
  note?: string;
}

export const ROOMS_STEP_KEYS: StepKey[] = ['think', 'plan', 'assets', 'layout', 'structure', 'place', 'verify', 'report'];

export function makeSteps(keys: StepKey[]): BuildRun['steps'] {
  return keys.map((key) => ({ key, label: STEP_LABELS[key], status: 'pending' as StepStatus }));
}

export interface BuildRun {
  id: string;
  request: string;
  status: 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped' | 'not_layout';
  steps: { key: StepKey; label: string; status: StepStatus; detail?: string }[];
  log: string[];
  plan?: ScenePlan;
  /** The reference image the scene should resemble, what was read from it, and how the result compared. */
  reference?: { images: string[]; text: string; similarity?: number; differences?: string[]; error?: string };
  /** Which pipeline produced this run: the rooms-and-furniture layout engine, or general code steps. */
  method?: 'rooms' | 'steps';
  /** One-line summary when there is no rooms plan (the step pipeline). */
  summary?: string;
  /** The step list of the general pipeline, with each step's status and attempts. */
  work?: WorkStep[];
  /** The model's free-text design thinking (streamed while it is written). */
  thinking: string;
  /** A reasoning model's own chain of thought, kept apart: shown to the user, never fed to later steps. */
  reasoning?: string;
  /** What the finished scene must satisfy — written during thinking, judged at review. */
  criteria: string[];
  /** The reviewer's verdict on each criterion (null = it could not judge this from what it was shown). */
  verdicts: { text: string; met: boolean | null; note?: string }[];
  checklist: ChecklistEntry[];
  issues: Issue[];
  rounds: number;
  images: { label: string; data: string }[];
  collection?: string;
  checkpoint?: string;
  error?: string;
  structure?: { rooms: number; walls: number; doors: number; windows: number };
}

export const STEP_LABELS: Record<StepKey, string> = {
  reference: 'Study the reference image',
  think: 'Think it through',
  plan: 'Plan the scene',
  build: 'Build step by step',
  assets: 'Match assets',
  layout: 'Lay out rooms & furniture',
  structure: 'Build floors & walls',
  place: 'Place assets',
  verify: 'Check & fix',
  report: 'Final review',
};

const MATERIALS = {
  'AB Wall': { color: [0.86, 0.85, 0.82, 1], roughness: 0.8 },
  'AB Floor': { color: [0.55, 0.42, 0.3, 1], roughness: 0.6 },
};

export class Stopped extends Error {}

/** What fills a plan item: a library asset, or a labeled stand-in. */
type Choice = { key: string } & (
  | { kind: 'asset'; asset: CatalogAsset; dims: AssetDims }
  | { kind: 'placeholder'; dims: AssetDims; reason: string }
);

export async function runBuild(deps: AgentDeps, opts: BuildOptions): Promise<BuildRun> {
  const run: BuildRun = {
    id: Math.random().toString(36).slice(2, 8),
    request: opts.request,
    status: 'running',
    steps: makeSteps(opts.reference?.images?.length ? ['reference', ...ROOMS_STEP_KEYS] : ROOMS_STEP_KEYS),
    log: [],
    thinking: '',
    criteria: [],
    verdicts: [],
    checklist: [],
    issues: [],
    rounds: 0,
    images: [],
  };
  const emit = () => opts.onUpdate?.({ ...run, steps: run.steps.map((s) => ({ ...s })), log: [...run.log], images: [...run.images] });
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
  const maxRounds = opts.maxRounds ?? 3;
  const catalogText = catalogForPrompt(opts.catalog);
  const preferred = new Set(opts.preferredAssetIds ?? []);
  let current: StepKey = 'think';

  // Streamed tokens arrive far faster than the UI needs repainting.
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const emitSoon = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emit();
    }, 90);
  };

  try {
    // 0. Reference image, then think ----------------------------------------------
    await referenceStage(deps, opts, run, { step, log, emitSoon, checkStop });
    checkStop();
    await thinkStage(deps, opts, run, { step, log, emitSoon, checkStop });
    checkStop();

    // 1. Plan ---------------------------------------------------------------
    current = 'plan';
    step('plan', 'running');
    let plan: ScenePlan;
    if (opts.approvedPlan) {
      plan = opts.approvedPlan;
      step('plan', 'done', 'Using the approved plan');
    } else {
      plan = await makePlan(deps, opts, catalogText, run, log);
      if (plan.kind === 'edit') {
        run.status = 'not_layout';
        step('plan', 'skipped', 'Not a layout request');
        return run;
      }
      step('plan', 'done', `${plan.rooms.length} room(s), ${plan.items.length} item(s)`);
    }
    run.plan = plan;
    emit();
    if (opts.planOnly) {
      run.status = 'awaiting_approval';
      emit();
      return run;
    }
    checkStop();

    // 2. Assets -------------------------------------------------------------
    current = 'assets';
    step('assets', 'running');
    const sizes = opts.measuredSizes ?? {};
    let choices = await chooseAll(deps, plan, opts, preferred, sizes, new Map(), log, checkStop);
    let dims = dimsFrom(plan, choices);
    const real = [...choices.values()].filter((c) => c.kind === 'asset').length;
    const stand = [...choices.values()].filter((c) => c.kind === 'placeholder').length;
    step('assets', 'done', `${real} from the library${stand ? `, ${stand} placeholder(s)` : ''}${plan.items.length - real - stand ? `, ${plan.items.length - real - stand} missing` : ''}`);
    checkStop();

    // 3. Layout -------------------------------------------------------------
    current = 'layout';
    step('layout', 'running');
    const before = await deps.blender('get_layout', {});
    const origin = before.other_bbox_max
      ? { x: Math.ceil(before.other_bbox_max[0] + 2), y: Math.floor(before.other_bbox_min[1]) }
      : { x: 0, y: 0 };
    if (before.other_bbox_max) log(`The scene already has ${before.other_objects} object(s) — building beside them, starting at x = ${origin.x} m.`);
    let layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: plan.structure, origin });
    layout.notes.forEach(log);
    const unplacedCount = Object.values(layout.placed).filter((p) => p.status === 'unplaced').length;
    step('layout', 'done', unplacedCount ? `${unplacedCount} item(s) didn't fit` : 'Everything fits');
    checkStop();

    // Undo point before touching the scene.
    const cp = deps.checkpointPath ? await deps.checkpointPath(run.id) : null;
    if (cp) {
      await deps.blender('save_checkpoint', { name: `before-build-${run.id}`, filepath: cp });
      run.checkpoint = cp;
      log('Saved an undo checkpoint.');
    }
    run.collection = `Build ${run.id} – ${plan.summary}`.slice(0, 60);

    // 4. Structure ----------------------------------------------------------
    current = 'structure';
    if (plan.structure) {
      step('structure', 'running');
      const boxes = [...layout.floors, ...layout.walls].map((b) => ({ ...b, tags: { ...b.tags, run: run.id } }));
      await deps.blender('build_boxes', { collection: run.collection, materials: MATERIALS, boxes });
      run.structure = {
        rooms: layout.rooms.length,
        walls: layout.walls.length,
        doors: layout.openings.filter((o) => o.kind === 'door').length,
        windows: layout.openings.filter((o) => o.kind === 'window').length,
      };
      step('structure', 'done', `${run.structure.rooms} floor(s), ${run.structure.walls} wall pieces, ${run.structure.doors} door(s), ${run.structure.windows} window(s)`);
    } else {
      step('structure', 'skipped', 'Furnishing only');
    }
    checkStop();

    // 5. Place --------------------------------------------------------------
    current = 'place';
    step('place', 'running');
    await syncScene(deps, run, plan, layout, choices, (done, total) => step('place', 'running', `${done}/${total}`), checkStop, log);
    step('place', 'done', `${Object.values(layout.placed).filter((p) => p.status === 'placed').length} placed`);
    if (opts.captureImages) await capture(deps, run, layout, 'First build', 'persp', log);
    emit();

    // 6. Verify & repair ----------------------------------------------------
    current = 'verify';
    step('verify', 'running');
    let dirty = false; // edits applied since the reviewer last looked
    const triedAssets: Record<string, Set<string>> = {}; // assets already tried (and too big) per item
    for (let round = 0; round < maxRounds; round++) {
      checkStop();
      run.rounds = round + 1;
      let units = await assetUnits(deps, run.collection);

      if (round === 0) {
        // Catalog sizes can be wrong — adopt the real ones and re-solve once.
        const real = measuredDims(layout, units, dims);
        sizeMismatches(dims, real, plan.items).forEach((i) => log(i.message));
        dims = real;
      }
      let issues = verifyBuild(layout, plan.items, units);
      const errors = issues.filter((i) => i.severity === 'error' && i.code !== 'unplaced');
      step('verify', 'running', `Round ${round + 1}: ${errors.length} problem(s)`);

      if (errors.length > 0) {
        // Deterministic fix: re-solve with real sizes and move what changed.
        layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: plan.structure, origin });
        await syncScene(deps, run, plan, layout, choices, () => undefined, checkStop, log);
        units = await assetUnits(deps, run.collection);
        issues = verifyBuild(layout, plan.items, units);
        log(`Round ${round + 1}: fixed ${errors.length - issues.filter((i) => i.severity === 'error' && i.code !== 'unplaced').length} problem(s) by re-solving the layout.`);
      }

      // Items that didn't fit: first try a smaller asset, then a placeholder at the estimated size.
      const retry: Record<string, { avoid: Set<string>; smallerThan: number }> = {};
      for (const item of plan.items) {
        const p = layout.placed[item.id];
        const c = choices.get(item.id);
        if (p?.status === 'unplaced' && /No free spot/.test(p.note ?? '') && c?.kind === 'asset') {
          retry[item.id] = { avoid: new Set([...(triedAssets[item.id] ?? []), c.asset.id]), smallerThan: c.dims.dx * c.dims.dy * 0.9 };
          triedAssets[item.id] = retry[item.id].avoid;
        }
      }
      if (Object.keys(retry).length) {
        const prevChoices = choices;
        choices = await chooseAll(deps, plan, opts, preferred, sizes, prevChoices, log, checkStop, retry);
        const reused = new Set([...choices.entries()].filter(([id, c]) => prevChoices.get(id) === c).map(([id]) => id));
        dims = { ...dimsFrom(plan, choices), ...Object.fromEntries(Object.entries(dims).filter(([id]) => reused.has(id))) };
        layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: plan.structure, origin });
        await syncScene(deps, run, plan, layout, choices, () => undefined, checkStop, log);
        units = await assetUnits(deps, run.collection);
        issues = verifyBuild(layout, plan.items, units);
        const nowPlaced = Object.keys(retry).filter((id) => layout.placed[id]?.status === 'placed').length;
        log(`Round ${round + 1}: ${nowPlaced}/${Object.keys(retry).length} item(s) that didn't fit now fit after choosing something smaller.`);
      }

      const remaining = issues.filter((i) => i.severity === 'error');

      // Every round gets a skeptical review of the *current* state — not only the first build.
      const review = await reviewPlan(deps, opts, run, plan, layout, choices, remaining, catalogText, log);
      dirty = false;
      if (review.verdicts.length) run.verdicts = review.verdicts;
      if (review.note) log(`Review: ${review.note}`);
      // Nothing more the model wants to change → further rounds can't improve anything.
      if (review.edits.length === 0) break;
      const notes: string[] = [];
      plan = applyEdits(plan, review.edits, notes);
      // A swap back to an asset that already failed to fit would undo the retry — refuse it.
      for (const item of plan.items) {
        if (item.asset_id && triedAssets[item.id]?.has(item.asset_id)) {
          notes.push(`Ignored swapping "${item.what}" back to ${item.asset_id}: it already didn't fit.`);
          item.asset_id = undefined;
        }
      }
      notes.forEach(log);
      run.plan = plan;
      const prevChoices = choices;
      choices = await chooseAll(deps, plan, opts, preferred, sizes, prevChoices, log, checkStop);
      // Keep sizes measured in the scene for items that kept their asset.
      const reused = new Set([...choices.entries()].filter(([id, c]) => prevChoices.get(id) === c).map(([id]) => id));
      dims = { ...dimsFrom(plan, choices), ...Object.fromEntries(Object.entries(dims).filter(([id]) => reused.has(id))) };
      layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: plan.structure, origin });
      await syncScene(deps, run, plan, layout, choices, () => undefined, checkStop, log);
      dirty = true;
    }
    if (dirty) {
      // The last round changed things: record a verdict on the final state (further edits are only noted).
      const unitsNow = await assetUnits(deps, run.collection);
      const last = await reviewPlan(deps, opts, run, plan, layout, choices, verifyBuild(layout, plan.items, unitsNow).filter((i) => i.severity === 'error'), catalogText, log);
      if (last.verdicts.length) run.verdicts = last.verdicts;
      if (last.edits.length) log(`Reviewer still suggests ${last.edits.length} change(s); the round limit was reached.`);
    }
    step('verify', 'done', `${run.rounds} round(s)`);

    // 7. Report -------------------------------------------------------------
    current = 'report';
    step('report', 'running');
    const finalUnits = await assetUnits(deps, run.collection);
    run.issues = verifyBuild(layout, plan.items, finalUnits);
    run.checklist = checklist(plan, layout, run.issues, finalUnits, choices);
    if (opts.captureImages) {
      await capture(deps, run, layout, 'Finished — 3/4 view', 'persp', log);
      await capture(deps, run, layout, 'Finished — top view', 'top', log);
    }
    const ok = run.checklist.filter((c) => c.status === 'ok').length;
    const ph = run.checklist.filter((c) => c.status === 'placeholder').length;
    step('report', 'done', `${ok}/${run.checklist.length} items placed${ph ? `, ${ph} placeholder(s)` : ''}`);
    run.status = 'done';
    emit();
    return run;
  } catch (e: any) {
    const stopped = e instanceof Stopped;
    run.status = stopped ? 'stopped' : 'failed';
    run.error = e?.message || String(e);
    step(current, 'failed', run.error);
    return run;
  }
}

// ------------------------------------------------------------------ shared stages

export interface StageHooks {
  step: (key: StepKey, status: StepStatus, detail?: string) => void;
  log: (line: string) => void;
  emitSoon: () => void;
  checkStop: () => void;
}

/**
 * THINK: the model reasons about the request in plain language (streamed into
 * run.thinking) and ends with success criteria. Used by every pipeline, so what
 * the user sees — and what later stages are judged against — is identical.
 * Skipped when thinking is supplied (`opts.prior`, e.g. from an approved plan).
 */
export async function thinkStage(
  deps: AgentDeps,
  opts: Pick<BuildOptions, 'request' | 'brief' | 'sceneSummary' | 'catalog' | 'signal' | 'prior' | 'approvedPlan'>,
  run: BuildRun,
  h: StageHooks
): Promise<void> {
  if (opts.prior || opts.approvedPlan) {
    run.thinking = opts.prior?.thinking ?? '';
    run.criteria = opts.prior?.criteria ?? [];
    h.step('think', opts.prior ? 'done' : 'skipped', opts.prior ? 'From the plan you approved' : undefined);
    return;
  }
  h.step('think', 'running');
  try {
    const reply = await deps.llm(
      [
        { role: 'system', content: THINK_SYSTEM },
        { role: 'user', content: thinkUser(opts.request, { brief: opts.brief, scene: opts.sceneSummary, library: catalogSummary(opts.catalog), reference: run.reference?.text }) },
      ],
      {
        signal: opts.signal,
        onToken: (d) => {
          // Only the answer is the design thinking later steps follow; chain of thought stays separate.
          if (d.text) run.thinking += d.text;
          if (d.reasoning) run.reasoning = (run.reasoning ?? '') + d.reasoning;
          h.emitSoon();
        },
      }
    );
    if (!run.thinking.trim()) run.thinking = reply;
    // Inline <think> blocks are chain of thought, not the design thinking later steps follow.
    const split = splitThinkTags(run.thinking);
    if (split.reasoning) run.reasoning = [run.reasoning, split.reasoning].filter(Boolean).join('\n');
    run.thinking = split.answer || run.thinking;
    run.criteria = parseCriteria(run.thinking);
    h.step('think', 'done', run.criteria.length ? `${run.criteria.length} success criteria` : undefined);
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    h.log(`The thinking step failed (${e?.message || e}) — planning directly.`);
    h.step('think', 'skipped', 'Skipped');
  }
}

// ------------------------------------------------------------------ steps

async function makePlan(deps: AgentDeps, opts: BuildOptions, catalogText: string, run: BuildRun, log: (s: string) => void): Promise<ScenePlan> {
  const approved = (opts.preferredAssetIds ?? []).join(', ');
  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM },
    {
      role: 'user',
      content: plannerUser(opts.request, {
        brief: opts.brief, scene: opts.sceneSummary, assets: catalogText, approved,
        thinking: run.thinking.trim() || undefined, criteria: run.criteria,
      }),
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await deps.llm(messages, { signal: opts.signal, schema: PLAN_SCHEMA });
    try {
      const { plan, errors, notes } = normalizePlan(extractJson(reply));
      if (errors.length) throw new Error(errors.join(' '));
      notes.forEach(log);
      return plan;
    } catch (e: any) {
      if (attempt === 1) throw new Error(`The model's plan couldn't be used: ${e?.message || e}`);
      log('The plan reply was not valid — asking the model to correct it.');
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: REPAIR_JSON(e?.message || String(e)) });
    }
  }
  throw new Error('unreachable');
}

/**
 * Pick what fills each item: the best-ranked library asset whose real size is
 * believable for the role, else a labeled placeholder (or nothing). Items that
 * keep the same request reuse their previous choice.
 */
async function chooseAll(
  deps: AgentDeps,
  plan: ScenePlan,
  opts: BuildOptions,
  preferred: Set<string>,
  sizes: Record<string, AssetDims>,
  previous: Map<string, Choice>,
  log: (s: string) => void,
  checkStop: () => void,
  /** Items that didn't fit: assets to avoid, and a footprint area the replacement must stay under. */
  retry: Record<string, { avoid: Set<string>; smallerThan: number }> = {}
): Promise<Map<string, Choice>> {
  const out = new Map<string, Choice>();
  const ids = new Set(opts.catalog.map((a) => a.id));
  const keyOf = (i: Item) => `${i.what}|${i.asset_id ?? ''}|${(i.size ?? []).join(',')}|${retry[i.id] ? [...retry[i.id].avoid].join('+') : ''}`;

  // Unchanged items keep their earlier choice (and the object already in the scene).
  const pending = plan.items.filter((i) => {
    const prev = previous.get(i.id);
    if (prev && prev.key === keyOf(i)) {
      out.set(i.id, prev);
      return false;
    }
    return true;
  });

  // One model call maps items without a valid asset id onto the real catalog and estimates
  // sizes for items that have none — no built-in vocabulary.
  const unmatched = pending.filter((i) => !i.asset_id || !ids.has(i.asset_id) || !i.size);
  const picks = unmatched.length ? await matchWithModel(deps, opts, unmatched, ids, log) : new Map<string, string | null>();

  for (const item of pending) {
    checkStop();
    const key = keyOf(item);
    const again = retry[item.id];
    const modelPick = again ? undefined : item.asset_id && ids.has(item.asset_id) ? item.asset_id : picks.get(item.id);
    // The model said nothing in the library fits → trust it; name matching is only for when it didn't answer.
    const ranked =
      modelPick === null
        ? []
        : rankCandidates({ what: item.what, asset_id: modelPick ?? undefined }, opts.catalog, preferred).slice(0, 6);
    const rejected: string[] = [];
    let chosen: Choice | undefined;
    for (const asset of ranked) {
      if (!asset.model_path) continue;
      if (again?.avoid.has(asset.id)) continue;
      let dims = sizes[asset.id] ?? dimsOf(asset);
      if (!dims) {
        try {
          const m = await deps.blender('measure_asset', { model_path: asset.model_path });
          dims = { dx: m.dimensions[0], dy: m.dimensions[1], h: m.dimensions[2], forwardAxis: asset.forward_axis || '+Y', surface: asset.surface, category: asset.category };
          sizes[asset.id] = dims;
        } catch (e: any) {
          rejected.push(`${asset.id} couldn't be measured (${e?.message || e})`);
          continue;
        }
      }
      const why = implausible(item.size, dims, spaceFor(plan, item));
      if (!why && again && dims.dx * dims.dy >= again.smallerThan) {
        rejected.push(`${asset.id} is no smaller than the one that didn't fit`);
        continue;
      }
      if (why) {
        rejected.push(`${asset.id} ${why}`);
        continue;
      }
      chosen = { key, kind: 'asset', asset, dims };
      break;
    }
    for (const r of rejected) log(`Skipped ${r} (for "${item.what}").`);
    if (chosen) out.set(item.id, chosen);
    else if (opts.placeholders !== false) {
      const reason = rejected.length
        ? "the library's candidates don't have a believable size"
        : modelPick === null
          ? 'the model found nothing suitable in the library'
          : 'nothing like it in the library';
      out.set(item.id, { key, kind: 'placeholder', dims: placeholderDims(item), reason });
      log(`"${item.what}": using a placeholder — ${reason}.`);
    } else log(`"${item.what}": no usable asset — it will be reported as missing.`);
  }
  return out;
}

/** One model call: item → best catalog asset id (or none). Failures just mean "use text matching". */
/** item id → asset id, or null when the model judged that nothing fits. Items it skipped are absent. */
async function matchWithModel(deps: AgentDeps, opts: BuildOptions, items: Item[], ids: Set<string>, log: (s: string) => void): Promise<Map<string, string | null>> {
  const picks = new Map<string, string | null>();
  try {
    const reply = await deps.llm(
      [
        { role: 'system', content: MATCHER_SYSTEM },
        { role: 'user', content: matcherUser(items, catalogForPrompt(opts.catalog)) },
      ],
      { signal: opts.signal, schema: MATCH_SCHEMA }
    );
    const json = extractJson(reply);
    const map = json.matches && typeof json.matches === 'object' ? json.matches : json;
    for (const item of items) {
      if (!(item.id in map)) continue;
      const entry = map[item.id];
      // Accept {"asset": id, "size": [w,d,h]} and the plain id/null form.
      const raw = entry && typeof entry === 'object' ? entry.asset : entry;
      const id = typeof raw === 'string' ? raw.trim() : '';
      picks.set(item.id, id && ids.has(id) ? id : null);
      const size = entry && typeof entry === 'object' ? entry.size : undefined;
      if (!item.size && Array.isArray(size) && size.length >= 3 && size.slice(0, 3).every((n: any) => typeof n === 'number' && n > 0)) {
        item.size = [size[0], size[1], size[2]];
      }
    }
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    log(`Asset matching by the model failed (${e?.message || e}) — matching by name instead.`);
  }
  return picks;
}

function dimsFrom(plan: ScenePlan, choices: Map<string, Choice>): Record<string, AssetDims | undefined> {
  return Object.fromEntries(
    plan.items.map((i) => {
      const dims = choices.get(i.id)?.dims;
      return [i.id, dims ? { ...dims, turn: i.turn } : undefined];
    })
  );
}

async function assetUnits(deps: AgentDeps, collection?: string): Promise<(Unit & { asset_id?: string; rotation_z?: number })[]> {
  if (!collection) return [];
  const res = await deps.blender('get_layout', { collection });
  return (res.units || []).filter((u: any) => u.role === 'asset' || u.role === 'placeholder');
}

/** Make the scene match the layout: create new items, move changed ones, remove dropped ones. */
async function syncScene(
  deps: AgentDeps,
  run: BuildRun,
  plan: ScenePlan,
  layout: LayoutResult,
  choices: Map<string, Choice>,
  progress: (done: number, total: number) => void,
  checkStop: () => void,
  log: (s: string) => void
): Promise<void> {
  const units = await assetUnits(deps, run.collection);
  const unitByItem = new Map(units.filter((u) => u.item).map((u) => [u.item!, u]));
  const remove: string[] = [];
  const planned = new Set(plan.items.map((i) => i.id));
  for (const u of units) if (!u.item || !planned.has(u.item)) remove.push(u.name);

  const label = (what: string) => what.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 50);
  const todo = plan.items.filter((i) => layout.placed[i.id]?.status === 'placed' && choices.has(i.id));
  let done = 0;
  for (const item of plan.items) {
    const p = layout.placed[item.id];
    const choice = choices.get(item.id);
    let unit = unitByItem.get(item.id);
    if (!p || p.status !== 'placed' || !choice) {
      if (unit) remove.push(unit.name);
      continue;
    }
    checkStop();
    const wanted = choice.kind === 'asset' ? choice.asset.id : 'placeholder';
    if (unit && (unit.asset_id ?? '') !== wanted) {
      remove.push(unit.name);
      unit = undefined;
    }
    // Placeholder boxes have their origin at their center, assets at the bottom.
    const zOrigin = choice.kind === 'placeholder' ? p.z + choice.dims.h / 2 : p.z;
    const tags = { item: item.id, room: item.room, run: run.id, asset_id: wanted };
    if (!unit) {
      try {
        if (choice.kind === 'asset') {
          await deps.blender('import_asset', {
            model_path: choice.asset.model_path,
            asset_id: choice.asset.id,
            name: label(item.what),
            location: [p.x, p.y, p.z],
            rotation_z: p.yaw,
            collection: run.collection,
            tags,
          });
        } else {
          const { dx, dy, h } = choice.dims;
          await deps.blender('build_boxes', {
            collection: run.collection,
            materials: { 'AB Placeholder': { color: [0.95, 0.55, 0.15, 1], roughness: 0.9 } },
            boxes: [{ name: `Placeholder – ${label(item.what)}`, center: [p.x, p.y, zOrigin], size: [dx, dy, h], material: 'AB Placeholder', role: 'placeholder', tags }],
          });
          if (Math.abs(p.yaw) > 1e-6) {
            const fresh = (await assetUnits(deps, run.collection)).find((u) => u.item === item.id);
            if (fresh) await deps.blender('set_rotation', { name: fresh.name, rotation: [0, 0, p.yaw], mode: 'EULER' });
          }
        }
      } catch (e: any) {
        log(`Couldn't create "${item.what}": ${e?.message || e}`);
      }
    } else {
      const cx = (unit.bbox_min[0] + unit.bbox_max[0]) / 2;
      const cy = (unit.bbox_min[1] + unit.bbox_max[1]) / 2;
      const moved = Math.hypot(cx - p.x, cy - p.y) > 0.01 || Math.abs(unit.bbox_min[2] - p.z) > 0.01;
      const turned = Math.abs(normalize((unit.rotation_z ?? 0) - p.yaw)) > 0.01;
      if (turned) await deps.blender('set_rotation', { name: unit.name, rotation: [0, 0, p.yaw], mode: 'EULER' });
      if (moved || turned) await deps.blender('set_location', { name: unit.name, location: [p.x, p.y, zOrigin] });
    }
    progress(++done, todo.length);
  }
  if (remove.length) await deps.blender('remove_units', { names: remove });
}

const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Item id → {asset, size}. Free-form keys, so only the value shape is constrained. */
const MATCH_SCHEMA = {
  name: 'asset_matches',
  schema: {
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: { asset: { type: ['string', 'null'] }, size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } },
      required: ['asset'],
    },
  },
};

/** The space an item will live in — a physical upper bound on its size. */
function spaceFor(plan: ScenePlan, item: Item): SpaceLimits | undefined {
  const room = plan.rooms.find((r) => r.id === item.room) ?? plan.rooms[0];
  return room ? { height: room.height, span: Math.max(room.width, room.depth) } : undefined;
}

const REVIEW_SCHEMA = {
  name: 'scene_review',
  schema: {
    type: 'object',
    properties: {
      complete: { type: 'boolean' },
      note: { type: 'string' },
      criteria: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, status: { enum: ['met', 'not_met', 'cannot_judge'] }, note: { type: 'string' } }, required: ['n', 'status'] } },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { enum: ['move', 'remove', 'swap', 'add'] }, id: { type: 'string' }, item: { type: 'object' },
            what: { type: 'string' }, asset_id: { type: 'string' }, turns: { type: 'integer' },
          },
          required: ['op'],
        },
      },
    },
    required: ['complete', 'edits'],
  },
};

interface Review {
  edits: PlanEdit[];
  note: string;
  verdicts: { text: string; met: boolean | null; note?: string }[];
}

/**
 * The skeptical second opinion: reads the exact floor plan, the geometry
 * issues and the success criteria, then judges and proposes edits.
 */
async function reviewPlan(
  deps: AgentDeps,
  opts: BuildOptions,
  run: BuildRun,
  plan: ScenePlan,
  layout: LayoutResult,
  choices: Map<string, Choice>,
  issues: Issue[],
  catalogText: string,
  log: (s: string) => void
): Promise<Review> {
  const planText = [
    ...plan.rooms.map((r) => `room ${r.id} "${r.name}" ${r.width}x${r.depth} m`),
    ...plan.items.map((i) => {
      const p = layout.placed[i.id];
      const where = [i.placement, i.wall, i.corner, i.target && `target ${i.target}`, i.side].filter(Boolean).join(' ');
      const c = choices.get(i.id);
      const source = !c ? 'NO ASSET' : c.kind === 'placeholder' ? 'PLACEHOLDER' : `asset ${c.asset.id}`;
      const size = i.size ? ` ~${i.size.join('×')} m` : '';
      return `item ${i.id} "${i.what}"${size} in ${i.room}: ${where} — ${source}, ${p?.status === 'placed' ? 'placed' : `NOT PLACED (${p?.note ?? 'no asset'})`}`;
    }),
  ].join('\n');
  const issueText = issues.map((i) => `- [${i.code}] ${i.message}`).join('\n');
  const messages: LlmMessage[] = [
    { role: 'system', content: REVIEWER_SYSTEM },
    {
      role: 'user',
      content: reviewerUser(opts.request, {
        plan: planText, issues: issueText, assets: catalogText,
        criteria: run.criteria, floorplan: describeLayout(layout, plan),
      }),
    },
  ];
  try {
    const reply = await deps.llm(messages, { signal: opts.signal, schema: REVIEW_SCHEMA });
    const json = extractJson(reply);
    const edits: PlanEdit[] = (Array.isArray(json.edits) ? json.edits : []).filter(
      (e: any) => e && ['move', 'remove', 'swap', 'add'].includes(e.op)
    );
    const verdicts = (Array.isArray(json.criteria) ? json.criteria : [])
      .filter((c: any) => c && Number.isInteger(c.n) && run.criteria[c.n - 1])
      .map((c: any) => ({
        text: run.criteria[c.n - 1],
        // Older-style replies used met: true/false; anything unclear counts as "can't judge", never as met.
        met: c.status === 'met' || c.met === true ? true : c.status === 'not_met' || c.met === false ? false : null,
        note: typeof c.note === 'string' ? c.note : undefined,
      }));
    return { edits, note: typeof json.note === 'string' ? json.note : '', verdicts };
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    log(`The review step failed (${e?.message || e}) — keeping the current layout.`);
    return { edits: [], note: '', verdicts: [] };
  }
}

async function capture(deps: AgentDeps, run: BuildRun, layout: LayoutResult, label: string, view: 'persp' | 'top', log: (s: string) => void) {
  try {
    const img = await deps.blender('capture_review', {
      bbox_min: layout.bounds.min,
      bbox_max: layout.bounds.max,
      view,
      width: 720,
      height: 450,
    });
    run.images.push({ label, data: `data:image/png;base64,${img.base64}` });
    if (run.images.length > 3) run.images.splice(0, run.images.length - 3);
  } catch (e: any) {
    log(`Couldn't capture a review image: ${e?.message || e}`);
  }
}

function checklist(plan: ScenePlan, layout: LayoutResult, issues: Issue[], units: Unit[], choices: Map<string, Choice>): ChecklistEntry[] {
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const present = new Set(units.map((u) => u.item));
  return plan.items.map((item) => {
    const p = layout.placed[item.id];
    const choice = choices.get(item.id);
    const mine = issues.filter((i) => i.item === item.id || i.other === item.id);
    const base = { id: item.id, label: item.what, room: roomName.get(item.room) ?? item.room };
    if (!choice) return { ...base, status: 'missing', note: 'No usable asset in the library' };
    if (!p || p.status !== 'placed') return { ...base, status: 'missing', note: p?.note ?? 'Could not be placed' };
    if (!present.has(item.id)) return { ...base, status: 'missing', note: 'Could not be created in Blender' };
    if (mine.some((i) => i.severity === 'error')) return { ...base, status: 'issue', note: mine.map((i) => i.message).join(' ') };
    if (choice.kind === 'placeholder') return { ...base, status: 'placeholder', note: `Placeholder — ${choice.reason}` };
    return { ...base, status: 'ok', note: choice.asset.id };
  });
}
