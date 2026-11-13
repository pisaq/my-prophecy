import { describe, expect, it, vi } from 'vitest';
import { MidiEngine } from '../midi/engine.js';
import { PARAMS_BY_ID } from '../midi/params.js';
import { PATCH_FILE_TYPE, createLayersService, docLayers, isLayersDoc } from './layersDoc.js';

const state = { bankA: 0, programA: 5, bankB: 1, programB: 9 };

describe('isLayersDoc / docLayers', () => {
  it('recognises layers files and lists their layers', () => {
    expect(isLayersDoc({ type: PATCH_FILE_TYPE, layers: { A: {} } })).toBe(true);
    expect(isLayersDoc({ type: 'something-else', layers: {} })).toBe(false);
    expect(isLayersDoc(null)).toBe(false);
    expect(docLayers({ layers: { B: {}, A: {} } })).toEqual(['A', 'B']);
    expect(docLayers({ layers: { A: 1 } })).toEqual([]);
  });
});

describe('createLayersService', () => {
  it('snapshots both layers from the app when the synth does not answer', async () => {
    const midi = new MidiEngine(); // no output → no dump request
    midi.setParam(PARAMS_BY_ID.filter_cutoff, 40, { silent: true });
    midi.setLayer('B');
    midi.setParam(PARAMS_BY_ID.filter_cutoff, 90, { silent: true });
    midi.setLayer('A');
    const { snapshotLayers } = createLayersService({ midi, state, sendParamsPaced: vi.fn() });

    const doc = await snapshotLayers();
    expect(doc.type).toBe(PATCH_FILE_TYPE);
    expect(doc.source).toBe('app');
    expect(doc.programs).toEqual({ A: { bank: 'U1', program: 5 }, B: { bank: 'U2', program: 9 } });
    expect(doc.layers.A.filter_cutoff).toBe(40);
    expect(doc.layers.B.filter_cutoff).toBe(90);
    expect(doc.layers.A.ab_mode).toBeUndefined(); // shared params live in doc.shared
    expect('ab_mode' in doc.shared).toBe(true);
  });

  it('sends shared params first, the other layer next, and the active layer last', async () => {
    const midi = new MidiEngine();
    const calls = [];
    const sendParamsPaced = vi.fn(async (entries) => {
      calls.push({ layer: midi.layer, ids: entries.map(([p]) => p.id) });
    });
    const onLayerRestored = vi.fn();
    const { sendLayers } = createLayersService({ midi, state, sendParamsPaced, onLayerRestored });

    await sendLayers({
      type: PATCH_FILE_TYPE,
      shared: { ab_mode: 1 },
      layers: { A: { filter_cutoff: 10 }, B: { filter_cutoff: 20 } },
    });
    expect(calls.map((c) => c.ids)).toEqual([['ab_mode'], ['filter_cutoff'], ['filter_cutoff']]);
    expect(calls.map((c) => c.layer)).toEqual(['A', 'B', 'A']);
    expect(midi.layer).toBe('A');
    expect(onLayerRestored).toHaveBeenCalledOnce();
  });
});
