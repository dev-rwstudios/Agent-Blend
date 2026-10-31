/**
 * Builds the extra system context sent with each message, so the model knows
 * which project (or none) it's working in. Kept compact — local models with
 * small context windows have to fit this alongside the chat history.
 */

import { CatalogAsset, ProjectMeta, SceneInfo } from '../types';
import { matchCatalogToText } from './curator';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function catalogOverview(catalog: CatalogAsset[]): string {
  if (catalog.length === 0) return 'No asset library is configured.';
  const counts: Record<string, number> = {};
  for (const a of catalog) counts[a.category] = (counts[a.category] || 0) + 1;
  const cats = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} (${n})`)
    .join(', ');
  return `${catalog.length} assets — ${cats}.`;
}

function assetLines(assets: CatalogAsset[]): string {
  return assets
    .map((a) => {
      const d = a.dimensions_m;
      const size = d ? ` — ${d.width}×${d.depth}×${d.height} m` : '';
      return `- ${a.id}${size}`;
    })
    .join('\n');
}

/** Context for a chat inside a project: its brief, the live scene, and relevant assets. */
export function projectContext(
  project: ProjectMeta,
  scene: SceneInfo | null,
  sceneLoaded: boolean,
  catalog: CatalogAsset[],
  prompt: string
): string {
  const lines = [
    `ACTIVE PROJECT: "${project.name}"`,
    project.description ? `Project brief: ${clip(project.description, 600)}` : '',
  ];

  if (sceneLoaded && scene) {
    const names = (scene.objects || []).slice(0, 40).map((o) => `${o.name} (${o.type})`).join(', ');
    lines.push(`Current Blender scene: ${scene.object_count} objects${names ? ` — ${names}` : ''}.`);
  } else {
    lines.push('The project scene is not currently open in Blender.');
  }

  lines.push(`Project asset library: ${catalogOverview(catalog)}`);
  const relevant = matchCatalogToText(prompt, 15, catalog);
  if (relevant.length > 0) {
    lines.push(`Assets matching this request (use these asset_id values with import_asset):\n${assetLines(relevant)}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Context for a general chat: no scene attached, but it knows every project and the asset library. */
export function generalContext(projects: ProjectMeta[], catalog: CatalogAsset[], prompt: string): string {
  const lines = [
    'GENERAL CHAT — this conversation is not attached to any project or Blender scene.',
    'You cannot change Blender from here: never output a ```json:tools block. If the user wants to build or edit a scene, tell them to open that project (or create one) from the sidebar.',
    'Answer questions about the user\'s projects, the asset library, and Blender in general.',
  ];

  if (projects.length === 0) {
    lines.push('The user has no projects yet.');
  } else {
    lines.push(`The user's projects (${projects.length}):`);
    for (const p of projects.slice(0, 25)) {
      const s = p.sceneSummary;
      const scene = s
        ? `${s.objectCount} objects${s.objectNames.length ? ` (${s.objectNames.slice(0, 12).join(', ')})` : ''}`
        : 'scene not saved yet';
      const updated = new Date(p.updatedAt).toLocaleDateString();
      lines.push(`- "${p.name}" — ${clip(p.description || 'no description', 160)} — ${scene} — ${p.assetSources.length} asset source(s) — updated ${updated}`);
    }
  }

  lines.push(`Asset library: ${catalogOverview(catalog)}`);
  const relevant = matchCatalogToText(prompt, 20, catalog);
  if (relevant.length > 0) lines.push(`Assets matching this question:\n${assetLines(relevant)}`);
  return lines.join('\n');
}
