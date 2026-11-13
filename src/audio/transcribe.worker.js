/**
 * Basic Pitch transcription worker.
 * Keeps TensorFlow.js + the model off the main thread so the UI and MIDI
 * timing stay smooth. Holds the last raw model output so note settings can be
 * re-applied without running the model again.
 *
 * Messages in:
 *   { type: 'transcribe', id, audio: Float32Array (22050 Hz mono), modelUrl, options }
 *   { type: 'notes', id, options }            — re-run note extraction only
 * Messages out:
 *   { type: 'status', id, text }
 *   { type: 'progress', id, value }           — 0..1
 *   { type: 'result', id, notes, backend }
 *   { type: 'error', id, message }
 */
// Keep first: patches a tfjs-in-worker bug before tfjs evaluates
import './worker-shim.js';
import * as tf from '@tensorflow/tfjs';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

/** Model frames per second (22050 / 256). */
const FRAMES_PER_SECOND = 22050 / 256;

let basicPitch = null;
/** Id of the request in flight, so stray async errors can be reported to it. */
let currentId = null;

// tfjs can fail inside its own un-awaited promises; without this the page
// would wait forever (stuck at 0%) instead of showing the error.
self.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  postMessage({ type: 'error', id: currentId, message: e.reason?.message || String(e.reason) });
});
self.addEventListener('error', (e) => {
  postMessage({ type: 'error', id: currentId, message: e.message || 'Transcription worker error' });
});
let backend = null;
/** @type {{ frames: number[][], onsets: number[][], contours: number[][] } | null} */
let last = null;

async function ensureModel(modelUrl, id) {
  if (basicPitch) return;
  postMessage({ type: 'status', id, text: 'Loading model…' });
  // WebGL in a worker needs OffscreenCanvas; fall back to CPU if unavailable
  for (const name of ['webgl', 'cpu']) {
    try {
      if (await tf.setBackend(name)) break;
    } catch {
      /* try next backend */
    }
  }
  await tf.ready();
  backend = tf.getBackend();
  const model = tf.loadGraphModel(modelUrl);
  await model;
  basicPitch = new BasicPitch(model);
}

function extractNotes(options = {}) {
  if (!last) return [];
  const {
    onsetThreshold = 0.5,
    frameThreshold = 0.3,
    minNoteMs = 120,
    minHz = null,
    maxHz = null,
  } = options;
  const minNoteFrames = Math.max(1, Math.round((minNoteMs / 1000) * FRAMES_PER_SECOND));
  // outputToNotesPoly mutates its inputs — work on copies so settings can be re-applied
  const frames = last.frames.map((r) => r.slice());
  const onsets = last.onsets.map((r) => r.slice());
  const events = outputToNotesPoly(
    frames,
    onsets,
    onsetThreshold,
    frameThreshold,
    minNoteFrames,
    true,
    maxHz,
    minHz,
    true,
  );
  return noteFramesToTime(addPitchBendsToNoteEvents(last.contours, events)).map((n) => ({
    start: n.startTimeSeconds,
    duration: n.durationSeconds,
    pitch: n.pitchMidi,
    amplitude: n.amplitude,
  }));
}

self.onmessage = async ({ data }) => {
  const { id } = data;
  currentId = id;
  try {
    if (data.type === 'transcribe') {
      await ensureModel(data.modelUrl, id);
      postMessage({ type: 'status', id, text: 'Transcribing…' });
      const frames = [];
      const onsets = [];
      const contours = [];
      await basicPitch.evaluateModel(
        data.audio,
        (f, o, c) => {
          frames.push(...f);
          onsets.push(...o);
          contours.push(...c);
        },
        (p) => postMessage({ type: 'progress', id, value: p }),
      );
      last = { frames, onsets, contours };
      postMessage({ type: 'result', id, notes: extractNotes(data.options), backend });
    } else if (data.type === 'notes') {
      postMessage({ type: 'result', id, notes: extractNotes(data.options), backend });
    }
  } catch (err) {
    postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
