/**
 * MIDI Monitor page: recent MIDI traffic, updated live.
 */
import { el } from '../components/controls.js';

const HISTORY = 80;
const MAX_LINES = 120;

const logLine = (entry) =>
  el('div', {
    class: `log-line ${entry.dir}`,
    text: `${entry.stamp}  ${entry.dir.toUpperCase()}  ${entry.text}`,
  });

/** @param {{ midi: import('../midi/engine.js').MidiEngine }} ctx */
export function createMonitorPage({ midi }) {
  const panel = el('section', { class: 'panel monitor-panel' });
  panel.append(el('h2', { class: 'panel-title', text: 'Live MIDI' }));
  const log = el('div', { class: 'midi-log', 'data-log': '' });
  midi.log.slice(-HISTORY).forEach((entry) => log.append(logLine(entry)));
  panel.append(log);

  const onLog = (e) => {
    log.append(logLine(e.detail));
    while (log.childElementCount > MAX_LINES) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  midi.addEventListener('log', onLog);
  panel._teardown = () => midi.removeEventListener('log', onLog);
  return panel;
}
