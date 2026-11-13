/**
 * Control builders used by the Panel's sections. Every control registers in
 * `ctx.controlNodes` (param id → node with `_setValue`) so values coming back
 * from the synth repaint it.
 */
import { PANEL_LAYOUT, PARAMS_BY_ID } from '../midi/params.js';
import { el, renderParamControl, wheel } from '../components/controls.js';

/** Labels that differ on the Unison / Glide blocks. */
const BLOCK_LABELS = {
  glide_mode: 'Rate/Time',
  osc1_glide: 'Rate',
  glide_on: 'Glide',
  unison_on: 'Unison',
  unison_detune: 'Detune',
  hold: 'Hold',
};

/** Button text for section header switches. */
const SWITCH_LABELS = {
  glide_on: 'Glide',
  gated_on: 'On',
  arp_on: 'On',
  fx_on: 'On',
  env3_repeat: 'Repeat',
};

/** Header switches whose text reads On / Off with their state. */
const ON_OFF_TEXT = new Set(['arp_on', 'fx_on', 'gated_on']);

/**
 * Controls that only apply for one value of another param — greyed out
 * otherwise. dependent id → [source id, value it needs].
 */
const ACTIVE_WHEN = {
  gated_mode: ['seq_type', 0], // Mode is for the Gated sequencer, not Poly
};

/** Grey out / restore a control that ACTIVE_WHEN governs. */
function setActive(control, active) {
  control.classList.toggle('is-inactive', !active);
  control.querySelectorAll('select, input, button').forEach((node) => {
    node.disabled = !active;
  });
}

/**
 * @param {{
 *   midi: import('../midi/engine.js').MidiEngine,
 *   controlNodes: Map<string, any>,
 *   ui: { root: HTMLElement, layer: HTMLSelectElement },
 *   remember: () => void,
 * }} ctx
 */
export function createPanelControls(ctx) {
  const { midi, controlNodes } = ctx;

  /** Standard knob / select / toggle for a param. */
  function mountControl(param, row) {
    const value = midi.getValue(param.id, param.defaultValue ?? param.min);
    const control = renderParamControl(param, value, (v) => {
      midi.setParam(param, v);
      syncDependents(param.id, v, row);
    });
    const setValue = control._setValue;
    control._setValue = (v) => {
      setValue?.(v);
      syncDependents(param.id, v, row);
    };
    const rule = ACTIVE_WHEN[param.id];
    if (rule) {
      const [srcId, want] = rule;
      const src = PARAMS_BY_ID[srcId];
      setActive(control, Number(midi.getValue(srcId, src?.defaultValue ?? 0)) === want);
    }
    controlNodes.set(param.id, control);
    row.append(control);
  }

  /** Re-check controls that depend on `srcId` (looked up in the same section). */
  function syncDependents(srcId, value, row) {
    const scope = row.closest('.hw-section') || row;
    for (const [depId, [src, want]] of Object.entries(ACTIVE_WHEN)) {
      if (src !== srcId) continue;
      const node = scope.querySelector(`[data-id="${depId}"]`);
      if (node) setActive(node, Number(value) === want);
    }
  }

  /** A row of buttons that each set one value (e.g. Arp repeats 0–3). */
  function mountValueButtons(param, { label, values }) {
    const wrap = el('div', { class: 'control value-btns-control', 'data-id': param.id });
    wrap.append(el('label', { class: 'control-label', text: label || param.label }));
    const row = el('div', { class: 'hw-value-btns' });
    const sync = (v) => {
      row.querySelectorAll('[data-value]').forEach((btn) => {
        btn.classList.toggle('on', Number(btn.dataset.value) === Number(v));
      });
    };
    values.forEach((val) => {
      const btn = el('button', {
        type: 'button',
        class: 'ghost-btn hw-oct',
        text: String(val),
        title: `${label || param.label}: ${val}`,
        'data-value': String(val),
      });
      btn.addEventListener('click', () => sync(midi.setParam(param, val)));
      row.append(btn);
    });
    sync(midi.getValue(param.id, param.defaultValue ?? values[0]));
    wrap.append(row);
    controlNodes.set(param.id, { _setValue: (v) => sync(v) });
    return wrap;
  }

  /**
   * Section header on/off switch. True power switches (Arp, Effects) also
   * dim and disable the section body while off.
   */
  function mountOnOffSwitch(paramId, host) {
    const param = PARAMS_BY_ID[paramId];
    const value = midi.getValue(paramId, param?.defaultValue ?? 0);
    const dimsSection = paramId === 'arp_on' || paramId === 'fx_on';
    const text = SWITCH_LABELS[paramId] || param?.label || 'On';
    const title = param?.label || text;
    const btn = el('button', {
      type: 'button',
      class: `ghost-btn hw-mode-btn hw-section-on${value ? ' on' : ''}`,
      text,
      title,
      'aria-label': title,
      'aria-pressed': value ? 'true' : 'false',
    });
    const sync = (v) => {
      const on = !!v;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (ON_OFF_TEXT.has(paramId)) btn.textContent = on ? 'On' : 'Off';
      if (!host) return;
      if (dimsSection) {
        host.classList.toggle('is-off', !on);
        host.setAttribute('aria-disabled', on ? 'false' : 'true');
        host.querySelectorAll('button, select, input').forEach((node) => {
          if (node.closest('.hw-section-head') || node.classList.contains('hw-expand-btn')) return;
          node.disabled = !on;
        });
      } else {
        host.classList.remove('is-off');
        host.removeAttribute('aria-disabled');
      }
    };
    btn.addEventListener('click', () => {
      if (!param) return;
      const next = btn.classList.contains('on') ? 0 : 1;
      sync(next);
      midi.setParam(param, next);
    });
    sync(value);
    controlNodes.set(paramId, { _setValue: (v) => sync(v) });
    return btn;
  }

  function syncAbModeButtons() {
    const cur = midi.getValue('ab_mode', 0);
    ctx.ui.root.querySelectorAll('[data-ab-mode]').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.abMode) === cur);
    });
  }

  /** Stack / Split — toggles A/B mode (clicking the active one turns it off). */
  function mountAbModeBtn(label, mode) {
    const btn = el('button', {
      type: 'button',
      class: 'ghost-btn hw-mode-btn',
      text: label,
      'data-ab-mode': String(mode),
    });
    btn.classList.toggle('on', midi.getValue('ab_mode', 0) === mode);
    btn.addEventListener('click', () => {
      const param = PARAMS_BY_ID.ab_mode;
      if (!param) return;
      const cur = midi.getValue('ab_mode', 0);
      midi.setParam(param, cur === mode ? 0 : mode);
      syncAbModeButtons();
      ctx.remember();
    });
    return btn;
  }

  /** Edit B — switch the edited layer (on the synth too) and pull its values. */
  function mountLayerEditBtn() {
    const btn = el('button', {
      type: 'button',
      class: 'ghost-btn hw-mode-btn',
      text: 'Edit B',
      title: 'Edit Layer B — read current program from the synth into the panel',
    });
    const sync = () => {
      btn.classList.toggle('on', midi.layer === 'B');
      btn.setAttribute('aria-pressed', midi.layer === 'B' ? 'true' : 'false');
    };
    btn.addEventListener('click', () => {
      const next = midi.layer === 'B' ? 'A' : 'B';
      midi.setLayer(next, { notifySynth: true });
      ctx.ui.layer.value = midi.layer;
      sync();
      // Pull the edit-buffer dump and paint this layer's values into the UI
      midi.requestEditBuffer(midi.layer);
      ctx.remember();
    });
    sync();
    return btn;
  }

  /** Titled block of standard controls (Unison, …). */
  function mountHwBlock(title, ids, className) {
    const block = el('section', { class: className });
    if (title) block.append(el('div', { class: 'hw-strip-label hw-col-label', text: title }));
    const row = el('div', { class: 'hw-row' });
    ids.forEach((paramId) => {
      const param = PARAMS_BY_ID[paramId];
      if (!param) return;
      mountControl(BLOCK_LABELS[paramId] ? { ...param, label: BLOCK_LABELS[paramId] } : param, row);
    });
    block.append(row);
    return block;
  }

  /** Octave transpose buttons −2 … +2. */
  function mountHwTranspose() {
    const block = el('section', { class: 'hw-perf-block' });
    block.append(el('div', { class: 'hw-strip-label hw-col-label', text: 'Transpose' }));
    const param = PARAMS_BY_ID.transpose;
    const row = el('div', { class: 'hw-transpose' });
    const sync = (v) => {
      row.querySelectorAll('[data-transpose]').forEach((btn) => {
        btn.classList.toggle('on', Number(btn.dataset.transpose) === Number(v));
      });
    };
    [-2, -1, 0, 1, 2].forEach((oct) => {
      const label = oct > 0 ? `+${oct}` : String(oct);
      const btn = el('button', {
        type: 'button',
        class: 'ghost-btn hw-oct',
        text: label,
        title: `Transpose ${label} octave${Math.abs(oct) === 1 ? '' : 's'}`,
        'data-transpose': String(oct),
      });
      btn.addEventListener('click', () => sync(midi.setParam(param, oct)));
      row.append(btn);
    });
    sync(midi.getValue('transpose', 0));
    block.append(row);
    controlNodes.set('transpose', { _setValue: (v) => sync(v) });
    return block;
  }

  /** Pitch bend + mod wheel. */
  function mountPitchModWheels() {
    const wheels = el('div', { class: 'hw-seq-wheels' });
    const wheelsRow = el('div', { class: 'hw-perf-row hw-perf-row-wheels' });
    PANEL_LAYOUT.wheels.forEach((id) => {
      const param = PARAMS_BY_ID[id];
      if (!param) return;
      const value = midi.getValue(param.id, param.defaultValue ?? param.min);
      const control = wheel(param, value, (v) => midi.setParam(param, v), {
        spring: id === 'pitch_bend',
      });
      controlNodes.set(param.id, control);
      wheelsRow.append(control);
    });
    wheels.append(wheelsRow);
    return wheels;
  }

  return {
    mountControl,
    mountValueButtons,
    mountOnOffSwitch,
    mountAbModeBtn,
    mountLayerEditBtn,
    mountHwBlock,
    mountHwTranspose,
    mountPitchModWheels,
  };
}
