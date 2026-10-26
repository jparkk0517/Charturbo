#!/usr/bin/env node
// README screenshots of the examples site: serves web/examples-dist with `vite preview`, opens
// each family page in its own headless Chrome (WebGPU via --enable-unsafe-webgpu), isolates one
// demo card (header, intro and source panel hidden), and screenshots it at 2x DPR into
// docs/assets/demo/<name>.png, plus a 2x3 collage docs/assets/demo/hero.png.
//
//   npm run examples:shots                    build the site, then capture
//   node examples/scripts/capture-screens.mjs [options]   capture an existing examples-dist
//   options: --out=<dir> (default ../docs/assets/demo)  --dpr=2  --only=line,scatter
//            --base=/VizEngineSDK/ (serve under a subpath, e.g. to check the Pages layout)
//            --chrome=<path> (or CHROME_PATH)  --no-hero
//
// PNG size optimization (palette quantization) and the collage use `sharp`. It is not a
// dependency: `npm i --no-save sharp`, or point SHARP_DIR at a directory whose node_modules has
// it. Without sharp the raw screenshots are written and the collage is skipped.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(WEB, 'examples-dist');

const args = process.argv.slice(2);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const OUT = path.resolve(WEB, option('out') ?? '../docs/assets/demo');
const DPR = Number(option('dpr') ?? 2);
const BASE = option('base') ?? '/';
const ONLY = option('only')?.split(',');
const HERO = !args.includes('--no-hero');
const WIDTH = 1200; // CSS px of every shot
const log = (...m) => console.log('[shots]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One shot = one family page; `demos` = card ids (file names) kept visible, laid out in `columns`;
 * `height` = CSS height of each chart host. `hero` = part of the 2x3 collage (in this order).
 * `settle` = ms to wait after layout before the shot (default 1500).
 */
const SHOTS = [
  { name: 'line', page: 'line', demos: ['01-million'], height: 600, hero: true },
  { name: 'scatter', page: 'scatter', demos: ['01-brush'], height: 600, hero: true },
  { name: 'candlestick', page: 'candlestick', demos: ['01-ohlc'], height: 600, hero: true },
  // 3D graph: give the force layout a few seconds to spread before the shot
  { name: 'graph', page: 'graph', demos: ['01-force-network'], height: 600, hero: true, settle: 5000 },
  { name: 'sankey', page: 'hierarchy', demos: ['03-sankey'], height: 600, hero: true },
  { name: 'business', page: 'business', demos: ['01-radar', '02-gauge', '03-funnel', '04-waterfall'], columns: 2, height: 270, hero: true },
  { name: 'heatmap', page: 'heatmap', demos: ['01-heatmap'], height: 600 },
  { name: 'bar', page: 'bar', demos: ['01-grouped-stacked'], height: 600 },
  { name: 'embeddings', page: 'embeddings', demos: ['01-similarity'], height: 600 },
  { name: 'scene', page: 'scene', demos: ['01-rigid-bodies'], height: 600, settle: 4000 },
].filter((s) => !ONLY || ONLY.includes(s.name));

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

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    if (!process.env.SHARP_DIR) return null;
    try {
      return createRequire(path.join(path.resolve(process.env.SHARP_DIR), 'noop.js'))('sharp');
    } catch {
      return null;
    }
  }
}

/** Minimal CDP client over the page target's WebSocket (Node >= 22 global WebSocket). */
async function connectPage(port) {
  let targets = [];
  for (let i = 0; i < 80 && !targets.some((t) => t.type === 'page'); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      // Chrome still starting
    }
    if (!targets.some((t) => t.type === 'page')) await sleep(250);
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
  // Chrome / its GPU process died: fail every pending call instead of hanging
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
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  return { send, on, evaluate, close: () => ws.close() };
}

/** CSS that leaves only the shot's demo cards, full width, sources hidden. */
function isolateCss(shot) {
  const keep = shot.demos.map((d) => `#${CSS_ID(d)}`).join(', ');
  return `
    .site-header, .intro, .demo-source { display: none !important; }
    html, body { background: #090b14 !important; }
    main { display: grid !important; grid-template-columns: repeat(${shot.columns ?? 1}, minmax(0, 1fr));
           gap: 0 !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
    .demo { display: none !important; }
    ${keep} { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; border: none !important; border-radius: 0 !important; }
    ${shot.demos.map((d) => `#${CSS_ID(d)} .demo-host`).join(', ')} { height: ${shot.height}px !important; }`;
}
const CSS_ID = (id) => (/^\d/.test(id) ? `\\3${id[0]} ${id.slice(1)}` : id);

async function capture(cdp, url, shot) {
  // Leave the previous page first so its `__ready` cannot match the new navigation
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 60_000;
  while (!(await cdp.evaluate('document.readyState === "complete" && window.__ready === true').catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`timeout loading ${url}`);
    await sleep(100);
  }
  const demos = await cdp.evaluate('JSON.stringify(window.__demos ?? [])');
  const failed = JSON.parse(demos).filter((d) => !d.ok);
  if (failed.length) throw new Error(`${shot.name}: demo failed: ${JSON.stringify(failed)}`);
  await cdp.evaluate(`(() => {
    const s = document.createElement('style');
    s.textContent = ${JSON.stringify(isolateCss(shot))};
    document.head.appendChild(s);
    window.scrollTo(0, 0);
  })()`);
  // autoResize re-renders at the new host size; let any enter animation (or simulation) finish
  await sleep(shot.settle ?? 1500);
  const rect = await cdp.evaluate(`(() => {
    const els = ${JSON.stringify(shot.demos)}.map((id) => document.getElementById(id));
    if (els.some((e) => !e)) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
  })()`);
  if (!rect) throw new Error(`${shot.name}: demo card not found`);
  const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 };
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, fromSurface: true, captureBeyondViewport: true });
  return { png: Buffer.from(data, 'base64'), backend: await cdp.evaluate('navigator.gpu ? "webgpu" : "webgl2"') };
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('examples-dist missing: run `npm run examples:build` first');
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found (set CHROME_PATH or --chrome=)');
  const sharp = await loadSharp();
  if (!sharp) log('sharp not found: writing raw PNGs, no collage (npm i --no-save sharp, or SHARP_DIR=<dir>)');

  const server = await preview({
    configFile: path.join(WEB, 'examples/vite.config.ts'),
    base: BASE,
    logLevel: 'warn',
    preview: { port: await freePort(), strictPort: true, host: '127.0.0.1', open: false },
  });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const pageUrl = (page) => `${new URL(origin).origin}${BASE.replace(/\/?$/, '/')}${page}.html`;

  const cdpPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-shots-'));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--enable-unsafe-webgpu',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},900`,
      '--hide-scrollbars',
      `--force-device-scale-factor=${DPR}`,
      '--force-color-profile=srgb',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  const cleanup = async () => {
    const exited = new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
    chrome.kill('SIGKILL');
    await Promise.race([exited, sleep(3000)]);
    await server.close().catch(() => {});
    // Helper processes may still be writing into the profile right after the kill
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      log(`could not remove ${profile}: ${err.message}`);
    }
  };

  const written = [];
  try {
    const cdp = await connectPage(cdpPort);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.exceptionThrown', (p) => log('page exception:', p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: DPR, mobile: false });
    fs.mkdirSync(OUT, { recursive: true });
    for (const shot of SHOTS) {
      const { png, backend } = await capture(cdp, pageUrl(shot.page), shot);
      const file = path.join(OUT, `${shot.name}.png`);
      const buf = sharp ? await sharp(png).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer() : png;
      fs.writeFileSync(file, buf);
      written.push({ shot, file, png });
      log(`${path.relative(WEB, file)} (${backend}, ${(buf.length / 1024).toFixed(0)} KB)`);
    }
    cdp.close();
  } finally {
    await cleanup();
  }

  const hero = written.filter((w) => w.shot.hero).slice(0, 6);
  if (HERO && sharp && hero.length === 6) {
    // 2 columns x 3 rows of 800 x 450 px tiles (whole shot letterboxed in each), 12 px gaps
    const [tileW, tileH, gap] = [800, 450, 12];
    const tiles = await Promise.all(
      hero.map((w) => sharp(w.png).resize({ width: tileW, height: tileH, fit: 'contain', position: 'top', background: '#090b14' }).toBuffer())
    );
    const width = tileW * 2 + gap * 3;
    const height = tileH * 3 + gap * 4;
    const buf = await sharp({ create: { width, height, channels: 3, background: '#05070d' } })
      .composite(tiles.map((input, i) => ({ input, left: gap + (i % 2) * (tileW + gap), top: gap + Math.floor(i / 2) * (tileH + gap) })))
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
    const file = path.join(OUT, 'hero.png');
    fs.writeFileSync(file, buf);
    log(`${path.relative(WEB, file)} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error('[shots]', err.message ?? err);
  process.exit(1);
});
