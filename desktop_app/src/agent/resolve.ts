/**
 * Choosing catalog assets for plan items — generic, for any asset library.
 *
 * Nothing here knows what a "sofa" or a "tv" is. The model picks assets by id
 * from the real catalog and estimates each item's real-world size; this module
 * ranks text matches as a fallback and rejects assets whose actual size is far
 * from the estimate (wrong scale, broken exports, mislabeled files).
 *
 * Pure module (node --test).
 */

import type { CatalogAsset } from '../types.ts';
import type { AssetDims } from './layout.ts';
import type { Item } from './plan.ts';

const words = (text: string) =>
  [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 3))].map((w) =>
    w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w
  );

/** Does an asset made for `roomTypes` belong in a space used as `purpose`? Unknown → yes. */
export function roomFits(purpose: string | undefined, roomTypes: string[] | null | undefined): boolean {
  if (!purpose || !roomTypes || roomTypes.length === 0) return true;
  const want = words(purpose);
  const have = roomTypes.flatMap((t) => words(t.replace(/_/g, ' ')));
  return want.some((w) => have.includes(w));
}

export interface RankOptions {
  preferred?: Set<string>;
  /** What the room is used for — assets whose room_types match are ranked higher. */
  purpose?: string;
  /** Only these asset ids may be used (e.g. the assets the user approved in the bucket). */
  only?: Set<string>;
}

/** Text-match fallback: catalog assets sharing words with the item, best first. */
export function rankCandidates(item: Pick<Item, 'what' | 'asset_id'>, catalog: CatalogAsset[], preferred: Set<string> | RankOptions = new Set()): CatalogAsset[] {
  const opts: RankOptions = preferred instanceof Set ? { preferred } : preferred;
  const terms = words(item.what);
  const scored: { asset: CatalogAsset; score: number }[] = [];
  for (const asset of catalog) {
    if (opts.only && !opts.only.has(asset.id)) continue;
    if (asset.id === item.asset_id) {
      scored.push({ asset, score: 1000 });
      continue;
    }
    const fields = [
      { text: (asset.subcategory || '').toLowerCase(), weight: 3 },
      { text: `${asset.name} ${asset.id}`.toLowerCase(), weight: 2 },
      { text: [asset.category, ...(asset.style_tags ?? []), ...(asset.room_types ?? [])].join(' ').toLowerCase(), weight: 1 },
    ];
    let score = 0;
    for (const t of terms) for (const f of fields) if (f.text.includes(t)) score += f.weight;
    if (score === 0) continue;
    if (opts.preferred?.has(asset.id)) score += 2;
    if (opts.purpose) score += roomFits(opts.purpose, asset.room_types) ? (asset.room_types?.length ? 2 : 0) : -2;
    scored.push({ asset, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.asset);
}

/** The space an object will live in — a physical upper bound on how big it can be. */
export interface SpaceLimits {
  height: number;
  /** Longest side of the room's floor. */
  span: number;
}

/**
 * Why an asset can't stand in for an item of the expected size, or null if it
 * can. Compares the longest footprint side (orientation-independent) and the
 * height, allowing a generous 2.5× either way plus a few cm for tiny parts.
 * Even with no estimate, an object can't be taller than its room or wider than
 * most of it — that alone catches broken exports.
 */
export function implausible(expected: [number, number, number] | undefined, dims: AssetDims, space?: SpaceLimits): string | null {
  const size = `${dims.dx.toFixed(2)}×${dims.dy.toFixed(2)}×${dims.h.toFixed(2)} m`;
  if (Math.max(dims.dx, dims.dy, dims.h) < 0.005) return `is ${size} (empty or broken geometry)`;
  if (space) {
    if (dims.h > space.height - 0.05) return `is ${size}: taller than the ${space.height.toFixed(1)} m room`;
    if (Math.max(dims.dx, dims.dy) > space.span * 0.85) return `is ${size}: bigger than the room it would go in`;
  }
  if (!expected) return null;
  const within = (actual: number, want: number) => actual >= want / 2.5 - 0.05 && actual <= want * 2.5 + 0.05;
  const side = Math.max(dims.dx, dims.dy);
  const wantSide = Math.max(expected[0], expected[1]);
  if (!within(side, wantSide) || !within(dims.h, expected[2])) {
    return `is ${size}, far from the expected ~${expected.map((v) => v.toFixed(2)).join('×')} m`;
  }
  return null;
}

export function dimsOf(asset: CatalogAsset): AssetDims | undefined {
  const d = asset.dimensions_m;
  if (!d || !(d.width > 0) || !(d.depth > 0) || !(d.height > 0)) return undefined;
  return { dx: d.width, dy: d.depth, h: d.height, forwardAxis: asset.forward_axis || '+Y', surface: asset.surface, category: asset.category };
}

/** Stand-in size for an item with no usable asset: the model's estimate. */
export function placeholderDims(item: Pick<Item, 'size'>): AssetDims {
  const [dx, dy, h] = item.size ?? [0.6, 0.6, 0.8];
  return { dx, dy, h, forwardAxis: '+Y', category: 'placeholder' };
}

/** One line: how many assets per category — enough for the thinking step to know what exists. */
export function catalogSummary(catalog: CatalogAsset[]): string {
  const counts = new Map<string, number>();
  for (const a of catalog) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  return counts.size ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ') : 'empty';
}

/**
 * Compact asset list for prompts, grouped by category. Long catalogs are
 * capped so the prompt fits small context windows; the model can still ask
 * for anything by description and the text fallback searches everything.
 */
export function catalogForPrompt(catalog: CatalogAsset[], maxEntries = 300): string {
  // Sizes are deliberately left out: shown a size, a small model copies it as its own
  // "estimate", which makes a broken asset look right. Real sizes are checked in code.
  const groups = new Map<string, CatalogAsset[]>();
  for (const a of catalog) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)!).push(a);
  const perCategory = Math.max(4, Math.floor(maxEntries / Math.max(groups.size, 1)));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, list]) => {
      const entries = list.slice(0, perCategory).map((a) => a.id);
      const more = list.length > perCategory ? ` …+${list.length - perCategory} more` : '';
      return `${cat}: ${entries.join(', ')}${more}`;
    })
    .join('\n');
}
