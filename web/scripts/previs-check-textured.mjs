#!/usr/bin/env node
// Textured-pass regression check: png-seq renders of previs docs with --passes=beauty,textured.
//
//   node scripts/previs-check-textured.mjs [doc.json ...] [--frames=N] [--backend=webgpu|webgl2] [--keep=<dir>] [--selftest]
//
// Default docs: previs/examples/textured-demo.json, model-demo.json, gate-raid.json, retarget-demo.json; default --frames=24 (the first N
// frames of each doc, for speed). Per doc it renders (previs-render.mjs --format=png-seq): beauty only (A), beauty +
// textured (B), and beauty + textured again (C). Checks (any failure -> exit 1, else 0):
//   1 beauty    : every beauty png of A equals B byte for byte (sha1) -> adding the textured pass never changes beauty.
//   2 determin. : every beauty png of B equals C byte for byte (same backend, same machine); every textured png of B
//                 matches C except at most 0.01 % of pixels (any channel differs). Measured on Chrome WebGPU / Metal:
//                 a lit rerun flips a few pixels by 1/255 (rarely one edge pixel by ~20/255), so exact bytes are not
//                 guaranteed for the textured pass; the count and max difference are reported.
//   3 exposure  : per textured frame, over the NON-background pixels (background = exactly the sRGB bytes
//                 round(255 * float32(doc.background)); both the flat and the textured pass clear to it, no tone mapping):
//                 clipped (any channel == 255) <= 1 %, crushed (all channels < 5) <= 5 %, and, ONLY for docs that author a
//                 `lighting` block, mean luma within 0.25..0.65 (a doc on default lighting gets a warning instead: the range
//                 is a tuning aid for authored lighting, not a standard).
//                 Luma = Rec.709 weights (0.2126, 0.7152, 0.0722) on the sRGB bytes / 255 (display-referred, no linearization).
//   4 silhouette: IoU >= 0.98 per frame between the beauty foreground and the textured foreground (foreground = not
//                 background), ONLY for docs without a node `look.show` of 'flat' or 'textured' (those differ by design; an explicit 'both' keeps the check).
// Prints one table row per doc and an overall PASS / FAIL. Thresholds are fixed constants below; never loosened silently.
// --keep=<dir>: keep the renders there (default: a temp dir, removed at the end, also when a doc path is bad: exit 2 before anything is created). --selftest: no rendering; feeds
// synthetic images to every check and exits 0 only if each check passes on good input and FAILS on bad input.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../e2e/lib/image.mjs';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(webDir, 'scripts', 'previs-render.mjs');
const EX = path.join(webDir, 'previs', 'examples');
const DEFAULT_DOCS = ['textured-demo.json', 'model-demo.json', 'gate-raid.json', 'retarget-demo.json'].map((f) => path.join(EX, f));

export const LIMITS = { clipped: 0.01, crushed: 0.05, lumaMin: 0.25, lumaMax: 0.65, iou: 0.98, rerunPixels: 1e-4 };

// ---- pure checks (exported for the selftest) ----
// The engine clears in float32: round(fround(v) * 255), e.g. 0.9 -> 229 (not Math.round(0.9 * 255) = 230).
export const bgBytes = (bg) => bg.map((v) => Math.round(Math.fround(v) * 255));

/** { fg, clipped, crushed, meanLuma } over the non-background pixels of an RGBA image. */
export function exposure(img, bg) {
  let fg = 0, clipped = 0, crushed = 0, luma = 0;
  const d = img.data;
  for (let i = 0; i < img.width * img.height; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    if (r === bg[0] && g === bg[1] && b === bg[2]) continue;
    fg++;
    if (r === 255 || g === 255 || b === 255) clipped++;
    if (r < 5 && g < 5 && b < 5) crushed++;
    luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return { fg, clipped: fg ? clipped / fg : 0, crushed: fg ? crushed / fg : 0, meanLuma: fg ? luma / fg : 0 };
}
export const lumaOk = (e) => e.meanLuma >= LIMITS.lumaMin && e.meanLuma <= LIMITS.lumaMax;
export const exposureOk = (e, checkLuma = true) =>
  e.fg > 0 && e.clipped <= LIMITS.clipped && e.crushed <= LIMITS.crushed && (!checkLuma || lumaOk(e));

/** Intersection over union of the foreground (not exactly bg) masks of two same-size images. */
export function silhouetteIoU(a, b, bg) {
  if (a.width !== b.width || a.height !== b.height) return 0;
  let inter = 0, uni = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const fa = !(a.data[i * 4] === bg[0] && a.data[i * 4 + 1] === bg[1] && a.data[i * 4 + 2] === bg[2]);
    const fb = !(b.data[i * 4] === bg[0] && b.data[i * 4 + 1] === bg[1] && b.data[i * 4 + 2] === bg[2]);
    if (fa || fb) uni++;
    if (fa && fb) inter++;
  }
  return uni ? inter / uni : 1;
}

/** Pixels where any RGB channel differs, and the largest channel difference. */
export function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { count: Infinity, max: 255 };
  let count = 0, max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (d) { count++; if (d > max) max = d; }
  }
  return { count, max };
}
const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// ---- selftest ----
function selftest() {
  const W = 40, H = 40, bg = [26, 26, 33];
  const mk = (fn) => {
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = fn(x, y) ?? [...bg];
      data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
    return { width: W, height: H, data };
  };
  const rect = (x0, x1, c) => (x, y) => (x >= x0 && x < x1 && y >= 10 && y < 30 ? c : null);
  const good = mk(rect(5, 25, [120, 130, 140]));
  const results = [];
  const expect = (name, got, want) => { results.push([name, got === want]); };
  expect('exposure ok on good image', exposureOk(exposure(good, bg)), true);
  expect('exposure fails: clipped 255', exposureOk(exposure(mk(rect(5, 25, [255, 200, 200])), bg)), false);
  expect('exposure fails: crushed black', exposureOk(exposure(mk(rect(5, 25, [2, 3, 1])), bg)), false);
  expect('exposure fails: too dark mean', exposureOk(exposure(mk(rect(5, 25, [40, 40, 40])), bg)), false);
  expect('exposure fails: too bright mean', exposureOk(exposure(mk(rect(5, 25, [200, 210, 220])), bg)), false);
  expect('exposure fails: empty image', exposureOk(exposure(mk(() => null), bg)), false);
  expect('pixelDiff 0 on identical', pixelDiff(good, good).count, 0);
  expect('pixelDiff counts a changed pixel', pixelDiff(good, mk(rect(5, 25, [121, 130, 140]))).count > 0, true);
  expect('exposure luma not enforced when off', exposureOk(exposure(mk(rect(5, 25, [40, 40, 40])), bg), false), true);
  expect('iou 1 on identical masks', silhouetteIoU(good, mk(rect(5, 25, [10, 90, 200])), bg) >= LIMITS.iou, true);
  expect('iou fails on shifted mask', silhouetteIoU(good, mk(rect(8, 28, [120, 130, 140])), bg) >= LIMITS.iou, false);
  const f = path.join(os.tmpdir(), `previs-check-textured-selftest-${process.pid}`);
  fs.writeFileSync(f + 'a', 'x'); fs.writeFileSync(f + 'b', 'x'); fs.writeFileSync(f + 'c', 'y');
  expect('sha1 equal files match', sha1(f + 'a') === sha1(f + 'b'), true);
  expect('sha1 different files differ', sha1(f + 'a') === sha1(f + 'c'), false);
  for (const s of 'abc') fs.rmSync(f + s, { force: true });
  for (const [n, ok] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`);
  const pass = results.every(([, ok]) => ok);
  console.log(pass ? 'selftest PASS' : 'selftest FAIL');
  process.exit(pass ? 0 : 1);
}

// ---- main ----
const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
for (const a of args) {
  if (!a.startsWith('--')) continue;
  if (!/^--(frames|backend|keep)=/.test(a) && a !== '--selftest') {
    console.error(`unknown argument ${a}\nusage: previs-check-textured.mjs [doc.json ...] [--frames=N] [--backend=webgpu|webgl2] [--keep=<dir>] [--selftest]`);
    process.exit(2);
  }
}
if (args.includes('--selftest')) selftest();
const frames = Number(opt('frames') ?? 24);
if (!Number.isInteger(frames) || frames < 1) { console.error('--frames must be an integer >= 1'); process.exit(2); }
const backend = opt('backend');
if (backend !== undefined && backend !== 'webgpu' && backend !== 'webgl2') { console.error('--backend must be webgpu or webgl2'); process.exit(2); }
const docs = args.filter((a) => !a.startsWith('--')).map((p) => path.resolve(p));
if (docs.length === 0) docs.push(...DEFAULT_DOCS);

// Validate every input before anything is created on disk
for (const d of docs) {
  if (!fs.existsSync(d)) { console.error(`no such doc ${d}`); process.exit(2); }
}
// With --keep nothing temporary is created; otherwise the temp dir holds the renders and is always removed
const tmp = opt('keep') ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'previs-check-textured-'));
const root = tmp === null ? path.resolve(opt('keep')) : path.join(tmp, 'png');
fs.mkdirSync(root, { recursive: true });
const cleanup = () => { if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true }); };

function render(docPath, out, passes) {
  const r = spawnSync(process.execPath, [renderer, docPath, out, '--format=png-seq', `--frames=${frames}`, `--passes=${passes}`, '--force', ...(backend ? [`--backend=${backend}`] : [])], {
    cwd: webDir, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`render ${path.basename(docPath)} --passes=${passes} exit ${r.status}\n${r.stderr.split('\n').slice(-12).join('\n')}`);
  return r.stderr.split('\n').filter((l) => /warn/i.test(l));
}
const pngs = (dir) => fs.readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();

function checkDoc(docPath) {
  const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));
  const name = path.basename(docPath, '.json');
  const bg = bgBytes(doc.background);
  const hasShow = doc.nodes.some((n) => n.look?.show === 'flat' || n.look?.show === 'textured'); // 'both' draws in both passes
  const authoredLighting = doc.lighting !== undefined;
  let rerunFrames = 0, rerunMax = 0;
  let lumaWarn = 0;
  const A = path.join(root, name, 'A'), B = path.join(root, name, 'B'), C = path.join(root, name, 'C');
  const t0 = Date.now();
  const warns = [...render(docPath, A, 'beauty'), ...render(docPath, B, 'beauty,textured'), ...render(docPath, C, 'beauty,textured')];
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const row = { name, frames: 0, beauty: 'ok', determ: 'ok', exposure: 'ok', iou: hasShow ? 'n/a' : 'ok', worst: {}, secs, warns, fails: [] };
  const fa = pngs(A), fb = pngs(B), fc = pngs(C), tb = pngs(B + '.textured'), tc = pngs(C + '.textured');
  row.frames = fb.length;
  if (!(fa.length === fb.length && fb.length === fc.length && fb.length === tb.length && tb.length === tc.length && fb.length > 0)) {
    row.fails.push(`frame counts A=${fa.length} B=${fb.length} C=${fc.length} textured B=${tb.length} C=${tc.length}`);
    row.beauty = row.determ = row.exposure = 'FAIL';
    return row;
  }
  let minIoU = 1, maxClip = 0, maxCrush = 0, minL = 1, maxL = 0;
  for (let i = 0; i < fb.length; i++) {
    const a = path.join(A, fa[i]), b = path.join(B, fb[i]), c = path.join(C, fc[i]);
    const tbp = path.join(B + '.textured', tb[i]), tcp = path.join(C + '.textured', tc[i]);
    if (sha1(a) !== sha1(b)) { row.beauty = 'FAIL'; row.fails.push(`beauty ${fa[i]} differs between beauty-only and beauty,textured`); }
    if (sha1(b) !== sha1(c)) { row.determ = 'FAIL'; row.fails.push(`beauty ${fb[i]} differs between two runs`); }
    const timg = decodePng(fs.readFileSync(tbp));
    if (sha1(tbp) !== sha1(tcp)) {
      const dd = pixelDiff(timg, decodePng(fs.readFileSync(tcp)));
      rerunMax = Math.max(rerunMax, dd.max); rerunFrames++;
      if (dd.count > LIMITS.rerunPixels * timg.width * timg.height) { row.determ = 'FAIL'; row.fails.push(`textured ${tb[i]} differs between two runs on ${dd.count} pixels (max ${dd.max}/255)`); }
    }
    const e = exposure(timg, bg);
    maxClip = Math.max(maxClip, e.clipped); maxCrush = Math.max(maxCrush, e.crushed);
    minL = Math.min(minL, e.meanLuma); maxL = Math.max(maxL, e.meanLuma);
    if (!authoredLighting && e.fg > 0 && !lumaOk(e)) lumaWarn++;
    if (!exposureOk(e, authoredLighting)) {
      row.exposure = 'FAIL';
      row.fails.push(`exposure ${tb[i]}: fg=${e.fg} clipped=${(e.clipped * 100).toFixed(2)}% crushed=${(e.crushed * 100).toFixed(2)}% luma=${e.meanLuma.toFixed(3)}`);
    }
    if (!hasShow) {
      const iou = silhouetteIoU(decodePng(fs.readFileSync(b)), timg, bg);
      minIoU = Math.min(minIoU, iou);
      if (iou < LIMITS.iou) { row.iou = 'FAIL'; row.fails.push(`silhouette ${fb[i]}: IoU ${iou.toFixed(4)} < ${LIMITS.iou}`); }
    }
  }
  if (rerunFrames) (row.warns ??= []).push(`textured rerun differs on ${rerunFrames} frame(s) within tolerance (max ${rerunMax}/255)`);
  if (lumaWarn) (row.warns ??= []).push(`mean luma outside ${LIMITS.lumaMin}..${LIMITS.lumaMax} on ${lumaWarn} frame(s); not enforced (no doc lighting block)`);
  row.worst = { clip: maxClip, crush: maxCrush, lumaMin: minL, lumaMax: maxL, iou: hasShow ? null : minIoU };
  return row;
}

let rows = [];
try {
  for (const d of docs) {
    try { rows.push(checkDoc(d)); } catch (e) { rows.push({ name: path.basename(d, '.json'), error: String(e.message ?? e), fails: [String(e.message ?? e)], warns: [] }); }
  }
} finally {
  cleanup();
}
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('doc', 16)}${pad('frames', 8)}${pad('beauty=', 9)}${pad('determ', 8)}${pad('exposure', 10)}${pad('iou', 6)}${pad('clip%max', 10)}${pad('crush%max', 11)}${pad('luma min..max', 15)}${pad('iou min', 9)}secs`);
for (const r of rows) {
  if (r.error) { console.log(`${pad(r.name, 16)}ERROR ${r.error.split('\n')[0]}`); continue; }
  const w = r.worst;
  console.log(
    pad(r.name, 16) + pad(r.frames, 8) + pad(r.beauty, 9) + pad(r.determ, 8) + pad(r.exposure, 10) + pad(r.iou, 6) +
      pad((w.clip * 100).toFixed(2), 10) + pad((w.crush * 100).toFixed(2), 11) + pad(`${w.lumaMin.toFixed(3)}..${w.lumaMax.toFixed(3)}`, 15) +
      pad(w.iou === null ? '-' : w.iou.toFixed(4), 9) + r.secs,
  );
}
for (const r of rows) {
  for (const w of r.warns ?? []) console.log(`warn ${r.name}: ${w}`);
  for (const f of (r.fails ?? []).slice(0, 8)) console.log(`FAIL ${r.name}: ${f}`);
  if ((r.fails ?? []).length > 8) console.log(`FAIL ${r.name}: ... ${r.fails.length - 8} more`);
}
const pass = rows.every((r) => !r.error && r.fails.length === 0);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
