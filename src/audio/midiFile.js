/**
 * Minimal Standard MIDI File (format 0) writer for transcribed notes.
 * 120 BPM, 480 ticks per quarter → 960 ticks per second.
 */

const PPQ = 480;
const TEMPO_US = 500000; // 120 BPM
const TICKS_PER_SECOND = (PPQ * 1e6) / TEMPO_US;

const MTHD = [0x4d, 0x54, 0x68, 0x64]; // "MThd"
const MTRK = [0x4d, 0x54, 0x72, 0x6b]; // "MTrk"
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u24 = (n) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function varLen(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

/**
 * @param {{ start: number, duration: number, pitch: number, velocity: number }[]} notes
 * @param {{ channel?: number, name?: string }} [opts]
 * @returns {Uint8Array}
 */
export function notesToMidiFile(notes, { channel = 0, name = 'Transcription' } = {}) {
  const ch = channel & 0x0f;
  const events = [];
  for (const n of notes) {
    const on = Math.round(n.start * TICKS_PER_SECOND);
    const off = Math.max(on + 1, Math.round((n.start + n.duration) * TICKS_PER_SECOND));
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
    events.push({ tick: on, order: 1, bytes: [0x90 | ch, pitch, vel] });
    events.push({ tick: off, order: 0, bytes: [0x80 | ch, pitch, 0] });
  }
  // Note-offs before note-ons at the same tick so repeated pitches retrigger
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  const nameBytes = [...new TextEncoder().encode(name)];
  track.push(0x00, 0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes);
  track.push(0x00, 0xff, 0x51, 0x03, ...u24(TEMPO_US)); // set tempo
  let lastTick = 0;
  for (const e of events) {
    track.push(...varLen(e.tick - lastTick), ...e.bytes);
    lastTick = e.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [...MTHD, ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ)]; // format 0, 1 track
  const trackChunk = [...MTRK, ...u32(track.length), ...track];
  return new Uint8Array([...header, ...trackChunk]);
}
