import { GATED_STEP_RESET, PARAMS_BY_ID, SEQ_DESTINATIONS, DESTINATIONS } from '../midi/params.js';
import { el, markControlHot } from '../components/controls.js';

const DEST_IDS = ['seq1_dest', 'seq2_dest', 'seq3_dest', 'seq4_dest'];

/**
 * Gated sequencer editor: 4 tracks × 16 steps (NRPN 182–255).
 * Drag a column to set 0–125; Alt/⌥-click or double-click = Reset (126).
 *
 * @param {import('../midi/engine.js').MidiEngine} midi
 * @param {{ controlNodes?: Map<string, any>, compact?: boolean, toolsHost?: HTMLElement }} [opts]
 */
export function createGatedSequencerEditor(midi, opts = {}) {
  const { controlNodes, compact = false, toolsHost = null } = opts;
  const root = el('div', {
    class: `gated-seq${compact ? ' gated-seq-compact' : ''}`,
  });

  const tools = el('div', { class: 'gated-seq-tools' });
  const clearAllBtn = el('button', {
    type: 'button',
    class: 'ghost-btn gated-seq-btn',
    text: 'Clear All',
    title: 'Zero all steps on tracks 1–4',
  });
  const reset8 = el('button', {
    type: 'button',
    class: 'ghost-btn gated-seq-btn',
    text: 'Len 8',
    title: 'Set step 9 to Reset on every track',
  });
  const reset16 = el('button', {
    type: 'button',
    class: 'ghost-btn gated-seq-btn',
    text: 'Len 16',
    title: 'Clear Reset markers on every track (full 16 steps)',
  });
  tools.append(reset8, reset16, clearAllBtn);

  if (toolsHost) {
    toolsHost.append(tools);
  } else {
    const header = el('div', { class: 'gated-seq-header' });
    header.append(
      el('p', {
        class: 'gated-seq-hint',
        text: compact
          ? 'Hold a note to run · Alt-click step = Reset'
          : 'Gated seq runs while a note is held. Drag steps 0–125 · Alt/double-click = Reset (loop end) · Tracks 2/4 dest can be Slew.',
      }),
      tools,
    );
    root.append(header);
  }

  if (!compact) {
    const globals = el('div', { class: 'gated-seq-globals' });
    for (const id of ['seq_type', 'gated_on', 'gated_mode']) {
      const param = PARAMS_BY_ID[id];
      if (!param) continue;
      globals.append(mountEnumOrToggle(midi, param, controlNodes));
    }
    root.append(globals);
  }

  const tracks = el('div', { class: 'gated-seq-tracks' });
  /** @type {Array<{ track: number, cells: HTMLElement[], refreshLoop: () => void }>} */
  const trackViews = [];

  for (let track = 1; track <= 4; track++) {
    const view = mountTrack(midi, track, controlNodes, compact);
    trackViews.push(view);
    tracks.append(view.root);
  }
  root.append(tracks);

  clearAllBtn.addEventListener('click', () => {
    trackViews.forEach((view) => clearTrack(midi, view));
  });

  reset8.addEventListener('click', () => {
    for (const view of trackViews) {
      for (let step = 1; step <= 16; step++) {
        const cur = midi.getValue(`seq_t${view.track}_s${step}`, 0);
        if (cur === GATED_STEP_RESET) {
          setStep(midi, view.track, step, 0);
          view.cells[step - 1]?._setValue?.(0);
        }
      }
      setStep(midi, view.track, 9, GATED_STEP_RESET);
      view.cells[8]?._setValue?.(GATED_STEP_RESET);
      view.refreshLoop();
    }
  });

  reset16.addEventListener('click', () => {
    for (const view of trackViews) {
      for (let step = 1; step <= 16; step++) {
        if (midi.getValue(`seq_t${view.track}_s${step}`, 0) === GATED_STEP_RESET) {
          setStep(midi, view.track, step, 0);
          view.cells[step - 1]?._setValue?.(0);
        }
      }
      view.refreshLoop();
    }
  });

  return root;
}

function clearTrack(midi, view) {
  for (let step = 1; step <= 16; step++) {
    setStep(midi, view.track, step, 0);
    view.cells[step - 1]?._setValue?.(0);
  }
  view.refreshLoop();
}

function mountTrack(midi, track, controlNodes, compact) {
  const root = el('div', { class: 'gated-seq-track', 'data-track': String(track) });
  const meta = el('div', { class: 'gated-seq-meta' });
  meta.append(el('span', { class: 'gated-seq-track-label', text: `T${track}` }));
  const clearTrackBtn = el('button', {
    type: 'button',
    class: 'ghost-btn gated-seq-btn gated-seq-track-clear',
    text: 'Clear',
    title: `Zero all 16 steps on track ${track}`,
  });

  const destId = DEST_IDS[track - 1];
  const destParam = PARAMS_BY_ID[destId];
  const destSelect = el('select', {
    class: 'mac-select gated-seq-dest',
    title: destParam.label,
  });
  const options = track === 2 || track === 4 ? SEQ_DESTINATIONS : DESTINATIONS;
  options.forEach((name, i) => destSelect.append(el('option', { value: String(i), text: name })));
  destSelect.value = String(midi.getValue(destId, destParam.defaultValue ?? 0));
  destSelect.addEventListener('change', () => {
    markControlHot(destSelect);
    midi.setParam(destParam, Number(destSelect.value));
  });
  bindSelectWheel(destSelect, (v) => midi.setParam(destParam, v));
  if (controlNodes) {
    controlNodes.set(destId, {
      _setValue(v) {
        destSelect.value = String(v);
      },
    });
  }
  meta.append(destSelect);
  root.append(meta);

  const steps = el('div', { class: 'gated-seq-steps' });
  const cells = [];
  for (let step = 1; step <= 16; step++) {
    const cell = mountStep(midi, track, step, () => refreshLoop());
    cells.push(cell);
    if (controlNodes) controlNodes.set(`seq_t${track}_s${step}`, cell);
    steps.append(cell);
  }
  root.append(steps);
  root.append(clearTrackBtn);

  if (!compact) {
    const nums = el('div', { class: 'gated-seq-nums' });
    for (let step = 1; step <= 16; step++) {
      nums.append(el('span', { text: String(step) }));
    }
    root.append(nums);
  }

  function refreshLoop() {
    let dead = false;
    for (let i = 0; i < 16; i++) {
      const v = midi.getValue(`seq_t${track}_s${i + 1}`, 0);
      cells[i].classList.toggle('is-reset', v === GATED_STEP_RESET);
      cells[i].classList.toggle('is-after-reset', dead);
      if (v === GATED_STEP_RESET) dead = true;
    }
  }

  const view = { root, track, cells, refreshLoop };
  clearTrackBtn.addEventListener('click', () => clearTrack(midi, view));

  refreshLoop();
  return view;
}

function mountStep(midi, track, step, onChange) {
  const id = `seq_t${track}_s${step}`;
  const param = PARAMS_BY_ID[id];
  const cell = el('div', {
    class: 'gated-seq-step',
    role: 'slider',
    tabindex: '0',
    'aria-label': param.label,
    'aria-valuemin': '0',
    'aria-valuemax': String(GATED_STEP_RESET),
    title: `${param.label} — drag / scroll · Alt-click Reset`,
  });
  const fill = el('div', { class: 'gated-seq-fill' });
  const read = el('span', { class: 'gated-seq-val' });
  cell.append(fill, read);

  const paint = (v) => {
    const isReset = v === GATED_STEP_RESET;
    const pct = isReset ? 100 : (Math.min(v, 125) / 125) * 100;
    fill.style.height = `${pct}%`;
    cell.classList.toggle('is-reset', isReset);
    cell.setAttribute('aria-valuenow', String(v));
    read.textContent = isReset ? 'R' : v === 0 ? '' : String(v);
  };

  const commit = (v) => {
    setStep(midi, track, step, v);
    paint(v);
    onChange();
  };

  paint(midi.getValue(id, 0));

  const applyFromY = (clientY) => {
    const rect = cell.getBoundingClientRect();
    const t = 1 - (clientY - rect.top) / (rect.height || 1);
    const v = Math.round(Math.min(1, Math.max(0, t)) * 125);
    commit(v);
  };

  cell.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = midi.getValue(id, 0);
      const amt = e.shiftKey ? 8 : 1;
      const base = cur === GATED_STEP_RESET ? 125 : cur;
      const next = Math.max(0, Math.min(125, base + (e.deltaY < 0 ? amt : -amt)));
      commit(next);
    },
    { passive: false },
  );

  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.altKey) {
      commit(GATED_STEP_RESET);
      return;
    }
    cell.setPointerCapture(e.pointerId);
    applyFromY(e.clientY);
  });
  cell.addEventListener('pointermove', (e) => {
    if (!cell.hasPointerCapture(e.pointerId)) return;
    applyFromY(e.clientY);
  });
  cell.addEventListener('dblclick', (e) => {
    e.preventDefault();
    commit(GATED_STEP_RESET);
  });
  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    commit(0);
  });
  cell.addEventListener('keydown', (e) => {
    const cur = midi.getValue(id, 0);
    if (e.key === 'r' || e.key === 'R') {
      commit(GATED_STEP_RESET);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      commit(0);
      return;
    }
    const stepAmt = e.shiftKey ? 8 : 1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      commit(cur === GATED_STEP_RESET ? 125 : Math.min(125, cur + stepAmt));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      commit(cur === GATED_STEP_RESET ? 125 : Math.max(0, cur - stepAmt));
    }
  });

  cell._setValue = paint;
  return cell;
}

function setStep(midi, track, step, value) {
  const param = PARAMS_BY_ID[`seq_t${track}_s${step}`];
  if (!param) return;
  midi.setParam(param, value);
}

function mountEnumOrToggle(midi, param, controlNodes) {
  const wrap = el('label', { class: 'gated-seq-field' });
  wrap.append(el('span', { text: param.label }));
  if (param.type === 'toggle') {
    const btn = el('button', {
      type: 'button',
      class: `ghost-btn gated-seq-toggle${midi.getValue(param.id, 0) ? ' on' : ''}`,
      text: midi.getValue(param.id, 0) ? 'On' : 'Off',
    });
    btn.addEventListener('click', () => {
      const next = midi.getValue(param.id, 0) ? 0 : 1;
      midi.setParam(param, next);
      if (param.id === 'gated_on' && next) {
        const typeParam = PARAMS_BY_ID.seq_type;
        if (typeParam && midi.getValue('seq_type', 0) !== 0) midi.setParam(typeParam, 0);
      }
      btn.textContent = next ? 'On' : 'Off';
      btn.classList.toggle('on', !!next);
    });
    if (controlNodes) {
      controlNodes.set(param.id, {
        _setValue(v) {
          btn.textContent = v ? 'On' : 'Off';
          btn.classList.toggle('on', !!v);
        },
      });
    }
    wrap.append(btn);
    return wrap;
  }

  const select = el('select', { class: 'mac-select' });
  (param.options || []).forEach((name, i) => {
    select.append(el('option', { value: String(i), text: name }));
  });
  select.value = String(midi.getValue(param.id, param.defaultValue ?? 0));
  select.addEventListener('change', () => {
    markControlHot(select);
    midi.setParam(param, Number(select.value));
  });
  bindSelectWheel(select, (v) => midi.setParam(param, v));
  if (controlNodes) {
    controlNodes.set(param.id, {
      _setValue(v) {
        select.value = String(v);
      },
    });
  }
  wrap.append(select);
  return wrap;
}

/** Scroll through a <select> without opening it (Shift = ±5). */
function bindSelectWheel(select, onChange) {
  select.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const max = select.options.length - 1;
      if (max < 0) return;
      const amt = e.shiftKey ? 5 : 1;
      const cur = Number(select.value);
      const next = Math.max(0, Math.min(max, cur + (e.deltaY < 0 ? -amt : amt)));
      if (next === cur) return;
      markControlHot(select);
      select.value = String(next);
      onChange(next);
    },
    { passive: false },
  );
}
