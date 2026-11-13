import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

// Project root (this file lives in tooling/)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'bin', 'trackpad-midi');
const buildScript = path.join(root, 'companion', 'trackpad-midi', 'build.sh');
const CONTROL = 'http://127.0.0.1:17321';

/**
 * During `npm run dev`, ensure the standalone companion daemon is running
 * so Enable/Disable works the same as on a published site (localhost:17321).
 * Also proxies /api/trackpad/* → companion for convenience.
 */
export function trackpadControlPlugin() {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;

  async function ensureBuilt() {
    try {
      await access(binary, constants.X_OK);
    } catch {
      await new Promise((resolve, reject) => {
        execFile(buildScript, { cwd: root }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      });
    }
  }

  async function companionUp() {
    try {
      const res = await fetch(`${CONTROL}/status`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async function ensureDaemon() {
    if (await companionUp()) return;
    await ensureBuilt();
    child = spawn(binary, ['--daemon', '--out', 'MidiLink'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (b) => process.stdout.write(`[trackpad] ${b}`));
    child.stderr?.on('data', (b) => process.stderr.write(`[trackpad] ${b}`));
    child.on('exit', () => {
      child = null;
    });
    for (let i = 0; i < 20; i++) {
      await delay(150);
      if (await companionUp()) return;
    }
  }

  function proxy(req, res, pathSuffix) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(pathSuffix, CONTROL);
      const opts = {
        hostname: '127.0.0.1',
        port: 17321,
        path: url.pathname + url.search,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      };
      const upstream = http.request(opts, (up) => {
        res.statusCode = up.statusCode || 502;
        res.setHeader('Content-Type', up.headers['content-type'] || 'application/json');
        up.pipe(res);
      });
      upstream.on('error', () => {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'companion not running' }));
      });
      upstream.end(body);
    });
  }

  return {
    name: 'trackpad-control',
    configureServer(server) {
      ensureDaemon().catch((err) => {
        console.warn('[trackpad] could not auto-start companion:', err.message);
      });

      server.httpServer?.once('close', () => {
        if (child) {
          try {
            child.kill('SIGINT');
          } catch {
            // ignore
          }
          child = null;
        }
      });

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/trackpad')) return next();
        const suffix = req.url.replace(/^\/api\/trackpad/, '') || '/status';
        proxy(req, res, suffix.startsWith('/') ? suffix : `/${suffix}`);
      });
    },
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
