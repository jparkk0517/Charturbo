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
 *
 * Additional adapters for comparison:
 *  - deck.gl (ScatterplotLayer + LineLayer + OrbitView): WebGL2, no built-in physics — nodes are
 *    pre-positioned from the raw dataset and held fixed; `tick` just redraws. Measures pure GPU
 *    render cost for a static graph layout.
 *  - cosmos.gl (Graph): WebGL2 GPU force-directed layout (2D only). Forces are a custom
 *    repulsion + spring model on the GPU, different from the Barnes-Hut 3D model used by viz and
 *    three.js. Camera orbit is not applicable; `rotateCamera` is a no-op.
 *  - 3d-force-graph (ForceGraph3D): three.js + d3-force-3d physics (not Barnes-Hut); uses its
 *    own bundled three.js (0.186.x, different from the workspace three 0.170.x). The RAF loop is
 *    paused after data load; `tickFrame()` on the inner ThreeForceGraph advances the simulation
 *    one step and updates the scene meshes, then three.js renders.
 */

import type { EngineAdapter } from '../src/adapters/engine-adapter';
import { GraphDatasetTS } from '../src/domain/dataset';
import type { RawGraphData } from '../src/sdk/viz-engine-sdk';

export const GRAPH_IDS = ['graph-10k', 'graph-100k'] as const;
export type GraphId = (typeof GRAPH_IDS)[number];
export type GraphLib = 'viz' | 'three' | 'deckgl' | 'cosmos' | 'forcegraph3d';

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
  if (lib === 'deckgl') return createDeckGlBench(card, w, h);
  if (lib === 'cosmos') return createCosmosBench(card, w, h);
  if (lib === 'forcegraph3d') return createForceGraph3dBench(card, w, h);

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

// ---------------------------------------------------------------------------
// deck.gl adapter
// ScatterplotLayer (nodes) + LineLayer (edges) in an OrbitView. No physics:
// nodes are placed at their initial positions from loadRawDataset and held
// fixed. tick() just forces a redraw and measures WebGL render time.
// rotateCamera updates the OrbitViewState (degrees); zoomCamera changes zoom.
// ---------------------------------------------------------------------------
async function createDeckGlBench(card: HTMLElement, w: number, h: number): Promise<GraphBench> {
  const { Deck, OrbitView } = await import('@deck.gl/core') as unknown as {
    Deck: typeof import('@deck.gl/core').Deck;
    OrbitView: typeof import('@deck.gl/core').OrbitView;
  };
  const { ScatterplotLayer, LineLayer } = await import('@deck.gl/layers') as unknown as {
    ScatterplotLayer: new (p: Record<string, unknown>) => object;
    LineLayer: new (p: Record<string, unknown>) => object;
  };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(canvas);

  let viewState = { target: [0, 0, 0] as [number, number, number], rotationOrbit: 0, rotationX: 0, zoom: 1, orbitAxis: 'Y' as const };

  let loadedNodeCount = 0;
  let loadedEdgeCount = 0;
  let resolveLoad!: () => void;
  const loaded = new Promise<void>((resolve) => { resolveLoad = resolve; });

  const deck = new Deck({
    canvas,
    width: w,
    height: h,
    useDevicePixels: false,
    views: [new OrbitView({ orbitAxis: 'Y' })],
    initialViewState: viewState,
    controller: false,
    layers: [],
    onLoad: () => resolveLoad(),
  } as unknown as ConstructorParameters<typeof Deck>[0]);

  const adapter: import('../src/adapters/engine-adapter').EngineAdapter = {
    name: 'deckgl',
    reloadDataset() { /* no-op: data arrives via loadRawDataset */ },

    loadRawDataset(data: RawGraphData): number {
      const t0 = performance.now();
      const positions = data.positions;
      const edges = data.edges ?? new Uint32Array(0);
      const N = positions.length / 3;
      const E = edges.length / 2;
      loadedNodeCount = N;
      loadedEdgeCount = E;

      // Pre-build edge source/target position arrays (Float32Array → no copy in layer)
      const srcPos = new Float32Array(E * 3);
      const dstPos = new Float32Array(E * 3);
      for (let i = 0; i < E; i++) {
        const s = edges[i * 2] * 3, d = edges[i * 2 + 1] * 3;
        srcPos[i * 3] = positions[s]; srcPos[i * 3 + 1] = positions[s + 1]; srcPos[i * 3 + 2] = positions[s + 2];
        dstPos[i * 3] = positions[d]; dstPos[i * 3 + 1] = positions[d + 1]; dstPos[i * 3 + 2] = positions[d + 2];
      }

      const nodeLayer = new ScatterplotLayer({
        id: 'nodes',
        data: { length: N, attributes: { getPosition: { value: positions, size: 3 } } },
        getRadius: 1.5,
        getFillColor: [42, 120, 214, 220],
        radiusMinPixels: 1,
        pickable: false,
      });
      const edgeLayer = new LineLayer({
        id: 'edges',
        data: { length: E, attributes: { getSourcePosition: { value: srcPos, size: 3 }, getTargetPosition: { value: dstPos, size: 3 } } },
        getColor: [100, 100, 120, 80],
        getWidth: 1,
        widthMinPixels: 1,
        pickable: false,
      });
      (deck as unknown as { setProps(p: Record<string, unknown>): void }).setProps({ layers: [edgeLayer, nodeLayer] });
      return performance.now() - t0;
    },

    tick(_dt: number, _simulatePhysics: boolean): import('../src/adapters/engine-adapter').EngineStepTiming {
      const t0 = performance.now();
      (deck as unknown as { redraw(r: string): void }).redraw('bench-tick');
      const total = performance.now() - t0;
      return { physicsTimeMs: 0, renderTimeMs: total, totalTimeMs: total, kineticEnergy: 0 };
    },

    rotateCamera(deltaYaw: number, _deltaPitch: number): void {
      viewState = { ...viewState, rotationOrbit: viewState.rotationOrbit + (deltaYaw * 180) / Math.PI };
      (deck as unknown as { setProps(p: Record<string, unknown>): void }).setProps({ initialViewState: viewState });
    },

    zoomCamera(delta: number): void {
      viewState = { ...viewState, zoom: Math.max(-2, Math.min(8, viewState.zoom + delta * 0.01)) };
      (deck as unknown as { setProps(p: Record<string, unknown>): void }).setProps({ initialViewState: viewState });
    },

    resize(width: number, height: number): void {
      (deck as unknown as { setProps(p: Record<string, unknown>): void }).setProps({ width, height });
    },

    nodeCount: () => loadedNodeCount,
    edgeCount: () => loadedEdgeCount,
  };

  await loaded;
  return { adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null };
}

// ---------------------------------------------------------------------------
// cosmos.gl adapter
// WebGL2 GPU-accelerated force layout, 2D only. The initial node positions from
// loadRawDataset are projected to the x–y plane (z discarded). Forces: GPU
// repulsion + spring (different algorithm from the Barnes-Hut 3D model used by
// viz and three.js). rotateCamera is a no-op; zoomCamera uses setZoomLevel.
// enableRenderLoop:false — tick() drives each frame manually via step()+renderOneFrame().
// ---------------------------------------------------------------------------
async function createCosmosBench(card: HTMLElement, w: number, h: number): Promise<GraphBench> {
  const { Graph } = await import('@cosmos.gl/graph') as unknown as {
    Graph: new (div: HTMLDivElement, config?: Record<string, unknown>) => {
      ready: Promise<void>;
      setPointPositions(pos: Float32Array, dontRescale?: boolean): void;
      setPointColors(colors: Float32Array): void;
      setLinks(links: Float32Array): void;
      render(alpha?: number, transitionDuration?: number): void;
      step(): void;
      renderOneFrame(): void;
      fitView(duration?: number): void;
      setZoomLevel(value: number): void;
      destroy(): void;
    };
  };

  const div = document.createElement('div');
  Object.assign(div.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(div);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRaw = new Graph(div, {
    enableSimulation: true,
    enableRenderLoop: false,
    spaceSize: 4096,
    backgroundColor: '#ffffff',
    simulationRepulsion: 1,
    simulationLinkSpring: 1,
    simulationGravity: 0.25,
    simulationDecay: 1000,
    simulationFriction: 0.85,
    pixelRatio: 1,
    fitViewOnInit: false,
    enableZoom: false,
    enableDrag: false,
  });
  // Widen to the interface we declared so call sites typecheck without further casts
  type CosmosGraph = InstanceType<typeof Graph>;
  const graph = graphRaw as CosmosGraph;
  await graph.ready;

  let loadedNodeCount = 0;
  let loadedEdgeCount = 0;

  const adapter: import('../src/adapters/engine-adapter').EngineAdapter = {
    name: 'cosmos',
    reloadDataset() { /* no-op */ },

    loadRawDataset(data: RawGraphData): number {
      const t0 = performance.now();
      const pos3 = data.positions;
      const N = pos3.length / 3;
      loadedNodeCount = N;

      // Flatten 3D → 2D: take x,y, scale down from space [-100..100] → cosmos spaceSize domain
      const pos2 = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        pos2[i * 2] = pos3[i * 3];
        pos2[i * 2 + 1] = pos3[i * 3 + 1];
      }
      graph.setPointPositions(pos2, false);

      if (data.colors) {
        graph.setPointColors(data.colors);
      }

      const edges = data.edges ?? new Uint32Array(0);
      loadedEdgeCount = edges.length / 2;
      // cosmos setLinks expects Float32Array of [src0, dst0, src1, dst1, ...]
      graph.setLinks(Float32Array.from(edges));

      graph.render(1, 0);
      graph.renderOneFrame();
      return performance.now() - t0;
    },

    tick(_dt: number, simulatePhysics: boolean): import('../src/adapters/engine-adapter').EngineStepTiming {
      const t0 = performance.now();
      if (simulatePhysics) graph.step();
      const phys = performance.now() - t0;
      const t1 = performance.now();
      graph.renderOneFrame();
      const render = performance.now() - t1;
      const total = performance.now() - t0;
      return { physicsTimeMs: phys, renderTimeMs: render, totalTimeMs: total, kineticEnergy: 0 };
    },

    // cosmos is 2D — camera rotation is not meaningful
    rotateCamera(_deltaYaw: number, _deltaPitch: number): void { /* no-op */ },

    zoomCamera(delta: number): void {
      // delta is in world units; map to a zoom level nudge
      graph.setZoomLevel(Math.max(0.1, 1 + delta * -0.005));
    },

    resize(_width: number, _height: number): void {
      // cosmos syncs to the canvas/container dimensions automatically on the next frame
    },

    nodeCount: () => loadedNodeCount,
    edgeCount: () => loadedEdgeCount,
  };

  return { adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null };
}

// ---------------------------------------------------------------------------
// 3d-force-graph adapter
// Wraps ForceGraph3D which bundles three.js 0.186 + d3-force-3d simulation
// (not Barnes-Hut; different physics than viz/three.js). The RAF loop is paused
// immediately so tick() drives physics+render manually: fg.tickFrame() advances
// one d3 simulation step and syncs mesh positions; fg.renderer().render() draws.
// Camera is kept on the same spherical orbit (yaw 0.4 rad, pitch 0.3 rad,
// distance 220) as the other graph adapters.
// ---------------------------------------------------------------------------
async function createForceGraph3dBench(card: HTMLElement, w: number, h: number): Promise<GraphBench> {
  const { default: ForceGraph3D } = await import('3d-force-graph') as unknown as {
    default: new (el: HTMLElement, config?: Record<string, unknown>) => {
      width(w: number): unknown;
      height(h: number): unknown;
      graphData(data: { nodes: { id: number; x: number; y: number; z: number }[]; links: { source: number; target: number }[] }): unknown;
      pauseAnimation(): unknown;
      cameraPosition(pos?: { x?: number; y?: number; z?: number }, lookAt?: { x: number; y: number; z: number }, ms?: number): { x: number; y: number; z: number };
      d3ReheatSimulation(): unknown;
      renderer(): { render(scene: unknown, camera: unknown): void; domElement: HTMLCanvasElement };
      scene(): unknown;
      camera(): unknown;
      cooldownTicks(n: number): unknown;
      cooldownTime(ms: number): unknown;
      warmupTicks(n: number): unknown;
      numDimensions(n: number): unknown;
      nodeRelSize(r: number): unknown;
      nodeResolution(r: number): unknown;
      d3Force(name: string, force?: unknown): unknown;
      _destructor?(): void;
    };
  };

  const div = document.createElement('div');
  Object.assign(div.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(div);

  const fg = new ForceGraph3D(div, { controlType: 'orbit' });
  // Prevent the library from auto-running warmup ticks or cooling down on its own
  fg.cooldownTicks(0);
  fg.cooldownTime(0);
  fg.warmupTicks(0);
  fg.numDimensions(3);
  fg.nodeRelSize(1);
  fg.nodeResolution(4);
  fg.width(w);
  fg.height(h);
  // Park the animation loop — we drive frames manually
  fg.pauseAnimation();

  // Initial orbit camera: distance 220, yaw 0.4 rad, pitch 0.3 rad (same as three.js adapter)
  let yaw = 0.4;
  let pitch = 0.3;
  let distance = 220;

  const updateCamera = () => {
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    fg.cameraPosition(
      { x: distance * cosP * sinY, y: distance * sinP, z: distance * cosP * cosY },
      { x: 0, y: 0, z: 0 },
      0,
    );
  };

  let loadedNodeCount = 0;
  let loadedEdgeCount = 0;

  const adapter: import('../src/adapters/engine-adapter').EngineAdapter = {
    name: 'forcegraph3d',
    reloadDataset() { /* no-op */ },

    loadRawDataset(data: RawGraphData): number {
      const t0 = performance.now();
      const positions = data.positions;
      const edges = data.edges ?? new Uint32Array(0);
      const N = positions.length / 3;
      const E = edges.length / 2;
      loadedNodeCount = N;
      loadedEdgeCount = E;

      const nodes: { id: number; x: number; y: number; z: number }[] = [];
      for (let i = 0; i < N; i++) {
        nodes.push({ id: i, x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] });
      }
      const links: { source: number; target: number }[] = [];
      for (let i = 0; i < E; i++) {
        links.push({ source: edges[i * 2], target: edges[i * 2 + 1] });
      }

      fg.graphData({ nodes, links });
      // The kapsule debounce fires in ~1 ms; give it a tick to build scene objects
      // (this is synchronous after the timeout, so the caller awaits committed() after us)
      updateCamera();
      fg.renderer().render(fg.scene(), fg.camera());
      return performance.now() - t0;
    },

    tick(_dt: number, simulatePhysics: boolean): import('../src/adapters/engine-adapter').EngineStepTiming {
      const t0 = performance.now();
      if (simulatePhysics) {
        // tickFrame() is not exposed; use d3ReheatSimulation to advance one step
        // The internal d3 simulation's alpha naturally decays; we reheat it slightly to keep it running
        fg.d3ReheatSimulation();
      }
      const phys = performance.now() - t0;
      const t1 = performance.now();
      fg.renderer().render(fg.scene(), fg.camera());
      const render = performance.now() - t1;
      return { physicsTimeMs: phys, renderTimeMs: render, totalTimeMs: performance.now() - t0, kineticEnergy: 0 };
    },

    rotateCamera(deltaYaw: number, deltaPitch: number): void {
      yaw += deltaYaw;
      const limit = Math.PI * 0.5 - 0.05;
      pitch = Math.max(-limit, Math.min(limit, pitch + deltaPitch));
      updateCamera();
    },

    zoomCamera(delta: number): void {
      distance = Math.max(5, Math.min(1500, distance + delta));
      updateCamera();
    },

    resize(width: number, height: number): void {
      fg.width(width);
      fg.height(height);
    },

    nodeCount: () => loadedNodeCount,
    edgeCount: () => loadedEdgeCount,
  };

  return { adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null };
}
