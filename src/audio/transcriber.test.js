import { describe, expect, it } from 'vitest';
import { extractMelody, removeGhostNotes } from './transcriber.js';

const note = (pitch, start, duration, amplitude) => ({ pitch, start, duration, amplitude });

describe('removeGhostNotes', () => {
  it('drops a weaker note an octave (or two) away that sounds under a stronger one', () => {
    const real = note(60, 0, 1, 0.9);
    const ghost = note(72, 0.1, 0.8, 0.3);
    const ghost2 = note(84, 0.1, 0.8, 0.2);
    expect(removeGhostNotes([real, ghost, ghost2])).toEqual([real]);
  });

  it('keeps octave notes that are louder, or that barely overlap', () => {
    const a = note(60, 0, 1, 0.5);
    const louder = note(72, 0, 1, 0.9);
    const separate = note(48, 0.9, 1, 0.2);
    expect(removeGhostNotes([a, louder, separate])).toEqual([louder, separate]);
  });
});

describe('extractMelody', () => {
  it('keeps one note per onset — the strongest of near-simultaneous notes', () => {
    const notes = [
      note(64, 0.0, 0.5, 0.4),
      note(60, 0.02, 0.5, 0.9), // same onset, stronger
      note(67, 0.5, 0.5, 0.7),
      note(72, 1.0, 0.5, 0.6),
    ];
    expect(extractMelody(notes).map((n) => n.pitch)).toEqual([60, 67, 72]);
  });

  it('returns notes in time order', () => {
    const notes = [note(72, 1, 0.2, 1), note(60, 0, 0.2, 1)];
    expect(extractMelody(notes).map((n) => n.start)).toEqual([0, 1]);
  });
});
