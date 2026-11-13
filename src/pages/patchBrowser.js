/**
 * Patches page:
 *  1. Record previews — step through a bank, play a test note on each program
 *     and record the Rev2's audio output (plus its settings via SysEx).
 *  2. Library — browse by listening, load patches back onto the synth.
 *  3. Find similar — rank the library by closeness to the current sound,
 *     and morph between two patches.
 */
import { el } from '../components/controls.js';
import { BANKS } from '../midi/params.js';
import { deletePatch, listPatches, newId, putPatch, upsertSlot } from '../patches/library.js';
import {
  analyseClip,
  drawWaveform,
  listAudioInputs,
  openInput,
  recordClip,
  sleep,
} from '../patches/capture.js';
import { morphLayer, rankSimilar } from '../patches/similarity.js';
import { midiNoteName } from '../lib/music.js';
import { LAYER_PARAMS, PATCH_FILE_TYPE, isLayersDoc } from '../services/layersDoc.js';

/** Settings that survive page switches (not persisted across reloads). */
const prefs = {
  deviceId: '',
  bank: 0,
  from: 0,
  to: 15,
  note: 48,
  holdMs: 1500,
  tailMs: 1000,
  readSettings: true,
  filter: '',
  show: 'all',
  morph: { a: '', b: '', t: 50, live: true },
};

const SOURCE_LABELS = { morph: 'blend', file: 'imported', current: 'saved sound', capture: '' };

const slotLabel = (e) =>
  e.bank != null && e.program != null
    ? `${BANKS[e.bank]}-${String(e.program).padStart(3, '0')}`
    : '';

/**
 * @param {{
 *   midi: import('../midi/engine.js').MidiEngine,
 *   confirmDialog: (o: object) => Promise<boolean>,
 *   snapshotLayers: (o?: { program?: number[] | null }) => Promise<object>,
 *   sendLayers: (doc: object) => Promise<void>,
 *   sendParamsPaced: (entries: [object, number][]) => Promise<void>,
 *   onParamsChanged: () => void,
 * }} deps
 */
export function createPatchBrowser(deps) {
  const { midi, confirmDialog, snapshotLayers, sendLayers, sendParamsPaced, onParamsChanged } =
    deps;
  const root = el('div', { class: 'param-grid pb' });

  let entries = [];
  let capture = null; // { abort: AbortController, stream }
  const urls = new Map(); // id → object URL for previews
  const player = new Audio();
  let playingId = null;
  let similarRef = null; // null = current patch, else entry id
  let morphTimer = null;
  let lastMorphSent = {};

  const accent = () => getComputedStyle(root).getPropertyValue('--accent').trim() || '#7eb8c9';

  /* ———————————————————— 1. Record previews ———————————————————— */
  const rec = el('section', { class: 'panel' });
  rec.append(el('h2', { class: 'panel-title', text: 'Record previews' }));
  rec.append(
    el('p', {
      class: 'hint',
      text: 'Connect the Rev2’s audio output to your audio interface. For each program the app sends a program change, reads its settings over SysEx, plays a test note and records the sound.',
    }),
  );

  const field = (label, control, cls = '') => {
    const f = el('label', { class: `field pb-field ${cls}` });
    f.append(el('span', { text: label }), control);
    return f;
  };
  const select = (options, value) => {
    const s = el('select', { class: 'mac-select' });
    options.forEach(([v, t]) => s.append(el('option', { value: String(v), text: t })));
    s.value = String(value);
    return s;
  };

  const inputSel = el('select', { class: 'mac-select' });
  const allowBtn = el('button', { type: 'button', class: 'ghost-btn', text: 'Allow audio input' });
  const bankSel = select(
    BANKS.map((b, i) => [i, b]),
    prefs.bank,
  );
  const fromIn = el('input', {
    type: 'number',
    class: 'mac-number',
    min: '0',
    max: '127',
    value: String(prefs.from),
  });
  const toIn = el('input', {
    type: 'number',
    class: 'mac-number',
    min: '0',
    max: '127',
    value: String(prefs.to),
  });
  const noteSel = select(
    Array.from({ length: 37 }, (_, i) => 36 + i).map((n) => [n, midiNoteName(n)]),
    prefs.note,
  );
  const holdSel = select(
    [
      [500, '0.5 s'],
      [1000, '1 s'],
      [1500, '1.5 s'],
      [2000, '2 s'],
      [3000, '3 s'],
    ],
    prefs.holdMs,
  );
  const tailSel = select(
    [
      [500, '0.5 s'],
      [1000, '1 s'],
      [2000, '2 s'],
      [3000, '3 s'],
    ],
    prefs.tailMs,
  );
  const readChk = el('input', { type: 'checkbox' });
  readChk.checked = prefs.readSettings;
  const readLabel = el('label', { class: 'pb-check' });
  readLabel.append(readChk, el('span', { text: 'Read settings (SysEx)' }));

  const recRow1 = el('div', { class: 'pb-row' });
  recRow1.append(field('Audio input', inputSel, 'pb-wide'), allowBtn);
  const recRow2 = el('div', { class: 'pb-row' });
  recRow2.append(
    field('Bank', bankSel),
    field('From', fromIn, 'pb-num'),
    field('To', toIn, 'pb-num'),
    field('Test note', noteSel),
    field('Hold', holdSel),
    field('Tail', tailSel),
    readLabel,
  );
  const recBankBtn = el('button', { type: 'button', class: 'primary-btn', text: 'Record bank' });
  const recCurrentBtn = el('button', {
    type: 'button',
    class: 'ghost-btn',
    text: 'Record current sound',
  });
  const cancelBtn = el('button', {
    type: 'button',
    class: 'ghost-btn',
    text: 'Cancel',
    hidden: '',
  });
  const recRow3 = el('div', { class: 'pb-row' });
  recRow3.append(recBankBtn, recCurrentBtn, cancelBtn);
  const progress = el('div', { class: 'a2m-progress', hidden: '' });
  const progressBar = el('div', { class: 'a2m-progress-bar' });
  progress.append(progressBar);
  const recStatus = el('div', { class: 'a2m-status', 'aria-live': 'polite' });
  rec.append(recRow1, recRow2, recRow3, progress, recStatus);

  /* ———————————————————— 2. Library ———————————————————— */
  const lib = el('section', { class: 'panel' });
  const libHead = el('div', { class: 'pb-head' });
  const libTitle = el('h2', { class: 'panel-title', text: 'Library' });
  const libCount = el('span', { class: 'a2m-meta' });
  libHead.append(libTitle, libCount);
  const search = el('input', {
    type: 'search',
    class: 'mac-number',
    placeholder: 'Search name, slot or type…',
    value: prefs.filter,
  });
  const showSel = select(
    [
      ['all', 'All patches'],
      ['sound', 'With sound'],
      ['settings', 'With settings'],
    ],
    prefs.show,
  );
  const importBtn = el('button', { type: 'button', class: 'ghost-btn', text: 'Import JSON…' });
  const importInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    multiple: '',
    hidden: '',
  });
  const libRow = el('div', { class: 'pb-row' });
  libRow.append(field('Search', search, 'pb-wide'), field('Show', showSel), importBtn, importInput);
  const grid = el('div', { class: 'pb-grid' });
  const libStatus = el('div', { class: 'a2m-status', 'aria-live': 'polite' });
  lib.append(libHead, libRow, grid, libStatus);

  /* ———————————————————— 3. Find similar + morph ———————————————————— */
  const sim = el('section', { class: 'panel' });
  sim.append(el('h2', { class: 'panel-title', text: 'Find similar' }));
  sim.append(
    el('p', {
      class: 'hint',
      text: 'Compares oscillator, filter, envelope, LFO, mod and effect settings. Only patches with settings (read over SysEx, imported or saved) can be compared.',
    }),
  );
  const simRow = el('div', { class: 'pb-row' });
  const simRef = el('div', { class: 'pb-ref' });
  const simCurrentBtn = el('button', {
    type: 'button',
    class: 'ghost-btn',
    text: 'Compare with current patch',
  });
  simRow.append(simRef, simCurrentBtn);
  const simList = el('div', { class: 'pb-sim' });
  sim.append(simRow, simList);

  const morph = el('section', { class: 'panel' });
  morph.append(el('h2', { class: 'panel-title', text: 'Morph' }));
  morph.append(
    el('p', {
      class: 'hint',
      text: 'Blend two patches’ Layer A settings. Knob values blend smoothly; switches and menus flip at the middle. Live mode sends to the synth’s current layer as you move the slider.',
    }),
  );
  const morphA = el('select', { class: 'mac-select' });
  const morphB = el('select', { class: 'mac-select' });
  const morphSlider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(prefs.morph.t),
  });
  const morphVal = el('span', { class: 'pb-morph-val' });
  const liveChk = el('input', { type: 'checkbox' });
  liveChk.checked = prefs.morph.live;
  const liveLabel = el('label', { class: 'pb-check' });
  liveLabel.append(liveChk, el('span', { text: 'Live send to synth' }));
  const morphSave = el('button', {
    type: 'button',
    class: 'ghost-btn',
    text: 'Save blend to library',
  });
  const morphRow = el('div', { class: 'pb-row' });
  morphRow.append(field('Patch A', morphA, 'pb-wide'), field('Patch B', morphB, 'pb-wide'));
  const morphRow2 = el('div', { class: 'pb-row pb-morph-row' });
  const sliderWrap = el('div', { class: 'pb-slider' });
  sliderWrap.append(
    el('span', { class: 'pb-morph-end', text: 'A' }),
    morphSlider,
    el('span', { class: 'pb-morph-end', text: 'B' }),
    morphVal,
  );
  morphRow2.append(sliderWrap, liveLabel, morphSave);
  const morphStatus = el('div', { class: 'a2m-status', 'aria-live': 'polite' });
  morph.append(morphRow, morphRow2, morphStatus);

  root.append(rec, lib, sim, morph);

  /* ———————————————————— helpers ———————————————————— */
  const status = (node, text, kind = '') => {
    node.textContent = text;
    node.className = `a2m-status${kind ? ` is-${kind}` : ''}`;
  };
  const busy = () => !!capture;

  function previewUrl(e) {
    if (!e.preview) return null;
    if (!urls.has(e.id)) urls.set(e.id, URL.createObjectURL(e.preview));
    return urls.get(e.id);
  }

  function playPreview(e) {
    const url = previewUrl(e);
    if (!url) return;
    if (playingId === e.id && !player.paused) {
      player.pause();
      playingId = null;
    } else {
      player.src = url;
      player.currentTime = 0;
      player.play().catch(() => {});
      playingId = e.id;
    }
    renderGrid();
  }
  player.addEventListener('ended', () => {
    playingId = null;
    renderGrid();
  });

  async function loadOnSynth(e) {
    if (!midi.output) {
      status(libStatus, 'Connect a MIDI output first (MIDI pill, top right).', 'error');
      return;
    }
    if (e.source === 'capture' && e.bank != null && e.program != null) {
      midi.sendProgram(e.bank, e.program);
      status(
        libStatus,
        `Recalled ${slotLabel(e)} ${e.name !== slotLabel(e) ? `“${e.name}”` : ''} on the synth.`,
        'ok',
      );
      if (midi.input) midi.requestEditBuffer(midi.layer);
      return;
    }
    if (!e.doc) return;
    const ok = await confirmDialog({
      title: `Load “${e.name}”?`,
      message:
        'This sends the patch to the synthesizer and replaces its current settings. Anything not saved on the synth will be lost.',
      confirmLabel: 'Load & Send',
      danger: true,
    });
    if (!ok) return;
    status(libStatus, `Sending “${e.name}”…`);
    await sendLayers(e.doc);
    status(libStatus, `Loaded “${e.name}” onto the synth.`, 'ok');
  }

  async function removeEntry(e) {
    const ok = await confirmDialog({
      title: `Delete “${e.name}”?`,
      message:
        'This removes the patch and its recorded preview from the library in this browser. Nothing on the synth changes.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deletePatch(e.id);
    if (urls.has(e.id)) {
      URL.revokeObjectURL(urls.get(e.id));
      urls.delete(e.id);
    }
    await refresh();
  }

  /* ———————————————————— render ———————————————————— */
  function visibleEntries() {
    const q = prefs.filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (prefs.show === 'sound' && !e.preview) return false;
      if (prefs.show === 'settings' && !e.doc) return false;
      if (!q) return true;
      return `${e.name} ${slotLabel(e)} ${SOURCE_LABELS[e.source] || ''}`.toLowerCase().includes(q);
    });
  }

  function renderGrid() {
    const list = visibleEntries();
    libCount.textContent = entries.length
      ? `${list.length === entries.length ? '' : `${list.length} of `}${entries.length} patch${entries.length === 1 ? '' : 'es'}`
      : '';
    grid.innerHTML = '';
    if (!entries.length) {
      grid.append(
        el('div', {
          class: 'a2m-empty pb-empty',
          text: 'No patches yet — record a bank above, record the current sound, or import Save/Load JSON files.',
        }),
      );
      return;
    }
    if (!list.length) {
      grid.append(el('div', { class: 'a2m-empty pb-empty', text: 'No patches match.' }));
      return;
    }
    const color = accent();
    for (const e of list) {
      const card = el('div', { class: `pb-card${playingId === e.id ? ' is-playing' : ''}` });
      const top = el('div', { class: 'pb-card-top' });
      const play = el('button', {
        type: 'button',
        class: 'pb-play',
        'aria-label': e.preview ? `Play preview of ${e.name}` : 'No preview recorded',
        title: e.preview ? 'Play preview' : 'No preview recorded',
        text: playingId === e.id ? '■' : '▶',
      });
      play.disabled = !e.preview;
      play.addEventListener('click', () => playPreview(e));
      const titles = el('div', { class: 'pb-card-titles' });
      titles.append(
        el('div', { class: 'pb-card-name', text: e.name, title: e.name }),
        el('div', {
          class: 'pb-card-sub',
          text: [slotLabel(e), SOURCE_LABELS[e.source]].filter(Boolean).join(' · '),
        }),
      );
      top.append(play, titles);
      const wave = el('canvas', { class: 'pb-wave' });
      const badges = el('div', { class: 'pb-badges' });
      if (e.preview) {
        badges.append(
          el('span', {
            class: `pb-badge${e.peak != null && e.peak < 0.01 ? ' is-warn' : ''}`,
            text: e.peak != null && e.peak < 0.01 ? 'silent' : 'sound',
          }),
        );
      }
      if (e.doc) badges.append(el('span', { class: 'pb-badge', text: 'settings' }));
      const actions = el('div', { class: 'pb-card-actions' });
      const load = el('button', { type: 'button', class: 'ghost-btn', text: 'Load' });
      load.disabled = !(e.doc || (e.bank != null && e.program != null));
      load.addEventListener('click', () => loadOnSynth(e));
      const similar = el('button', { type: 'button', class: 'ghost-btn', text: 'Similar' });
      similar.disabled = !e.doc;
      similar.addEventListener('click', () => {
        similarRef = e.id;
        renderSimilar();
        sim.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const del = el('button', {
        type: 'button',
        class: 'ghost-btn pb-del',
        text: '✕',
        'aria-label': `Delete ${e.name}`,
        title: 'Delete',
      });
      del.addEventListener('click', () => removeEntry(e));
      actions.append(load, similar, del);
      card.append(top, wave, badges, actions);
      grid.append(card);
      requestAnimationFrame(() => drawWaveform(wave, e.waveform, color));
    }
  }

  function renderSimilar() {
    const ref = similarRef ? entries.find((e) => e.id === similarRef) : null;
    if (similarRef && !ref) similarRef = null;
    simRef.textContent = ref
      ? `Like: ${ref.name}${slotLabel(ref) ? ` (${slotLabel(ref)})` : ''}`
      : `Like: current patch (Layer ${midi.layer})`;
    const refLayer = ref
      ? ref.doc?.layers?.A || ref.doc?.layers?.B
      : midi.getLayerValues(midi.layer);
    simList.innerHTML = '';
    const ranked = rankSimilar(refLayer, entries, { excludeId: ref?.id, limit: 8 });
    if (!ranked.length) {
      simList.append(
        el('div', { class: 'a2m-empty', text: 'No patches with settings to compare yet.' }),
      );
      return;
    }
    for (const { entry, similarity } of ranked) {
      const row = el('div', { class: 'pb-sim-row' });
      const pct = Math.round(similarity * 100);
      const bar = el('div', { class: 'pb-sim-bar' });
      const fill = el('div', { class: 'pb-sim-fill' });
      fill.style.width = `${pct}%`;
      bar.append(fill);
      const play = el('button', {
        type: 'button',
        class: 'pb-play',
        text: '▶',
        'aria-label': `Play preview of ${entry.name}`,
        title: 'Play preview',
      });
      play.disabled = !entry.preview;
      play.addEventListener('click', () => playPreview(entry));
      const load = el('button', { type: 'button', class: 'ghost-btn', text: 'Load' });
      load.addEventListener('click', () => loadOnSynth(entry));
      const name = el('div', { class: 'pb-sim-name' });
      name.append(
        el('span', { text: entry.name }),
        el('span', { class: 'pb-card-sub', text: slotLabel(entry) }),
      );
      row.append(play, name, bar, el('span', { class: 'pb-sim-pct', text: `${pct}%` }), load);
      simList.append(row);
    }
  }

  function renderMorphOptions() {
    const withDoc = entries.filter((e) => e.doc?.layers?.A || e.doc?.layers?.B);
    for (const [sel, key] of [
      [morphA, 'a'],
      [morphB, 'b'],
    ]) {
      sel.innerHTML = '';
      sel.append(
        el('option', {
          value: '',
          text: withDoc.length ? 'Choose a patch…' : 'No patches with settings',
        }),
      );
      withDoc.forEach((e) =>
        sel.append(
          el('option', {
            value: e.id,
            text: `${e.name}${slotLabel(e) ? ` · ${slotLabel(e)}` : ''}`,
          }),
        ),
      );
      if (!withDoc.some((e) => e.id === prefs.morph[key])) prefs.morph[key] = '';
      sel.value = prefs.morph[key];
    }
    morphVal.textContent = `${prefs.morph.t}%`;
    const ready = prefs.morph.a && prefs.morph.b;
    morphSlider.disabled = !ready;
    morphSave.disabled = !ready;
  }

  function renderCaptureState() {
    const running = busy();
    [
      recBankBtn,
      recCurrentBtn,
      inputSel,
      allowBtn,
      bankSel,
      fromIn,
      toIn,
      noteSel,
      holdSel,
      tailSel,
      readChk,
    ].forEach((n) => {
      n.disabled = running;
    });
    cancelBtn.hidden = !running;
  }

  async function refresh() {
    try {
      entries = await listPatches();
    } catch (err) {
      status(libStatus, `Couldn’t open the library: ${err.message}`, 'error');
      entries = [];
    }
    renderGrid();
    renderSimilar();
    renderMorphOptions();
  }

  /* ———————————————————— audio inputs ———————————————————— */
  async function fillInputs(requestPermission = false) {
    try {
      const inputs = await listAudioInputs({ requestPermission });
      inputSel.innerHTML = '';
      if (!inputs.length) {
        inputSel.append(el('option', { value: '', text: 'No audio inputs found' }));
        return;
      }
      const labelled = inputs.some((d) => d.label);
      inputs.forEach((d, i) =>
        inputSel.append(
          el('option', { value: d.deviceId, text: d.label || `Audio input ${i + 1}` }),
        ),
      );
      if (inputs.some((d) => d.deviceId === prefs.deviceId)) inputSel.value = prefs.deviceId;
      else prefs.deviceId = inputSel.value;
      allowBtn.hidden = labelled;
    } catch (err) {
      status(
        recStatus,
        err?.name === 'NotAllowedError'
          ? 'Audio input access was blocked — allow it in the browser’s site settings.'
          : `Couldn’t list audio inputs: ${err.message}`,
        'error',
      );
    }
  }
  allowBtn.addEventListener('click', () => fillInputs(true));
  inputSel.addEventListener('change', () => {
    prefs.deviceId = inputSel.value;
  });

  /* ———————————————————— capture ———————————————————— */
  function readPrefs() {
    prefs.bank = Number(bankSel.value);
    prefs.from = Math.max(0, Math.min(127, Number(fromIn.value) || 0));
    prefs.to = Math.max(prefs.from, Math.min(127, Number(toIn.value) || 0));
    fromIn.value = String(prefs.from);
    toIn.value = String(prefs.to);
    prefs.note = Number(noteSel.value);
    prefs.holdMs = Number(holdSel.value);
    prefs.tailMs = Number(tailSel.value);
    prefs.readSettings = readChk.checked;
  }

  async function withInput(fn) {
    if (!midi.output) {
      status(recStatus, 'Connect a MIDI output first (MIDI pill, top right).', 'error');
      return;
    }
    let stream;
    try {
      stream = await openInput(prefs.deviceId || inputSel.value);
    } catch (err) {
      status(
        recStatus,
        err?.name === 'NotAllowedError'
          ? 'Audio input access was blocked — allow it in the browser’s site settings.'
          : `Couldn’t open the audio input: ${err.message}`,
        'error',
      );
      return;
    }
    await fillInputs(); // labels are available now
    const abort = new AbortController();
    capture = { abort, stream };
    renderCaptureState();
    try {
      await fn(stream, abort.signal);
    } catch (err) {
      if (err?.name === 'AbortError') status(recStatus, 'Recording cancelled.', 'warn');
      else status(recStatus, `Recording failed: ${err.message}`, 'error');
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      capture = null;
      progress.hidden = true;
      renderCaptureState();
    }
  }

  async function recordOne(stream, signal) {
    let held = false;
    const blob = await recordClip(stream, {
      play: () => {
        midi.sendNoteOn(prefs.note, 100, { applyTranspose: false });
        held = true;
      },
      release: () => {
        if (!held) return;
        held = false;
        midi.sendNoteOff(prefs.note, { applyTranspose: false });
      },
      holdMs: prefs.holdMs,
      tailMs: prefs.tailMs,
      signal,
    });
    const info = await analyseClip(blob);
    return { blob, ...info };
  }

  recBankBtn.addEventListener('click', async () => {
    readPrefs();
    const total = prefs.to - prefs.from + 1;
    const ok = await confirmDialog({
      title: `Record ${total} program${total === 1 ? '' : 's'}?`,
      message: `The synth will switch through ${BANKS[prefs.bank]} ${prefs.from}–${prefs.to}, playing ${midiNoteName(prefs.note)} on each. The current edit (if unsaved on the synth) will be lost. About ${Math.ceil((total * (prefs.holdMs + prefs.tailMs + 900)) / 1000)} s.`,
      confirmLabel: 'Record',
    });
    if (!ok) return;
    await withInput(async (stream, signal) => {
      let silent = 0;
      let withSettings = 0;
      progress.hidden = false;
      for (let p = prefs.from; p <= prefs.to; p++) {
        const i = p - prefs.from;
        progressBar.style.width = `${Math.round((i / total) * 100)}%`;
        const slot = `${BANKS[prefs.bank]}-${String(p).padStart(3, '0')}`;
        status(recStatus, `Recording ${slot} (${i + 1} of ${total})…`);
        midi.sendProgram(prefs.bank, p);
        await sleep(350, signal);
        let doc = null;
        if (prefs.readSettings && midi.input) {
          const dump = await midi.fetchEditBuffer(1500);
          if (dump) {
            doc = await snapshotLayers({ program: dump });
            withSettings++;
          }
        }
        signal.throwIfAborted();
        const clip = await recordOne(stream, signal);
        if (clip.peak < 0.01) silent++;
        await upsertSlot({
          id: newId(),
          name: doc?.name || slot,
          bank: prefs.bank,
          program: p,
          source: 'capture',
          createdAt: Date.now(),
          doc,
          preview: clip.blob,
          waveform: clip.waveform,
          peak: clip.peak,
        });
        await refresh();
      }
      progressBar.style.width = '100%';
      const notes = [];
      if (prefs.readSettings && withSettings < total) {
        notes.push(
          `settings read for ${withSettings} of ${total} (SysEx needs MIDI In and a matching Sysex Cable setting)`,
        );
      }
      if (silent)
        notes.push(
          `${silent} recording${silent === 1 ? ' was' : 's were'} silent — check the audio input`,
        );
      status(
        recStatus,
        `Recorded ${total} program${total === 1 ? '' : 's'}.${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
        notes.length ? 'warn' : 'ok',
      );
      onParamsChanged();
    });
  });

  recCurrentBtn.addEventListener('click', async () => {
    readPrefs();
    await withInput(async (stream, signal) => {
      status(recStatus, 'Reading the current patch…');
      const doc = await snapshotLayers();
      status(recStatus, `Recording ${midiNoteName(prefs.note)}…`);
      const clip = await recordOne(stream, signal);
      const name =
        doc.name ||
        `Sound ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      await putPatch({
        id: newId(),
        name,
        bank: null,
        program: null,
        source: 'current',
        createdAt: Date.now(),
        doc,
        preview: clip.blob,
        waveform: clip.waveform,
        peak: clip.peak,
      });
      await refresh();
      status(
        recStatus,
        clip.peak < 0.01
          ? `Saved “${name}”, but the recording is silent — check the audio input.`
          : `Saved “${name}”.`,
        clip.peak < 0.01 ? 'warn' : 'ok',
      );
    });
  });

  cancelBtn.addEventListener('click', () => capture?.abort.abort());

  /* ———————————————————— library controls ———————————————————— */
  search.addEventListener('input', () => {
    prefs.filter = search.value;
    renderGrid();
  });
  showSel.addEventListener('change', () => {
    prefs.show = showSel.value;
    renderGrid();
  });
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const files = [...(importInput.files || [])];
    importInput.value = '';
    let added = 0;
    const skipped = [];
    for (const file of files) {
      try {
        const doc = JSON.parse(await file.text());
        if (!isLayersDoc(doc)) throw new Error('not a layers file');
        await putPatch({
          id: newId(),
          name: doc.name || file.name.replace(/\.json$/i, ''),
          bank: null,
          program: null,
          source: 'file',
          createdAt: Date.now(),
          doc,
          preview: null,
          waveform: null,
          peak: null,
        });
        added++;
      } catch {
        skipped.push(file.name);
      }
    }
    await refresh();
    status(
      libStatus,
      `Imported ${added} patch${added === 1 ? '' : 'es'}.${skipped.length ? ` Skipped (not Save/Load files): ${skipped.join(', ')}.` : ''}`,
      skipped.length ? 'warn' : 'ok',
    );
  });

  simCurrentBtn.addEventListener('click', () => {
    similarRef = null;
    renderSimilar();
  });
  midi.addEventListener('layer', renderSimilarIfCurrent);
  function renderSimilarIfCurrent() {
    if (!similarRef) renderSimilar();
  }

  /* ———————————————————— morph ———————————————————— */
  function morphValues() {
    const a = entries.find((e) => e.id === prefs.morph.a);
    const b = entries.find((e) => e.id === prefs.morph.b);
    if (!a || !b) return null;
    const la = a.doc.layers.A || a.doc.layers.B;
    const lb = b.doc.layers.A || b.doc.layers.B;
    return { a, b, values: morphLayer(la, lb, prefs.morph.t / 100) };
  }

  async function sendMorph() {
    const m = morphValues();
    if (!m || !prefs.morph.live || !midi.output) return;
    // Only send what changed since the last send — keeps MIDI traffic light
    const changed = LAYER_PARAMS.filter(
      (p) => Number.isFinite(m.values[p.id]) && m.values[p.id] !== lastMorphSent[p.id],
    ).map((p) => [p, m.values[p.id]]);
    if (!changed.length) return;
    changed.forEach(([p, v]) => {
      lastMorphSent[p.id] = v;
    });
    await sendParamsPaced(changed);
    onParamsChanged();
  }

  morphA.addEventListener('change', () => {
    prefs.morph.a = morphA.value;
    lastMorphSent = {};
    renderMorphOptions();
  });
  morphB.addEventListener('change', () => {
    prefs.morph.b = morphB.value;
    lastMorphSent = {};
    renderMorphOptions();
  });
  morphSlider.addEventListener('input', () => {
    prefs.morph.t = Number(morphSlider.value);
    morphVal.textContent = `${prefs.morph.t}%`;
    clearTimeout(morphTimer);
    morphTimer = setTimeout(sendMorph, 40);
  });
  morphSlider.addEventListener('change', async () => {
    if (prefs.morph.live && !midi.output) {
      status(morphStatus, 'Live send needs a MIDI output (MIDI pill, top right).', 'warn');
    }
  });
  liveChk.addEventListener('change', () => {
    prefs.morph.live = liveChk.checked;
    lastMorphSent = {};
    if (liveChk.checked) sendMorph();
  });
  morphSave.addEventListener('click', async () => {
    const m = morphValues();
    if (!m) return;
    const name = `${m.a.name} ↔ ${m.b.name} ${prefs.morph.t}%`;
    await putPatch({
      id: newId(),
      name,
      bank: null,
      program: null,
      source: 'morph',
      createdAt: Date.now(),
      doc: {
        type: PATCH_FILE_TYPE,
        version: 1,
        exportedAt: new Date().toISOString(),
        source: 'morph',
        name,
        shared: m.a.doc.shared || {},
        layers: { A: m.values },
      },
      preview: null,
      waveform: null,
      peak: null,
    });
    await refresh();
    status(morphStatus, `Saved “${name}” to the library.`, 'ok');
  });

  /* ———————————————————— lifecycle ———————————————————— */
  // Redraw thumbnails only when the width changes (re-rendering changes height)
  let gridWidth = 0;
  const ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w === gridWidth) return;
    gridWidth = w;
    renderGrid();
  });
  ro.observe(grid);
  root._teardown = () => {
    ro.disconnect();
    capture?.abort.abort();
    player.pause();
    clearTimeout(morphTimer);
    midi.removeEventListener('layer', renderSimilarIfCurrent);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  };

  renderCaptureState();
  fillInputs(false);
  refresh();
  return root;
}
