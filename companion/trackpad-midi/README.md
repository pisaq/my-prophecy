# trackpad-midi companion

Native macOS helper for **my-prophecy**. Reads absolute multitouch via private `MultitouchSupport.framework` and:

1. Publishes virtual MIDI **my-prophecy Trackpad**
2. Exposes a localhost control API so a **published website** can Enable/Disable capture

Browsers cannot start Mac programs. Users run this companion once and leave it open; the site talks to it on `127.0.0.1`.

## Quick start

```bash
# From repo root — wait for the website button
npm run trackpad:daemon

# Or capture immediately (CLI / jam without the site)
npm run trackpad
npm run trackpad -- --out MidiLink
```

Double-click **`Start Trackpad Companion.command`** in the repo root (first run may ask to allow Terminal).

## Control API

Always bound to **http://127.0.0.1:17321** with `Access-Control-Allow-Origin: *`.

| Method | Path | Effect |
| --- | --- | --- |
| GET | `/status` | `{ running, out, port, name, companion }` |
| POST | `/start` | body optional `{ "out": "MidiLink" }` — start capture |
| POST | `/stop` | stop capture / note off |
| GET | `/` | tiny status page |

## Shipping for a published site

1. Build: `./build.sh` → `bin/trackpad-midi`
2. Attach the binary (and optionally the `.command` launcher) to GitHub Releases
3. Site copy: “Mac users: download the trackpad companion, open it, then click Enable”
4. Static hosting of the Vite `dist/` is enough — no Node server required for the button

## Mapping

- X left → right: C2 → C7  
- Y top → bottom: high → low  
- Finger size ≈ velocity  
