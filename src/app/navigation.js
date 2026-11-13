/**
 * Main view switching: the Panel and the menu pages.
 */
import { GROUPS } from '../midi/params.js';
import { createMidiDocsPanel } from '../pages/midiDocs.js';
import { createAudioToMidiPanel } from '../pages/audioToMidi.js';
import { createPatchBrowser } from '../pages/patchBrowser.js';
import { createSaveLoadPage } from '../pages/saveLoad.js';
import { createMonitorPage } from '../pages/monitor.js';

/**
 * @param {object} ctx app context
 * @param {{
 *   panel: ReturnType<import('../panel/hardwarePanel.js').createHardwarePanel>,
 *   sectionModal: ReturnType<import('../panel/sectionModal.js').createSectionModal>,
 *   sidebar: ReturnType<import('./sidebar.js').createSidebar>,
 * }} parts
 */
export function createNavigation(ctx, { panel, sectionModal, sidebar }) {
  const { ui, state, runtime } = ctx;

  /** Menu pages (id → builder). Builders may set `_teardown` on the node. */
  const PAGES = {
    patches: () =>
      createPatchBrowser({
        midi: ctx.midi,
        confirmDialog: ctx.confirm,
        snapshotLayers: ctx.snapshotLayers,
        sendLayers: ctx.sendLayers,
        sendParamsPaced: ctx.sendParamsPaced,
        onParamsChanged: ctx.remember,
      }),
    audio: () =>
      createAudioToMidiPanel({
        midi: ctx.midi,
        confirmDialog: ctx.confirm,
        sendParamsPaced: ctx.sendParamsPaced,
        onParamsChanged: ctx.remember,
        openPanel: () => goTo('panel'),
      }),
    saveload: () => createSaveLoadPage(ctx),
    monitor: () => createMonitorPage(ctx),
    docs: () => createMidiDocsPanel(),
  };

  function render(id) {
    sectionModal.close();
    runtime.activeTrackpad?._teardown?.();
    runtime.activeTrackpad = null;
    runtime.pageTeardown?.();
    runtime.pageTeardown = null;
    ctx.controlNodes.clear();
    ui.workspace.innerHTML = '';
    ui.sectionTitle.textContent = GROUPS.find((g) => g.id === id)?.label ?? id;
    ui.window?.classList.toggle('panel-mode', id === 'panel');
    if (id !== 'panel') sidebar.close();

    if (id === 'panel' || !PAGES[id]) {
      ui.workspace.append(panel.render());
      return;
    }
    const node = PAGES[id]();
    runtime.pageTeardown = node._teardown ?? null;
    ui.workspace.append(node);
  }

  /** Switch the main view (same as clicking the sidebar menu). */
  function goTo(id) {
    state.section = id;
    ui.nav.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.section === id);
    });
    sidebar.close();
    render(id);
    ctx.remember();
  }

  ui.nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn) goTo(btn.dataset.section);
  });

  return { render, goTo };
}
