#!/usr/bin/env node
// Previs renderer regression check: stills of every previs/examples/*.json (+ a pure-pivot socket doc and the
// compressed walker fixtures), rendered with --no-aa, must contain ONLY palette colors.
//
//   node scripts/previs-check.mjs [--backend=webgpu|webgl2] [--keep=<dir>] [--only=<substring>] [--selftest]
//
// Palette = doc.background + every node color + every role color. Rule: a pixel matches palette color c when, in every
// channel, |byte - 255*c| <= 0.5 (i.e. the byte is round(255*c); no further tolerance). Per still it reports the
// unmatched pixel count and the worst distance (over unmatched pixels: max channel distance to the nearest palette
// color, in 8-bit units). Exit 1 when any still has an unmatched pixel, else 0.
// --selftest: renders flat-swatches once, expects it clean, flips ONE pixel to an off-palette value, expects the check
// to report exactly 1 unmatched pixel; exit 0 only if both hold.
// Stills per doc: 3, at t = duration * (i + 0.5) / 3 (duration = max shot end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../e2e/lib/image.mjs';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(webDir, 'scripts', 'previs-render.mjs');
const TOL = 0.5;
const STILLS = 3;

const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const backend = opt('backend');
const keepOpt = opt('keep');
const only = opt('only');
const selftest = args.includes('--selftest');
for (const a of args) {
  if (!/^--(backend|keep|only)=/.test(a) && a !== '--selftest') {
    console.error(`unknown argument ${a}\nusage: previs-check.mjs [--backend=webgpu|webgl2] [--keep=<dir>] [--only=<substring>] [--selftest]`);
    process.exit(2);
  }
}
if (backend !== undefined && backend !== 'webgpu' && backend !== 'webgl2') {
  console.error('--backend must be webgpu or webgl2');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'previs-check-'));
const outRoot = keepOpt ? path.resolve(keepOpt) : path.join(tmp, 'png');
fs.mkdirSync(outRoot, { recursive: true });
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });

const duration = (doc) => Math.max(0, ...doc.shots.map((s) => s.end));

function palette(doc) {
  const cols = [['background', doc.background]];
  for (const n of doc.nodes) if (n.color) cols.push([n.id, n.color]);
  for (const r of doc.roles ?? []) if (r.color) cols.push([`role:${r.id}`, r.color]);
  return cols.map(([id, c]) => [id, c.map((v) => v * 255)]);
}

function checkPng(file, pal) {
  const img = decodePng(fs.readFileSync(file));
  const cache = new Map();
  let unmatched = 0;
  let worst = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let d = cache.get(key);
    if (d === undefined) {
      d = Infinity;
      for (const [, c] of pal) d = Math.min(d, Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2])));
      cache.set(key, d);
    }
    if (d > TOL) {
      unmatched++;
      worst = Math.max(worst, d);
    }
  }
  return { unmatched, worst, pixels: img.width * img.height };
}

// Renders stills of one doc into outRoot/<name>/ and returns [{ file, t }].
function render(name, docPath, doc) {
  const d = duration(doc);
  const times = Array.from({ length: STILLS }, (_, i) => (d * (i + 0.5)) / STILLS);
  const out = path.join(outRoot, name);
  const a = [renderer, docPath, `--stills=${times.map((t) => t.toFixed(2)).join(',')}`, `--out=${out}`, '--no-aa'];
  if (backend) a.push(`--backend=${backend}`);
  const r = spawnSync(process.execPath, a, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`renderer failed for ${name} (exit ${r.status}):\n${r.stdout}${r.stderr}`);
  return [...new Set(times.map((t) => t.toFixed(2)))].map((t) => ({ file: path.join(out, `still_${t}.png`), t }));
}

function extraDocs() {
  const rel = (p) => path.relative(tmp, p).split(path.sep).join('/');
  const base = {
    version: 1, fps: 24, size: { width: 480, height: 270 }, background: [0.82, 0.86, 0.9],
    roles: [{ id: 'prop', label: 'prop', color: [0.2, 0.45, 0.9] }],
  };
  const ground = { id: 'ground', shape: 'box', color: [0.68, 0.7, 0.66], position: [0, -0.01, 0], rotation: [0, 0, 0], size: [14, 0.02, 8] };
  const cam = (p, t) => ({ id: 'main', start: 0, end: 2, camera: { position: [{ t: 0, v: p }], target: { track: [{ t: 0, v: t }] } } });
  // pure pivot: the prop sits on a (non-skinned) glTF node of the walker, via parentJoint
  const socket = {
    ...base, title: 'socket check',
    nodes: [
      ground,
      { id: 'walker', shape: 'model', model: { src: rel(path.join(webDir, 'previs/examples/models/walker.glb')), animation: { clip: 'walk', loop: 'repeat' } },
        color: [0.9, 0.35, 0.15], position: [0, 0.875, 0], rotation: [0, 0, 0], size: [0.7, 1.75, 0.5] },
      { id: 'sword', shape: 'box', role: 'prop', parent: 'walker', parentJoint: 'lowerArm.R', color: [0.2, 0.45, 0.9], position: [0, -0.2, 0.1], rotation: [0, 0, 0], size: [0.05, 0.5, 0.05] },
    ],
    shots: [cam([0, 1.2, 4], [0, 0.9, 0])],
  };
  // compressed walkers / mug / tail (Draco + meshopt)
  const fx = path.join(webDir, 'src/__tests__/fixtures/gltf-compressed');
  const items = [['walker.draco', 'walker'], ['walker.meshopt', 'walker'], ['mug.draco', 'mug'], ['mug.meshopt', 'mug'], ['tail.draco', 'tail'], ['tail.meshopt', 'tail']];
  const colors = [[0.9, 0.35, 0.15], [0.25, 0.75, 0.35], [0.2, 0.45, 0.9], [0.95, 0.8, 0.15], [0.6, 0.3, 0.8], [0.1, 0.7, 0.7]];
  const clip = { walker: 'walk', tail: 'sway' };
  const compressed = {
    ...base, title: 'compressed models',
    nodes: [
      ground,
      ...items.map(([f, kind], i) => ({
        id: f.replace('.', '_'), shape: 'model',
        model: { src: rel(path.join(fx, `${f}.glb`)), fit: 'contain', ...(clip[kind] ? { animation: { clip: clip[kind], loop: 'repeat' } } : {}) },
        color: colors[i], position: [-2.5 + i, kind === 'walker' ? 0.875 : kind === 'tail' ? 0.5 : 0.4, 0], rotation: [0, 0, 0],
        size: kind === 'walker' ? [0.7, 1.75, 0.5] : kind === 'tail' ? [0.5, 1, 0.2] : [0.5, 0.4, 0.4],
      })),
    ],
    shots: [cam([0, 1.2, 6], [0, 0.7, 0])],
  };
  return [['socket-pivot', socket], ['compressed-models', compressed]];
}

function writeDoc(name, doc) {
  const p = path.join(tmp, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(doc));
  return p;
}

const rows = [];
let failed = false;
const t0 = Date.now();
try {
  if (selftest) {
    const p = path.join(webDir, 'previs/examples/flat-swatches.json');
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    const pal = palette(doc);
    const [s] = render('selftest', p, doc);
    const clean = checkPng(s.file, pal);
    const img = decodePng(fs.readFileSync(s.file));
    const px = (img.height >> 1) * img.width + (img.width >> 1);
    img.data[px * 4] = (img.data[px * 4] + 8) & 255; // one pixel off by 8/255 in R
    img.data[px * 4 + 1] = (img.data[px * 4 + 1] + 8) & 255;
    const bad = path.join(path.dirname(s.file), 'selftest-bad.png');
    fs.writeFileSync(bad, encodePng(img));
    const dirty = checkPng(bad, pal);
    console.log(`selftest clean still : unmatched ${clean.unmatched} worst ${clean.worst.toFixed(2)} (expect 0)`);
    console.log(`selftest 1-px edit   : unmatched ${dirty.unmatched} worst ${dirty.worst.toFixed(2)} (expect 1)`);
    const ok = clean.unmatched === 0 && dirty.unmatched === 1;
    console.log(ok ? 'SELFTEST PASS (checker catches exactly 1 bad pixel)' : 'SELFTEST FAIL');
    process.exitCode = ok ? 0 : 1;
  } else {
    const jobs = [];
    const exDir = path.join(webDir, 'previs/examples');
    for (const f of fs.readdirSync(exDir).filter((x) => x.endsWith('.json')).sort()) {
      const p = path.join(exDir, f);
      jobs.push([f.replace(/\.json$/, ''), p, JSON.parse(fs.readFileSync(p, 'utf8'))]);
    }
    for (const [n, d] of extraDocs()) jobs.push([n, null, d]);
    for (const [name, docPath, doc] of jobs) {
      if (only && !name.includes(only)) continue;
      const p = docPath ?? writeDoc(name, doc);
      const pal = palette(doc);
      for (const s of render(name, p, doc)) {
        const r = checkPng(s.file, pal);
        rows.push({ doc: name, t: s.t, ...r });
        if (r.unmatched > 0) failed = true;
      }
    }
    if (rows.length === 0) { console.error('no stills rendered (--only matched nothing?)'); process.exitCode = 2; }
    else {
      const w = Math.max(...rows.map((r) => r.doc.length));
      console.log(`${'doc'.padEnd(w)}  t(s)   pixels  unmatched  worst(/255)`);
      for (const r of rows) console.log(`${r.doc.padEnd(w)}  ${r.t.padStart(5)}  ${String(r.pixels).padStart(6)}  ${String(r.unmatched).padStart(9)}  ${r.worst.toFixed(2).padStart(6)}  ${r.unmatched ? 'FAIL' : 'ok'}`);
      const nbad = rows.filter((r) => r.unmatched).length;
      console.log(`${rows.length} stills, ${nbad} failed, backend=${backend ?? 'default'}, ${((Date.now() - t0) / 1000).toFixed(1)}s${keepOpt ? `, kept in ${outRoot}` : ''}`);
      process.exitCode = failed ? 1 : 0;
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
