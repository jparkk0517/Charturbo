#!/usr/bin/env node
// Offline previs renderer: previs doc JSON -> headless Chrome (previs/render.html, real Charturbo
// engine) -> PNG frames -> ffmpeg -> mp4.
//
//   node scripts/previs-render.mjs <doc.json> <out> [--format=mp4|mp4-lossless|png-seq] [--backend=webgpu|webgl2]
//        [--frames=N] [--shot=<id> | --range=<a>..<b>] [--handles=<seconds>] [--split-shots]
//        [--force] [--camera-json=<file>] [--chrome=path] [--no-aa]
//   node scripts/previs-render.mjs <doc.json> --still=<seconds> --out=<out.png> [--backend=..]
//
// --format    mp4 (default: libx264 -crf 14 yuv420p BT.709), mp4-lossless (libx264rgb -crf 0 -preset veryslow, RGB,
//             0 off-palette pixels; needs an ffmpeg with libx264rgb, else exit 1; many players cannot play RGB H.264)
//             or png-seq (<out> is a DIRECTORY: frame_000000.png ... numbered from 0 per output, no ffmpeg needed)
// --backend   webgpu (default; falls back to webgl2 with a warning when not given explicitly) or webgl2
// --frames=N  render only the first N frames (of the selected span)
// --shot=ID   render only that shot's time span (unknown id: exit 2); --range=A..B renders seconds [A, B) (frames i with
//             A <= i/fps < B). Frames keep the doc fps and the GLOBAL clock (frame i is always t = i/fps). Exclusive.
// --handles=S extra seconds added on both sides of --shot / --range / each split shot, clamped to [0, duration] (default 0)
// --split-shots  one output per shot: <out-stem>.<shotId>.<ext> (mp4 formats) or <out>/<shotId>/ (png-seq), plus
//             <out-stem>.cuts.json = [{ shot, start, end, frames: [first, last] }] (frames = global inclusive indices;
//             start/end = seconds incl. handles). Not combinable with --shot / --range / --frames.
// --camera-json=FILE  per rendered frame { frame, t, shot, eye, target, up, roll, fovDeg, aspect, near, far, worldScale,
//             view, projection } under { units, frames: [...] }: eye / target in METERS, near / far / view / projection
//             in ENGINE units (= meters * worldScale), matrices column-major (clip = projection * view * [p,1]),
//             reverse-Z perspective_rh(fov, aspect, far, near) (see previs/camera.ts, mirrors the engine camera).
//             A frame rendered twice (overlapping shots with handles) appears once.
// --force    png-seq only: delete existing frame_NNNNNN.png files (only those) in the target directory; without it a
//             directory that already holds such files is a usage error (exit 2)
//             A shot shorter than one frame under --split-shots is skipped (warning, frames: [] in cuts.json).
// --still=S   render ONE frame at time S seconds to --out (PNG), no ffmpeg (cheap preview)
// --no-aa     disable the 4x MSAA of the main pass
// --chrome    Chrome binary (or CHROME_PATH)
//
// glTF models (`shape: 'model'`): a relative `model.src` resolves against the DOC FILE's directory and is served by the
// local vite server (any size) under opaque `/__previs_models/<index>/<basename>` URLs (only collected model files; a .gltf
// may also load siblings of its own directory); http(s)/data URLs pass through. A missing model file fails with exit 1
// before Chrome starts (after the doc is validated).
//
// Exit codes: 0 ok, 1 render / Chrome / ffmpeg failure, 2 usage error or invalid doc (issues are
// printed one per line as `path: message`). Progress goes to stderr; the last stdout line is
// `frames=.. fps=.. size=WxH out=.. backend=.. format=..` (with --split-shots: out = the cuts file, frames = total).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_PREFIX = '/__previs_models/';
const MIME = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

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

/**
 * glTF model sources of the doc: relative paths (and file: URLs / absolute fs paths) resolve against the DOC FILE's
 * directory and are served by the vite plugin `previsModels` as `/__previs_models/<index>/<basename>` (no /@fs, no
 * base64 through CDP, 20+ MB models are fine). http(s): / data: / blob: URLs pass through. `srcs` = modelSrcsToLoad(doc)
 * (src/previs/models.ts): the models the player loads (a pure pivot only when a node hangs from its joint).
 * Returns { urls: src -> served URL, missing: [{src, file}], files: index -> { file, dir } }.
 */
function collectModels(srcs, docPath) {
  const urls = {};
  const missing = [];
  const files = new Map();
  const docDir = path.dirname(path.resolve(docPath));
  for (const src of srcs) {
    if (typeof src !== 'string' || src === '' || src in urls || missing.some((m) => m.src === src)) continue;
    if (/^(https?|data|blob):/i.test(src)) continue;
    let file;
    try {
      file = /^file:/i.test(src) ? fileURLToPath(src) : path.resolve(docDir, decodeRelative(src));
    } catch {
      missing.push({ src, file: src });
      continue;
    }
    let ok = false;
    try {
      ok = fs.statSync(file).isFile();
    } catch {
      // missing
    }
    if (!ok) missing.push({ src, file });
    else {
      const index = files.size;
      files.set(index, { file, dir: path.dirname(file) });
      urls[src] = `${MODEL_PREFIX}${index}/${encodeURIComponent(path.basename(file))}`;
    }
  }
  return { urls, missing, files };
}

/** Vite plugin: serves ONLY the collected model files (and, for .gltf, files inside the model's own directory). */
function previsModels(files) {
  return {
    name: 'previs-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url ?? '').split('?')[0];
        if (!raw.startsWith(MODEL_PREFIX)) return next();
        const fail = (code) => {
          res.statusCode = code;
          res.end();
        };
        let rel;
        try {
          rel = decodeURIComponent(raw.slice(MODEL_PREFIX.length));
        } catch {
          return fail(400);
        }
        const slash = rel.indexOf('/');
        const entry = slash < 0 ? undefined : files.get(Number(rel.slice(0, slash)));
        const sub = slash < 0 ? '' : rel.slice(slash + 1);
        if (!entry || !sub || sub.includes('\\') || sub.includes('\0') || sub.split('/').some((p) => p === '..' || p === '')) return fail(404);
        const isGltf = /\.gltf$/i.test(entry.file);
        const target = path.resolve(entry.dir, ...sub.split('/'));
        // .glb: only the model itself; .gltf: anything inside its directory
        if (target !== entry.file && !(isGltf && target.startsWith(entry.dir + path.sep))) return fail(404);
        let st;
        try {
          st = fs.statSync(target);
        } catch {
          return fail(404);
        }
        if (!st.isFile()) return fail(404);
        res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', st.size);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(target)
          .on('error', () => res.destroy())
          .pipe(res);
      });
    },
  };
}

// `src` is a URL-ish relative reference: strip ?query / #hash, decode %XX when it looks encoded
function decodeRelative(src) {
  const bare = src.replace(/[?#].*$/, '');
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
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

/** ffmpeg: PNG stream on stdin -> H.264 mp4 (mp4: BT.709 yuv420p; mp4-lossless: libx264rgb crf 0 RGB). */
function startFfmpeg(fps, out, format = 'mp4') {
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
  const args = format === 'mp4-lossless'
    ? [...input, '-c:v', 'libx264rgb', '-preset', 'veryslow', '-crf', '0', '-pix_fmt', 'rgb24', '-movflags', '+faststart', out]
    : [
    ...input,
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
      'usage: node scripts/previs-render.mjs <doc.json> <out> [--format=mp4|mp4-lossless|png-seq] [--backend=webgpu|webgl2] [--frames=N]\n' +
        '         [--shot=<id> | --range=<a>..<b>] [--handles=<seconds>] [--split-shots] [--camera-json=<file>] [--chrome=path] [--no-aa]\n' +
        '       node scripts/previs-render.mjs <doc.json> --still=<seconds> --out=<out.png> [--backend=..]\n' +
        '  <out> is the mp4 file, or a directory for --format=png-seq (frame_000000.png ...)',
      2,
    );
  }
  const format = option('format') ?? 'mp4';
  if (format !== 'mp4' && format !== 'mp4-lossless' && format !== 'png-seq') {
    throw new Failure(`--format must be mp4, mp4-lossless or png-seq, got ${format}`, 2);
  }
  const shotOpt = option('shot');
  const rangeOpt = option('range');
  const splitShots = flag('split-shots');
  const cameraJson = option('camera-json');
  const force = flag('force');
  if (still !== undefined) {
    const ignored = [
      ['camera-json', cameraJson !== undefined],
      ['split-shots', splitShots],
      ['format', option('format') !== undefined],
      ['shot', shotOpt !== undefined],
      ['range', rangeOpt !== undefined],
      ['handles', option('handles') !== undefined],
      ['force', force],
    ].find(([, given]) => given);
    if (ignored) throw new Failure(`--${ignored[0]} has no effect with --still; remove it`, 2);
  } else if (option('handles') !== undefined && shotOpt === undefined && rangeOpt === undefined && !splitShots) {
    throw new Failure('--handles needs --shot, --range or --split-shots', 2);
  }
  if (shotOpt !== undefined && rangeOpt !== undefined) throw new Failure('--shot and --range are exclusive', 2);
  if (splitShots && (shotOpt !== undefined || rangeOpt !== undefined || option('frames') !== undefined)) {
    throw new Failure('--split-shots cannot be combined with --shot, --range or --frames', 2);
  }
  let range;
  if (rangeOpt !== undefined) {
    const m = /^([0-9.eE+-]+)\.\.([0-9.eE+-]+)$/.exec(rangeOpt);
    range = m ? [Number(m[1]), Number(m[2])] : null;
    if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] < 0 || range[1] <= range[0]) {
      throw new Failure(`--range must be <a>..<b> seconds with 0 <= a < b, got ${rangeOpt}`, 2);
    }
  }
  const handles = option('handles') !== undefined ? Number(option('handles')) : 0;
  if (!Number.isFinite(handles) || handles < 0) throw new Failure(`--handles must be seconds >= 0, got ${option('handles')}`, 2);
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

  // Filled after validation (the served files map is read lazily by the vite plugin)
  const models = { urls: {}, missing: [], files: new Map() };

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
      plugins: [previsModels(models.files)],
      logLevel: 'warn',
      clearScreen: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: vitePort, strictPort: true, hmr: false, watch: null },
    });
    cleanups.push(() => vite.close());
    await vite.listen();

    // Validation wins over every other failure: an invalid doc exits 2 with its issues
    const { validateDoc } = await vite.ssrLoadModule(path.join(WEB, 'src/previs/validate.ts'));
    const checkedDoc = validateDoc(doc);
    if (!checkedDoc.ok) {
      for (const i of checkedDoc.issues) console.error(`${i.path}: ${i.message}`);
      throw new Failure(`invalid previs document (${checkedDoc.issues.length} issue${checkedDoc.issues.length === 1 ? '' : 's'})`, 2);
    }
    // Fail fast (exit 1) on a missing model file the player loads, before Chrome starts
    const { modelSrcsToLoad } = await vite.ssrLoadModule(path.join(WEB, 'src/previs/models.ts'));
    const found = collectModels(modelSrcsToLoad(doc), docPath);
    models.urls = found.urls;
    models.missing = found.missing;
    for (const [k, v] of found.files) models.files.set(k, v);
    if (models.missing.length) {
      console.error(models.missing.map((m) => `model file not found: ${m.src} (looked for ${m.file})`).join('\n'));
      throw new Failure(`${models.missing.length} model file${models.missing.length === 1 ? '' : 's'} not found (paths resolve against ${path.dirname(path.resolve(docPath))})`);
    }
    const chromePath = findChrome();
    if (!chromePath) throw new Failure('Chrome not found (set CHROME_PATH or --chrome=<path>)');
    if (still === undefined && format !== 'png-seq') {
      const probe = spawn('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let encoders = '';
      probe.stdout.on('data', (d) => (encoders += d));
      const ok = await new Promise((resolve) => {
        probe.on('error', () => resolve(false));
        probe.on('close', (c) => resolve(c === 0));
      });
      if (!ok) throw new Failure('ffmpeg not found on PATH');
      const need = format === 'mp4-lossless' ? 'libx264rgb' : 'libx264';
      if (!new RegExp(`\\b${need}\\b`).test(encoders)) {
        throw new Failure(`ffmpeg has no ${need} encoder (needed for --format=${format}); use --format=png-seq or install an ffmpeg build with libx264`);
      }
    }
    // Shot / range selection needs the validated doc (unknown shot id: usage error)
    let selShot;
    if (shotOpt !== undefined) {
      selShot = checkedDoc.doc.shots.find((sh) => sh.id === shotOpt);
      if (!selShot) {
        throw new Failure(`unknown shot "${shotOpt}" (shots: ${checkedDoc.doc.shots.map((sh) => sh.id).join(', ')})`, 2);
      }
    }

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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__previsDoc = ${docText};window.__previsModels = ${JSON.stringify(models.urls)};`,
    });

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
      console.log(`frames=1 fps=${meta.fps} size=${meta.width}x${meta.height} out=${stillOut} frame=${i} backend=${state.backend} format=png`);
      return;
    }

    // Frames of a time span [a, b) seconds (global clock): i with a <= i/fps < b, handles on both sides, clamped
    const spanFrames = (a, b) => {
      const lo = Math.max(0, a - handles);
      const hi = Math.min(meta.duration, b + handles);
      const first = Math.max(0, Math.ceil(lo * meta.fps - 1e-6));
      const last = Math.min(meta.frames - 1, Math.ceil(hi * meta.fps - 1e-6) - 1);
      return { first, last, start: lo, end: hi };
    };
    const safeName = (id) => String(id).replace(/[^\w.-]/g, '_');
    const parsed = path.parse(outPath);
    const stem = format === 'png-seq' ? outPath.replace(/[\\/]+$/, '') : path.join(parsed.dir, parsed.name);
    const ext = parsed.ext || '.mp4';
    // One job = one output (file or directory) over a global frame span
    const jobs = [];
    if (splitShots) {
      const used = new Map(); // lower-cased output name -> shot id (case-insensitive file systems)
      for (const sh of checkedDoc.doc.shots) {
        const sp = spanFrames(sh.start, sh.end);
        const name = safeName(sh.id);
        if (name === '' || name === '.' || name === '..') throw new Failure(`shot id "${sh.id}" is not usable as a file name`, 2);
        const key = name.toLowerCase();
        if (used.has(key)) {
          throw new Failure(`shots "${used.get(key)}" and "${sh.id}" map to the same output name "${name}" (case-insensitive); rename one`, 2);
        }
        used.set(key, sh.id);
        jobs.push({ shot: sh.id, ...sp, out: format === 'png-seq' ? path.join(stem, name) : `${stem}.${name}${ext}` });
      }
    } else {
      let sp = { first: 0, last: meta.frames - 1, start: 0, end: meta.duration };
      if (selShot) sp = spanFrames(selShot.start, selShot.end);
      else if (range) sp = spanFrames(range[0], range[1]);
      if (frameLimit !== undefined) sp.last = Math.min(sp.last, sp.first + frameLimit - 1);
      jobs.push({ shot: selShot?.id ?? null, ...sp, out: outPath });
    }
    if (splitShots) {
      for (const j of jobs) {
        if (j.last < j.first) {
          j.skip = true;
          info(`warning: shot "${j.shot}" is shorter than one frame (fps ${meta.fps}); skipped, no output`);
        }
      }
    } else {
      const empty = jobs.find((j) => j.last < j.first);
      if (empty) throw new Failure(`${empty.shot ? `shot "${empty.shot}"` : '--range'} selects no frames (fps ${meta.fps}, ${meta.frames} frames)`, 2);
    }

    // png-seq: never mix new frames with stale ones from an earlier run
    if (format === 'png-seq') {
      const frameRe = /^frame_\d{6}\.png$/;
      const stale = [];
      for (const j of jobs) {
        if (j.skip) continue;
        let names = [];
        try {
          names = fs.readdirSync(j.out);
        } catch {}
        for (const n of names) if (frameRe.test(n)) stale.push(path.join(j.out, n));
      }
      if (stale.length > 0 && !force) {
        throw new Failure(`${stale.length} frame_NNNNNN.png file(s) already in ${path.dirname(stale[0])}; pass --force to delete them or pick an empty directory`, 2);
      }
      for (const f of stale) fs.rmSync(f, { force: true });
    }

    const total = jobs.reduce((n, j) => n + (j.skip ? 0 : j.last - j.first + 1), 0);
    const cameraRecords = new Map();
    const t0 = Date.now();
    let nextReport = 1;
    let done = 0;
    for (const job of jobs) {
      if (job.skip) continue;
      const count = job.last - job.first + 1;
      let ff = null;
      if (format === 'png-seq') {
        fs.mkdirSync(job.out, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
        ff = startFfmpeg(meta.fps, job.out, format);
        let complete = false;
        job.markComplete = () => (complete = true);
        // Cleanups run in reverse: kill ffmpeg first, then drop a partial mp4
        cleanups.push(() => {
          if (!complete) fs.rmSync(job.out, { force: true });
        });
        cleanups.push(() => ff.proc.kill('SIGKILL'));
      }
      for (let k = 0; k < count; k++) {
        const i = job.first + k;
        const png = await grab(i);
        if (ff) await ff.write(png);
        else fs.writeFileSync(path.join(job.out, `frame_${String(k).padStart(6, '0')}.png`), png);
        if (cameraJson && !cameraRecords.has(i)) cameraRecords.set(i, await cdp.evaluate(`window.previs.camera(${i})`));
        done++;
        if (done / total >= nextReport / 10) {
          nextReport = Math.floor((done / total) * 10) + 1;
          info(`${done}/${total} frames (${Math.round((done / total) * 100)}%), ${((Date.now() - t0) / 1000 / done).toFixed(3)} s/frame`);
        }
      }
      if (ff) {
        await ff.finish();
        job.markComplete();
      }
    }
    let reported = outPath;
    if (splitShots) {
      reported = `${stem}.cuts.json`;
      const cuts = jobs.map((j) => ({ shot: j.shot, start: j.start, end: j.end, frames: j.skip ? [] : [j.first, j.last] }));
      fs.writeFileSync(reported, JSON.stringify(cuts, null, 2) + '\n');
    }
    if (cameraJson) {
      fs.mkdirSync(path.dirname(path.resolve(cameraJson)), { recursive: true });
      const frames = [...cameraRecords.values()].sort((x, y) => x.frame - y.frame);
      const units = {
        eye: 'meters',
        target: 'meters',
        near: 'engine',
        far: 'engine',
        view: 'engine (column-major, meters * worldScale)',
        projection: 'engine (column-major, reverse-Z perspective_rh(fovDeg, aspect, far, near))',
        t: 'seconds',
        roll: 'radians',
      };
      fs.writeFileSync(cameraJson, JSON.stringify({ units, fps: meta.fps, frames }) + '\n');
    }
    info(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    console.log(`frames=${total} fps=${meta.fps} size=${meta.width}x${meta.height} out=${reported} backend=${state.backend} format=${format}`);
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
