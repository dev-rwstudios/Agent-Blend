/**
 * Reference images: read the picture into a build brief, and later compare what
 * was built with it. Both use `deps.vision` (a model that can see), which may be
 * a different model from the one that writes code.
 *
 * If the user attached an image and no vision model can read it, the run stops
 * with a clear message — building from the words alone would silently ignore
 * what they showed.
 */

import type { AgentDeps, BuildOptions, BuildRun, StageHooks } from './buildAgent.ts';
import { Stopped } from './buildAgent.ts';
import { extractJson } from './plan.ts';
import { COMPARE_SCHEMA, COMPARE_SYSTEM, REFERENCE_SYSTEM, compareUser, referenceUser } from './prompts.ts';

export const NEEDS_VISION =
  "You attached an image, but no model that can read images is set up. In Settings, choose a Vision model (a vision-capable model loaded in LM Studio, or a hosted one such as Claude or GPT-4o).";

/** Key-feature lines from the end of the analysis. */
export function parseKeyFeatures(text: string): string[] {
  const at = text.search(/key features\s*:?/i);
  if (at < 0) return [];
  return text
    .slice(at)
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 3)
    .slice(0, 10);
}

/** READ the reference image(s) into run.reference.text, streamed. No-op without a reference. */
export async function referenceStage(
  deps: AgentDeps,
  opts: Pick<BuildOptions, 'request' | 'brief' | 'reference' | 'signal'>,
  run: BuildRun,
  h: StageHooks
): Promise<void> {
  const ref = opts.reference;
  if (!ref?.images?.length) return;
  run.reference = { images: ref.images, text: ref.text ?? '' };
  if (ref.text) {
    h.step('reference', 'done', 'Already read');
    return;
  }
  if (!deps.vision) {
    run.reference.error = NEEDS_VISION;
    h.step('reference', 'failed', 'No vision model');
    throw new Error(NEEDS_VISION);
  }
  h.step('reference', 'running');
  try {
    const reply = await deps.vision(
      [
        { role: 'system', content: REFERENCE_SYSTEM },
        { role: 'user', content: referenceUser(opts.request, opts.brief), images: ref.images },
      ],
      {
        signal: opts.signal,
        onToken: (d) => {
          run.reference!.text += d.text ?? '';
          h.emitSoon();
        },
      }
    );
    if (!run.reference.text.trim()) run.reference.text = reply;
    const features = parseKeyFeatures(run.reference.text);
    h.step('reference', 'done', features.length ? `${features.length} key features` : undefined);
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    run.reference.error = e?.message || String(e);
    h.step('reference', 'failed', run.reference.error ?? undefined);
    throw new Error(run.reference.error ?? 'The reference image could not be read.');
  }
}

export interface Comparison {
  similarity: number | null;
  differences: string[];
  fix_steps: any[];
}

/**
 * COMPARE the finished renders with the reference image. Returns concrete
 * differences and up to two fix steps. Never throws (a failed comparison just
 * means no extra fixes); a Stop is re-raised.
 */
export async function compareStage(
  deps: AgentDeps,
  opts: Pick<BuildOptions, 'request' | 'signal'>,
  run: BuildRun,
  renders: string[],
  stateText: string,
  log: (s: string) => void
): Promise<Comparison> {
  const empty: Comparison = { similarity: null, differences: [], fix_steps: [] };
  if (!deps.vision || !run.reference || renders.length === 0) return empty;
  try {
    const reply = await deps.vision(
      [
        { role: 'system', content: COMPARE_SYSTEM },
        {
          role: 'user',
          content: compareUser({ request: opts.request, reference: run.reference.text.slice(0, 1500), state: stateText }),
          images: [...run.reference.images.slice(0, 1), ...renders.slice(-3)],
        },
      ],
      { signal: opts.signal, schema: COMPARE_SCHEMA }
    );
    const json = extractJson(reply);
    const similarity = typeof json.similarity === 'number' ? Math.max(0, Math.min(10, json.similarity)) : null;
    const differences = (Array.isArray(json.differences) ? json.differences : []).filter((d: unknown) => typeof d === 'string' && d.trim()).slice(0, 8);
    run.reference.similarity = similarity ?? undefined;
    run.reference.differences = differences;
    log(`Compared with the reference image: similarity ${similarity ?? '?'}/10${differences.length ? `, ${differences.length} difference(s)` : ''}.`);
    return { similarity, differences, fix_steps: Array.isArray(json.fix_steps) ? json.fix_steps : [] };
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Stopped('Stopped by you.');
    log(`The comparison with the reference image failed (${e?.message || e}).`);
    return empty;
  }
}
