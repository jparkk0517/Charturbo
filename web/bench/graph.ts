/**
 * 3D graph comparison of the benchmark page (`graph-10k`, `graph-100k`): viz-engine-sdk (Rust
 * Barnes-Hut in WebAssembly + WebGPU billboards) vs three.js (the demo's JS Barnes-Hut octree +
 * InstancedMesh spheres / LineSegments edges on WebGL2). Both sides run through the demo app's
 * `EngineAdapter` implementations unchanged (src/adapters), with:
 *  - the same seeded dataset (GraphDatasetTS: 8 clusters, edges = 2 x nodes, 80% intra-cluster),
 *    loaded as the same flat TypedArrays (`loadRawDataset`)
 *  - the same force model and constants (repulsion 25, spring 0.08 / rest 8, gravity 0.03,
 *    damping 0.88, theta 0.75, softening 1.5, max speed 60) and dt = 0.016 per frame
 *  - the same orbit camera (distance 220, yaw 0.4, pitch 0.3, fov 45) and 960 x 540 canvas @ DPR 1
 * The adapters are imported dynamically, so chart pages never load three.js.
 */

import type { EngineAdapter } from '../src/adapters/engine-adapter';
import { GraphDatasetTS } from '../src/domain/dataset';
import type { RawGraphData } from '../src/sdk/viz-engine-sdk';

export const GRAPH_IDS = ['graph-10k', 'graph-100k'] as const;
export type GraphId = (typeof GRAPH_IDS)[number];
export type GraphLib = 'viz' | 'three';

export interface GraphSpec {
  nodes: number;
  edges: number;
  clusters: number;
  seed: number;
}

export function graphSpec(id: GraphId): GraphSpec {
  const nodes = id === 'graph-100k' ? 100_000 : 10_000;
  return { nodes, edges: nodes * 2, clusters: 8, seed: 42 };
}

/** Seeded clustered graph as flat buffers (not timed). */
export function graphData(s: GraphSpec): RawGraphData {
  return GraphDatasetTS.generateSeeded({ seed: s.seed, nodeCount: s.nodes, edgeCount: s.edges, clusterCount: s.clusters, spaceRadius: 100 }).toRawBuffers();
}

export interface GraphBench {
  adapter: EngineAdapter;
  backend(): 'webgpu' | 'webgl2';
  /** WebAssembly memory (viz only) */
  wasmBytes(): number | null;
  /** GPU buffer bytes the engine reports (viz only; three.js has no byte counter) */
  gpuBytes(): number | null;
}

export async function createGraphAdapter(lib: GraphLib, card: HTMLElement, w: number, h: number): Promise<GraphBench> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(canvas);
  if (lib === 'viz') {
    const { RustWgpuAdapter } = await import('../src/adapters/rust-wgpu-adapter');
    // Empty engine: the dataset arrives through loadRawDataset like on the three.js side
    const adapter = await RustWgpuAdapter.create(canvas, 42, 0, 0, 1);
    const gl = !!canvas.getContext('webgl2');
    return {
      adapter,
      backend: () => (gl ? 'webgl2' : 'webgpu'),
      wasmBytes: () => adapter.sdk.getRenderStats()?.wasmMemoryBytes ?? null,
      gpuBytes: () => adapter.sdk.getRenderStats()?.gpuBytes ?? null,
    };
  }
  const { ThreeJsAdapter } = await import('../src/adapters/three-js-adapter');
  const adapter = new ThreeJsAdapter(canvas, 42, 0, 0, 1);
  adapter.resize(w, h);
  return { adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null };
}
