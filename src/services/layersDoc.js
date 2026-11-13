/**
 * "Layers doc" — both Rev2 layers as plain JSON. Used by Save / Load, the
 * Patches library and morphing.
 *
 * { type, version, exportedAt, source: 'synth'|'app'|…, name?, programs?,
 *   shared: { ab_mode, … }, layers: { A: {…}, B: {…} } }
 */
import { BANKS, PARAMS, isLayerParam } from '../midi/params.js';
import { programNameFromDump, valuesFromDump } from '../midi/sysex.js';
import { wait } from '../lib/sleep.js';

export const PATCH_FILE_TYPE = 'my-prophecy/rev2-layers';

/** Patch params saved per layer — not performance controls or synth globals. */
export const LAYER_PARAMS = PARAMS.filter(isLayerParam);
/** Patch-level params shared by both layers. */
export const SHARED_PARAMS = PARAMS.filter((p) => p.global);

/** True when `doc` looks like a layers doc. */
export function isLayersDoc(doc) {
  return doc?.type === PATCH_FILE_TYPE && typeof doc.layers === 'object' && !!doc.layers;
}

/** The layers ('A' / 'B') present in a doc. */
export function docLayers(doc) {
  return ['A', 'B'].filter((l) => doc?.layers?.[l] && typeof doc.layers[l] === 'object');
}

function pickValues(source, params) {
  const out = {};
  params.forEach((p) => {
    const v = source(p);
    if (Number.isFinite(v)) out[p.id] = v;
  });
  return out;
}

const entriesFor = (values, params) =>
  params.filter((p) => Number.isFinite(values?.[p.id])).map((p) => [p, values[p.id]]);

/**
 * @param {{
 *   midi: import('../midi/engine.js').MidiEngine,
 *   state: { bankA: number, programA: number, bankB: number, programB: number },
 *   sendParamsPaced: (entries: [object, number][]) => Promise<void>,
 *   onLayerRestored?: () => void,
 * }} deps
 */
export function createLayersService({ midi, state, sendParamsPaced, onLayerRestored }) {
  /**
   * Both layers as a layers doc. Reads the synth's edit buffer when it answers
   * (pass a raw `program` dump to skip the request); otherwise app values.
   */
  async function snapshotLayers({ program: given } = {}) {
    const appValue = (p) => midi.getValue(p.id, p.defaultValue ?? p.min ?? 0);
    let program = given;
    if (program === undefined) {
      program = midi.output && midi.input ? await midi.fetchEditBuffer() : null;
    }

    const doc = {
      type: PATCH_FILE_TYPE,
      version: 1,
      exportedAt: new Date().toISOString(),
      source: program ? 'synth' : 'app',
      programs: {
        A: { bank: BANKS[state.bankA], program: state.programA },
        B: { bank: BANKS[state.bankB], program: state.programB },
      },
      shared: pickValues(appValue, SHARED_PARAMS),
      layers: {},
    };

    for (const layer of ['A', 'B']) {
      // App's own per-layer values; the synth's dump (when it answers) wins.
      // CC-only params aren't in the dump, so those always come from the app.
      const appLayer = midi.getLayerValues(layer);
      const fromDump = program ? valuesFromDump(program, layer, PARAMS) : {};
      doc.layers[layer] = pickValues(
        (p) => (p.id in fromDump ? fromDump[p.id] : appLayer[p.id]),
        LAYER_PARAMS,
      );
    }
    if (program) {
      Object.assign(doc.shared, valuesFromDump(program, 'A', SHARED_PARAMS));
      const name = programNameFromDump(program);
      if (name) doc.name = name;
    }
    return doc;
  }

  /** Send a layers doc (shared + A and/or B) to the synth. */
  async function sendLayers(doc) {
    const original = midi.layer;
    await sendParamsPaced(entriesFor(doc.shared, SHARED_PARAMS));
    // Send the active layer last so the app's controls end up showing it
    const order = docLayers(doc).sort((a, b) => (a === original) - (b === original));
    for (const layer of order) {
      midi.setLayer(layer, { notifySynth: true });
      await wait(20);
      await sendParamsPaced(entriesFor(doc.layers[layer], LAYER_PARAMS));
    }
    midi.setLayer(original, { notifySynth: true });
    onLayerRestored?.();
  }

  return { snapshotLayers, sendLayers };
}
