/**
 * Composition root: creates the MIDI engine and app context, renders the
 * shell, and wires the Panel, pages, modals and header actions together.
 */
import { MidiEngine } from '../midi/engine.js';
import { PARAMS_BY_ID } from '../midi/params.js';
import { bindComputerKeyboard } from '../midi/computerKeyboard.js';
import { FractalBackground } from '../fractal/background.js';
import { createConfirmDialog } from '../components/confirmDialog.js';
import { createHardwarePanel } from '../panel/hardwarePanel.js';
import { createSectionModal } from '../panel/sectionModal.js';
import { createParamSender } from '../services/paramSender.js';
import { createLayersService } from '../services/layersDoc.js';
import { createAppPersister, restoreAppState } from './appState.js';
import { renderShell } from './shell.js';
import { createSidebar } from './sidebar.js';
import { createConnection } from './connection.js';
import { createNavigation } from './navigation.js';
import { bindHeaderActions } from './headerActions.js';

/** @param {HTMLElement} root */
export function mountApp(root) {
  const midi = new MidiEngine();
  const { state, saved } = restoreAppState(midi);
  const persister = createAppPersister({ state, midi, saved });
  const ui = renderShell(root, { activeSection: state.section });
  new FractalBackground(ui.fractal).start();

  /** Shared app context passed to modules. */
  const ctx = {
    midi,
    state,
    saved,
    ui,
    /** param id → control node (with `_setValue`) for what's on screen */
    controlNodes: new Map(),
    /** mutable handles owned by whichever view is showing */
    runtime: { activeTrackpad: null, pageTeardown: null },
    remember: () => persister.schedule(),
    confirm: createConfirmDialog(ui.confirmModal),
    sendParamsPaced: createParamSender(midi),
    /** Repaint every on-screen control from the engine's values. */
    refreshControls() {
      for (const [id, node] of ctx.controlNodes) {
        if (!node?._setValue) continue;
        node._setValue(midi.getValue(id, PARAMS_BY_ID[id]?.defaultValue ?? 0));
      }
    },
  };
  Object.assign(
    ctx,
    createLayersService({
      midi,
      state,
      sendParamsPaced: ctx.sendParamsPaced,
      onLayerRestored: () => {
        ui.layer.value = midi.layer;
        ctx.remember();
      },
    }),
  );

  // Panel ↔ section modal reference each other (expand buttons ↔ section copies)
  let panel = null;
  const sectionModal = createSectionModal(ctx, () => panel);
  panel = createHardwarePanel(ctx, { mountExpandBtn: sectionModal.mountExpandBtn });

  const sidebar = createSidebar(ui);
  const navigation = createNavigation(ctx, { panel, sectionModal, sidebar });
  const connection = createConnection(ctx, { onOpenDocs: () => navigation.goTo('docs') });
  bindHeaderActions(ctx, { rerender: () => navigation.render(state.section) });

  // Play the synth from the computer keyboard (Z–M · Q–I, [ ] octave)
  bindComputerKeyboard(midi, {
    initialOctave: state.keyboardOctave,
    onOctave(oct) {
      state.keyboardOctave = oct;
      ctx.remember();
    },
  });

  // Escape closes the topmost overlay (the confirm dialog handles its own)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !ui.confirmModal.hidden) return;
    if (sectionModal.isOpen()) sectionModal.close();
    else if (connection.isOpen()) connection.close();
    else if (sidebar.isOpen()) sidebar.close();
  });

  // Values coming back from the synth
  midi.addEventListener('param', (e) => {
    const node = ctx.controlNodes.get(e.detail.param.id);
    if (node?._setValue && e.detail.fromHardware) node._setValue(e.detail.value);
    ctx.remember();
  });
  midi.addEventListener('dump', (e) => {
    if (!e.detail?.ok) return;
    ctx.refreshControls();
    ctx.remember();
  });
  // Switching A↔B swaps in that layer's values — repaint the controls
  midi.addEventListener('layer', () => {
    ctx.refreshControls();
    ctx.remember();
  });

  navigation.render(state.section);
  connection.boot();
  window.addEventListener('pagehide', () => persister.flush());
}
