/** Headless Chrome + Vite for SDK-rendered reports. No browser automation dependency. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const WEB = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

export async function openReport() {
  const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
  if (!chromePath) throw new Error('Chrome not found. Set CHROME_PATH.');
  const server = await createServer({
    configFile: path.join(WEB, 'examples/vite.config.ts'), logLevel: 'warn',
    server: { port: await freePort(), host: '127.0.0.1', strictPort: true, open: false },
  });
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'charturbo-report-'));
  let chrome;
  let ws;
  const close = async () => {
    ws?.close();
    if (chrome && chrome.exitCode === null) {
      const exit = new Promise((r) => chrome.once('exit', r));
      chrome.kill('SIGKILL');
      await Promise.race([exit, sleep(3000)]);
    }
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await server.listen();
    chrome = spawn(chromePath, [
      '--headless=new', '--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,1000',
      '--force-device-scale-factor=1', '--force-color-profile=srgb', '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    let launchError;
    chrome.on('error', (error) => { launchError = error; });
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      if (launchError) throw launchError;
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
      page = targets.find((t) => t.type === 'page');
      if (!page) await sleep(100);
    }
    if (!page) throw new Error('Chrome did not expose a page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let seq = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const message = JSON.parse(String(ev.data));
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (!pending.has(message.id)) return;
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    });
    ws.addEventListener('close', () => {
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Chrome disconnected')); }
      pending.clear();
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 90000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result?.value;
    };
    const wait = async (expression) => {
      const until = Date.now() + 60000;
      while (!(await evaluate(expression))) {
        if (Date.now() > until) throw new Error(`Report readiness timed out: ${expression}`);
        await sleep(100);
      }
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${server.resolvedUrls.local[0]}benchmarks.html?theme=light` });
    await wait('window.__benchmark?.ready === true');
    const error = await evaluate('window.__benchmark.error');
    if (error) throw new Error(error);
    return { send, evaluate, wait, errors, close };
  } catch (error) { await close(); throw error; }
}
