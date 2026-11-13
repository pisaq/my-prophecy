/** localStorage persistence for My Prophecy UI + editor state. */

const STORAGE_KEY = 'my-prophecy.settings';
const VERSION = 1;

/**
 * @typedef {Object} PersistedSettings
 * @property {number} v
 * @property {string} [section]
 * @property {number} [bankA]
 * @property {number} [programA]
 * @property {number} [bankB]
 * @property {number} [programB]
 * @property {number} [keyboardOctave]
 * @property {{ outputName?: string|null, inputName?: string|null, channel?: number, protocol?: string, layer?: string, midiThru?: boolean }} [connection]
 * @property {Record<string, number>} [values]
 * @property {{ A?: Record<string, number>, B?: Record<string, number> }} [layerValues]
 */

/** @returns {PersistedSettings|null} */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** @param {Omit<PersistedSettings, 'v'>} data */
export function saveSettings(data) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: VERSION,
        savedAt: Date.now(),
        ...data,
      }),
    );
  } catch {
    // Quota / private mode — ignore
  }
}

/**
 * @param {() => Omit<PersistedSettings, 'v'>} getSnapshot
 * @param {number} [delayMs]
 */
export function createPersister(getSnapshot, delayMs = 200) {
  let timer = null;
  const write = () => {
    timer = null;
    saveSettings(getSnapshot());
  };
  return {
    schedule() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    flush() {
      if (timer != null) clearTimeout(timer);
      write();
    },
  };
}
