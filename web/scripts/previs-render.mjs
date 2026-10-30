#!/usr/bin/env node
// Offline previs renderer: previs doc JSON -> headless Chrome (previs/render.html, real Charturbo
// engine) -> PNG frames -> ffmpeg -> mp4.
//
//   node scripts/previs-render.mjs <doc.json> <out.mp4> [--backend=webgpu|webgl2] [--frames=N]
//        [--chrome=path] [--no-aa]
//   node scripts/previs-render.mjs <doc.json> --still=<seconds> --out=<out.png> [--backend=..]
//
// --backend   webgpu (default; falls back to webgl2 with a warning when not given explicitly) or webgl2
// --frames=N  render only the first N frames
// --still=S   render ONE frame at time S seconds to --out (PNG), no ffmpeg (cheap preview)
// --no-aa     disable the 4x MSAA of the main pass
// --chrome    Chrome binary (or CHROME_PATH)
//
// Exit codes: 0 ok, 1 render / Chrome / ffmpeg failure, 2 usage error or invalid doc (issues are
// printed one per line as `path: message`). Progress goes to stderr; the last stdout line is
// `frames=.. fps=.. size=WxH out=..`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIS = path.join(WEB, 'previs');

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = (...m) => console.error('[previs]', ...m);

class Failure extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function findChrome() {
  const explicit = option('chrome') ?? process.env.CHROME_PATH;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  return (
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].find((p) => fs.existsSync(p)) ?? null
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Minimal CDP client over the page target's WebSocket (Node >= 22 global WebSocket). */
async function connectPage(port) {
  let targets = [];
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      // Chrome still starting
    }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome DevTools: no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Chrome DevTools: WebSocket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  let closed = null;
  const failAll = (why) => {
    closed ??= new Error(`Chrome DevTools connection lost (${why})`);
    for (const { reject } of pending.values()) reject(closed);
    pending.clear();
  };
  ws.addEventListener('close', () => failAll('closed'));
  ws.addEventListener('error', () => failAll('socket error'));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message} (${m.error.code})`));
      else resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners.get(m.method) ?? []) fn(m.params);
    }
  });
  const send = (method, params = {}, timeoutMs = 60_000) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(closed);
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`timeout in ${method}`));
      }, timeoutMs);
      const done = (fn) => (v) => {
        clearTimeout(timer);
        fn(v);
      };
      pending.set(i, { resolve: done(resolve), reject: done(reject) });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
    return () => listeners.get(method).delete(fn);
  };
  const once = (method, timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      const off = on(method, (p) => {
        clearTimeout(timer);
        off();
        resolve(p);
      });
    });
  const evaluate = async (expression, timeoutMs = 120_000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  return { send, on, once, evaluate, close: () => ws.close() };
}

/** ffmpeg: PNG stream on stdin -> H.264 mp4 (BT.709 matrix + tags so flat colors survive). */
function startFfmpeg(fps, out) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
    '-movflags', '+faststart',
    out,
  ];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let failed = null;
  proc.stderr.on('data', (d) => (stderr += d));
  proc.stdin.on('error', (err) => (failed ??= err));
  let exitCode = null;
  const exited = new Promise((resolve) => {
    proc.on('error', (err) => {
      failed ??= err;
      exitCode ??= -1;
      resolve(-1);
    });
    proc.on('close', (code) => {
      exitCode ??= code ?? -1;
      resolve(exitCode);
    });
  });
  const dead = () => failed !== null || (exitCode !== null && exitCode !== 0);
  const fail = () => new Failure(`ffmpeg failed: ${failed?.message ?? `exit ${exitCode}`} ${stderr.trim()}`);
  return {
    proc,
    async write(buf) {
      if (dead()) throw fail();
      // A dead pipe never emits 'drain': also wake on ffmpeg exit / stdin close / stdin error
      if (!proc.stdin.write(buf)) {
        await new Promise((resolve) => {
          const done = () => {
            proc.stdin.off('drain', done);
            proc.stdin.off('close', done);
            proc.stdin.off('error', done);
            resolve();
          };
          proc.stdin.once('drain', done);
          proc.stdin.once('close', done);
          proc.stdin.once('error', done);
          void exited.then(done);
        });
        if (dead()) throw fail();
      }
    },
    async finish() {
      proc.stdin.end();
      const code = await exited;
      if (code !== 0 || failed) throw new Failure(`ffmpeg exited with ${code}: ${stderr.trim() || failed?.message}`);
    },
  };
}

async function main() {
  const docPath = positional[0];
  const still = option('still');
  const stillOut = option('out') ?? (still !== undefined ? positional[1] : undefined);
  const outPath = still !== undefined ? undefined : positional[1];
  const backendOpt = option('backend');
  if (!docPath || (still === undefined && !outPath) || (still !== undefined && !stillOut)) {
    throw new Failure(
      'usage: node scripts/previs-render.mjs <doc.json> <out.mp4> [--backend=webgpu|webgl2] [--frames=N] [--chrome=path] [--no-aa]\n' +
        '       node scripts/previs-render.mjs <doc.json> --still=<seconds> --out=<out.png> [--backend=..]',
      2,
    );
  }
  if (backendOpt !== undefined && backendOpt !== 'webgpu' && backendOpt !== 'webgl2') {
    throw new Failure(`--backend must be webgpu or webgl2, got ${backendOpt}`, 2);
  }
  const backend = backendOpt ?? 'webgpu';
  let stillTime;
  if (still !== undefined) {
    stillTime = Number(still);
    if (!Number.isFinite(stillTime) || stillTime < 0) throw new Failure(`--still must be seconds >= 0, got ${still}`, 2);
  }
  const frameLimit = option('frames') !== undefined ? Number(option('frames')) : undefined;
  if (frameLimit !== undefined && !(Number.isInteger(frameLimit) && frameLimit >= 1)) {
    throw new Failure(`--frames must be an integer >= 1, got ${option('frames')}`, 2);
  }

  let docText;
  let doc;
  try {
    docText = fs.readFileSync(docPath, 'utf8');
  } catch (err) {
    throw new Failure(`cannot read ${docPath}: ${err.message}`, 2);
  }
  try {
    doc = JSON.parse(docText);
  } catch (err) {
    throw new Failure(`invalid JSON in ${docPath}: ${err.message}`, 2);
  }

  const chromePath = findChrome();
  if (!chromePath) throw new Failure('Chrome not found (set CHROME_PATH or --chrome=<path>)');
  if (still === undefined) {
    const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    const ok = await new Promise((resolve) => {
      probe.on('error', () => resolve(false));
      probe.on('close', (c) => resolve(c === 0));
    });
    if (!ok) throw new Failure('ffmpeg not found on PATH');
  }

  const cleanups = [];
  const cleanup = async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        await fn();
      } catch {
        // best effort
      }
    }
  };
  const onSignal = () => void cleanup().then(() => process.exit(130));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const { createServer } = await import('vite');
    const vitePort = await freePort();
    const vite = await createServer({
      root: PREVIS,
      configFile: path.join(PREVIS, 'vite.config.ts'),
      logLevel: 'warn',
      clearScreen: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: vitePort, strictPort: true, hmr: false, watch: null },
    });
    cleanups.push(() => vite.close());
    await vite.listen();

    const cdpPort = await freePort();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'charturbo-previs-'));
    const w = Number.isInteger(doc?.size?.width) && doc.size.width > 0 ? doc.size.width : 1200;
    const h = Number.isInteger(doc?.size?.height) && doc.size.height > 0 ? doc.size.height : 900;
    const chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--enable-unsafe-webgpu',
        ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        `--window-size=${w},${h}`,
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--force-color-profile=srgb',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--mute-audio',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let chromeExited = false;
    chrome.on('exit', () => (chromeExited = true));
    chrome.on('error', (err) => {
      chromeExited = true;
      info(`Chrome failed to start: ${err.message}`);
    });
    cleanups.push(async () => {
      if (!chromeExited) chrome.kill('SIGKILL');
      await sleep(200);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });

    let cdp;
    try {
      cdp = await connectPage(cdpPort);
    } catch (err) {
      throw new Failure(`Chrome did not start (${err.message})`);
    }
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const pageErrors = [];
    cdp.on('Runtime.exceptionThrown', (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        pageErrors.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__previsDoc = ${docText};` });

    const q = new URLSearchParams({ backend });
    if (flag('no-aa')) q.set('aa', '0');
    const loaded = cdp.once('Page.loadEventFired', 120_000);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/render.html?${q}` });
    await loaded;
    let state = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      state = await cdp.evaluate('window.__previs ?? null');
      if (state?.done) break;
      await sleep(50);
    }
    if (!state?.done) throw new Failure(`timeout starting the renderer${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    if (!state.ok) {
      if (state.issues) {
        for (const i of state.issues) console.error(`${i.path}: ${i.message}`);
        throw new Failure(`invalid previs document (${state.issues.length} issue${state.issues.length === 1 ? '' : 's'})`, 2);
      }
      throw new Failure(`renderer failed: ${state.error}${pageErrors.length ? ' | ' + pageErrors.join(' | ') : ''}`);
    }
    if (state.backend !== backend) {
      const msg = `requested backend ${backend}, got ${state.backend}`;
      if (backendOpt !== undefined) throw new Failure(msg);
      info(`warning: ${msg}`);
    }
    const meta = await cdp.evaluate('window.previs.info()');
    info(`${state.backend}; ${meta.frames} frames @ ${meta.fps} fps, ${meta.width}x${meta.height}, ${meta.duration}s`);

    const grab = async (i) => {
      const url = await cdp.evaluate(`window.previs.frame(${i})`);
      if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) throw new Failure(`frame ${i}: no PNG returned`);
      return Buffer.from(url.slice(22), 'base64');
    };

    if (still !== undefined) {
      const i = Math.min(meta.frames - 1, Math.max(0, Math.round(stillTime * meta.fps)));
      fs.mkdirSync(path.dirname(path.resolve(stillOut)), { recursive: true });
      fs.writeFileSync(stillOut, await grab(i));
      console.log(`frames=1 fps=${meta.fps} size=${meta.width}x${meta.height} out=${stillOut} frame=${i} backend=${state.backend}`);
      return;
    }

    const total = Math.min(meta.frames, frameLimit ?? meta.frames);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    const ff = startFfmpeg(meta.fps, outPath);
    // Cleanups run in reverse: kill ffmpeg first, then drop a partial mp4
    let complete = false;
    cleanups.push(() => {
      if (!complete) fs.rmSync(outPath, { force: true });
    });
    cleanups.push(() => ff.proc.kill('SIGKILL'));
    const t0 = Date.now();
    let nextReport = 1;
    for (let i = 0; i < total; i++) {
      await ff.write(await grab(i));
      if ((i + 1) / total >= nextReport / 10) {
        nextReport = Math.floor(((i + 1) / total) * 10) + 1;
        info(`${i + 1}/${total} frames (${Math.round(((i + 1) / total) * 100)}%), ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(3)} s/frame`);
      }
    }
    await ff.finish();
    complete = true;
    info(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    console.log(`frames=${total} fps=${meta.fps} size=${meta.width}x${meta.height} out=${outPath} backend=${state.backend}`);
  } finally {
    await cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    if (err instanceof Failure) console.error(`[previs] ${err.message}`);
    else console.error('[previs] error:', err);
    process.exit(err instanceof Failure ? err.code : 1);
  },
);
