/**
 * App state: what's restored from localStorage on start and saved as you go.
 */
import { MENU_GROUPS, PARAMS_BY_ID } from '../midi/params.js';
import { clamp } from '../lib/math.js';
import { createPersister, loadSettings } from './persistence.js';

/**
 * Restore the saved session into a fresh state object and the MIDI engine.
 * @param {import('../midi/engine.js').MidiEngine} midi
 */
export function restoreAppState(midi) {
  const saved = loadSettings();
  const state = {
    section: 'panel',
    bankA: 0,
    programA: 0,
    bankB: 0,
    programB: 0,
    keyboardOctave: 3,
  };
  if (!saved) return { state, saved };

  if (typeof saved.section === 'string' && MENU_GROUPS.some((g) => g.id === saved.section)) {
    state.section = saved.section;
  }
  if (Number.isFinite(saved.bankA)) state.bankA = clamp(saved.bankA, 0, 7);
  if (Number.isFinite(saved.programA)) state.programA = clamp(saved.programA, 0, 127);
  if (Number.isFinite(saved.bankB)) state.bankB = clamp(saved.bankB, 0, 7);
  if (Number.isFinite(saved.programB)) state.programB = clamp(saved.programB, 0, 127);
  if (Number.isFinite(saved.keyboardOctave)) {
    state.keyboardOctave = clamp(saved.keyboardOctave, 0, 8);
  }
  if (saved.values && typeof saved.values === 'object') {
    for (const [id, raw] of Object.entries(saved.values)) {
      const param = PARAMS_BY_ID[id];
      if (!param || !Number.isFinite(raw)) continue;
      // fromHardware: restore UI state without blasting MIDI on refresh
      midi.setParam(param, raw, { silent: true, fromHardware: true });
    }
  }
  if (saved.connection) {
    const c = saved.connection;
    if (Number.isFinite(c.channel)) midi.setChannel(c.channel);
    if (c.protocol) midi.setProtocol(c.protocol);
    if (c.layer) midi.setLayer(c.layer);
    if (c.midiThru != null) midi.setMidiThru(c.midiThru);
  }
  if (saved.layerValues) midi.restoreLayerValues(saved.layerValues);
  return { state, saved };
}

/** Debounced saver for the session (state + connection + both layers' values). */
export function createAppPersister({ state, midi, saved }) {
  return createPersister(() => ({
    section: state.section,
    bankA: state.bankA,
    programA: state.programA,
    bankB: state.bankB,
    programB: state.programB,
    keyboardOctave: state.keyboardOctave,
    connection: {
      outputName: midi.output?.name ?? saved?.connection?.outputName ?? null,
      inputName: midi.input?.name ?? saved?.connection?.inputName ?? null,
      channel: midi.channel,
      protocol: midi.protocol,
      layer: midi.layer,
      midiThru: midi.midiThru,
    },
    values: Object.fromEntries(midi.values),
    layerValues: { A: midi.getLayerValues('A'), B: midi.getLayerValues('B') },
  }));
}
