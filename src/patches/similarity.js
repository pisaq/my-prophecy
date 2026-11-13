/**
 * Patch similarity + morphing over parameter values.
 * (Nearest-neighbour idea from spotify/voyager — brute force is instant at
 * library sizes of a few thousand patches.)
 */
import { PARAMS, isLayerParam } from '../midi/params.js';

/** Sound-shaping groups; sequencer / arp / clock don't change the timbre. */
const SOUND_GROUPS = new Set([
  'oscillators',
  'filter',
  'amp',
  'env3',
  'lfos',
  'modulation',
  'fx',
  'voice',
]);
/** Extra weight on the params that define a sound most. */
const WEIGHTS = {
  osc1_shape: 2,
  osc2_shape: 2,
  osc_mix: 1.5,
  filter_cutoff: 2.5,
  filter_res: 1.5,
  filter_env_amt: 1.5,
  filter_attack: 1.5,
  filter_decay: 1.5,
  filter_sustain: 1.5,
  filter_release: 1.5,
  amp_attack: 2,
  amp_decay: 1.5,
  amp_sustain: 1.5,
  amp_release: 2,
  fx_type: 1.5,
  fx_mix: 1.5,
};

export const SOUND_PARAMS = PARAMS.filter((p) => isLayerParam(p) && SOUND_GROUPS.has(p.group));

const isCategorical = (p) => p.type === 'enum' || p.type === 'toggle';

/**
 * Distance in 0..1 between two layer value maps (missing params are skipped).
 * Root-mean-square, so a few big differences (e.g. cutoff) count for more
 * than many tiny ones — a plain mean squashes every score towards 100%.
 */
export function layerDistance(a, b) {
  if (!a || !b) return 1;
  let sum = 0;
  let weight = 0;
  for (const p of SOUND_PARAMS) {
    const va = a[p.id];
    const vb = b[p.id];
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    const w = WEIGHTS[p.id] ?? 1;
    const d = isCategorical(p) ? (va === vb ? 0 : 1) : Math.abs(va - vb) / (p.max - p.min || 1);
    sum += w * d * d;
    weight += w;
  }
  return weight ? Math.sqrt(sum / weight) : 1;
}

/**
 * Layers that actually sound: Layer A, plus Layer B when A/B mode is Stack or
 * Split (an unused Layer B is usually the init patch and would match anything).
 */
export function soundingLayers(doc) {
  const stacked = (doc?.shared?.ab_mode ?? 0) > 0;
  return (stacked ? ['A', 'B'] : ['A']).map((l) => doc?.layers?.[l]).filter(Boolean);
}

/** Best match: the reference against each sounding layer of the entry. */
export function patchDistance(refLayer, doc) {
  let layers = soundingLayers(doc);
  if (!layers.length) layers = ['A', 'B'].map((l) => doc?.layers?.[l]).filter(Boolean);
  if (!layers.length) return 1;
  return Math.min(...layers.map((l) => layerDistance(refLayer, l)));
}

/**
 * Rank entries by similarity to `refLayer`.
 * @returns {{ entry: object, similarity: number }[]} most similar first
 */
export function rankSimilar(refLayer, entries, { excludeId = null, limit = 10 } = {}) {
  return entries
    .filter((e) => e.doc && e.id !== excludeId)
    .map((entry) => ({ entry, similarity: 1 - patchDistance(refLayer, entry.doc) }))
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, limit);
}

/**
 * Interpolate two layer value maps. Continuous params blend; switches and
 * menus flip at the halfway point.
 */
export function morphLayer(a, b, t) {
  const out = {};
  for (const p of PARAMS) {
    if (!isLayerParam(p)) continue;
    const va = a?.[p.id];
    const vb = b?.[p.id];
    if (!Number.isFinite(va) && !Number.isFinite(vb)) continue;
    if (!Number.isFinite(va)) out[p.id] = vb;
    else if (!Number.isFinite(vb)) out[p.id] = va;
    else if (isCategorical(p) || p.group === 'sequencer') out[p.id] = t < 0.5 ? va : vb;
    else out[p.id] = Math.round(va + (vb - va) * t);
  }
  return out;
}
