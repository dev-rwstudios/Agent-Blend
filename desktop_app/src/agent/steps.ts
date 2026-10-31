/**
 * The general plan: an ordered list of build steps, in free text.
 *
 * Nothing in this schema names a kind of scene. A step is "what to build, where,
 * how big" plus a few checkable facts about what done looks like. Pure module
 * (node --test).
 */

export type StepStatus = 'pending' | 'running' | 'passed' | 'unchecked' | 'unmet' | 'failed';

export interface WorkStep {
  id: string;
  title: string;
  /** What to build, with real sizes and positions, in meters (ground z = 0). */
  goal: string;
  /** Facts that can be checked from object sizes/positions or a render. */
  done_when: string[];
  status: StepStatus;
  attempts: number;
  /** Why it is unmet/failed, or what the critic could not judge. */
  note?: string;
  /** How many objects the accepted attempt created. */
  created: number;
  /** The code of the last attempt — shown to the user, so nothing the agent does is hidden. */
  code?: string;
}

export interface StepsPlan {
  summary: string;
  steps: WorkStep[];
}

export const MAX_STEPS = 12;

export const STEPS_SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: 'build_steps',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            goal: { type: 'string' },
            done_when: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'goal'],
        },
      },
    },
    required: ['summary', 'steps'],
  },
};

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'step';
}

export interface NormalizedSteps {
  plan: StepsPlan;
  errors: string[];
  notes: string[];
}

/** Turn the model's JSON into a clean step list, or explain why it can't be used. */
export function normalizeSteps(raw: any): NormalizedSteps {
  const notes: string[] = [];
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { plan: { summary: '', steps: [] }, errors: ['The plan is not a JSON object.'], notes };

  const rawSteps: any[] = Array.isArray(raw.steps) ? raw.steps : [];
  const used = new Set<string>();
  const steps: WorkStep[] = [];
  let overflow = 0;
  for (const s of rawSteps) {
    const title = str(s?.title, 80) || str(s?.goal, 60);
    const goal = str(s?.goal, 700) || title;
    if (!title) {
      notes.push('Skipped a step with no title or goal.');
      continue;
    }
    if (steps.length >= MAX_STEPS) {
      overflow++;
      continue;
    }
    let id = slug(str(s?.id, 40) || title);
    for (let n = 2; used.has(id); n++) id = `${slug(str(s?.id, 40) || title)}_${n}`;
    used.add(id);
    const done = (Array.isArray(s?.done_when) ? s.done_when : []).map((d: unknown) => str(d, 220)).filter(Boolean).slice(0, 5);
    steps.push({ id, title, goal, done_when: done, status: 'pending', attempts: 0, created: 0 });
  }
  if (overflow) notes.push(`Only the first ${MAX_STEPS} steps are used.`);
  if (steps.length === 0) errors.push('The plan has no usable steps.');
  return { plan: { summary: str(raw.summary, 160) || 'Scene build', steps }, errors, notes };
}

/** A step to add after review found something missing. */
export function makeFixStep(raw: any, existing: WorkStep[]): WorkStep | null {
  const norm = normalizeSteps({ summary: '', steps: [raw] });
  const step = norm.plan.steps[0];
  if (!step) return null;
  let id = step.id;
  const ids = new Set(existing.map((s) => s.id));
  for (let n = 2; ids.has(id); n++) id = `${step.id}_${n}`;
  return { ...step, id };
}

/** The Python from a model reply: a ```python block (closed or not), else the whole reply. */
export function extractCode(reply: string): string {
  const closed = reply.match(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/i);
  if (closed) return closed[1].trim();
  const open = reply.match(/```(?:python|py)?[ \t]*\r?\n([\s\S]*)$/i);
  if (open) return open[1].trim();
  return reply.trim();
}
