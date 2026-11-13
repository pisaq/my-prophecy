/**
 * Audio → notes: decoding, recording, worker orchestration and note clean-up.
 */

export const MODEL_SAMPLE_RATE = 22050;
/** Longest audio we transcribe (seconds) — keeps memory and wait time sane. */
export const MAX_SECONDS = 600;

const MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`;

let worker = null;
let nextId = 1;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' });
  }
  return worker;
}

function callWorker(message, { onStatus, onProgress } = {}) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.type === 'status') onStatus?.(data.text);
      else if (data.type === 'progress') onProgress?.(data.value);
      else if (data.type === 'result' || data.type === 'error') {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        if (data.type === 'result') resolve(data);
        else reject(new Error(data.message));
      }
    };
    const onError = (e) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(new Error(e.message || 'Transcription worker failed'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ ...message, id }, message.audio ? [message.audio.buffer] : []);
  });
}

/**
 * Decode any browser-supported audio and resample to 22050 Hz mono.
 * @returns {Promise<{ audio: Float32Array, duration: number }>}
 */
export async function decodeToModelRate(arrayBuffer) {
  if (!arrayBuffer?.byteLength) {
    throw new Error(
      'The file is empty (0 bytes) — the download probably didn’t finish. Download it again and retry.',
    );
  }
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      'The browser couldn’t read this audio file. It may be damaged or incomplete, or in a format the browser doesn’t support — try a WAV or MP3.',
    );
  } finally {
    ctx.close();
  }
  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const length = Math.max(1, Math.ceil(seconds * MODEL_SAMPLE_RATE));
  // A 1-channel destination down-mixes stereo to mono while resampling
  const offline = new OfflineAudioContext(1, length, MODEL_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return {
    audio: rendered.getChannelData(0).slice(),
    duration: seconds,
    truncated: decoded.duration > MAX_SECONDS,
  };
}

/** Run the model; resolves with raw (uncleaned) notes. */
export async function transcribe(audio, options, callbacks) {
  const res = await callWorker(
    { type: 'transcribe', audio, modelUrl: MODEL_URL, options },
    callbacks,
  );
  return { notes: res.notes, backend: res.backend };
}

/** Re-extract notes from the last model output with new settings (fast). */
export async function reextractNotes(options) {
  const res = await callWorker({ type: 'notes', options });
  return res.notes;
}

/**
 * Remove octave "ghost" notes: a note 12 or 24 semitones from a stronger note
 * that sounds over most of its length is usually a harmonic, not a real note.
 * (Idea from the YaronKoresh/basic-pitch fork.)
 */
export function removeGhostNotes(notes) {
  const keep = [];
  for (const n of notes) {
    const nEnd = n.start + n.duration;
    const ghost = notes.some((m) => {
      if (m === n) return false;
      const diff = Math.abs(m.pitch - n.pitch);
      if (diff !== 12 && diff !== 24) return false;
      if (m.amplitude <= n.amplitude) return false;
      const overlap = Math.min(nEnd, m.start + m.duration) - Math.max(n.start, m.start);
      return overlap >= 0.6 * n.duration;
    });
    if (!ghost) keep.push(n);
  }
  return keep;
}

/**
 * One note per onset, in time order — the strongest of notes starting within
 * `groupMs` of each other. Used for the 16-step sequencer.
 */
export function extractMelody(notes, groupMs = 60) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const melody = [];
  for (const n of sorted) {
    const prev = melody[melody.length - 1];
    if (prev && (n.start - prev.start) * 1000 < groupMs) {
      if (n.amplitude > prev.amplitude) melody[melody.length - 1] = n;
    } else {
      melody.push(n);
    }
  }
  return melody;
}

/**
 * Record from the microphone. Returns a controller; `stop()` resolves with the
 * recorded audio as an ArrayBuffer.
 */
export async function startRecording({ maxSeconds = 120, onTick } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Raw signal — browser voice processing smears pitch
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const started = performance.now();
  let stopTimer = null;
  const tick = setInterval(() => onTick?.((performance.now() - started) / 1000), 200);

  const done = new Promise((resolve, reject) => {
    recorder.onstop = async () => {
      clearInterval(tick);
      clearTimeout(stopTimer);
      stream.getTracks().forEach((t) => t.stop());
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        resolve(await blob.arrayBuffer());
      } catch (err) {
        reject(err);
      }
    };
    recorder.onerror = (e) => reject(e.error || new Error('Recording failed'));
  });
  recorder.start();
  stopTimer = setTimeout(
    () => recorder.state === 'recording' && recorder.stop(),
    maxSeconds * 1000,
  );

  return {
    stop() {
      if (recorder.state === 'recording') recorder.stop();
      return done;
    },
    cancel() {
      if (recorder.state === 'recording') recorder.stop();
      done.catch(() => {});
    },
  };
}
