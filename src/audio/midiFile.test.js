import { describe, expect, it } from 'vitest';
import { notesToMidiFile } from './midiFile.js';

/** Minimal SMF reader for the bits we write. */
function readMidi(bytes) {
  const b = [...bytes];
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const header = {
    id: String.fromCharCode(...b.slice(0, 4)),
    length: u32(4),
    format: u16(8),
    tracks: u16(10),
    ppq: u16(12),
  };
  let i = 14;
  const trackId = String.fromCharCode(...b.slice(i, i + 4));
  const trackLength = u32(i + 4);
  i += 8;
  const end = i + trackLength;
  let tick = 0;
  const events = [];
  const varLen = () => {
    let v = 0;
    for (;;) {
      const c = b[i++];
      v = (v << 7) | (c & 0x7f);
      if (c < 0x80) return v;
    }
  };
  while (i < end) {
    tick += varLen();
    const status = b[i];
    if (status === 0xff) {
      const type = b[i + 1];
      const len = b[i + 2];
      events.push({ tick, meta: type, data: b.slice(i + 3, i + 3 + len) });
      i += 3 + len;
    } else {
      events.push({ tick, status, data: b.slice(i + 1, i + 3) });
      i += 3;
    }
  }
  return { header, trackId, trackLength, endMatches: i === b.length, events };
}

describe('notesToMidiFile', () => {
  it('writes a valid format-0 file with tempo, name and end-of-track', () => {
    const midi = readMidi(notesToMidiFile([], { name: 'Test' }));
    expect(midi.header).toEqual({ id: 'MThd', length: 6, format: 0, tracks: 1, ppq: 480 });
    expect(midi.trackId).toBe('MTrk');
    expect(midi.endMatches).toBe(true);
    const metas = midi.events.filter((e) => e.meta != null);
    expect(metas[0]).toMatchObject({ meta: 0x03 });
    expect(String.fromCharCode(...metas[0].data)).toBe('Test');
    expect(metas[1]).toMatchObject({ meta: 0x51, data: [0x07, 0xa1, 0x20] }); // 500000 µs = 120 BPM
    expect(metas.at(-1).meta).toBe(0x2f);
  });

  it('converts seconds to ticks at 120 BPM (960 ticks/s) and clamps values', () => {
    const midi = readMidi(
      notesToMidiFile([{ start: 0.5, duration: 0.25, pitch: 60, velocity: 200 }], { channel: 2 }),
    );
    const notes = midi.events.filter((e) => e.status != null);
    expect(notes).toEqual([
      { tick: 480, status: 0x92, data: [60, 127] },
      { tick: 720, status: 0x82, data: [60, 0] },
    ]);
  });

  it('orders a note-off before a note-on at the same tick (repeated pitches retrigger)', () => {
    const midi = readMidi(
      notesToMidiFile([
        { start: 0, duration: 0.5, pitch: 64, velocity: 100 },
        { start: 0.5, duration: 0.5, pitch: 64, velocity: 100 },
      ]),
    );
    const atHalf = midi.events.filter((e) => e.status != null && e.tick === 480);
    expect(atHalf.map((e) => e.status & 0xf0)).toEqual([0x80, 0x90]);
  });
});
