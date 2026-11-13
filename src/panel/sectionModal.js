/**
 * Expand button on every Panel section, and the modal that shows an enlarged
 * copy of that section (same layout, genuinely bigger controls — no zoom).
 */
import { el } from '../components/controls.js';
import { createTrackpadPanel } from '../components/trackpad.js';
import { applyScaledStyles } from './scaledStyles.js';
import { findPanelSection } from './hardwarePanel.js';

/** Panel section id → modal title. */
export const SECTION_TITLES = {
  clock: 'Clock',
  arp: 'Arp',
  rate: 'Rate',
  seq_ctrl: 'Sequencer',
  sequencer: 'Sequencer',
  banks: 'Programs',
  trackpad: 'Trackpad',
  fx: 'Effects',
  env3: 'Envelope 3',
  modulation: 'Modulation',
  lfos: 'LFOs',
  oscillators: 'Oscillators',
  filter: 'LPF & Envelope 1',
  amp: 'Amplifier & Envelope 2',
};

const EXPAND_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5h3v3M10.5 1.5 7 5M4.5 10.5h-3v-3M1.5 10.5 5 7"/></svg>';

const MAX_SCALE = 2.6;
/** modal-root padding + body padding + borders */
const MODAL_CHROME = 48 + 32 + 4;

/**
 * @param {object} ctx app context (midi, ui, controlNodes, runtime, refreshControls)
 * @param {() => ReturnType<import('./hardwarePanel.js').createHardwarePanel>} getPanel
 */
export function createSectionModal(ctx, getPanel) {
  const { ui, controlNodes } = ctx;
  const sheet = ui.sectionModal.querySelector('.section-modal-sheet');
  /** Panel controls registered in controlNodes while the modal owns them. */
  let modalState = null;

  const isOpen = () => !ui.sectionModal.hidden;

  function show() {
    ui.sectionModal.hidden = false;
    ui.sectionModal.querySelector('.modal-close')?.focus();
  }

  /** Remove the section's own title (the modal header names it) and nested expand buttons. */
  function tidyMirror(mirror, sectionId, title) {
    const names = new Set(
      [sectionId === 'sequencer' ? 'Sequencer' : findPanelSection(sectionId)?.label, title]
        .filter(Boolean)
        .map((n) => n.trim().toLowerCase()),
    );
    [...mirror.querySelectorAll('.hw-col-label, .hw-strip-label')]
      .find((n) => names.has(n.textContent.trim().toLowerCase()))
      ?.remove();
    mirror.querySelectorAll('.hw-expand-btn').forEach((b) => {
      b.parentElement?.classList.remove('has-expand');
      b.remove();
    });
  }

  /** Scale so the panel section's proportions fill the space available. */
  function fit(sectionId, rect) {
    const rootBox = ui.sectionModal.getBoundingClientRect();
    const headH = sheet.querySelector('.modal-head').offsetHeight;
    const availW = rootBox.width - MODAL_CHROME;
    const availH = rootBox.height - MODAL_CHROME - headH;
    let scale;
    let width;
    if (sectionId === 'sequencer') {
      // Full-width strip: grow by height and let the step grid reflow to the width
      scale = Math.max(1, Math.min(2, availH / rect.height));
      width = availW;
    } else {
      scale = Math.max(1, Math.min(MAX_SCALE, availW / rect.width, availH / rect.height));
      width = rect.width * scale;
    }
    scale = Math.round(scale * 100) / 100;
    return { scale, width: Math.floor(width), height: Math.floor(rect.height * scale) };
  }

  function open(sectionId, host) {
    const title = SECTION_TITLES[sectionId];
    if (!title) return;
    const rect = host?.getBoundingClientRect();
    // Copies are sized from the panel section, so it must be on screen
    if (sectionId !== 'trackpad' && !rect?.width) return;
    close();
    // Modal controls take over controlNodes so hardware updates reach them;
    // the panel's nodes are restored (and resynced) on close.
    modalState = { panelNodes: new Map(controlNodes), teardowns: [], removeStyles: null };
    controlNodes.clear();
    ui.sectionModalBody.innerHTML = '';
    ui.sectionModalTitle.textContent = title;

    if (sectionId === 'trackpad') {
      const node = createTrackpadPanel(ctx.midi);
      if (node._teardown) modalState.teardowns.push(node._teardown);
      sheet.classList.remove('is-mirror');
      ui.sectionModalBody.append(node);
      show();
      return;
    }

    // Build the copy without replacing the panel's trackpad handle
    const panel = getPanel();
    const panelTrackpad = ctx.runtime.activeTrackpad;
    const mirror =
      sectionId === 'sequencer'
        ? panel.buildSeqStrip()
        : panel.buildHwSection(findPanelSection(sectionId));
    ctx.runtime.activeTrackpad = panelTrackpad;
    mirror.classList.add('hw-modal-mirror');
    tidyMirror(mirror, sectionId, title);
    mirror.querySelectorAll('.hw-trackpad').forEach((tp) => {
      if (tp._teardown) modalState.teardowns.push(tp._teardown);
    });

    // .hw-board scopes the panel's compact control sizing
    const frame = el('div', { class: 'hw-board hw-modal-frame' });
    frame.append(mirror);
    ui.sectionModalBody.append(frame);
    sheet.classList.add('is-mirror');
    ui.sectionModal.hidden = false;

    const { scale, width, height } = fit(sectionId, rect);
    modalState.removeStyles = applyScaledStyles('hw-scaled', scale);
    frame.classList.add('hw-scaled');
    mirror.style.width = `${width}px`;
    mirror.style.height = `${height}px`;
    ui.sectionModal.querySelector('.modal-close')?.focus();
  }

  function close() {
    if (!modalState) return;
    modalState.teardowns.forEach((fn) => fn());
    modalState.removeStyles?.();
    ui.sectionModalBody.innerHTML = '';
    ui.sectionModal.hidden = true;
    controlNodes.clear();
    modalState.panelNodes.forEach((node, id) => controlNodes.set(id, node));
    modalState = null;
    // Reflect edits made in the modal on the panel controls
    ctx.refreshControls();
  }

  /** Add the expand icon to a Panel section (top-left corner). */
  function mountExpandBtn(sectionId, host) {
    const label = SECTION_TITLES[sectionId];
    if (!label) return;
    const btn = el('button', {
      type: 'button',
      class: 'hw-expand-btn',
      'aria-label': `Expand ${label}`,
      title: `Expand ${label}`,
      html: EXPAND_ICON,
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      open(sectionId, host);
    });
    host.classList.add('has-expand');
    host.prepend(btn);
  }

  ui.sectionModal.querySelectorAll('[data-close-section-modal]').forEach((node) => {
    node.addEventListener('click', close);
  });

  return { open, close, isOpen, mountExpandBtn };
}
