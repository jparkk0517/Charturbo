/**
 * Seeded data generators of the benchmark page (`npm run bench`). Every scenario builds its data
 * from mulberry32 with a fixed seed, so every run / library / machine draws the same samples.
 * Generation happens before any timer starts.
 */

/** Seeded PRNG (mulberry32): same sequence on every run / machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random walk with a slow sine (sensor-like series). */
export function walk(seed: number, n: number, base = 0): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += rand() - 0.5;
    out[i] = base + v + Math.sin((i / n) * Math.PI * 6) * 40;
  }
  return out;
}

/** `count` series of `perSeries` samples each (seeds 1..count). */
export function lineSeries(total: number, count: number): Float32Array[] {
  const per = Math.floor(total / count);
  return Array.from({ length: count }, (_, s) => walk(1 + s, per, s * 60));
}

/** Gaussian clusters (Box-Muller): scatter x / y. */
export function scatter(n: number, seed = 81): { x: Float32Array; y: Float32Array } {
  const rand = mulberry32(seed);
  const centers = [
    [-2, -1],
    [1.5, 1],
    [0, 2.5],
    [3, -2],
  ];
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.max(rand(), 1e-12);
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * rand();
    const c = centers[i & 3];
    x[i] = c[0] + r * Math.cos(a) * 0.8;
    y[i] = c[1] + r * Math.sin(a) * 0.7;
  }
  return { x, y };
}

/** Bar values of `n` categories. */
export function bars(n: number, seed = 5): { labels: string[]; values: Float32Array } {
  const rand = mulberry32(seed);
  const labels = Array.from({ length: n }, (_, i) => `C${i}`);
  const values = Float32Array.from({ length: n }, (_, i) => 20 + 60 * rand() + 15 * Math.sin(i / 50));
  return { labels, values };
}

/** Row-major `size x size` smooth field plus noise. */
export function heatmap(size: number, seed = 41): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      out[r * size + c] = Math.sin(c / 37) * Math.cos(r / 23) * 10 + rand() * 3;
    }
  }
  return out;
}

/** OHLC random walk of `n` candles. */
export function candles(n: number, seed = 21) {
  const rand = mulberry32(seed);
  const open = new Float32Array(n);
  const high = new Float32Array(n);
  const low = new Float32Array(n);
  const close = new Float32Array(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    open[i] = price;
    price = Math.max(1, price + (rand() - 0.5) * 2);
    close[i] = price;
    high[i] = Math.max(open[i], close[i]) + rand();
    low[i] = Math.min(open[i], close[i]) - rand();
  }
  return { open, high, low, close };
}

export interface TreeNode {
  name: string;
  value?: number;
  children?: TreeNode[];
}

/** Three-level hierarchy with `leaves` leaves (branching ~ cube root). */
export function tree(leaves: number, seed = 61): TreeNode {
  const rand = mulberry32(seed);
  const b = Math.max(2, Math.round(Math.cbrt(leaves)));
  let made = 0;
  const top: TreeNode[] = [];
  for (let i = 0; i < b && made < leaves; i++) {
    const mid: TreeNode[] = [];
    for (let j = 0; j < b && made < leaves; j++) {
      const kids: TreeNode[] = [];
      for (let k = 0; k < b && made < leaves; k++, made++) kids.push({ name: `L${made}`, value: 1 + rand() * 99 });
      mid.push({ name: `M${i}.${j}`, children: kids });
    }
    top.push({ name: `T${i}`, children: mid });
  }
  // Remainder (rounding) under one extra branch
  const rest: TreeNode[] = [];
  while (made < leaves) rest.push({ name: `L${made++}`, value: 1 + rand() * 99 });
  if (rest.length) top.push({ name: 'Rest', children: [{ name: 'Rest', children: rest }] });
  return { name: 'root', children: top };
}

/** Layered DAG: `nodes` nodes in 8 layers, ~2 links per node to the next layer. */
export function sankey(nodes: number, seed = 71) {
  const rand = mulberry32(seed);
  const layers = 8;
  const per = Math.ceil(nodes / layers);
  const ids = Array.from({ length: nodes }, (_, i) => ({ id: `n${i}` }));
  const links: { source: string; target: string; value: number }[] = [];
  for (let i = 0; i < nodes; i++) {
    const layer = Math.floor(i / per);
    if (layer >= layers - 1) continue;
    const next0 = (layer + 1) * per;
    const nextN = Math.min(nodes, next0 + per) - next0;
    if (nextN <= 0) continue;
    for (let k = 0; k < 2; k++) {
      links.push({ source: `n${i}`, target: `n${next0 + Math.floor(rand() * nextN)}`, value: 1 + rand() * 9 });
    }
  }
  return { nodes: ids, links };
}
