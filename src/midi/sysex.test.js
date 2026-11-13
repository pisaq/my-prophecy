import { describe, expect, it } from 'vitest';
import {
  DSI_ID,
  LAYER_B_OFFSET,
  MSG_EDIT_BUFFER_DUMP,
  REV2_ID,
  SYSEX_INDEX_BY_NRPN,
  parseEditBufferDump,
  programNameFromDump,
  unpackMsBits,
  valuesFromDump,
} from './sysex.js';
import { PARAMS, PARAMS_BY_ID } from './params.js';

/** Pack program bytes into DSI "packed MS bit" format (inverse of unpackMsBits). */
function pack(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    let ms = 0;
    chunk.forEach((v, b) => {
      if (v & 0x80) ms |= 1 << b;
    });
    out.push(ms, ...chunk.map((v) => v & 0x7f));
  }
  return out;
}

const dump = (data) => [0xf0, DSI_ID, REV2_ID, MSG_EDIT_BUFFER_DUMP, ...pack(data), 0xf7];

describe('unpackMsBits', () => {
  it('round-trips bytes including the high bit', () => {
    const data = Array.from({ length: 2046 }, (_, i) => (i * 37) % 256);
    expect(unpackMsBits(pack(data))).toEqual(data);
  });
});

describe('parseEditBufferDump', () => {
  it('accepts a Rev2 edit-buffer dump with or without F0/F7', () => {
    const data = new Array(2046).fill(0).map((_, i) => i % 100);
    expect(parseEditBufferDump(dump(data))).toEqual(data);
    expect(parseEditBufferDump(dump(data).slice(1, -1))).toEqual(data);
  });

  it('rejects other SysEx', () => {
    expect(parseEditBufferDump([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7])).toBeNull();
    expect(parseEditBufferDump([])).toBeNull();
  });
});

describe('valuesFromDump', () => {
  it('reads Layer A and Layer B (offset) values and clamps to the param range', () => {
    const cutoff = PARAMS_BY_ID.filter_cutoff;
    const idx = SYSEX_INDEX_BY_NRPN[cutoff.nrpn];
    const data = new Array(2046).fill(0);
    data[idx] = 77;
    data[LAYER_B_OFFSET + idx] = 250; // above max → clamped
    expect(valuesFromDump(data, 'A', PARAMS).filter_cutoff).toBe(77);
    expect(valuesFromDump(data, 'B', PARAMS).filter_cutoff).toBe(cutoff.max);
  });
});

describe('programNameFromDump', () => {
  const withName = (name, layer = 'A') => {
    const data = new Array(2046).fill(0);
    const start = (layer === 'B' ? LAYER_B_OFFSET : 0) + 235;
    name
      .padEnd(20, ' ')
      .split('')
      .forEach((c, i) => (data[start + i] = c.charCodeAt(0)));
    return data;
  };

  it('reads and trims the 20-character name', () => {
    expect(programNameFromDump(withName('Warm Pad'))).toBe('Warm Pad');
    expect(programNameFromDump(withName('Layer B Lead', 'B'), 'B')).toBe('Layer B Lead');
  });

  it('returns null when the bytes are not printable text', () => {
    expect(programNameFromDump(new Array(2046).fill(0))).toBeNull();
    expect(programNameFromDump(withName('                    '))).toBeNull();
  });
});
