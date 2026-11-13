import { describe, expect, it } from 'vitest';
import { layerDistance, morphLayer, rankSimilar, soundingLayers } from './similarity.js';
import { PARAMS_BY_ID } from '../midi/params.js';

const base = { filter_cutoff: 20, filter_res: 10, osc1_shape: 1, amp_attack: 0 };

describe('layerDistance', () => {
  it('is 0 for identical layers and grows with the difference', () => {
    expect(layerDistance(base, { ...base })).toBe(0);
    const near = layerDistance(base, { ...base, filter_cutoff: 30 });
    const far = layerDistance(base, { ...base, filter_cutoff: 160 });
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(1);
  });

  it('treats menus as same/different, not by numeric distance', () => {
    const d1 = layerDistance(base, { ...base, osc1_shape: 2 });
    const d2 = layerDistance(base, { ...base, osc1_shape: 4 });
    expect(d1).toBe(d2);
  });
});

describe('soundingLayers', () => {
  it('ignores Layer B unless A/B mode is Stack or Split', () => {
    const doc = { shared: { ab_mode: 0 }, layers: { A: { a: 1 }, B: { b: 1 } } };
    expect(soundingLayers(doc)).toEqual([{ a: 1 }]);
    expect(soundingLayers({ ...doc, shared: { ab_mode: 1 } })).toHaveLength(2);
  });
});

describe('rankSimilar', () => {
  it('ranks closest first and skips entries without settings or the reference itself', () => {
    const entries = [
      { id: 'far', doc: { layers: { A: { ...base, filter_cutoff: 160, filter_res: 90 } } } },
      { id: 'near', doc: { layers: { A: { ...base, filter_cutoff: 25 } } } },
      { id: 'self', doc: { layers: { A: base } } },
      { id: 'nodoc', doc: null },
    ];
    const ranked = rankSimilar(base, entries, { excludeId: 'self' });
    expect(ranked.map((r) => r.entry.id)).toEqual(['near', 'far']);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });
});

describe('morphLayer', () => {
  const a = { filter_cutoff: 20, osc1_shape: 1 };
  const b = { filter_cutoff: 120, osc1_shape: 4 };

  it('blends knob values and flips menus at the midpoint', () => {
    expect(morphLayer(a, b, 0)).toMatchObject(a);
    expect(morphLayer(a, b, 1)).toMatchObject(b);
    expect(morphLayer(a, b, 0.5).filter_cutoff).toBe(70);
    expect(morphLayer(a, b, 0.49).osc1_shape).toBe(1);
    expect(morphLayer(a, b, 0.5).osc1_shape).toBe(4);
  });

  it('only produces per-layer params', () => {
    const out = morphLayer({ ab_mode: 1, ...a }, { ab_mode: 2, ...b }, 0.5);
    expect(out.ab_mode).toBeUndefined();
    expect(PARAMS_BY_ID.filter_cutoff).toBeDefined();
  });
});
