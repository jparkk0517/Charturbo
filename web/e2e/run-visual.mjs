#!/usr/bin/env node
// GPU visual regression runner: starts its own Vite server and a headless Chrome (WebGPU via
// --enable-unsafe-webgpu, plus a WebGL2-forced pass), renders every fixture of e2e/fixtures.ts,
// screenshots it over the DevTools Protocol (canvas-only crop with the DOM overlay hidden, and
// the full card with labels) and compares against e2e/baselines/<backend>/<fixture>.<shot>.png.
//
//   npm run test:visual                        compare (exit 1 on any failure)
//   npm run test:visual -- --update            (re)write baselines
//   options: --backend=webgpu,webgl2  --filter=<substring>  --canvas-only (skip full shots)
//            --param=key:value[,key:value]  (fixture params, e.g. color:#ff0000)
//            --repeat=N (N passes, flake check)  --strict (missing Chrome / GPU = failure)
//            --chrome=<path> (or CHROME_PATH)
// Missing Chrome or GPU backends are SKIPPED (exit 0) unless --strict.
// Writes e2e/out/report.html, report.json, *.actual.png and *.diff.png.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, diffImages, encodePng } from './lib/image.mjs';

const E2E = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(E2E, '..');
const BASELINES = path.join(E2E, 'baselines');
const OUT = path.join(E2E, 'out');

/** Tolerances per shot: canvas pixels are font-free; the full shot includes DOM text. */
const TOLERANCE = {
  canvas: { threshold: 24, maxDiffRatio: 0.002 },
  full: { threshold: 32, maxDiffRatio: 0.002 },
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const UPDATE = flag('update');
const STRICT = flag('strict');
const CANVAS_ONLY = flag('canvas-only');
const FILTER = option('filter');
const PARAM = option('param') ?? '';
const REPEAT = Math.max(1, Number(option('repeat') ?? 1) | 0);
const BACKENDS = (option('backend') ?? 'webgpu,webgl2').split(',').filter((b) => b === 'webgpu' || b === 'webgl2');
const SHOTS = CANVAS_ONLY ? ['canvas'] : ['canvas', 'full'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[visual]', ...m);

function skip(reason) {
  console.log(`[visual] SKIPPED: ${reason}`);
  process.exit(STRICT ? 1 : 0);
}

function findChrome() {
  // An explicit path is used as is (no fallback), so a wrong one reports SKIPPED
  const explicit = option('chrome') ?? process.env.CHROME_PATH;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
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
  // Chrome / its GPU process died: fail every pending call instead of hanging the run
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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  return { send, on, once, evaluate, close: () => ws.close() };
}

/** Loads `url` and waits for the page's `window.__visual` state. */
async function load(cdp, url, timeoutMs = 60_000) {
  const loaded = cdp.once('Page.loadEventFired', timeoutMs);
  await cdp.send('Page.navigate', { url });
  await loaded;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await cdp.evaluate('window.__visual ?? null');
    if (state?.done) return state;
    await sleep(50);
  }
  throw new Error(`timeout rendering ${url}`);
}

async function capture(cdp, mode) {
  const r = await cdp.evaluate(`window.__visualMode(${JSON.stringify(mode)})`);
  // Whole device pixels covering the rect (fractional DOM-sized cards round outward)
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  const clip = { x, y, width: Math.ceil(r.x + r.width) - x, height: Math.ceil(r.y + r.height) - y, scale: 1 };
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, fromSurface: true });
  return decodePng(Buffer.from(shot.data, 'base64'));
}

function writePng(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(image));
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function writeReport(results, meta) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...meta, results }, null, 2));
  const rel = (p) => (p ? path.relative(OUT, p).split(path.sep).join('/') : '');
  const img = (p) => (p && fs.existsSync(p) ? `<img src="${escapeHtml(rel(p))}" loading="lazy">` : '<span class="none">-</span>');
  const rows = results
    .map(
      (r) => `<tr class="${r.status}">
  <td>${r.pass}</td><td>${escapeHtml(r.backend)}</td><td>${escapeHtml(r.fixture)}</td><td>${r.shot}</td>
  <td class="status">${r.status}</td><td>${r.diffRatio === undefined ? '' : (r.diffRatio * 100).toFixed(3) + '%'}</td>
  <td>${r.maxDelta ?? ''}</td><td>${escapeHtml(r.message ?? '')}</td>
  <td>${img(r.baseline)}</td><td>${img(r.actual)}</td><td>${img(r.diff)}</td></tr>`
    )
    .join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Visual regression report</title>
<style>
body { font: 13px system-ui, sans-serif; margin: 16px; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 6px; vertical-align: top; }
img { max-width: 320px; image-rendering: pixelated; display: block; }
tr.fail td.status, tr.error td.status, tr.missing td.status { color: #fff; background: #c62828; }
tr.pass td.status { color: #1b5e20; } tr.updated td.status { color: #0d47a1; }
.none { color: #999; }
</style>
<h1>Visual regression: ${escapeHtml(meta.summary)}</h1>
<p>${escapeHtml(meta.date)} · Chrome ${escapeHtml(meta.chrome)} · backends ${escapeHtml(meta.backends.join(', '))} · ${meta.ms} ms${meta.param ? ' · params ' + escapeHtml(meta.param) : ''}</p>
<p>diff: red = channel delta above threshold, yellow = below threshold, gray = identical</p>
<table><tr><th>pass</th><th>backend</th><th>fixture</th><th>shot</th><th>status</th><th>diff</th><th>max Δ</th><th>message</th><th>baseline</th><th>actual</th><th>diff</th></tr>
${rows}
</table>`;
  fs.writeFileSync(path.join(OUT, 'report.html'), html);
}

async function main() {
  const t0 = Date.now();
  if (BACKENDS.length === 0) throw new Error('--backend must list webgpu and/or webgl2');
  if (UPDATE && PARAM) throw new Error('--update with --param would bake a perturbed fixture into the baselines');
  const chromePath = findChrome();
  if (!chromePath) skip('Chrome not found (set CHROME_PATH or --chrome=<path>)');

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const { createServer } = await import('vite');
  const vitePort = await freePort();
  const vite = await createServer({
    root: WEB,
    configFile: path.join(WEB, 'vite.config.ts'),
    logLevel: 'warn',
    clearScreen: false,
    // Fixtures never import npm packages: no dependency scan / optimizer reloads mid-run
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: vitePort, strictPort: true, hmr: false, watch: null },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vitePort}/e2e/index.html`;

  const cdpPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-visual-'));
  const chromeArgs = [
    '--headless=new',
    '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1200,900',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio',
    'about:blank',
  ];
  const chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' });
  let chromeExited = false;
  chrome.on('exit', () => (chromeExited = true));
  // Not executable (directory, no exec bit): reported by connectPage failing -> SKIPPED
  chrome.on('error', (err) => {
    chromeExited = true;
    log(`Chrome failed to start: ${err.message}`);
  });

  const cleanup = async () => {
    if (!chromeExited) chrome.kill('SIGKILL');
    await vite.close().catch(() => {});
    try {
      // Helper processes may still be writing into the profile right after the kill
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      log(`could not remove ${profile}: ${err.message}`);
    }
  };
  const onSignal = () => void cleanup().then(() => process.exit(130));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const results = [];
  let chromeVersion = '?';
  try {
    let cdp;
    try {
      cdp = await connectPage(cdpPort);
    } catch (err) {
      await cleanup();
      skip(`Chrome did not start (${err.message})`);
    }
    const version = await cdp.send('Browser.getVersion').catch(() => null);
    chromeVersion = version?.product ?? '?';
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    const consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });

    // Capability probe + fixture list (first load also warms Vite's transform cache)
    const probe = await load(cdp, `${base}?probe=1`, 120_000);
    const fixtures = (await cdp.evaluate('window.__visualFixtures')).filter((f) => !FILTER || f.includes(FILTER));
    if (fixtures.length === 0) throw new Error(`--filter=${FILTER} matches no fixture`);
    log(`${chromeVersion}; WebGPU adapter: ${probe.probe.webgpu}, WebGL2: ${probe.probe.webgl2}; ${fixtures.length} fixtures`);
    const available = BACKENDS.filter((b) => probe.probe[b]);
    const missing = BACKENDS.filter((b) => !probe.probe[b]);
    for (const b of missing) log(`SKIPPED backend ${b}: not available in this Chrome / GPU`);
    if (missing.length && STRICT) {
      await cleanup();
      console.log(`[visual] FAILED (--strict): backend ${missing.join(', ')} unavailable`);
      process.exit(1);
    }
    if (available.length === 0) {
      await cleanup();
      skip(`no GPU backend available (${BACKENDS.join(', ')})`);
    }

    for (let pass = 1; pass <= REPEAT; pass++) {
      for (const backend of available) {
        for (const fixture of fixtures) {
          const q = new URLSearchParams({ fixture, backend });
          if (PARAM) q.set('p', PARAM);
          consoleErrors.length = 0;
          const tf = Date.now();
          const state = await load(cdp, `${base}?${q}`);
          const key = { pass, backend, fixture };
          if (!state.ok || state.backend !== backend) {
            const message = state.ok ? `rendered with ${state.backend}, expected ${backend}` : state.error;
            for (const shot of SHOTS) results.push({ ...key, shot, status: 'error', message });
            log(`ERROR ${backend}/${fixture}: ${message}${consoleErrors.length ? ' | ' + consoleErrors.join(' | ') : ''}`);
            continue;
          }
          const statuses = [];
          for (const shot of SHOTS) {
            const image = await capture(cdp, shot);
            const name = `${fixture}.${shot}.png`;
            const baseline = path.join(BASELINES, backend, name);
            const actual = path.join(OUT, backend, name.replace(/\.png$/, '.actual.png'));
            writePng(actual, image);
            if (UPDATE) {
              writePng(baseline, image);
              results.push({ ...key, shot, status: 'updated', baseline, actual });
              statuses.push(`${shot}:updated`);
              continue;
            }
            if (!fs.existsSync(baseline)) {
              results.push({ ...key, shot, status: 'missing', actual, message: 'no baseline (run with --update)' });
              statuses.push(`${shot}:MISSING`);
              continue;
            }
            const d = diffImages(decodePng(fs.readFileSync(baseline)), image, TOLERANCE[shot]);
            const diff = d.diff ? path.join(OUT, backend, name.replace(/\.png$/, '.diff.png')) : undefined;
            if (diff) writePng(diff, d.diff);
            const message = d.sizeMismatch
              ? `size changed (${image.width}x${image.height})`
              : d.diffPixels
                ? `${d.diffPixels} px > Δ${TOLERANCE[shot].threshold}`
                : '';
            results.push({ ...key, shot, status: d.pass ? 'pass' : 'fail', diffRatio: d.diffRatio, maxDelta: d.maxDelta, message, baseline, actual, diff });
            statuses.push(`${shot}:${d.pass ? 'ok' : 'FAIL'}(${(d.diffRatio * 100).toFixed(3)}%, maxΔ ${d.maxDelta})`);
          }
          log(`${REPEAT > 1 ? `#${pass} ` : ''}${backend}/${fixture} ${statuses.join(' ')} [${Date.now() - tf} ms, render ${state.ms} ms]`);
        }
      }
    }
    cdp.close();
  } finally {
    await cleanup();
  }

  const bad = results.filter((r) => r.status === 'fail' || r.status === 'error' || r.status === 'missing');
  const counts = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  const summary = `${bad.length ? 'FAILED' : UPDATE ? 'UPDATED' : 'PASSED'} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`;
  const ms = Date.now() - t0;
  writeReport(results, {
    summary,
    date: new Date().toISOString(),
    chrome: chromeVersion,
    backends: BACKENDS,
    param: PARAM,
    ms,
  });
  log(`${summary} in ${(ms / 1000).toFixed(1)} s; report: ${path.relative(process.cwd(), path.join(OUT, 'report.html'))}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[visual] harness error:', err);
  process.exit(2);
});
