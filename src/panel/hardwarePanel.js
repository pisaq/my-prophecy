/**
 * Panel view: the fixed Rev2 front-panel map (fits one screen, no scroll),
 * built from PANEL_LAYOUT. Section builders are also used by the section
 * modal to make its enlarged copy.
 */
import { PANEL_LAYOUT, PARAMS_BY_ID } from '../midi/params.js';
import { el } from '../components/controls.js';
import { createPanelControls } from './panelControls.js';
import { mountProgramBanks } from './programBanks.js';
import { compactParamLabel } from './paramLabels.js';
import { createGatedSequencerEditor } from './gatedSequencer.js';

const ALL_SECTIONS = [...PANEL_LAYOUT.topRow, ...PANEL_LAYOUT.voiceRow];

/** Find a section definition in PANEL_LAYOUT by id (recurses into stacks). */
export function findPanelSection(id, list = ALL_SECTIONS) {
  for (const def of list) {
    if (def.id === id) return def;
    const hit = def.sections && findPanelSection(id, def.sections);
    if (hit) return hit;
  }
  return null;
}

const colLabel = (text) => el('div', { class: 'hw-strip-label hw-col-label', text });

/** Mod-matrix slot label: "Src" / "Amt" / "Dst". */
const modSlotKind = (paramId) => {
  if (paramId.includes('_src')) return 'Src';
  if (paramId.includes('_amt')) return 'Amt';
  return 'Dst';
};

/**
 * @param {object} ctx app context
 * @param {{ mountExpandBtn: (sectionId: string, host: HTMLElement) => void }} hooks
 */
export function createHardwarePanel(ctx, { mountExpandBtn }) {
  const { midi, controlNodes } = ctx;
  const controls = createPanelControls(ctx);

  function buildModMatrix(section, block) {
    if (section.label) block.append(colLabel(section.label));
    const grid = el('div', { class: 'hw-mod-grid' });
    (section.rows || []).forEach((rowDef) => {
      const strip = el('div', { class: 'hw-strip hw-mod-slot' });
      if (rowDef.label) {
        strip.append(
          el('div', { class: 'hw-strip-label', text: rowDef.label, title: `Mod ${rowDef.label}` }),
        );
      }
      const row = el('div', { class: 'hw-row' });
      rowDef.ids.forEach((paramId) => {
        const param = PARAMS_BY_ID[paramId];
        if (param) controls.mountControl({ ...param, label: modSlotKind(paramId) }, row);
      });
      strip.append(row);
      grid.append(strip);
    });
    if (section.id === 'modulation') {
      const body = el('div', { class: 'hw-mod-body' });
      body.append(grid, controls.mountPitchModWheels());
      block.append(body);
    } else {
      block.append(grid);
    }
  }

  function buildBanks(section, block) {
    const body = el('div', { class: 'hw-strip' });
    if (section.label) body.append(colLabel(section.label));
    const banks = mountProgramBanks(ctx, controls, mountExpandBtn, section.layerActions);
    banks.classList.add('hw-banks-grow');
    body.append(banks);
    block.append(body);
  }

  /** Default layout: optional header (title + on/off switch), then labelled rows. */
  function buildRows(section, block) {
    const rowsHaveLabels = (section.rows || []).some((r) => r.label);
    if (section.headerToggle) {
      const head = el('div', { class: 'hw-section-head' });
      if (section.label) head.append(colLabel(section.label));
      head.append(controls.mountOnOffSwitch(section.headerToggle, block));
      block.append(head);
    } else if (section.label && rowsHaveLabels) {
      block.append(colLabel(section.label));
    }
    (section.rows || []).forEach((rowDef) => {
      const strip = el('div', { class: 'hw-strip' });
      if (rowDef.label) {
        strip.append(el('div', { class: 'hw-strip-label', text: rowDef.label }));
      } else if (section.label && !rowsHaveLabels && !section.headerToggle) {
        strip.append(el('div', { class: 'hw-strip-label', text: section.label }));
      }
      const row = el('div', { class: 'hw-row' });
      rowDef.ids.forEach((paramId) => {
        const param = PARAMS_BY_ID[paramId];
        if (!param) return;
        if (paramId === 'arp_repeats') {
          row.append(
            controls.mountValueButtons(param, {
              label: compactParamLabel(section.id, param).label,
              values: [0, 1, 2, 3],
            }),
          );
          return;
        }
        controls.mountControl(compactParamLabel(section.id, param), row);
      });
      strip.append(row);
      block.append(strip);
    });
  }

  /** Build one section (or a vertical stack of sections) — no expand button. */
  function buildHwSection(section) {
    if (section.kind === 'section-stack') {
      const stack = el('div', { class: `hw-section-stack stack-${section.id}` });
      (section.sections || []).forEach((child) => stack.append(mountHwSection(child)));
      return stack;
    }
    const block = el('section', { class: `hw-section section-${section.id}` });
    if (section.kind === 'mod-matrix') buildModMatrix(section, block);
    else if (section.kind === 'banks') buildBanks(section, block);
    else buildRows(section, block);
    return block;
  }

  /** Build a section for the Panel (with its expand button). */
  function mountHwSection(section) {
    const node = buildHwSection(section);
    if (node.classList.contains('hw-section')) mountExpandBtn(section.id, node);
    return node;
  }

  /** The full-width gated-sequencer strip. */
  function buildSeqStrip() {
    const seq = el('section', { class: 'hw-section hw-seq-strip section-sequencer' });
    const seqHead = el('div', { class: 'hw-seq-head' });
    seqHead.append(colLabel('Sequencer'));
    seq.append(
      seqHead,
      createGatedSequencerEditor(midi, { controlNodes, compact: true, toolsHost: seqHead }),
    );
    return seq;
  }

  function render() {
    const board = el('div', { class: 'hw-board' });
    const top = el('div', { class: 'hw-top-row' });
    PANEL_LAYOUT.topRow.forEach((section) => top.append(mountHwSection(section)));

    const mid = el('div', { class: 'hw-seq-row' });
    const seq = buildSeqStrip();
    mountExpandBtn('sequencer', seq);
    mid.append(seq);

    const voice = el('div', { class: 'hw-voice-row' });
    PANEL_LAYOUT.voiceRow.forEach((section) => voice.append(mountHwSection(section)));
    board.append(top, mid, voice);
    return board;
  }

  return { render, buildHwSection, buildSeqStrip };
}
