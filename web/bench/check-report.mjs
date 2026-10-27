#!/usr/bin/env node
// Browser integration checks: real wasm rendering, theme controls, scenario switches, mobile,
// exports and unavailable measurements. Run after benchmarking to avoid GPU contention.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openReport } from './report-browser.mjs';

const browser = await openReport();
const output = path.join(import.meta.dirname, 'out');
fs.mkdirSync(output, { recursive: true });
try {
  for (const scenario of ['line-1m-1s', 'line-10m-1s', 'scatter-1m', 'bar-10k', 'graph-10k', 'graph-100k']) {
    await browser.evaluate(`(() => { const s = document.querySelector('#scenario'); s.value = '${scenario}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.wait('window.__benchmark.ready === true');
    assert.equal(await browser.evaluate('window.__benchmark.error'), undefined);
    assert.equal(await browser.evaluate('document.querySelectorAll("tbody tr").length'), scenario.startsWith('graph') ? 5 : 8);
    assert.equal(await browser.evaluate('document.querySelectorAll(".chart-host canvas").length'), scenario.startsWith('graph') ? 3 : 2);
  }
  for (const theme of ['dark', 'midnight', 'paper', 'light']) {
    await browser.evaluate(`(() => { const s = document.querySelector('#theme'); s.value = '${theme}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(await browser.evaluate('document.documentElement.dataset.theme'), theme);
  }
  await browser.evaluate(`(() => {
    for (const [id, value] of [['accent', '#d946ef'], ['palette', 'colorful'], ['radius', '0'], ['font', 'Georgia, serif']]) {
      const s = document.getElementById(id); s.value = value; s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const s = document.getElementById('labels'); s.checked = false; s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(await browser.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()'), '#d946ef');
  const downloadSvg = await browser.evaluate(`(async () => {
    const original = URL.createObjectURL;
    let blob;
    URL.createObjectURL = (value) => { blob = value; return original(value); };
    try { document.querySelector('#download').click(); } finally { URL.createObjectURL = original; }
    return blob?.text();
  })()`);
  assert.ok(downloadSvg?.includes('<svg') && downloadSvg.includes('Georgia'), 'download uses the customized SDK chart');
  // A successful zero FPS is valid; missing and failed rows must never become zero bars.
  const svg = await browser.evaluate(`window.__benchmark.export({meta: {date: '2026-10-27', machine: {cpu: 'test'}, versions: {}, reps: 5, duration: 3000}, compare: [
    {scenario: 'line-1m-1s', lib: 'viz', ok: true, result: {backend: 'webgpu', ttff: {frame: {median: 0, n: 5}}, steady: {fps: 0}}},
    {scenario: 'line-1m-1s', lib: 'plotly', ok: false, error: 'timeout'}
  ]}, 'ttff', 'light')`);
  assert.ok(svg.includes('시간 초과') && svg.includes('미측정'));
  assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));
  const valid = await browser.evaluate(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml');
    const ids = [...doc.querySelectorAll('[id]')].map((e) => e.id);
    return !doc.querySelector('parsererror') && new Set(ids).size === ids.length;
  })()`);
  assert.ok(valid, 'exported SVG must parse and have unique clip IDs');
  await browser.evaluate(`(() => {
    const s = document.querySelector('#scenario'); s.value = 'line-1m-1s'; s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await browser.wait('window.__benchmark.ready === true');
  const canvas = await browser.evaluate(`(() => {
    const c = document.querySelector('.chart-host canvas'); c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect(); return { x: r.x, y: r.y };
  })()`);
  let tooltip = false;
  for (let y = 30; y < 300 && !tooltip; y += 24) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvas.x + 122, y: canvas.y + y });
    await browser.evaluate('new Promise(r => requestAnimationFrame(r))');
    tooltip = await browser.evaluate('[...document.querySelectorAll(".viz-sdk-node-tooltip")].some(e => getComputedStyle(e).display !== "none" && e.textContent.length > 0)');
  }
  assert.ok(tooltip, 'the real SDK tooltip should respond to pointer movement');
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await browser.evaluate('window.scrollTo(0, 0)');
  for (const [name, width] of [['desktop', 1280], ['mobile', 390]]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no page-level horizontal overflow');
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, `report-${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  assert.deepEqual(browser.errors, []);
  console.log('[bench:report:check] 6 scenarios, 4 themes, design controls, unavailable data, SVG and responsive layout passed');
} finally { await browser.close(); }
