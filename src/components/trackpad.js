import { el } from './controls.js';
import { TRACKPAD_API, trackpadStart, trackpadStatus, trackpadStop } from '../midi/trackpadApi.js';

const LOW_C = 36;
const HIGH_C = 96;

/**
 * Compact XY pitch pad for embedding (e.g. Panel performance rail).
 * @param {import('../midi/engine.js').MidiEngine} midi
 */
export function createTrackpadEmbed(midi) {
  const root = el('div', { class: 'hw-trackpad' });
  const { surface, teardown } = mountPitchSurface(midi, {
    compact: true,
    hideReadout: true,
  });
  root.append(surface);
  root._teardown = teardown;
  return root;
}

/**
 * Trackpad / pointer XY pitch surface + real-trackpad companion controls.
 */
export function createTrackpadPanel(midi) {
  const panel = el('section', { class: 'panel trackpad-panel' });
  panel.append(el('h2', { class: 'panel-title', text: 'Trackpad pitch' }));

  const controls = el('div', { class: 'trackpad-controls' });
  const toggleBtn = el('button', {
    type: 'button',
    class: 'primary-btn trackpad-toggle',
    text: 'Enable real trackpad',
  });
  const status = el('span', { class: 'trackpad-status', text: 'Checking…' });
  controls.append(toggleBtn, status);
  panel.append(controls);

  const help = el('div', { class: 'banner info trackpad-help', hidden: 'true' });
  help.append(
    el('strong', { text: 'Companion required (once): ' }),
    el('span', {
      text: 'Published sites can’t start Mac programs. Download/run the trackpad companion, leave it open, then use Enable here. ',
    }),
  );
  const launch = el('code', { text: 'npm run trackpad:daemon' });
  help.append(launch);
  help.append(el('span', { text: '  ·  or double-click ' }));
  help.append(el('code', { text: 'Start Trackpad Companion.command' }));
  help.append(
    el('span', {
      text: `  ·  API ${TRACKPAD_API}`,
    }),
  );
  panel.append(help);

  panel.append(
    el('p', {
      class: 'hint',
      text: 'Notes from the real trackpad go to the MIDI Output selected in the connection settings.',
    }),
  );
  panel.append(
    el('p', {
      class: 'hint',
      text: 'Fallback: click/hold on the pad. Left = lowest C, right = highest C. Top = higher, bottom = lower.',
    }),
  );

  const { surface, readout, teardown: padTeardown } = mountPitchSurface(midi, { compact: false });
  panel.append(surface, readout);

  let running = false;
  let companionUp = false;
  let pollTimer = null;

  const setUi = (state, message) => {
    companionUp = true;
    help.hidden = true;
    running = !!state?.running;
    toggleBtn.disabled = false;
    toggleBtn.textContent = running ? 'Disable real trackpad' : 'Enable real trackpad';
    toggleBtn.classList.toggle('danger', running);
    status.textContent = message || (running ? '' : 'Companion ready · capture off');
    status.classList.toggle('on', running);
  };

  const setUnavailable = () => {
    companionUp = false;
    running = false;
    help.hidden = false;
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Enable real trackpad';
    toggleBtn.classList.remove('danger');
    status.textContent =
      'Companion not running — start it, then Enable works on any host (even a published site).';
    status.classList.remove('on');
  };

  async function refreshStatus() {
    try {
      const data = await trackpadStatus();
      setUi(data);
      return data;
    } catch {
      setUnavailable();
      return null;
    }
  }

  toggleBtn.addEventListener('click', async () => {
    if (!companionUp && !running) {
      await refreshStatus();
      if (!companionUp) return;
    }
    toggleBtn.disabled = true;
    status.textContent = running ? 'Stopping…' : 'Starting…';
    try {
      if (running) {
        const data = await trackpadStop();
        setUi(data, 'Companion ready · capture off');
        midi.allNotesOff();
      } else {
        const data = await trackpadStart();
        setUi(data);
      }
    } catch (err) {
      status.textContent = err.message || 'Failed';
      status.classList.remove('on');
      await refreshStatus();
    } finally {
      toggleBtn.disabled = !companionUp;
    }
  });

  refreshStatus();
  pollTimer = setInterval(refreshStatus, 2000);

  panel._teardown = () => {
    padTeardown();
    if (pollTimer) clearInterval(pollTimer);
  };
  return panel;
}

/**
 * @param {import('../midi/engine.js').MidiEngine} midi
 * @param {{ compact?: boolean, hideReadout?: boolean }} [opts]
 */
function mountPitchSurface(midi, { compact = false, hideReadout = false } = {}) {
  const surface = el('div', {
    class: `pitch-pad${compact ? ' pitch-pad-compact' : ''}`,
    role: 'application',
    tabindex: '0',
    'aria-label': 'Pitch trackpad',
  });
  const grid = el('div', { class: 'pitch-pad-grid', 'aria-hidden': 'true' });
  const cross = el('div', { class: 'pitch-pad-cross', 'aria-hidden': 'true' });
  const finger = el('div', { class: 'pitch-pad-finger', hidden: 'true' });
  const readout = hideReadout
    ? null
    : el('div', {
        class: `pitch-pad-readout${compact ? ' pitch-pad-readout-compact' : ''}`,
        text: '— · idle',
      });
  const labels = el('div', { class: 'pitch-pad-labels', 'aria-hidden': 'true' });
  labels.innerHTML = compact
    ? `
    <span class="pl-tl">↑</span>
    <span class="pl-tr">${noteName(HIGH_C)}</span>
    <span class="pl-bl">${noteName(LOW_C)}</span>
    <span class="pl-br">↓</span>
  `
    : `
    <span class="pl-tl">high</span>
    <span class="pl-tr">${noteName(HIGH_C)}</span>
    <span class="pl-bl">${noteName(LOW_C)}</span>
    <span class="pl-br">low</span>
  `;
  surface.append(grid, cross, finger, labels);

  let armed = false;
  let currentNote = null;

  const release = () => {
    if (currentNote != null) {
      midi.sendNoteOff(currentNote);
      currentNote = null;
    }
    armed = false;
    finger.hidden = true;
    surface.classList.remove('playing');
    if (readout) readout.textContent = '— · idle';
  };

  const playAt = (clientX, clientY, pressure) => {
    const rect = surface.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((clientY - rect.top) / rect.height, 0, 1);
    const note = noteFromXY(x, y);
    const velocity = velocityFromPressure(pressure);
    finger.hidden = false;
    finger.style.left = `${x * 100}%`;
    finger.style.top = `${y * 100}%`;
    surface.classList.add('playing');
    if (readout) {
      readout.textContent = compact
        ? `${noteName(note)} · ${velocity}`
        : `${noteName(note)} · ${note} · vel ${velocity}`;
    }
    if (currentNote === note) return;
    if (currentNote != null) midi.sendNoteOff(currentNote);
    midi.sendNoteOn(note, velocity);
    currentNote = note;
  };

  surface.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    armed = true;
    playAt(e.clientX, e.clientY, e.pressure);
  });
  surface.addEventListener('pointermove', (e) => {
    if (!armed) return;
    playAt(e.clientX, e.clientY, e.pressure);
  });
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);
  surface.addEventListener('lostpointercapture', release);
  surface.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      release();
      midi.allNotesOff();
    }
  });

  return {
    surface,
    readout,
    teardown: release,
  };
}

export function noteFromXY(x, y) {
  const fromX = LOW_C + x * (HIGH_C - LOW_C);
  const fromY = HIGH_C - y * (HIGH_C - LOW_C);
  return Math.round(clamp((fromX + fromY) / 2, LOW_C, HIGH_C));
}

function velocityFromPressure(pressure) {
  if (!pressure || pressure <= 0) return 100;
  return Math.round(clamp(40 + pressure * 87, 1, 127));
}

function noteName(n) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
