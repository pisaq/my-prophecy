/**
 * Titlebar actions: Notes Off and Reset All.
 */
import { PARAMS } from '../midi/params.js';

/**
 * @param {object} ctx app context (midi, ui, confirm, sendParamsPaced, runtime, remember)
 * @param {{ rerender: () => void }} hooks
 */
export function bindHeaderActions(ctx, { rerender }) {
  const { midi, ui } = ctx;

  ui.notesOff.addEventListener('click', () => {
    ctx.runtime.activeTrackpad?._teardown?.();
    midi.allNotesOff();
  });

  // Reset every param to its default (or min, usually 0) and send it
  const resetBtn = ui.resetAll;
  resetBtn.addEventListener('click', async () => {
    if (resetBtn.disabled) return;
    const ok = await ctx.confirm({
      title: 'Reset all controls?',
      message:
        'Every control goes back to its default (or 0), in the app and on the synth. The active layer’s current settings will be replaced.',
      confirmLabel: 'Reset All',
      danger: true,
    });
    if (!ok) return;
    resetBtn.disabled = true;
    resetBtn.classList.add('busy');
    try {
      await ctx.sendParamsPaced(PARAMS.map((p) => [p, p.defaultValue ?? p.min ?? 0]));
      // Rebuild the view so every control, switch and sequencer cell repaints
      rerender();
      ctx.remember();
    } finally {
      resetBtn.classList.remove('busy');
      resetBtn.disabled = false;
    }
  });
}
