import { describe, expect, it } from 'vitest';
import { MidiEngine } from './engine.js';
import { PARAMS_BY_ID } from './params.js';

/** Engine with a fake output that records every message. */
function engineWithOutput() {
  const midi = new MidiEngine();
  const sent = [];
  midi.output = { name: 'Fake', id: 'o', send: (bytes) => sent.push([...bytes]) };
  return { midi, sent };
}

/** Decode the NRPN (address, value) pairs out of CC 99/98/6/38 sequences. */
function nrpns(sent) {
  const out = [];
  let msb = 0;
  let lsb = 0;
  let data = 0;
  for (const [status, cc, v] of sent) {
    if ((status & 0xf0) !== 0xb0) continue;
    if (cc === 99) msb = v;
    else if (cc === 98) lsb = v;
    else if (cc === 6) data = v;
    else if (cc === 38) out.push([(msb << 7) | lsb, (data << 7) | v]);
  }
  return out;
}

describe('MidiEngine.setParam', () => {
  it('sends a scaled CC in CC mode', () => {
    const { midi, sent } = engineWithOutput();
    midi.setParam(PARAMS_BY_ID.filter_cutoff, PARAMS_BY_ID.filter_cutoff.max);
    expect(sent).toEqual([[0xb0, PARAMS_BY_ID.filter_cutoff.cc, 127]]);
  });

  it('sends NRPNs in NRPN mode, offset by 2048 for Layer B', () => {
    const { midi, sent } = engineWithOutput();
    midi.setProtocol('nrpn');
    const cutoff = PARAMS_BY_ID.filter_cutoff;
    midi.setParam(cutoff, 100);
    midi.setLayer('B');
    midi.setParam(cutoff, 50);
    expect(nrpns(sent)).toEqual([
      [cutoff.nrpn, 100],
      [cutoff.nrpn + 2048, 50],
    ]);
  });

  it('clamps values to the param range', () => {
    const { midi } = engineWithOutput();
    expect(midi.setParam(PARAMS_BY_ID.filter_res, 9999)).toBe(PARAMS_BY_ID.filter_res.max);
  });
});

describe('per-layer values', () => {
  it('keeps Layer A and Layer B separately when switching', () => {
    const midi = new MidiEngine();
    const cutoff = PARAMS_BY_ID.filter_cutoff;
    midi.setParam(cutoff, 77);
    midi.setLayer('B');
    expect(midi.getValue('filter_cutoff')).toBe(77); // a new layer starts from what was shown
    midi.setParam(cutoff, 47);
    midi.setLayer('A');
    expect(midi.getValue('filter_cutoff')).toBe(77);
    expect(midi.getLayerValues('B').filter_cutoff).toBe(47);
  });

  it('keeps a value that was only ever at its default when the other layer changes it', () => {
    const midi = new MidiEngine();
    const cutoff = PARAMS_BY_ID.filter_cutoff; // never set on Layer A → shows its default
    midi.setLayer('B');
    midi.setParam(cutoff, 70);
    midi.setLayer('A');
    expect(midi.getValue('filter_cutoff', -1)).toBe(cutoff.defaultValue);
    expect(midi.getLayerValues('A').filter_cutoff).toBe(cutoff.defaultValue);
    expect(midi.getLayerValues('B').filter_cutoff).toBe(70);
  });

  it('stores values for the other layer without touching what is shown', () => {
    const midi = new MidiEngine();
    midi.setParam(PARAMS_BY_ID.filter_cutoff, 10);
    midi.setParam(PARAMS_BY_ID.filter_cutoff, 99, { layer: 'B', fromHardware: true });
    expect(midi.getValue('filter_cutoff')).toBe(10);
    expect(midi.getLayerValues('B').filter_cutoff).toBe(99);
  });

  it('shares global params (A/B mode) between layers', () => {
    const midi = new MidiEngine();
    midi.setParam(PARAMS_BY_ID.ab_mode, 1);
    midi.setLayer('B');
    expect(midi.getValue('ab_mode')).toBe(1);
  });
});

describe('trackpad notes', () => {
  it('go to the selected Output on the current channel', () => {
    const { midi, sent } = engineWithOutput();
    midi.setChannel(3);
    midi.forwardTrackpad([0x90, 60, 100]);
    midi.forwardTrackpad([0x80, 60, 0]);
    expect(sent).toEqual([
      [0x93, 60, 100],
      [0x83, 60, 0],
      [0x93, 60, 0],
    ]);
  });

  it('ignore non-note messages and do nothing without an Output', () => {
    const { midi, sent } = engineWithOutput();
    midi.forwardTrackpad([0xb0, 74, 10]);
    expect(sent).toEqual([]);
    midi.output = null;
    expect(() => midi.forwardTrackpad([0x90, 60, 100])).not.toThrow();
  });
});
