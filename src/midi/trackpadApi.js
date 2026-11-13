/** Local companion control API (works with a published site). */
export const TRACKPAD_API = 'http://127.0.0.1:17321';

/** Name of the companion's virtual MIDI port (old misspelling included). */
export const TRACKPAD_PORT = /my-prophecy\s*trackpad|my-phophecy\s*trackpad/i;

/**
 * Prefer the standalone companion; fall back to Vite /api/trackpad during `npm run dev`
 * if the companion is not running yet.
 */
export async function trackpadFetch(path, options = {}) {
  const attempts = [`${TRACKPAD_API}${path}`, `/api/trackpad${path}`];
  let lastError;

  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Trackpad companion not reachable');
}

export async function trackpadStatus() {
  return trackpadFetch('/status');
}

/** Start capture. Notes go out the app's selected Output, not a companion port. */
export async function trackpadStart() {
  return trackpadFetch('/start', {
    method: 'POST',
    body: JSON.stringify({ out: '' }),
  });
}

export async function trackpadStop() {
  return trackpadFetch('/stop', { method: 'POST' });
}
