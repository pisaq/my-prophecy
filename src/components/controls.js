/** Lightweight macOS-feeling controls for the Rev2 editor. */

/** @type {HTMLElement | null} */
let hotControl = null;

export function markControlHot(node) {
  if (hotControl && hotControl !== node) hotControl.classList.remove('hot');
  hotControl = node;
  node.classList.add('hot');
}

function markKnobHot(dial) {
  markControlHot(dial);
}

export function knob(param, value, onChange) {
  const wrap = el('div', { class: 'control knob-control', 'data-id': param.id });
  const label = el('label', { class: 'control-label', text: param.label });
  const dial = el('div', {
    class: 'knob',
    role: 'slider',
    tabindex: '0',
    'aria-valuemin': String(param.min),
    'aria-valuemax': String(param.max),
    'aria-valuenow': String(value),
    'aria-label': param.label,
  });
  const pointer = el('div', { class: 'knob-pointer' });
  dial.append(pointer);
  const read = el('div', { class: 'control-value', text: formatValue(param, value) });

  const setVisual = (v) => {
    const t = (v - param.min) / (param.max - param.min || 1);
    const angle = -135 + t * 270;
    dial.style.setProperty('--angle', `${angle}deg`);
    dial.setAttribute('aria-valuenow', String(v));
    read.textContent = formatValue(param, v);
  };
  setVisual(value);

  let dragging = false;
  let startY = 0;
  let startVal = value;

  const update = (v) => {
    const clamped = Math.round(Math.min(param.max, Math.max(param.min, v)));
    setVisual(clamped);
    onChange(clamped);
  };

  dial.addEventListener('pointerdown', (e) => {
    dragging = true;
    markKnobHot(dial);
    dial.classList.add('active');
    startY = e.clientY;
    startVal = Number(dial.getAttribute('aria-valuenow'));
    dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = (startY - e.clientY) * ((param.max - param.min) / 140);
    update(startVal + delta);
  });
  dial.addEventListener('pointerup', () => {
    dragging = false;
    dial.classList.remove('active');
  });
  dial.addEventListener('pointercancel', () => {
    dragging = false;
    dial.classList.remove('active');
  });
  dial.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 8 : 1;
    const cur = Number(dial.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      markKnobHot(dial);
      update(cur + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      markKnobHot(dial);
      update(cur - step);
    }
  });
  dial.addEventListener('dblclick', () => {
    markKnobHot(dial);
    update(param.defaultValue ?? param.min);
  });
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      markKnobHot(dial);
      const step = e.shiftKey ? 8 : 1;
      const cur = Number(dial.getAttribute('aria-valuenow'));
      update(cur + (e.deltaY < 0 ? step : -step));
    },
    { passive: false },
  );

  wrap.append(label, dial, read);
  wrap._setValue = (v) => setVisual(v);
  return wrap;
}

export function slider(param, value, onChange) {
  const wrap = el('div', { class: 'control slider-control', 'data-id': param.id });
  const top = el('div', { class: 'control-row' });
  top.append(
    el('label', { class: 'control-label', text: param.label }),
    el('span', { class: 'control-value', text: formatValue(param, value) }),
  );
  const input = el('input', {
    type: 'range',
    min: String(param.min),
    max: String(param.max),
    step: '1',
    value: String(value),
    class: 'mac-slider',
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    top.querySelector('.control-value').textContent = formatValue(param, v);
    onChange(v);
  });
  wrap.append(top, input);
  wrap._setValue = (v) => {
    input.value = String(v);
    top.querySelector('.control-value').textContent = formatValue(param, v);
  };
  return wrap;
}

export function selectControl(param, value, onChange) {
  const wrap = el('div', { class: 'control select-control', 'data-id': param.id });
  wrap.append(el('label', { class: 'control-label', text: param.label }));
  const select = el('select', { class: 'mac-select' });
  (param.options || []).forEach((opt, i) => {
    const o = el('option', { value: String(i), text: opt });
    if (i === value) o.selected = true;
    select.append(o);
  });
  select.addEventListener('change', () => {
    markControlHot(select);
    onChange(Number(select.value));
  });
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (select.disabled) return;
      const max = (param.options?.length ?? 1) - 1;
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
  wrap.append(select);
  wrap._setValue = (v) => {
    select.value = String(v);
  };
  return wrap;
}

export function toggle(param, value, onChange) {
  const wrap = el('div', {
    class: `control toggle-control${param.labelAbove ? ' labeled' : ''}`,
    'data-id': param.id,
  });
  if (param.labelAbove) {
    wrap.append(el('label', { class: 'control-label', text: param.label }));
  }
  const btn = el('button', {
    type: 'button',
    class: `mac-toggle${value ? ' on' : ''}`,
    'aria-pressed': value ? 'true' : 'false',
    text: param.labelAbove ? (value ? 'On' : 'Off') : param.label,
  });
  btn.addEventListener('click', () => {
    const next = btn.classList.contains('on') ? 0 : 1;
    btn.classList.toggle('on', !!next);
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (param.labelAbove) btn.textContent = next ? 'On' : 'Off';
    onChange(next);
  });
  wrap.append(btn);
  wrap._setValue = (v) => {
    btn.classList.toggle('on', !!v);
    btn.setAttribute('aria-pressed', v ? 'true' : 'false');
    if (param.labelAbove) btn.textContent = v ? 'On' : 'Off';
  };
  return wrap;
}

/** Vertical pitch/mod wheel — spring-centers pitch on release when spring is true. */
export function wheel(param, value, onChange, { spring = false } = {}) {
  const wrap = el('div', { class: 'control wheel-control', 'data-id': param.id });
  wrap.append(el('label', { class: 'control-label', text: param.label }));
  const track = el('div', {
    class: 'wheel-track',
    role: 'slider',
    tabindex: '0',
    'aria-valuemin': String(param.min),
    'aria-valuemax': String(param.max),
    'aria-valuenow': String(value),
    'aria-label': param.label,
  });
  const thumb = el('div', { class: 'wheel-thumb' });
  track.append(thumb);
  const read = el('div', { class: 'control-value', text: String(value) });

  const setVisual = (v) => {
    const t = (v - param.min) / (param.max - param.min || 1);
    thumb.style.bottom = `${t * 100}%`;
    track.setAttribute('aria-valuenow', String(v));
    read.textContent = String(v);
  };
  setVisual(value);

  const updateFromY = (clientY) => {
    const rect = track.getBoundingClientRect();
    const t = 1 - (clientY - rect.top) / rect.height;
    const v = Math.round(param.min + Math.min(1, Math.max(0, t)) * (param.max - param.min));
    setVisual(v);
    onChange(v);
  };

  const apply = (v) => {
    const clamped = Math.round(Math.min(param.max, Math.max(param.min, v)));
    setVisual(clamped);
    onChange(clamped);
    return clamped;
  };

  track.addEventListener('pointerdown', (e) => {
    markControlHot(track);
    track.classList.add('active');
    track.setPointerCapture(e.pointerId);
    updateFromY(e.clientY);
  });
  track.addEventListener('pointermove', (e) => {
    if (!track.hasPointerCapture(e.pointerId)) return;
    updateFromY(e.clientY);
  });
  track.addEventListener('pointerup', (e) => {
    if (spring) {
      const center = param.defaultValue ?? Math.round((param.min + param.max) / 2);
      apply(center);
    }
    track.classList.remove('active');
    track.releasePointerCapture(e.pointerId);
  });
  track.addEventListener('pointercancel', () => {
    track.classList.remove('active');
  });
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      markControlHot(track);
      const step = e.shiftKey ? 8 : 1;
      const cur = Number(track.getAttribute('aria-valuenow'));
      apply(cur + (e.deltaY < 0 ? step : -step));
    },
    { passive: false },
  );
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 8 : 1;
    const cur = Number(track.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      markControlHot(track);
      apply(cur + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      markControlHot(track);
      apply(cur - step);
    }
  });
  track.addEventListener('dblclick', () => {
    markControlHot(track);
    apply(param.defaultValue ?? Math.round((param.min + param.max) / 2));
  });

  wrap.append(track, read);
  wrap._setValue = (v) => setVisual(v);
  return wrap;
}

export function renderParamControl(param, value, onChange) {
  if (param.id === 'pitch_bend' || param.id === 'mod_wheel') {
    return wheel(param, value, onChange, { spring: param.id === 'pitch_bend' });
  }
  if (param.type === 'enum') return selectControl(param, value, onChange);
  if (param.type === 'toggle') return toggle(param, value, onChange);
  if (param.max - param.min > 12) return knob(param, value, onChange);
  return slider(param, value, onChange);
}

export function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  }
  return node;
}

function formatValue(param, value) {
  if (param.type === 'enum' && param.options) return param.options[value] ?? String(value);
  if (param.type === 'toggle') return value ? 'On' : 'Off';
  return String(value);
}
