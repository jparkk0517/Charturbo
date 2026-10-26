#!/usr/bin/env node
// Performance benchmark runner: starts its own Vite server (cross-origin isolated, so the page
// can call performance.measureUserAgentSpecificMemory) and a headless Chrome (WebGPU via
// --enable-unsafe-webgpu, ANGLE Metal on macOS, plus a WebGL2-forced pass), runs every scenario
// of bench/ours.ts and the cross-library comparison of bench/others.ts in a fresh tab each, and
// writes bench/out/results.json + bench/out/results.md.
//
//   npm run bench                    full run (5 reps, 3 s steady phase)
//   npm run bench -- --quick         smoke run (2 reps, 1 s, no 10M / 5M / 4096² scenarios)
//   options: --filter=<substring>[,<substring>...]  --backend=webgpu,webgl2  --libs=viz,uplot,echarts,chartjs,plotly
//            --reps=N  --warmup=N  --duration=ms  --no-compare  --compare-only  --no-ours
//            --chrome=<path> (or CHROME_PATH)  --out=<file stem> (default bench/out/results)
//            --shots (PNG of every finished page in bench/out/shots/)  --verbose (page console)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(BENCH, '..');
const OUT = path.join(BENCH, 'out');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const QUICK = flag('quick');
const FILTER = option('filter');
const REPS = Number(option('reps') ?? (QUICK ? 2 : 5));
const WARMUP = Number(option('warmup') ?? 1);
const DURATION = Number(option('duration') ?? (QUICK ? 1000 : 3000));
const BACKENDS = (option('backend') ?? 'webgpu,webgl2').split(',').filter((b) => b === 'webgpu' || b === 'webgl2');
const LIBS = (option('libs') ?? 'viz,uplot,echarts,chartjs,plotly').split(',');
const RUN_OURS = !flag('compare-only') && !flag('no-ours');
const RUN_COMPARE = !flag('no-compare');
/** Screenshot of every finished page (bench/out/shots/): checks each library really drew */
const SHOTS = flag('shots');
/** Echo the page's console output */
const VERBOSE = flag('verbose');
/** CPU profile of every page (bench/out/profiles/*.cpuprofile) + top self-time functions */
const PROFILE = flag('profile');
const OUT_STEM = option('out') ? path.resolve(option('out')) : path.join(OUT, 'results');
/** Quick runs skip the multi-second scenarios */
const HEAVY = ['line-10m', 'scatter-5m', 'heatmap-4096'];
const PAGE_TIMEOUT = 300_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[bench]', ...m);

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

/** Minimal CDP client over one target's WebSocket (Node >= 22 global WebSocket). */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  let closed = null;
  const failAll = (why) => {
    closed ??= new Error(`DevTools connection lost (${why})`);
    for (const { reject } of pending.values()) reject(closed);
    pending.clear();
  };
  ws.addEventListener('close', () => failAll('closed'));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  const send = (method, params = {}) =>
    closed
      ? Promise.reject(closed)
      : new Promise((resolve, reject) => {
          const msgId = ++id;
          pending.set(msgId, { resolve, reject });
          ws.send(JSON.stringify({ id: msgId, method, params }));
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

/** Opens `url` in a new tab (own renderer state per scenario), waits for `window.__bench`. */
async function runPage(cdpPort, url, shot) {
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  const errors = [];
  let crashed = false;
  let phaseMetrics = {};
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
    cdp.on('Inspector.targetCrashed', () => (crashed = true));
    // Main-thread time of the steady phase (task / script / layout seconds, sampled at the
    // page's phase markers)
    await cdp.send('Performance.enable');
    await cdp.send('Runtime.addBinding', { name: '__benchSignal' });
    const metrics = {};
    cdp.on('Runtime.bindingCalled', (p) => {
      if (p.name !== '__benchSignal') return;
      cdp.send('Performance.getMetrics').then((m) => {
        metrics[p.payload] = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
      }, () => {});
    });
    phaseMetrics = metrics;
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (VERBOSE) log(`  console.${p.type}: ${p.args.map((x) => x.value ?? x.description ?? '').join(' ')}`);
      if (p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });
    if (PROFILE) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await cdp.send('Page.navigate', { url });
    const deadline = Date.now() + PAGE_TIMEOUT;
    // Last phase the page reported (window.__benchPhase): where a timed-out page was stuck
    let phase = null;
    while (Date.now() < deadline) {
      if (crashed) return { ok: false, error: 'renderer crashed (out of memory?)' };
      let state = null;
      try {
        // A page whose main thread is blocked never answers: bound each poll by the deadline
        const poll = cdp.evaluate('({ bench: window.__bench ?? null, phase: window.__benchPhase ?? null })');
        poll.catch(() => {});
        let timer;
        const expired = new Promise((r) => (timer = setTimeout(() => r(null), Math.max(0, deadline - Date.now()))));
        const r = await Promise.race([poll, expired]).finally(() => clearTimeout(timer));
        if (r) phase = r.phase ?? phase;
        state = r?.bench ?? null;
      } catch (err) {
        if (crashed) return { ok: false, error: 'renderer crashed (out of memory?)' };
        // Navigation in progress
        if (!/context|navigat/i.test(err.message)) throw err;
      }
      if (state?.done) {
        if (SHOTS && shot && state.ok) {
          const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
          fs.writeFileSync(path.join(OUT, 'shots', `${shot}.png`), Buffer.from(png.data, 'base64'));
        }
        if (PROFILE && shot) {
          const { profile } = await cdp.send('Profiler.stop');
          fs.mkdirSync(path.join(OUT, 'profiles'), { recursive: true });
          fs.writeFileSync(path.join(OUT, 'profiles', `${shot}.cpuprofile`), JSON.stringify(profile));
          log(`profile ${shot}:\n${topSelfTime(profile, 25)}`);
        }
        const a = phaseMetrics['steady-start'];
        const b = phaseMetrics['steady-end'];
        const steady = state.result?.steady;
        if (a && b && steady) {
          const d = (k) => Math.round((b[k] - a[k]) * 1e4) / 10;
          steady.mainThread = { taskMs: d('TaskDuration'), scriptMs: d('ScriptDuration'), layoutMs: Math.round((d('LayoutDuration') + d('RecalcStyleDuration')) * 10) / 10 };
          steady.mainThread.perFrameMs = Math.round((steady.mainThread.taskMs / Math.max(1, steady.frames)) * 100) / 100;
        }
        return state.ok ? state : { ...state, errors: errors.slice(0, 3) };
      }
      await sleep(250);
    }
    return { ok: false, error: `timeout after ${PAGE_TIMEOUT / 1000} s${phase ? ` (page was in phase "${phase}")` : ''}` };
  } catch (err) {
    return { ok: false, error: crashed ? 'renderer crashed (out of memory?)' : err.message };
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => {});
  }
}

/** Top `n` functions by self time of a CDP CPU profile. */
function topSelfTime(profile, n) {
  const dt = new Map();
  const { samples, timeDeltas, nodes } = profile;
  const byId = new Map(nodes.map((x) => [x.id, x]));
  for (let i = 0; i < samples.length; i++) dt.set(samples[i], (dt.get(samples[i]) ?? 0) + (timeDeltas[i] ?? 0));
  const self = new Map();
  for (const [id, us] of dt) {
    const f = byId.get(id).callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + us);
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, us]) => `    ${(us / 1000).toFixed(1).padStart(8)} ms  ${k}`)
    .join('\n');
}

const mb = (b) => (b == null ? '-' : (b / 1048576).toFixed(1));
const ms = (v, digits = 1) => (v == null || Number.isNaN(v) ? '-' : v >= 100 ? Math.round(v).toString() : v.toFixed(digits));
const fmtSize = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));

function markdown(meta, ours, compare) {
  const lines = [];
  lines.push(`# viz-engine-sdk benchmark results`);
  lines.push('');
  lines.push(`${meta.date} · ${meta.machine.cpu} · ${mb(meta.machine.memBytes)} MB RAM · ${meta.machine.os} · ${meta.chrome}`);
  lines.push(`WebGPU adapter: ${meta.gpu.webgpu ? Object.values(meta.gpu.webgpu).filter(Boolean).join(' / ') : 'none'} · WebGL2: ${meta.gpu.webgl2 ?? 'none'}`);
  lines.push(`reps ${meta.reps} (+${meta.warmup} warmup) · steady phase ${meta.duration} ms · canvas 960x540 CSS px @ DPR 1 · idle rAF interval median ${ms(meta.idle?.interval?.median)} ms`);
  lines.push('');
  if (ours.length) {
    lines.push('## viz-engine-sdk scenarios');
    lines.push('');
    lines.push('TTFF = render call -> second rAF after it (frame presented); call = synchronous render call; pixels = render + GPU read-back of 1 px (GPU work finished). Steady = rAF interval during the interaction (wheel+drag zoom/pan, hover sweep or streaming); work = JS+wasm time per frame. Memory after GC.');
    lines.push('');
    lines.push('| scenario | backend | TTFF med (p95) ms | call ms | pixels ms | steady med / p95 / max ms | dropped | work med ms | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | wasm MB | GPU MB | upload B/frame |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of ours) {
      if (!r.ok) {
        lines.push(`| ${r.scenario} | ${r.backend} | FAILED: ${r.error} |  |  |  |  |  |  |  |  |  |  |  |`);
        continue;
      }
      const x = r.result;
      const t = x.ttff;
      const s = x.steady;
      const h = x.hover;
      lines.push(
        `| ${x.scenario} | ${x.backend} | ${ms(t.frame.median)} (${ms(t.frame.p95)}) | ${ms(t.call.median)} | ${ms(t.pixels.median)} | ${ms(s.interval.median)} / ${ms(s.interval.p95)} / ${ms(s.interval.max)} | ${s.dropped}/${s.frames} | ${ms(s.work.median)} | ${ms(s.mainThread?.perFrameMs)} | ${h ? `${ms(h.sync.median)} / ${ms(h.interval.median)} / ${ms(h.interval.p95)}` : '-'} | ${mb(x.memory.jsHeapBytes)} | ${mb(x.memory.wasmBytes)} | ${mb(x.memory.gpuBytes)} | ${s.uploadBytesPerFrame ?? '-'} |`
      );
    }
    lines.push('');
  }
  if (compare.length) {
    lines.push('## Cross-library comparison');
    lines.push('');
    lines.push('Same seeded data for every library. Line / scatter steady phase: identical zoom-in / pan / zoom-out window schedule set through each library\'s range API (time-based, 1% minimum window). bar-10k: hover sweep. viz runs on WebGPU here.');
    lines.push('');
    const ids = [...new Set(compare.map((r) => r.scenario))];
    for (const id of ids) {
      lines.push(`### ${id}`);
      lines.push('');
      lines.push('| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
      for (const r of compare.filter((c) => c.scenario === id)) {
        if (!r.ok) {
          lines.push(`| ${r.lib} | - | FAILED: ${r.error} |  |  |  |  |  |  |  |  |`);
          continue;
        }
        const x = r.result;
        const s = x.steady;
        lines.push(
          `| ${r.lib}${meta.versions[r.lib] ? ` ${meta.versions[r.lib]}` : ''} | ${x.backend} | ${ms(x.ttff.frame.median)} (${ms(x.ttff.frame.p95)}) | ${ms(x.ttff.pixels.median)} | ${ms(s.interval.median)} / ${ms(s.interval.p95)} / ${ms(s.interval.max)} | ${s.fps} | ${s.dropped}/${s.frames} | ${ms(s.mainThread?.perFrameMs)} | ${x.hover ? `${ms(x.hover.sync.median)} / ${ms(x.hover.interval.median)} / ${ms(x.hover.interval.p95)}` : '-'} | ${mb(x.memory.jsHeapBytes)} | ${mb(x.memory.uaBytes)} |`
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function versionOf(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEB, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}

async function main() {
  const t0 = Date.now();
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('[bench] SKIPPED: Chrome not found (set CHROME_PATH or --chrome=<path>)');
    process.exit(0);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const { createServer } = await import('vite');
  const vitePort = await freePort();
  const vite = await createServer({
    root: WEB,
    configFile: path.join(WEB, 'vite.config.ts'),
    logLevel: 'warn',
    clearScreen: false,
    // Comparison libraries pre-bundled up front: no optimizer reload mid-run
    optimizeDeps: { entries: ['bench/index.html'], include: ['uplot', 'echarts', 'chart.js', 'plotly.js-gl2d-dist-min'] },
    server: {
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      hmr: false,
      watch: null,
      // Cross-origin isolation: enables performance.measureUserAgentSpecificMemory()
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vitePort}/bench/index.html`;

  const cdpPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-bench-'));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--enable-unsafe-webgpu',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--window-size=1000,600',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      '--enable-blink-features=ForceEagerMeasureMemory',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let chromeExited = false;
  chrome.on('exit', () => (chromeExited = true));
  chrome.on('error', () => (chromeExited = true));
  const cleanup = async () => {
    if (!chromeExited) chrome.kill('SIGKILL');
    await vite.close().catch(() => {});
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // helper processes may still hold files
    }
  };
  process.once('SIGINT', () => void cleanup().then(() => process.exit(130)));

  try {
    let version = null;
    for (let i = 0; i < 80 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json()).catch(() => null);
      if (!version) await sleep(250);
    }
    if (!version) throw new Error('Chrome did not start');
    const q = (o) => new URLSearchParams({ reps: String(REPS), warmup: String(WARMUP), duration: String(DURATION), ...o }).toString();
    const probe = await runPage(cdpPort, `${base}?probe=1`);
    if (!probe.ok) throw new Error(`probe failed: ${probe.error}`);
    const gpu = probe.result;
    log(`${version.Browser}; WebGPU: ${JSON.stringify(gpu.webgpu)}; WebGL2: ${gpu.webgl2}; isolated: ${gpu.crossOriginIsolated}`);
    const list = (await runPage(cdpPort, `${base}?scenario=idle&${q({})}`));
    const idle = list.ok ? list.result.steady : null;
    log(`idle rAF interval median ${idle?.interval.median} ms, p95 ${idle?.interval.p95} ms`);

    // Scenario ids come from the page module (single source of truth)
    const ids = await (async () => {
      const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${base}`, { method: 'PUT' })).json();
      const cdp = await connect(t.webSocketDebuggerUrl);
      await cdp.send('Runtime.enable');
      let v = null;
      for (let i = 0; i < 200 && !v; i++) {
        v = await cdp.evaluate('window.__benchList ?? null').catch(() => null);
        if (!v) await sleep(100);
      }
      cdp.close();
      await fetch(`http://127.0.0.1:${cdpPort}/json/close/${t.id}`).catch(() => {});
      return v;
    })();
    const pick = (id) => (!FILTER || FILTER.split(',').some((f) => id.includes(f))) && (!QUICK || FILTER || !HEAVY.some((h) => id.startsWith(h)));

    const ours = [];
    if (RUN_OURS) {
      for (const backend of BACKENDS) {
        if (backend === 'webgpu' && !gpu.webgpu) {
          log('SKIPPED backend webgpu: no adapter');
          continue;
        }
        for (const id of ids.ours.filter(pick)) {
          const tr = Date.now();
          const r = await runPage(cdpPort, `${base}?${q({ scenario: id, backend })}`, `${backend}-${id}`);
          ours.push({ scenario: id, backend, ...r });
          const x = r.result;
          log(
            r.ok
              ? `${backend}/${id}: ttff ${x.ttff.frame.median} ms (call ${x.ttff.call.median}), steady ${x.steady.interval.median}/${x.steady.interval.p95}/${x.steady.interval.max} ms, dropped ${x.steady.dropped}/${x.steady.frames}${x.backend !== backend ? ` [rendered with ${x.backend}!]` : ''} [${Date.now() - tr} ms]`
              : `${backend}/${id}: FAILED ${r.error}${r.errors?.length ? ' | ' + r.errors.join(' | ') : ''}`
          );
        }
      }
    }
    const compare = [];
    if (RUN_COMPARE) {
      for (const id of ids.compare.filter(pick)) {
        for (const lib of LIBS) {
          const tr = Date.now();
          const r = await runPage(cdpPort, `${base}?${q({ scenario: id, lib, compare: '1', backend: 'webgpu' })}`, `compare-${id}-${lib}`);
          compare.push({ scenario: id, lib, ...r });
          const x = r.result;
          log(
            r.ok
              ? `compare ${id}/${lib}: ttff ${x.ttff.frame.median} ms, steady ${x.steady.interval.median}/${x.steady.interval.p95}/${x.steady.interval.max} ms, fps ${x.steady.fps}, dropped ${x.steady.dropped}/${x.steady.frames} [${Date.now() - tr} ms]`
              : `compare ${id}/${lib}: FAILED ${r.error}${r.errors?.length ? ' | ' + r.errors.join(' | ') : ''}`
          );
        }
      }
    }

    const meta = {
      date: new Date().toISOString(),
      chrome: version.Browser,
      machine: { cpu: os.cpus()[0]?.model ?? '?', cores: os.cpus().length, memBytes: os.totalmem(), os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`, node: process.version },
      gpu,
      idle,
      reps: REPS,
      warmup: WARMUP,
      duration: DURATION,
      quick: QUICK,
      versions: { uplot: versionOf('uplot'), echarts: versionOf('echarts'), chartjs: versionOf('chart.js'), plotly: versionOf('plotly.js-gl2d-dist-min'), viz: JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8')).version },
      ms: Date.now() - t0,
    };
    fs.mkdirSync(path.dirname(OUT_STEM), { recursive: true });
    fs.writeFileSync(`${OUT_STEM}.json`, JSON.stringify({ meta, ours, compare }, null, 2));
    fs.writeFileSync(`${OUT_STEM}.md`, markdown(meta, ours, compare));
    log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${path.relative(process.cwd(), OUT_STEM)}.json / .md`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('[bench] harness error:', err);
  process.exit(2);
});
