/**
 * Patch library — stored in IndexedDB (audio previews are too big for
 * localStorage). Local to this browser.
 *
 * Entry:
 * {
 *   id: string,
 *   name: string,
 *   bank: number | null,        // 0–7 when captured from a synth program slot
 *   program: number | null,     // 0–127
 *   source: 'capture' | 'current' | 'file' | 'morph',
 *   createdAt: number,
 *   doc: LayersDoc | null,      // same shape as Save/Load JSON; null if SysEx didn't answer
 *   preview: Blob | null,       // recorded audio
 *   waveform: number[] | null,  // ~64 peak values 0..1 for thumbnails
 *   peak: number | null,        // loudest sample 0..1 (silence check)
 * }
 */

const DB_NAME = 'my-prophecy';
const DB_VERSION = 1;
const STORE = 'patches';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open the patch library'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => {
          result = r;
        });
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Library transaction aborted'));
      }),
  );
}

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listPatches() {
  const all = await tx('readonly', (store) => req(store.getAll()));
  return (all || []).sort(
    (a, b) =>
      (a.bank ?? 99) - (b.bank ?? 99) ||
      (a.program ?? 999) - (b.program ?? 999) ||
      b.createdAt - a.createdAt,
  );
}

export function putPatch(entry) {
  return tx('readwrite', (store) => req(store.put(entry)));
}

export function deletePatch(id) {
  return tx('readwrite', (store) => req(store.delete(id)));
}

/** Replace any entry captured from the same bank/program slot. */
export async function upsertSlot(entry) {
  if (entry.bank == null || entry.program == null) return putPatch(entry);
  const existing = (await listPatches()).find(
    (p) => p.source === 'capture' && p.bank === entry.bank && p.program === entry.program,
  );
  return putPatch(existing ? { ...entry, id: existing.id } : entry);
}
