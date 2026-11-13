/**
 * Save / Load page: export both layers to JSON, or load a JSON file and send
 * it to the synth (after a warning).
 */
import { el } from '../components/controls.js';
import { downloadBlob } from '../lib/download.js';
import { docLayers, isLayersDoc } from '../services/layersDoc.js';

/**
 * @param {{
 *   midi: import('../midi/engine.js').MidiEngine,
 *   confirm: (o: object) => Promise<boolean>,
 *   snapshotLayers: () => Promise<object>,
 *   sendLayers: (doc: object) => Promise<void>,
 * }} ctx
 */
export function createSaveLoadPage(ctx) {
  const { midi } = ctx;
  const wrap = el('div', { class: 'param-grid saveload' });

  const status = el('p', { class: 'saveload-status', 'aria-live': 'polite' });
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `saveload-status${kind ? ` is-${kind}` : ''}`;
  };

  async function exportLayers() {
    const doc = await ctx.snapshotLayers();
    const fromSynth = doc.source === 'synth';
    const stamp = doc.exportedAt.slice(0, 16).replace(/[:T]/g, '-');
    downloadBlob(
      new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
      `rev2-layers-${stamp}.json`,
    );
    setStatus(
      fromSynth
        ? 'Saved Layer A and Layer B (read from the synth).'
        : 'Saved Layer A and Layer B from the app’s values (the synth didn’t send its edit buffer, so changes made on the synth itself may be missing).',
      fromSynth ? 'ok' : 'warn',
    );
  }

  async function importLayers(file) {
    let doc;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      setStatus('That file isn’t valid JSON.', 'error');
      return;
    }
    if (!isLayersDoc(doc)) {
      setStatus('Not a My Prophecy layers file.', 'error');
      return;
    }
    const layers = docLayers(doc);
    if (!layers.length) {
      setStatus('The file contains no layer settings.', 'error');
      return;
    }
    if (!midi.output) {
      setStatus(
        'Connect a MIDI output first (MIDI pill, top right) — loading sends to the synth.',
        'error',
      );
      return;
    }
    const which = layers.length === 2 ? 'Layer A and Layer B' : `Layer ${layers[0]}`;
    const ok = await ctx.confirm({
      title: `Load “${file.name}”?`,
      message: `This sends ${which} to the synthesizer and replaces its current settings. Anything not saved on the synth will be lost.`,
      confirmLabel: 'Load & Send',
      danger: true,
    });
    if (!ok) {
      setStatus('Load cancelled.', '');
      return;
    }
    setStatus(`Sending ${which}…`, '');
    await ctx.sendLayers(doc);
    setStatus(`Loaded ${which} from “${file.name}” — sent to the synth.`, 'ok');
  }

  const save = el('section', { class: 'panel' });
  save.append(el('h2', { class: 'panel-title', text: 'Save' }));
  save.append(
    el('p', {
      class: 'hint',
      text: 'Export both layers (A and B) to a JSON file. With MIDI In and Out connected, the settings are read from the synth’s edit buffer; otherwise both layers are saved from the app’s own values (switch layers with Edit B).',
    }),
  );
  const saveBtn = el('button', { type: 'button', class: 'primary-btn', text: 'Export JSON' });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setStatus('Reading settings…');
    try {
      await exportLayers();
    } finally {
      saveBtn.disabled = false;
    }
  });
  save.append(saveBtn);

  const load = el('section', { class: 'panel' });
  load.append(el('h2', { class: 'panel-title', text: 'Load' }));
  load.append(
    el('div', {
      class: 'banner warn',
      text: 'Loading sends the file’s settings to the synthesizer. Its current settings on both layers will be replaced.',
    }),
  );
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const loadBtn = el('button', { type: 'button', class: 'ghost-btn', text: 'Load JSON…' });
  loadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    loadBtn.disabled = true;
    try {
      await importLayers(file);
    } finally {
      loadBtn.disabled = false;
    }
  });
  load.append(loadBtn, fileInput);

  wrap.append(save, load, status);
  return wrap;
}
