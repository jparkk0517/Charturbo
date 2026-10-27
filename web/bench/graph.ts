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
 *  - 3d-force-graph (ForceGraph3D): three.js + d3-force-3d (Barnes-Hut many-body force,
 *    different constants / integrator from viz). The RAF loop is
 *    paused after data load; `tickFrame()` on the inner ThreeForceGraph advances the simulation
 *    one step and updates the scene meshes, then three.js renders.
 */

import type { EngineAdapter } from '../src/adapters/engine-adapter';
import { GraphDatasetTS } from '../src/domain/dataset';
import type { RawGraphData } from '../src/sdk/viz-engine-sdk';

export const GRAPH_IDS = ['graph-10k', 'graph-100k'] as const;
export type GraphId = (typeof GRAPH_IDS)[number];
export type GraphLib = 'viz' | 'vizgpu' | 'three' | 'deckgl' | 'cosmos' | 'forcegraph3d';

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
  loaded?(): Promise<void>;
  validatePhysics?(): { ticks: number; movedNodes: number } | Promise<{ ticks: number; movedNodes: number }>;
  tickAsync?(dt: number, simulate: boolean): Promise<import('../src/adapters/engine-adapter').EngineStepTiming>;
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

  if (lib === 'viz' || lib === 'vizgpu') {
    const { RustWgpuAdapter } = await import('../src/adapters/rust-wgpu-adapter');
    // Empty engine: the dataset arrives through loadRawDataset like on the three.js side
    const adapter = await RustWgpuAdapter.create(canvas, 42, 0, 0, 1);
    if (lib === 'vizgpu' && !adapter.sdk.supportsGpuPhysics()) throw new Error('unsupported: hybrid GPU physics requires WebGPU');
    const tickAsync = async (dt: number, simulate: boolean) => {
      const start = performance.now();
      const kineticEnergy = simulate ? await adapter.sdk.stepPhysicsAsync(dt) : 0;
      const physicsEnd = performance.now();
      adapter.sdk.render();
      const end = performance.now();
      return { physicsTimeMs: physicsEnd - start, renderTimeMs: end - physicsEnd, totalTimeMs: end - start, kineticEnergy };
    };
    const gl = !!canvas.getContext('webgl2');
    return {
      adapter,
      backend: () => (gl ? 'webgl2' : 'webgpu'),
      wasmBytes: () => adapter.sdk.getRenderStats()?.wasmMemoryBytes ?? null,
      gpuBytes: () => adapter.sdk.getRenderStats()?.gpuBytes ?? null,
      tickAsync: lib === 'vizgpu' ? tickAsync : undefined,
      async validatePhysics() {
        const before = adapter.sdk.exportPositions();
        if (lib === 'vizgpu') await tickAsync(0.016, true); else adapter.tick(0.016, true);
        const after = adapter.sdk.exportPositions();
        let movedNodes = 0;
        for (let i = 0; i < after.length; i += 3) {
          if (after[i] !== before[i] || after[i + 1] !== before[i + 1] || after[i + 2] !== before[i + 2]) movedNodes++;
        }
        if (!after.every(Number.isFinite) || !movedNodes) throw new Error('viz: physics must move finite nodes');
        return { ticks: 1, movedNodes };
      },
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
// Paused simulation + enableRenderLoop:false: step() advances physics, renderOneFrame()
// only draws. Without pause(), renderOneFrame() would run a second simulation step.
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
      pause(): void;
      getPointPositions(): number[];
      renderOneFrame(): void;
      fitView(duration?: number): void;
      setZoomLevel(value: number): void;
      destroy(): void;
    };
  };

  const div = document.createElement('div');
  Object.assign(div.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(div);

  let ticks = 0;
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
    onSimulationTick: () => { ticks++; },
  });
  // Widen to the interface we declared so call sites typecheck without further casts
  type CosmosGraph = InstanceType<typeof Graph>;
  const graph = graphRaw as CosmosGraph;
  await graph.ready;
  graph.pause();

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
      graph.pause();
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

  return {
    adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null,
    validatePhysics() {
      const before = graph.getPointPositions();
      const startTicks = ticks;
      adapter.tick(0.016, true);
      const after = graph.getPointPositions();
      const physicsTicks = ticks - startTicks;
      adapter.tick(0.016, false);
      const drawn = graph.getPointPositions();
      if (ticks - startTicks !== physicsTicks || drawn.some((p, i) => p !== after[i])) {
        throw new Error('cosmos.gl: render-only frame advanced physics');
      }
      let movedNodes = 0;
      for (let i = 0; i < loadedNodeCount; i++) {
        if (after[2 * i] !== before[2 * i] || after[2 * i + 1] !== before[2 * i + 1]) movedNodes++;
      }
      if (after.length !== loadedNodeCount * 2 || !after.every(Number.isFinite) || physicsTicks !== 1 || !movedNodes) {
        throw new Error('cosmos.gl: physics must advance exactly one tick with finite node movement');
      }
      return { ticks: physicsTicks, movedNodes };
    },
  };
}

// ---------------------------------------------------------------------------
// 3d-force-graph adapter
// Wraps ForceGraph3D with the workspace three.js + d3-force-3d simulation.
// The RAF loop is paused; the scene's ThreeForceGraph.tickFrame() advances
// one d3 simulation step and syncs mesh positions; fg.renderer().render() draws.
// Camera is kept on the same spherical orbit (yaw 0.4 rad, pitch 0.3 rad,
// distance 220) as the other graph adapters.
// ---------------------------------------------------------------------------
async function createForceGraph3dBench(card: HTMLElement, w: number, h: number): Promise<GraphBench> {
  type Node = { id: number; x: number; y: number; z: number };
  type InnerGraph = {
    tickFrame(): void;
    onFinishUpdate(): () => void;
    onFinishUpdate(fn: () => void): void;
  };
  const { default: ForceGraph3D } = await import('3d-force-graph') as unknown as {
    default: new (el: HTMLElement, config?: Record<string, unknown>) => {
      width(w: number): unknown;
      height(h: number): unknown;
      graphData(data: { nodes: { id: number; x: number; y: number; z: number }[]; links: { source: number; target: number }[] }): unknown;
      pauseAnimation(): unknown;
      cameraPosition(pos?: { x?: number; y?: number; z?: number }, lookAt?: { x: number; y: number; z: number }, ms?: number): { x: number; y: number; z: number };
      d3ReheatSimulation(): unknown;
      renderer(): { render(scene: unknown, camera: unknown): void; domElement: HTMLCanvasElement };
      scene(): { traverse(fn: (object: unknown) => void): void };
      camera(): unknown;
      cooldownTicks(n: number): unknown;
      cooldownTime(ms: number): unknown;
      warmupTicks(n: number): unknown;
      numDimensions(n: number): unknown;
      nodeRelSize(r: number): unknown;
      nodeResolution(r: number): unknown;
      d3Force(name: string, force?: unknown): unknown;
      d3AlphaMin(n: number): unknown;
      onEngineTick(fn: () => void): unknown;
      _destructor?(): void;
    };
  };

  const div = document.createElement('div');
  Object.assign(div.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(div);

  const fg = new ForceGraph3D(div, { controlType: 'orbit' });
  // Disable cooling, not physics. Only the benchmark calls tickFrame.
  fg.cooldownTicks(Infinity);
  fg.cooldownTime(Infinity);
  fg.d3AlphaMin(0);
  fg.warmupTicks(0);
  fg.numDimensions(3);
  fg.nodeRelSize(1);
  fg.nodeResolution(4);
  fg.width(w);
  fg.height(h);
  // Park the animation loop — we drive frames manually
  fg.pauseAnimation();
  // three-render-objects attaches its objects in a debounced update.
  let inner: InnerGraph | undefined;
  for (let attempt = 0; attempt < 100 && !inner; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fg.scene().traverse((object) => {
      const candidate = object as Partial<InnerGraph>;
      if (typeof candidate.tickFrame === 'function' && typeof candidate.onFinishUpdate === 'function') inner = candidate as InnerGraph;
    });
  }
  // tickFrame is intentionally not a ForceGraph3D public method. Guard the scene integration
  // and verify actual simulation callbacks / movement, rather than silently measuring reheat.
  if (!inner) throw new Error('3d-force-graph: ThreeForceGraph scene object not found');
  const forceGraph = inner;
  const finishUpdate = forceGraph.onFinishUpdate();
  let pendingLoad = Promise.resolve();
  let ticks = 0;
  let currentNodes: Node[] = [];
  fg.onEngineTick(() => { ticks++; });

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

      currentNodes = nodes;
      pendingLoad = new Promise<void>((resolve) => {
        forceGraph.onFinishUpdate(() => {
          finishUpdate();
          // Meshes are created at the origin. Sync the seeded positions and links before
          // the first draw, without advancing physics (the cooled tick still syncs meshes).
          fg.cooldownTicks(0);
          forceGraph.tickFrame();
          fg.cooldownTicks(Infinity);
          fg.d3ReheatSimulation();
          updateCamera();
          fg.renderer().render(fg.scene(), fg.camera());
          resolve();
        });
      });
      fg.graphData({ nodes, links });
      return performance.now() - t0;
    },

    tick(_dt: number, simulatePhysics: boolean): import('../src/adapters/engine-adapter').EngineStepTiming {
      const t0 = performance.now();
      if (simulatePhysics) {
        forceGraph.tickFrame();
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

  return {
    adapter, backend: () => 'webgl2', wasmBytes: () => null, gpuBytes: () => null,
    loaded: () => pendingLoad,
    validatePhysics() {
      const before = currentNodes.map(({ x, y, z }) => [x, y, z]);
      const startTicks = ticks;
      adapter.tick(0.016, true);
      if (currentNodes.some((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z))) {
        throw new Error('3d-force-graph: non-finite node positions');
      }
      const movedNodes = currentNodes.filter((n, i) => n.x !== before[i][0] || n.y !== before[i][1] || n.z !== before[i][2]).length;
      if (ticks - startTicks !== 1 || !movedNodes) throw new Error('3d-force-graph: physics did not advance exactly one tick');
      return { ticks: ticks - startTicks, movedNodes };
    },
  };
}
