/**
 * Recording the Rev2's audio output (through an audio interface) for patch
 * previews, plus waveform thumbnails.
 */

/** Ask for mic permission once so device labels become visible, then list inputs. */
export async function listAudioInputs({ requestPermission = false } = {}) {
  if (requestPermission) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

/** Open an input stream with browser voice processing off (we want the raw synth). */
export function openInput(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
  });
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Record one clip from an open stream while `play()` sounds the synth.
 * @param {MediaStream} stream
 * @param {{ play: () => void, release: () => void, holdMs: number, tailMs: number, signal?: AbortSignal }} o
 * @returns {Promise<Blob>}
 */
export async function recordClip(stream, { play, release, holdMs, tailMs, signal }) {
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
  });
  const started = new Promise((resolve) => {
    recorder.onstart = resolve;
  });
  recorder.start();
  await started;
  try {
    await sleep(40, signal); // a little pre-roll so the attack isn't clipped
    play();
    await sleep(holdMs, signal);
    release();
    await sleep(tailMs, signal);
  } finally {
    release();
    if (recorder.state !== 'inactive') recorder.stop();
  }
  return stopped;
}

/** Peak waveform (n buckets, 0..1) + overall peak from an audio blob. */
export async function analyseClip(blob, buckets = 64) {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const len = buf.length;
    const size = Math.max(1, Math.floor(len / buckets));
    const waveform = [];
    let peak = 0;
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const end = Math.min(len, (b + 1) * size);
      for (let i = b * size; i < end; i++) {
        for (const c of chans) {
          const v = Math.abs(c[i]);
          if (v > m) m = v;
        }
      }
      waveform.push(m);
      if (m > peak) peak = m;
    }
    // Normalise the thumbnail so quiet patches are still visible
    const norm = peak > 0 ? waveform.map((v) => Math.round((v / peak) * 100) / 100) : waveform;
    return { waveform: norm, peak, duration: buf.duration };
  } finally {
    ctx.close();
  }
}

/** Draw a waveform thumbnail into a canvas. */
export function drawWaveform(canvas, waveform, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 160;
  const h = canvas.clientHeight || 36;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!waveform?.length) return;
  const bw = w / waveform.length;
  g.fillStyle = color;
  waveform.forEach((v, i) => {
    const bh = Math.max(1, v * (h - 2));
    g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh);
  });
}

export { sleep };
