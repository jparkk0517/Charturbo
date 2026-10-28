#!/usr/bin/env node
// Real WebGPU/WASM checks; no mocks. GPU-resident steps vs CPU, explicit sync, CPU edits applied
// in order, sleep, disposal, shared devices and the WebGL2 CPU fallback.
import assert from 'node:assert/strict';
import path from 'node:path';
import { openReport } from './report-browser.mjs';

const root = `/@fs${path.resolve(import.meta.dirname, '..')}`;
const browser = await openReport();
try {
  const expression = `(${async function run(root) {
    const { Charturbo, CharturboDevice } = await import(`${root}/src/index.ts`);
    const { graphData } = await import(`${root}/bench/graph.ts`);
    const check = (v, message) => { if (!v) throw new Error(message); };
    const rejects = async (promise, pattern) => {
      let message = '';
      try { await promise; } catch (e) { message = String(e); }
      check(pattern.test(message), `Expected rejection ${pattern}, got ${message}`);
    };
    const canvases = [];
    const pixels = (canvas) => {
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const make = async (device) => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      document.body.append(canvas); canvases.push(canvas);
      return Charturbo.create(canvas, { device, nodeCount: 0, edgeCount: 0, autoResize: false });
    };
    const device = await CharturboDevice.create({ backend: 'webgpu' });
    const cpu = await make(device), gpu = await make(device);
    const comparisons = [];
    try {
      check(gpu.supportsGpuPhysics(), 'Shared WebGPU device must enable compute');
      for (const [nodes, ticks, theta] of [[64, 8, 0], [1000, 16, 0.75], [10000, 8, 0.75], [100000, 3, 0.75]]) {
        const raw = graphData({ nodes, edges: 2 * nodes, clusters: 8, seed: 42 });
        // Co-located bodies exercise leaf chains and deterministic separation.
        raw.positions.set(raw.positions.subarray(0, 3), 3);
        cpu.loadDataset(raw); gpu.loadDataset(raw);
        cpu.setForceOptions({ theta }); gpu.setForceOptions({ theta });
        cpu.pinNode(2, true); gpu.pinNode(2, true);
        let a;
        for (let tick = 0; tick < ticks; tick++) {
          a = cpu.stepPhysics(.016); await gpu.stepPhysicsAsync(.016);
        }
        await gpu.syncPhysicsPositions();
        const b = await gpu.stepPhysicsAsync(0); // energy of the synced layout, no step
        const x = cpu.exportPositions(), y = gpu.exportPositions();
        check(x.length === y.length && y.every(Number.isFinite), 'finite complete positions');
        let maxError = 0;
        for (let i = 0; i < x.length; i++) maxError = Math.max(maxError, Math.abs(x[i] - y[i]));
        check(maxError < .02, `CPU/GPU coordinate error ${maxError} at ${nodes} nodes`);
        check(Math.abs(a - b) / Math.max(a, 1) < .005, 'CPU/GPU kinetic energy');
        check(y[6] === raw.positions[6] && y[7] === raw.positions[7] && y[8] === raw.positions[8], 'pinned node moved');
        check(gpu.queryRadius(y[0], y[1], y[2], .001, nodes).includes(0), 'spatial index stale after sync');
        // GPU-resident drawing (positions read on the GPU) matches CPU-packed positions, within the
        // visual regression's canvas tolerance (e2e/run-visual.mjs: channel delta 24, 0.2 % of pixels):
        // shader compilers may contract the two vertex paths' arithmetic differently at edges.
        gpu.render();
        const resident = pixels(canvases[1]);
        gpu.importPositions(y); gpu.render();
        const packed = pixels(canvases[1]);
        let residentDiffPixels = 0;
        for (let i = 0; i < packed.length; i += 4) {
          const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(resident[i + c] - packed[i + c])));
          residentDiffPixels += delta > 24 ? 1 : 0;
        }
        check(resident.some((v, i) => i % 4 !== 3 && v !== 0), 'resident render captured an empty canvas');
        check(residentDiffPixels <= packed.length / 4 * .002, `resident render differs in ${residentDiffPixels} pixels at ${nodes} nodes`);
        comparisons.push({ nodes, ticks, theta, maxError, residentDiffPixels });
      }
      // Rendering/camera updates are safe while a step is pending.
      let pending = gpu.stepPhysicsAsync(.016);
      gpu.rotateCamera(.1, 0); gpu.render();
      await rejects(gpu.stepPhysicsAsync(.016), /already pending/);
      await pending;
      // CPU edits apply in order; in-flight GPU state never overwrites them.
      const raw = graphData({ nodes: 128, edges: 256, clusters: 8, seed: 9 });
      await gpu.stepPhysicsAsync(.016);
      gpu.loadDataset(raw); gpu.render();
      check(gpu.exportPositions().every((v, i) => v === raw.positions[i]), 'GPU readback overwrote a replaced dataset');
      await gpu.stepPhysicsAsync(.016);
      gpu.moveNode(5, 40, 50, 60); gpu.pinNode(5, true); gpu.setForceOptions({ theta: .5 });
      for (let i = 0; i < 3; i++) await gpu.stepPhysicsAsync(.016);
      await gpu.syncPhysicsPositions();
      let p = gpu.exportPositions();
      check(p[15] === 40 && p[16] === 50 && p[17] === 60, 'GPU steps lost a moved, pinned node');
      // A CPU step makes the CPU copy authoritative; GPU steps continue from it.
      gpu.stepPhysics(.016);
      const cpuStepped = gpu.exportPositions();
      await gpu.stepPhysicsAsync(.016); await gpu.syncPhysicsPositions();
      p = gpu.exportPositions();
      check(p.every(Number.isFinite) && p.some((v, i) => v !== cpuStepped[i]), 'GPU did not continue from a CPU step');
      const before = gpu.exportPositions();
      await gpu.stepPhysicsAsync(0); await gpu.syncPhysicsPositions();
      check(gpu.exportPositions().every((v, i) => v === before[i]), 'zero dt moved nodes');
      gpu.loadDataset({ positions: new Float32Array([0, 0, 0, 1, 0, 0]) });
      gpu.pinNode(0, true); gpu.pinNode(1, true); gpu.setAutoSleep(true);
      for (let i = 0; i < 31; i++) await gpu.stepPhysicsAsync(.016);
      await gpu.syncPhysicsPositions();
      check(gpu.isSleeping(), 'GPU physics did not honor auto-sleep');
      gpu.setAutoSleep(false);
      pending = gpu.stepPhysicsAsync(.016); gpu.dispose();
      await rejects(pending, /disposed/);
    } finally { cpu.dispose(); gpu.dispose(); device.dispose(); }
    const glDevice = await CharturboDevice.create({ backend: 'webgl2' });
    const gl = await make(glDevice);
    try {
      check(!gl.supportsGpuPhysics(), 'WebGL2 must report no compute support');
      gl.loadDataset({ positions: new Float32Array([-1, 0, 0, 1, 0, 0]) });
      const before = gl.exportPositions();
      await gl.stepPhysicsAsync(.016);
      check(gl.exportPositions().some((v, i) => v !== before[i]), 'WebGL2 CPU fallback did not step');
      gl.render();
    } finally { gl.dispose(); glDevice.dispose(); }
    for (const canvas of canvases) canvas.remove();
    return comparisons;
  }.toString()})(${JSON.stringify(root)})`;
  let result;
  // Vite can reload once after discovering a new benchmark dependency.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { result = await browser.evaluate(expression); break; }
    catch (e) { if (!e.message.includes('navigated') || attempt === 2) throw e; await browser.wait('window.__benchmark?.ready === true'); }
  }
  assert.equal(result.length, 4);
  assert.deepEqual(browser.errors, []);
  console.log('[bench:physics:check] CPU/GPU quality, sync, pins, picking, ordered CPU edits, concurrent steps, sleep, disposal, WebGL2 fallback passed');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
