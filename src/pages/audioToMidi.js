/**
 * Audio → MIDI page: record or drop audio, transcribe with Basic Pitch,
 * preview as a piano roll, then play it on the Rev2, export a .mid file, or
 * write the melody into a gated-sequencer track.
 */
import { el } from '../components/controls.js';
import { downloadBlob } from '../lib/download.js';
import { midiNoteName } from '../lib/music.js';
import { PARAMS_BY_ID } from '../midi/params.js';
import {
  decodeToModelRate,
  extractMelody,
  reextractNotes,
  removeGhostNotes,
  startRecording,
  transcribe,
} from '../audio/transcriber.js';
import { notesToMidiFile } from '../audio/midiFile.js';

const SEQ_STEPS = 16;
const STEP_MAX = 125;
const STEP_RESET = 126;

/** Survives page switches within the session. */
const store = {
  sourceName: '',
  duration: 0,
  rawNotes: [],
  backend: '',
  settings: { sensitivity: 50, minNoteMs: 120, cleanGhosts: true },
  seq: { track: 1, stepsPerSemitone: 1 },
};

function noteOptions() {
  const { sensitivity, minNoteMs } = store.settings;
  // Higher sensitivity → lower onset threshold (0.8 … 0.2)
  return { onsetThreshold: 0.8 - (sensitivity / 100) * 0.6, frameThreshold: 0.3, minNoteMs };
}

function cleanedNotes() {
  const notes = store.settings.cleanGhosts ? removeGhostNotes(store.rawNotes) : store.rawNotes;
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function velocityOf(note) {
  return Math.max(1, Math.min(127, Math.round(30 + note.amplitude * 97)));
}

/**
 * @param {{
 *   midi: import('../midi/engine.js').MidiEngine,
 *   confirmDialog: (o: object) => Promise<boolean>,
 *   sendParamsPaced: (entries: [object, number][]) => Promise<void>,
 *   onParamsChanged: () => void,
 * }} deps
 */
export function createAudioToMidiPanel({
  midi,
  confirmDialog,
  sendParamsPaced,
  onParamsChanged,
  openPanel,
}) {
  const root = el('div', { class: 'param-grid a2m' });
  let busy = false;
  let recording = null;
  let playback = null;
  let reextractTimer = null;

  /* —— Source —— */
  const source = el('section', { class: 'panel' });
  source.append(el('h2', { class: 'panel-title', text: 'Audio source' }));
  source.append(
    el('p', {
      class: 'hint',
      text: 'Record or drop a melody, riff or chord part. Works best with one instrument or voice at a time. Audio stays in your browser.',
    }),
  );
  const drop = el('div', {
    class: 'a2m-drop',
    tabindex: '0',
    role: 'button',
    'aria-label': 'Choose or drop an audio file',
  });
  drop.append(
    el('div', { class: 'a2m-drop-title', text: 'Drop an audio file here' }),
    el('div', { class: 'a2m-drop-sub', text: 'or click to choose · WAV, MP3, M4A, OGG, FLAC' }),
  );
  const fileInput = el('input', { type: 'file', accept: 'audio/*', hidden: '' });
  const recordBtn = el('button', {
    type: 'button',
    class: 'ghost-btn a2m-record',
    text: '● Record',
  });
  const sourceRow = el('div', { class: 'a2m-row' });
  sourceRow.append(recordBtn);
  const status = el('div', { class: 'a2m-status', 'aria-live': 'polite' });
  const progress = el('div', {
    class: 'a2m-progress',
    hidden: '',
    role: 'progressbar',
    'aria-label': 'Transcription progress',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  });
  const progressBar = el('div', { class: 'a2m-progress-bar' });
  progress.append(progressBar);
  source.append(drop, fileInput, sourceRow, progress, status);

  /* —— Result —— */
  const result = el('section', { class: 'panel a2m-result' });
  const resultHead = el('div', { class: 'a2m-result-head' });
  const resultTitle = el('h2', { class: 'panel-title', text: 'Notes' });
  const resultMeta = el('span', { class: 'a2m-meta' });
  resultHead.append(resultTitle, resultMeta);
  const canvas = el('canvas', {
    class: 'a2m-roll',
    'aria-label': 'Piano roll of the transcribed notes',
  });
  const empty = el('div', { class: 'a2m-empty', text: 'No transcription yet.' });

  const settings = el('div', { class: 'a2m-settings' });
  const sens = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    value: String(store.settings.sensitivity),
  });
  const sensField = el('label', { class: 'field a2m-field' });
  sensField.append(el('span', { text: 'Note sensitivity' }), sens);
  const minLen = el('select', { class: 'mac-select' });
  [50, 80, 120, 200, 300].forEach((ms) =>
    minLen.append(el('option', { value: String(ms), text: `${ms} ms` })),
  );
  minLen.value = String(store.settings.minNoteMs);
  const minLenField = el('label', { class: 'field a2m-field' });
  minLenField.append(el('span', { text: 'Shortest note' }), minLen);
  const ghost = el('input', { type: 'checkbox' });
  ghost.checked = store.settings.cleanGhosts;
  const ghostField = el('label', { class: 'a2m-check' });
  ghostField.append(ghost, el('span', { text: 'Remove octave ghost notes' }));
  settings.append(sensField, minLenField, ghostField);

  const actions = el('div', { class: 'a2m-row a2m-actions' });
  const PLAY_LABELS = { prophet: '▶ Play on Prophet', browser: '▶ Play in browser' };
  const playBtn = el('button', { type: 'button', class: 'primary-btn', text: PLAY_LABELS.prophet });
  const browserBtn = el('button', {
    type: 'button',
    class: 'ghost-btn',
    text: PLAY_LABELS.browser,
  });
  const exportBtn = el('button', { type: 'button', class: 'ghost-btn', text: 'Export .mid' });
  actions.append(playBtn, browserBtn, exportBtn);
  // Messages for play / export show here, next to those buttons
  const resultStatus = el('div', { class: 'a2m-status', 'aria-live': 'polite' });
  result.append(resultHead, empty, canvas, settings, actions, resultStatus);

  /* —— Sequencer —— */
  const seq = el('section', { class: 'panel' });
  seq.append(el('h2', { class: 'panel-title', text: 'Send to sequencer' }));
  seq.append(
    el('p', {
      class: 'hint',
      text: 'Writes the first 16 melody notes into a gated-sequencer track on Layer A or Layer B, routed to Osc All Freq (steps are relative to the lowest note). Hold the root key to hear it.',
    }),
  );
  const seqRow = el('div', { class: 'a2m-row' });
  const trackSel = el('select', { class: 'mac-select' });
  [1, 2, 3, 4].forEach((t) =>
    trackSel.append(el('option', { value: String(t), text: `Track ${t}` })),
  );
  trackSel.value = String(store.seq.track);
  const trackField = el('label', { class: 'field a2m-field' });
  trackField.append(el('span', { text: 'Track' }), trackSel);
  const scaleSel = el('select', { class: 'mac-select' });
  scaleSel.append(
    el('option', { value: '1', text: '1 step = 1 semitone' }),
    el('option', { value: '2', text: '2 steps = 1 semitone' }),
  );
  scaleSel.value = String(store.seq.stepsPerSemitone);
  const scaleField = el('label', { class: 'field a2m-field' });
  scaleField.append(el('span', { text: 'Pitch scale' }), scaleSel);
  const seqBtnA = el('button', { type: 'button', class: 'primary-btn', text: 'Send to Layer A' });
  const seqBtnB = el('button', { type: 'button', class: 'primary-btn', text: 'Send to Layer B' });
  seqRow.append(trackField, scaleField, seqBtnA, seqBtnB);
  const seqPreview = el('div', { class: 'a2m-seq-preview' });
  const seqNote = el('p', {
    class: 'hint a2m-scale-hint',
    text: 'If the melody plays with intervals that are too wide or too narrow, switch the pitch scale and send again.',
  });
  // Feedback right under the buttons (the page status is far up the page)
  const seqStatus = el('div', { class: 'a2m-status a2m-seq-status', 'aria-live': 'polite' });
  const seqStatusText = el('span');
  const showPanelBtn = el('button', {
    type: 'button',
    class: 'ghost-btn a2m-show-panel',
    text: 'Show in Panel',
    hidden: '',
  });
  showPanelBtn.addEventListener('click', () => openPanel?.());
  seqStatus.append(seqStatusText, showPanelBtn);
  seq.append(seqRow, seqStatus, seqPreview, seqNote);

  root.append(source, result, seq);

  /* —— Helpers —— */
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `a2m-status${kind ? ` is-${kind}` : ''}`;
  };
  const setProgress = (value) => {
    if (value == null) {
      progress.hidden = true;
      return;
    }
    progress.hidden = false;
    const pct = Math.round(value * 100);
    progressBar.style.width = `${pct}%`;
    progress.setAttribute('aria-valuenow', String(pct));
  };

  function melodySteps() {
    const melody = extractMelody(cleanedNotes()).slice(0, SEQ_STEPS);
    if (!melody.length) return { melody, steps: [], rootPitch: null, clipped: false };
    const rootPitch = Math.min(...melody.map((n) => n.pitch));
    let clipped = false;
    const steps = melody.map((n) => {
      const v = (n.pitch - rootPitch) * store.seq.stepsPerSemitone;
      if (v > STEP_MAX) clipped = true;
      return Math.min(STEP_MAX, v);
    });
    return { melody, steps, rootPitch, clipped };
  }

  function render() {
    const notes = cleanedNotes();
    const has = notes.length > 0;
    empty.hidden = has;
    canvas.hidden = !has;
    empty.textContent = store.sourceName
      ? 'No notes found — try raising the sensitivity or lowering the shortest note.'
      : 'No transcription yet.';
    resultMeta.textContent = store.sourceName
      ? `${store.sourceName} · ${store.duration.toFixed(1)} s · ${notes.length} notes`
      : '';
    [playBtn, browserBtn, exportBtn, sens, minLen, ghost].forEach((n) => {
      n.disabled = !store.sourceName || busy;
    });
    // While one player runs, the other is disabled (its own button is Stop)
    playBtn.disabled = !has || busy || playback?.mode === 'browser';
    browserBtn.disabled = !has || busy || playback?.mode === 'prophet';
    exportBtn.disabled = !has || busy;
    recordBtn.disabled = busy && !recording;
    drop.classList.toggle('is-disabled', busy);

    const { melody, steps, rootPitch, clipped } = melodySteps();
    seqBtnA.disabled = !melody.length || busy;
    seqBtnB.disabled = !melody.length || busy;
    seqPreview.innerHTML = '';
    if (melody.length) {
      const cells = el('div', { class: 'a2m-steps' });
      for (let i = 0; i < SEQ_STEPS; i++) {
        const cell = el('div', { class: 'a2m-step' });
        if (i < melody.length) {
          cell.append(
            el('span', { class: 'a2m-step-note', text: midiNoteName(melody[i].pitch) }),
            el('span', { class: 'a2m-step-val', text: String(steps[i]) }),
          );
        } else if (i === melody.length) {
          cell.classList.add('is-reset');
          cell.append(el('span', { class: 'a2m-step-note', text: 'Reset' }));
        } else {
          cell.classList.add('is-unused');
        }
        cells.append(cell);
      }
      seqPreview.append(cells);
      seqPreview.append(
        el('p', {
          class: `hint${clipped ? ' a2m-warn' : ''}`,
          text: `Root ${midiNoteName(rootPitch)} — hold ${midiNoteName(rootPitch)} on the Rev2 to play it.${
            clipped ? ' Some notes are too far above the root and were capped.' : ''
          }`,
        }),
      );
    }
    drawRoll(notes, new Set(melody));
  }

  function drawRoll(notes, melodySet, playheadSec = null) {
    if (!notes.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 240;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const styles = getComputedStyle(root);
    const accent = styles.getPropertyValue('--accent').trim() || '#7eb8c9';
    const faint = styles.getPropertyValue('--text-faint').trim() || '#888';

    const lo = Math.min(...notes.map((n) => n.pitch)) - 2;
    const hi = Math.max(...notes.map((n) => n.pitch)) + 2;
    const span = Math.max(store.duration, ...notes.map((n) => n.start + n.duration));
    const gutter = 34;
    const rowH = h / (hi - lo + 1);
    const x = (t) => gutter + (t / span) * (w - gutter - 4);
    const y = (p) => h - (p - lo + 1) * rowH;

    // Octave lines + labels
    g.font = '10px -apple-system, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let p = lo; p <= hi; p++) {
      if (p % 12 !== 0) continue;
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(gutter, y(p) + rowH - 0.5, w - gutter, 1);
      g.fillStyle = faint;
      g.fillText(midiNoteName(p), 4, y(p) + rowH / 2);
    }
    // Notes: melody (sequencer) notes in accent, the rest dimmer
    for (const n of notes) {
      const inMelody = melodySet.has(n);
      g.globalAlpha = 0.35 + 0.65 * Math.min(1, n.amplitude * 1.3);
      g.fillStyle = inMelody ? accent : 'rgba(200,205,215,0.55)';
      const nx = x(n.start);
      const nw = Math.max(2, x(n.start + n.duration) - nx);
      const ny = y(n.pitch) + 1;
      const nh = Math.max(2, rowH - 2);
      g.beginPath();
      g.roundRect ? g.roundRect(nx, ny, nw, nh, Math.min(3, nh / 2)) : g.rect(nx, ny, nw, nh);
      g.fill();
    }
    g.globalAlpha = 1;
    if (playheadSec != null) {
      g.fillStyle = '#ffd56a';
      g.fillRect(x(playheadSec), 0, 1.5, h);
    }
  }

  /* —— Transcription —— */
  async function runTranscription(arrayBuffer, name) {
    stopPlayback();
    busy = true;
    render();
    setProgress(0);
    try {
      let stage = '';
      setStatus('Decoding audio…');
      const { audio, duration, truncated } = await decodeToModelRate(arrayBuffer);
      if (duration < 0.25) throw new Error('The audio is too short.');
      const { notes, backend } = await transcribe(audio, noteOptions(), {
        onStatus: (text) => {
          stage = text.replace(/…$/, '');
          setStatus(text);
        },
        onProgress: (v) => {
          const pct = Math.min(100, Math.round(v * 100));
          setProgress(v);
          setStatus(`${stage || 'Transcribing'}… ${pct}%`);
        },
      });
      Object.assign(store, { sourceName: name, duration, rawNotes: notes, backend });
      const count = cleanedNotes().length;
      setStatus(
        `${count} note${count === 1 ? '' : 's'} found${truncated ? ' (only the first 10 minutes were used)' : ''}.`,
        count ? 'ok' : 'warn',
      );
    } catch (err) {
      setStatus(`Couldn’t transcribe “${name}”: ${err.message}`, 'error');
    } finally {
      busy = false;
      setProgress(null);
      render();
    }
  }

  async function handleFile(file) {
    if (!file || busy) return;
    await runTranscription(await file.arrayBuffer(), file.name);
  }

  drop.addEventListener('click', () => !busy && fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !busy) {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    handleFile(file);
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    handleFile(e.dataTransfer?.files?.[0]);
  });

  recordBtn.addEventListener('click', async () => {
    if (recording) {
      const rec = recording;
      recording = null;
      recordBtn.textContent = '● Record';
      recordBtn.classList.remove('is-recording');
      try {
        const buf = await rec.stop();
        await runTranscription(buf, `Recording ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        setStatus(`Recording failed: ${err.message}`, 'error');
      }
      return;
    }
    if (busy) return;
    try {
      recording = await startRecording({
        maxSeconds: 120,
        onTick: (s) => setStatus(`Recording… ${s.toFixed(0)} s (max 120 s)`),
      });
      recordBtn.textContent = '■ Stop & transcribe';
      recordBtn.classList.add('is-recording');
      setStatus('Recording… 0 s (max 120 s)');
    } catch (err) {
      recording = null;
      setStatus(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked — allow it in the browser’s site settings.'
          : `Couldn’t start recording: ${err.message}`,
        'error',
      );
    }
    render();
  });

  /* —— Settings → re-extract notes (no model run) —— */
  const scheduleReextract = () => {
    clearTimeout(reextractTimer);
    reextractTimer = setTimeout(async () => {
      if (!store.sourceName) return;
      try {
        store.rawNotes = await reextractNotes(noteOptions());
        render();
      } catch (err) {
        setStatus(`Couldn’t update notes: ${err.message}`, 'error');
      }
    }, 150);
  };
  sens.addEventListener('input', () => {
    store.settings.sensitivity = Number(sens.value);
    scheduleReextract();
  });
  minLen.addEventListener('change', () => {
    store.settings.minNoteMs = Number(minLen.value);
    scheduleReextract();
  });
  ghost.addEventListener('change', () => {
    store.settings.cleanGhosts = ghost.checked;
    render();
  });
  trackSel.addEventListener('change', () => {
    store.seq.track = Number(trackSel.value);
  });
  scaleSel.addEventListener('change', () => {
    store.seq.stepsPerSemitone = Number(scaleSel.value);
    render();
  });

  /* —— Playback: on the Prophet (MIDI) or in the browser (Web Audio) —— */
  const setResultStatus = (text, kind = '') => {
    resultStatus.textContent = text;
    resultStatus.className = `a2m-status${kind ? ` is-${kind}` : ''}`;
  };

  function stopPlayback() {
    if (!playback) return;
    playback.timers.forEach(clearTimeout);
    cancelAnimationFrame(playback.raf);
    if (playback.mode === 'prophet') {
      for (const [pitch, count] of playback.held) {
        for (let i = 0; i < count; i++) midi.sendNoteOff(pitch, { applyTranspose: false });
      }
    } else {
      playback.ctx?.close().catch(() => {});
    }
    playback = null;
    if (resultStatus.textContent.startsWith('Playing')) setResultStatus('');
    playBtn.textContent = PLAY_LABELS.prophet;
    browserBtn.textContent = PLAY_LABELS.browser;
    render();
  }

  /** Schedule the notes as MIDI to the Prophet. Returns the start time (performance.now ms). */
  function scheduleProphet(notes, held, timers) {
    const t0 = performance.now() + 50;
    for (const n of notes) {
      const vel = velocityOf(n);
      timers.push(
        setTimeout(
          () => {
            midi.sendNoteOn(n.pitch, vel, { applyTranspose: false });
            held.set(n.pitch, (held.get(n.pitch) || 0) + 1);
          },
          Math.max(0, t0 - performance.now() + n.start * 1000),
        ),
      );
      timers.push(
        setTimeout(
          () => {
            const c = held.get(n.pitch) || 0;
            if (c <= 0) return;
            held.set(n.pitch, c - 1);
            midi.sendNoteOff(n.pitch, { applyTranspose: false });
          },
          Math.max(0, t0 - performance.now() + (n.start + n.duration) * 1000),
        ),
      );
    }
    return t0;
  }

  /**
   * A small two-oscillator synth voice per note (detuned saws → low-pass →
   * envelope), scheduled on the audio clock so timing is sample-accurate.
   */
  function scheduleBrowser(notes, ctx) {
    const lead = 0.08;
    const master = ctx.createGain();
    master.gain.value = 0.16;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    const base = ctx.currentTime + lead;
    for (const n of notes) {
      const t = base + n.start;
      const end = t + Math.max(0.05, n.duration);
      const freq = 440 * 2 ** ((n.pitch - 69) / 12);
      const peak = 0.35 + 0.65 * Math.min(1, n.amplitude * 1.3);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(Math.min(12000, freq * 8 * peak + 400), t);
      filter.frequency.setTargetAtTime(Math.min(8000, freq * 3 + 300), t + 0.02, 0.25);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.008);
      env.gain.setTargetAtTime(peak * 0.6, t + 0.01, 0.15);
      env.gain.setTargetAtTime(0, end, 0.06);
      filter.connect(env).connect(master);
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(end + 0.5);
      }
    }
    return performance.now() + lead * 1000;
  }

  async function startPlayback(mode) {
    if (playback) {
      const same = playback.mode === mode;
      stopPlayback();
      if (same) return;
    }
    if (mode === 'prophet' && !midi.output) {
      setResultStatus(
        'No MIDI output is connected — open the MIDI pill (top right) to connect the Prophet, or use Play in browser.',
        'error',
      );
      return;
    }
    const notes = cleanedNotes();
    if (!notes.length) return;
    const melodySet = new Set(extractMelody(notes).slice(0, SEQ_STEPS));
    const timers = [];
    const held = new Map();
    let ctx = null;
    let t0;
    if (mode === 'prophet') {
      t0 = scheduleProphet(notes, held, timers);
    } else {
      ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      t0 = scheduleBrowser(notes, ctx);
    }
    const end = Math.max(...notes.map((n) => n.start + n.duration));
    timers.push(setTimeout(stopPlayback, t0 - performance.now() + end * 1000 + 300));
    playback = { mode, timers, held, ctx, raf: 0 };
    (mode === 'prophet' ? playBtn : browserBtn).textContent = '■ Stop';
    setResultStatus(mode === 'prophet' ? 'Playing on the Prophet…' : 'Playing in the browser…');
    render();
    const tick = () => {
      if (!playback) return;
      drawRoll(notes, melodySet, Math.max(0, (performance.now() - t0) / 1000));
      playback.raf = requestAnimationFrame(tick);
    };
    playback.raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => startPlayback('prophet'));
  browserBtn.addEventListener('click', () => startPlayback('browser'));

  /* —— Export .mid —— */
  exportBtn.addEventListener('click', () => {
    const notes = cleanedNotes();
    if (!notes.length) return;
    const bytes = notesToMidiFile(
      notes.map((n) => ({ ...n, velocity: velocityOf(n) })),
      { name: store.sourceName },
    );
    const base =
      store.sourceName
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w\- ]+/g, '')
        .trim() || 'transcription';
    downloadBlob(new Blob([bytes], { type: 'audio/midi' }), `${base}.mid`);
    setResultStatus(`Exported ${base}.mid (${notes.length} notes).`, 'ok');
  });

  /* —— Send to the gated sequencer —— */
  /** Write the melody into a sequencer track of the chosen layer. */
  async function sendToSequencer(layer) {
    const { melody, steps, rootPitch } = melodySteps();
    if (!melody.length) return;
    const setSeqStatus = (text, kind = '', showPanel = false) => {
      seqStatusText.textContent = text;
      seqStatus.className = `a2m-status a2m-seq-status${kind ? ` is-${kind}` : ''}`;
      showPanelBtn.hidden = !showPanel;
    };
    const track = store.seq.track;
    const connected = !!midi.output;
    const ok = await confirmDialog({
      title: `Overwrite Layer ${layer}, track ${track}?`,
      message: `This writes ${melody.length} notes (root ${midiNoteName(rootPitch)}) into sequencer track ${track} of Layer ${layer}, routes it to Osc All Freq and turns Layer ${layer}’s gated sequencer on. The track’s current steps and destination on Layer ${layer} will be overwritten${
        connected
          ? ' in the app and on the synth.'
          : ' in the app’s sequencer. No MIDI output is connected, so nothing is sent to the synth yet.'
      }`,
      confirmLabel: `Send to Layer ${layer}`,
      danger: true,
    });
    if (!ok) return;

    const destParam = PARAMS_BY_ID[`seq${track}_dest`];
    const oscAll = destParam?.options?.indexOf('Osc All Freq') ?? -1;
    const entries = [];
    if (PARAMS_BY_ID.seq_type) entries.push([PARAMS_BY_ID.seq_type, 0]); // Gated
    if (PARAMS_BY_ID.gated_on) entries.push([PARAMS_BY_ID.gated_on, 1]);
    if (destParam && oscAll >= 0) entries.push([destParam, oscAll]);
    for (let i = 0; i < SEQ_STEPS; i++) {
      const param = PARAMS_BY_ID[`seq_t${track}_s${i + 1}`];
      if (!param) continue;
      const value = i < steps.length ? steps[i] : i === steps.length ? STEP_RESET : 0;
      entries.push([param, value]);
    }
    seqBtnA.disabled = true;
    seqBtnB.disabled = true;
    setSeqStatus(`Writing Layer ${layer}, track ${track}…`);
    // Point the synth (and the app) at the target layer while sending, then go back
    const original = midi.layer;
    try {
      midi.setLayer(layer, { notifySynth: true });
      await new Promise((r) => setTimeout(r, 20));
      await sendParamsPaced(entries);
      onParamsChanged();
      const where = connected
        ? 'in the app and on the synth'
        : 'in the app (not sent — no MIDI output)';
      const hint =
        layer === 'B'
          ? ' In the Panel it shows under Edit B; on the synth Layer B is heard with Stack or Split.'
          : '';
      setSeqStatus(
        `Layer ${layer}, track ${track} filled ${where}. Hold ${midiNoteName(rootPitch)} to play it.${hint}`,
        connected ? 'ok' : 'warn',
        true,
      );
    } finally {
      midi.setLayer(original, { notifySynth: true });
      render();
    }
  }

  seqBtnA.addEventListener('click', () => sendToSequencer('A'));
  seqBtnB.addEventListener('click', () => sendToSequencer('B'));

  // Redraw the roll when the page width changes
  const ro = new ResizeObserver(() => render());
  ro.observe(canvas);
  root._teardown = () => {
    ro.disconnect();
    stopPlayback();
    recording?.cancel();
    recording = null;
  };

  if (store.sourceName) setStatus(`Last transcription: ${store.sourceName}.`);
  render();
  return root;
}
