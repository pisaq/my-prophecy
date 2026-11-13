/**
 * QWERTY → MIDI piano (Ableton-style two-row layout).
 * Base note is C of the current octave (default C3 = 48).
 *
 *   2 3   5 6 7   9 0
 * Q W E R T Y U I O P
 *   S D   G H J
 * Z X C V B N M
 *
 * [ / ] — octave down / up
 */

const KEY_OFFSETS = {
  // Lower row (white + black)
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ',': 12,
  l: 13,
  '.': 14,
  ';': 15,
  '/': 16,
  // Upper row (one octave higher start)
  q: 12,
  2: 13,
  w: 14,
  3: 15,
  e: 16,
  r: 17,
  5: 18,
  t: 19,
  6: 20,
  y: 21,
  7: 22,
  u: 23,
  i: 24,
  9: 25,
  o: 26,
  0: 27,
  p: 28,
};

function typingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

/**
 * @param {import('./engine.js').MidiEngine} midi
 * @param {{ initialOctave?: number, onOctave?: (oct: number) => void, onNote?: (note: number, down: boolean) => void }} [hooks]
 */
export function bindComputerKeyboard(midi, hooks = {}) {
  let octave = Math.max(0, Math.min(8, Math.round(hooks.initialOctave ?? 3)));
  const held = new Map(); // code → midi note actually sent

  const baseNote = () => Math.max(0, Math.min(127, (octave + 1) * 12));

  const setOctave = (next) => {
    octave = Math.max(0, Math.min(8, next));
    hooks.onOctave?.(octave);
  };

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typingTarget(e.target)) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === '[' || key === '-') {
      e.preventDefault();
      if (!e.repeat) setOctave(octave - 1);
      return;
    }
    if (key === ']' || key === '=') {
      e.preventDefault();
      if (!e.repeat) setOctave(octave + 1);
      return;
    }

    if (!(key in KEY_OFFSETS)) return;
    if (e.repeat || held.has(e.code)) return;

    e.preventDefault();
    const note = Math.max(0, Math.min(127, baseNote() + KEY_OFFSETS[key]));
    const sent = midi.sendNoteOn(note, 110);
    held.set(e.code, sent ?? note);
    hooks.onNote?.(sent ?? note, true);
  };

  const onKeyUp = (e) => {
    const note = held.get(e.code);
    if (note == null) return;
    held.delete(e.code);
    // Already absolute MIDI note from sendNoteOn (transpose applied once)
    midi.sendNoteOff(note, { applyTranspose: false });
    hooks.onNote?.(note, false);
  };

  const onBlur = () => {
    for (const note of held.values()) {
      midi.sendNoteOff(note, { applyTranspose: false });
      hooks.onNote?.(note, false);
    }
    held.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  hooks.onOctave?.(octave);

  return {
    getOctave: () => octave,
    setOctave,
    dispose() {
      onBlur();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
