// Copies the basic-pitch model (model.json + weights) into public/ so the
// transcription worker can fetch it on demand. Runs on `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@spotify/basic-pitch/model');
const dest = join(root, 'public/models/basic-pitch');

if (!existsSync(src)) {
  console.warn('[basic-pitch] model not found in node_modules — skipping copy');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[basic-pitch] model copied to public/models/basic-pitch');
