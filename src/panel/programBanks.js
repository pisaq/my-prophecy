/**
 * Programs section of the Panel: bank / program recall, the square trackpad,
 * and the Layers / Unison / Transpose blocks.
 */
import { BANKS, PANEL_LAYOUT } from '../midi/params.js';
import { el } from '../components/controls.js';
import { createTrackpadEmbed } from '../components/trackpad.js';
import { clamp } from '../lib/math.js';

/**
 * @param {object} ctx app context (midi, state, remember, runtime)
 * @param {ReturnType<import('./panelControls.js').createPanelControls>} controls
 * @param {(sectionId: string, host: HTMLElement) => void} mountExpandBtn
 * @param {{ kind: string, label?: string, mode?: number }[]} [layerActions]
 */
export function mountProgramBanks(ctx, controls, mountExpandBtn, layerActions = []) {
  const { midi, state } = ctx;
  const wrap = el('div', { class: 'hw-banks' });

  const bankSelect = el('select', { class: 'mac-select compact' });
  BANKS.forEach((b, i) => bankSelect.append(el('option', { value: String(i), text: b })));
  bankSelect.value = String(state.bankA);
  const programInput = el('input', {
    type: 'number',
    class: 'mac-number',
    min: '0',
    max: '127',
    value: String(state.programA),
  });
  // No Go button: changing the bank or program recalls it straight away
  let pending = 0;
  const send = () => {
    clearTimeout(pending);
    state.bankA = Number(bankSelect.value);
    state.programA = clamp(Number(programInput.value), 0, 127);
    programInput.value = String(state.programA);
    midi.sendProgram(state.bankA, state.programA);
    ctx.remember();
  };
  bankSelect.addEventListener('change', send);
  programInput.addEventListener('change', send);
  // Spinner arrows / typing: wait briefly so "12" doesn't first recall 1
  programInput.addEventListener('input', () => {
    clearTimeout(pending);
    if (programInput.value === '') return;
    pending = setTimeout(send, 300);
  });

  const mainCol = el('div', { class: 'hw-banks-main' });
  const leftCol = el('div', { class: 'hw-banks-left' });
  const recallRow = el('div', { class: 'hw-banks-recall' });
  recallRow.append(bankSelect, programInput);
  const trackpad = createTrackpadEmbed(midi);
  trackpad.classList.add('hw-trackpad-mini');
  mountExpandBtn('trackpad', trackpad);
  ctx.runtime.activeTrackpad = trackpad;
  leftCol.append(recallRow, trackpad);

  const sideStack = el('div', { class: 'hw-unison-stack' });
  if (layerActions.length) {
    const layers = el('section', { class: 'hw-perf-block hw-layers-block' });
    layers.append(el('div', { class: 'hw-strip-label hw-col-label', text: 'Layers' }));
    const layerRow = el('div', { class: 'hw-layers hw-layers-inline' });
    layerActions.forEach((action) => {
      if (action.kind === 'ab') layerRow.append(controls.mountAbModeBtn(action.label, action.mode));
      else if (action.kind === 'layer') layerRow.append(controls.mountLayerEditBtn());
    });
    layers.append(layerRow);
    sideStack.append(layers);
  }
  const unison = controls.mountHwBlock(
    'Unison',
    PANEL_LAYOUT.performance.unisonHold,
    'hw-perf-block',
  );
  const transpose = controls.mountHwTranspose();
  transpose.classList.add('hw-perf-block');
  sideStack.append(unison, transpose);

  mainCol.append(leftCol, sideStack);
  wrap.append(mainCol);

  // Square trackpad: width must follow the column's available height. CSS
  // aspect-ratio alone doesn't feed back into the column's width on first
  // layout (it only corrected after a hover-triggered relayout), so size it here.
  const sizeLeftCol = () => {
    const gap = parseFloat(getComputedStyle(leftCol).rowGap) || 0;
    const side = Math.floor(leftCol.clientHeight - recallRow.offsetHeight - gap);
    if (side > 0) leftCol.style.width = `${side}px`;
  };
  // Not tied to trackpad._teardown (Notes Off calls that); the observer is
  // released with its targets when the panel DOM is discarded.
  const ro = new ResizeObserver(sizeLeftCol);
  ro.observe(mainCol);
  ro.observe(recallRow);
  return wrap;
}
