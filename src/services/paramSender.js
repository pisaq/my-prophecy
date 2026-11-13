import { wait } from '../lib/sleep.js';

const BATCH_SIZE = 12;
const BATCH_GAP_MS = 8;

/**
 * Send [param, value] pairs in small paced batches, so hundreds of params
 * (many of them 4-message NRPNs) don't flood the MIDI interface.
 * @param {import('../midi/engine.js').MidiEngine} midi
 */
export function createParamSender(midi) {
  return async function sendParamsPaced(entries) {
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      entries.slice(i, i + BATCH_SIZE).forEach(([param, value]) => {
        midi.setParam(param, value, { silent: true });
      });
      await wait(BATCH_GAP_MS);
    }
  };
}
