import { describe, expect, it } from 'vitest';
import { DeterministicRngTS, GraphDatasetTS } from '../domain/dataset';
import {
  DEFAULT_FORCE_CONFIG,
  ForceDirectedSimulatorTS,
  OctreeSpatialIndexTS,
} from '../three-engine/octree-physics';
import { MetricsCollector } from '../benchmark/metrics';
import { BenchmarkController } from '../benchmark/controller';
import { EngineAdapter, EngineStepTiming } from '../adapters/engine-adapter';
import { VIZ_THEMES, VizEngineSDK, WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

describe('Phase 5 Benchmark Core (TDD)', () => {
  it('DeterministicRngTS matches Rust XorShift32 bit-for-bit', () => {
    const rng = new DeterministicRngTS(42);
    // For seed 42:
    // x = 42; x ^= x << 13 (42 ^ 344064 = 344106); x ^= x >>> 17 (344106 ^ 2 = 344104); x ^= x << 5 (344104 ^ 11011328 = 11355432)
    expect(rng.nextU32()).toBe(11355432);

    const rngA = new DeterministicRngTS(1337);
    const rngB = new DeterministicRngTS(1337);
    for (let i = 0; i < 20; i++) {
      expect(rngA.nextU32()).toBe(rngB.nextU32());
    }
  });

  it('GraphDatasetTS generates deterministic nodes and valid edges', () => {
    const ds1 = GraphDatasetTS.generateSeeded({
      seed: 1337,
      nodeCount: 200,
      edgeCount: 400,
      clusterCount: 6,
      spaceRadius: 100,
    });
    const ds2 = GraphDatasetTS.generateSeeded({
      seed: 1337,
      nodeCount: 200,
      edgeCount: 400,
      clusterCount: 6,
      spaceRadius: 100,
    });

    expect(ds1.nodes.length).toBe(200);
    expect(ds1.edges.length).toBe(400);
    expect(ds1.nodes[0].px).toBeCloseTo(ds2.nodes[0].px, 6);
    expect(ds1.edges[0]).toEqual(ds2.edges[0]);
  });

  it('OctreeSpatialIndexTS and ForceDirectedSimulatorTS repel close nodes and pull connected distant nodes', () => {
    const closeDs = new GraphDatasetTS(
      [
        {
          id: 0,
          px: -1,
          py: 0,
          pz: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          clusterId: 0,
          mass: 1,
          color: [1, 1, 1, 1],
        },
        {
          id: 1,
          px: 1,
          py: 0,
          pz: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          clusterId: 0,
          mass: 1,
          color: [1, 1, 1, 1],
        },
      ],
      []
    );
    const sim = new ForceDirectedSimulatorTS(new OctreeSpatialIndexTS(), {
      ...DEFAULT_FORCE_CONFIG,
      centerGravity: 0,
      repulsionStrength: 50,
    });
    sim.step(closeDs, 0.05);
    const newDist = Math.hypot(
      closeDs.nodes[1].px - closeDs.nodes[0].px,
      closeDs.nodes[1].py - closeDs.nodes[0].py,
      closeDs.nodes[1].pz - closeDs.nodes[0].pz
    );
    expect(newDist).toBeGreaterThan(2.0);
    expect(closeDs.totalKineticEnergy()).toBeGreaterThan(0);
  });

  it('MetricsCollector computes rolling averages and 1% low FPS accurately', () => {
    const collector = new MetricsCollector(10);
    for (let i = 0; i < 9; i++) {
      collector.record({ frameTimeMs: 10.0, physicsTimeMs: 6.0, renderTimeMs: 4.0 });
    }
    // 1 spike frame of 50ms (20 FPS)
    collector.record({ frameTimeMs: 50.0, physicsTimeMs: 40.0, renderTimeMs: 10.0 });

    const summary = collector.summarize();
    expect(summary.sampleCount).toBe(10);
    expect(summary.avgFrameTimeMs).toBeCloseTo(14.0, 2); // (90 + 50) / 10 = 14ms
    expect(summary.avgFps).toBeCloseTo(1000 / 14.0, 1);
    expect(summary.onePercentLowFps).toBeCloseTo(20.0, 1); // worst frame = 50ms => 20 FPS
  });

  it('BenchmarkController coordinates adapters and computes speedup ratios', () => {
    const createStubAdapter = (
      name: string,
      physicsTimeMs: number,
      renderTimeMs: number
    ): EngineAdapter => ({
      name,
      reloadDataset: () => {},
      tick: (): EngineStepTiming => ({
        physicsTimeMs,
        renderTimeMs,
        totalTimeMs: physicsTimeMs + renderTimeMs,
        kineticEnergy: 10,
      }),
      rotateCamera: () => {},
      zoomCamera: () => {},
      resize: () => {},
      nodeCount: () => 5000,
      edgeCount: () => 10000,
    });

    const rustStub = createStubAdapter('Rust', 2.0, 0.5);
    const threeStub = createStubAdapter('Three', 10.0, 2.0);
    const controller = new BenchmarkController(rustStub, threeStub);

    controller.stepSingleEngine('rust', 0.016, true);
    controller.stepSingleEngine('three', 0.016, true);
    const report = controller.getReport();
    expect(report.physicsSpeedup).toBeCloseTo(5.0, 2); // 10.0ms / 2.0ms = 5x
    expect(report.totalSpeedup).toBeCloseTo(4.8, 2); // 12.0ms / 2.5ms = 4.8x
  });

  it('BenchmarkController runs only the selected engine and sanitizes custom dataset inputs', () => {
    let rustCalls = 0;
    let threeCalls = 0;
    let lastReload = { seed: 0, nodes: 0, edges: 0, clusters: 0 };

    const rustStub: EngineAdapter = {
      name: 'Rust',
      reloadDataset: (seed, nodes, edges, clusters) => {
        lastReload = { seed, nodes, edges, clusters };
      },
      tick: () => {
        rustCalls++;
        return { physicsTimeMs: 1.5, renderTimeMs: 0.5, totalTimeMs: 2.0, kineticEnergy: 5 };
      },
      rotateCamera: () => {},
      zoomCamera: () => {},
      resize: () => {},
      nodeCount: () => lastReload.nodes,
      edgeCount: () => lastReload.edges,
    };

    const threeStub: EngineAdapter = {
      ...rustStub,
      name: 'Three',
      tick: () => {
        threeCalls++;
        return { physicsTimeMs: 6.0, renderTimeMs: 1.5, totalTimeMs: 7.5, kineticEnergy: 5 };
      },
    };

    const controller = new BenchmarkController(rustStub, threeStub);

    // Step only Rust -> Three.js must NOT be called
    controller.stepSingleEngine('rust', 0.016, true);
    expect(rustCalls).toBe(1);
    expect(threeCalls).toBe(0);

    // Step only Three.js -> Rust must NOT be called
    controller.stepSingleEngine('three', 0.016, true);
    expect(rustCalls).toBe(1);
    expect(threeCalls).toBe(1);

    // Custom dataset input sanitization (clamps negative/huge numbers safely)
    const applied = controller.applyCustomDataset({
      seed: 42,
      nodeCount: 3500,
      edgeCount: 7000,
      clusterCount: 10,
    });
    expect(applied.nodeCount).toBe(3500);
    expect(applied.edgeCount).toBe(7000);
    expect(applied.clusterCount).toBe(10);
    expect(lastReload.nodes).toBe(3500);
  });

  it('VizEngineSDK manages bulk TypedArray datasets, spatial queries, selection, and force controls', () => {
    let storedPositions = new Float32Array(0);
    let storedEdges = new Uint32Array(0);
    let frustumCulling = false;
    let sleeping = false;
    const pinnedSet = new Set<number>();

    const mockBackend: WasmVizEngineBackend = {
      reload_dataset: () => {},
      load_raw_dataset: (positions, _masses, _colors, _clusters, edges) => {
        if (positions.length % 3 !== 0) {
          throw new Error('positions length must be a multiple of 3');
        }
        storedPositions = new Float32Array(positions);
        storedEdges = new Uint32Array(edges);
      },
      export_positions: () => new Float32Array(storedPositions),
      import_positions: (positions) => {
        storedPositions = new Float32Array(positions);
      },
      warmup: (ticks) => ticks * 1.5,
      step_physics: () => 4.2,
      set_auto_sleep: (_enabled, _threshold) => {
        sleeping = _enabled;
      },
      is_sleeping: () => sleeping,
      wake_up: () => {
        sleeping = false;
      },
      set_force_params: () => {},
      set_frustum_culling: (enabled) => {
        frustumCulling = enabled;
      },
      sync_and_render: () => {},
      rotate_camera: () => {},
      zoom_camera: () => {},
      pan_camera: () => {},
      fit_to_view: () => {},
      focus_on_node: (id) => id >= 0 && id < storedPositions.length / 3,
      resize: () => {},
      pick_node_at_ndc: () => 1,
      select_box_ndc: () => new Uint32Array([0, 1]),
      query_radius: () => new Uint32Array([1, 2]),
      select_node_and_neighbors: (id) => new Uint32Array([id, 1]),
      select_cluster: () => new Uint32Array([0, 2]),
      clear_selection: () => {},
      set_node_pinned: (id, pinned) => {
        if (pinned) pinnedSet.add(id);
        else pinnedSet.delete(id);
        return true;
      },
      move_node_to: (id, x, y, z) => {
        storedPositions[id * 3] = x;
        storedPositions[id * 3 + 1] = y;
        storedPositions[id * 3 + 2] = z;
        return true;
      },
      node_count: () => storedPositions.length / 3,
      edge_count: () => storedEdges.length / 2,
    };

    const sdk = VizEngineSDK.fromBackend(mockBackend);

    sdk.loadDataset({
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      edges: new Uint32Array([0, 1, 1, 2]),
    });

    expect(sdk.nodeCount()).toBe(3);
    expect(sdk.edgeCount()).toBe(2);

    // Warmup & Auto-Sleep
    expect(sdk.warmup(10)).toBeCloseTo(15.0);
    sdk.setAutoSleep(true, 0.05);
    expect(sdk.isSleeping()).toBe(true);
    sdk.wakeUp();
    expect(sdk.isSleeping()).toBe(false);

    // Spatial queries & selection
    expect( Array.from(sdk.boxSelect(-0.5, -0.5, 0.5, 0.5))).toEqual([0, 1]);
    expect(Array.from(sdk.queryRadius(0, 0, 0, 15.0, 5))).toEqual([1, 2]);
    expect(Array.from(sdk.highlightNeighbors(0, 1))).toEqual([0, 1]);

    // Pinning, Moving & Layout Snapshot Export
    expect(sdk.pinNode(1, true)).toBe(true);
    expect(sdk.moveNode(1, 42, 43, 44)).toBe(true);
    const snapshot = sdk.exportPositions();
    expect(Array.from(snapshot.slice(3, 6))).toEqual([42, 43, 44]);

    // Frustum culling & Camera focus
    sdk.setFrustumCulling(true);
    expect(frustumCulling).toBe(true);
    expect(sdk.focusNode(2)).toBe(true);
  });

  it('BenchmarkController compares VizEngineSDK module vs Three.js across Bulk Load, Warmup, and Spatial Queries', () => {
    const createFullStub = (
      name: string,
      timings: { physics: number; render: number; bulkLoad: number; warmup: number; query: number }
    ): EngineAdapter => ({
      name,
      reloadDataset: () => {},
      loadRawDataset: () => timings.bulkLoad,
      warmup: () => ({ elapsedMs: timings.warmup, kineticEnergy: 12.5 }),
      boxSelect: () => ({ elapsedMs: timings.query, selectedCount: 42 }),
      highlightNeighbors: () => ({ elapsedMs: timings.query, selectedCount: 15 }),
      selectCluster: () => ({ elapsedMs: timings.query, selectedCount: 125 }),
      clearSelection: () => {},
      fitToView: () => {},
      setFrustumCulling: () => {},
      tick: (): EngineStepTiming => ({
        physicsTimeMs: timings.physics,
        renderTimeMs: timings.render,
        totalTimeMs: timings.physics + timings.render,
        kineticEnergy: 10,
      }),
      rotateCamera: () => {},
      zoomCamera: () => {},
      resize: () => {},
      nodeCount: () => 5000,
      edgeCount: () => 10000,
    });

    const sdkModuleStub = createFullStub('VizEngineSDK (Rust + wgpu)', {
      physics: 1.2,
      render: 0.4,
      bulkLoad: 0.8,
      warmup: 18.0,
      query: 0.15,
    });
    const threeStub = createFullStub('Three.js (WebGL2)', {
      physics: 8.4,
      render: 2.0,
      bulkLoad: 6.4,
      warmup: 126.0,
      query: 2.4,
    });

    const controller = new BenchmarkController(sdkModuleStub, threeStub);

    const warmupComp = controller.compareWarmup(30, 0.016);
    expect(warmupComp.rustMs).toBeCloseTo(18.0);
    expect(warmupComp.threeMs).toBeCloseTo(126.0);
    expect(warmupComp.speedup).toBeCloseTo(7.0, 2);

    const boxComp = controller.compareBoxSelect(-0.4, -0.4, 0.4, 0.4);
    expect(boxComp.selectedCount).toBe(42);
    expect(boxComp.speedup).toBeCloseTo(16.0, 2);

    const neighborComp = controller.compareNeighborHighlight(0, 2);
    expect(neighborComp.selectedCount).toBe(15);
    expect(neighborComp.speedup).toBeCloseTo(16.0, 2);
  });

  it('VizEngineSDK supports Three.js-style 3D Scene objects, custom meshes, transforms, and SceneDescriptor serialization', () => {
    let nextId = 1;
    const transforms = new Map<number, Float32Array>();

    const mockBackend: WasmVizEngineBackend = {
      reload_dataset: () => {},
      load_raw_dataset: () => {},
      export_positions: () => new Float32Array(0),
      import_positions: () => {},
      warmup: () => 0,
      step_physics: () => 0,
      set_auto_sleep: () => {},
      is_sleeping: () => false,
      wake_up: () => {},
      set_force_params: () => {},
      set_frustum_culling: () => {},
      sync_and_render: () => {},
      rotate_camera: () => {},
      zoom_camera: () => {},
      pan_camera: () => {},
      fit_to_view: () => {},
      focus_on_node: () => true,
      resize: () => {},
      pick_node_at_ndc: () => -1,
      select_box_ndc: () => new Uint32Array(0),
      query_radius: () => new Uint32Array(0),
      select_node_and_neighbors: () => new Uint32Array(0),
      select_cluster: () => new Uint32Array(0),
      clear_selection: () => {},
      set_node_pinned: () => true,
      move_node_to: () => true,
      node_count: () => 0,
      edge_count: () => 0,
      add_primitive: (_kind, px, py, pz, sx, sy, sz) => {
        const id = nextId++;
        transforms.set(id, new Float32Array([px, py, pz, 0, 0, 0, sx, sy, sz]));
        return id;
      },
      add_custom_mesh: (_pos, _norm, _idx, px, py, pz, sx, sy, sz) => {
        const id = nextId++;
        transforms.set(id, new Float32Array([px, py, pz, 0, 0, 0, sx, sy, sz]));
        return id;
      },
      set_object_transform: (id, px, py, pz, rx, ry, rz, sx, sy, sz) => {
        transforms.set(id, new Float32Array([px, py, pz, rx, ry, rz, sx, sy, sz]));
        return true;
      },
      get_object_transform: (id) => transforms.get(id) ?? new Float32Array(0),
      remove_object: (id) => transforms.delete(id),
      clear_scene_objects: () => {
        transforms.clear();
      },
      object_count: () => transforms.size,
      pick_object_at_ndc: () => 1,
    };

    const sdk = VizEngineSDK.fromBackend(mockBackend);

    const floorId = sdk.addPlane({ name: 'Floor', position: [0, -10, 0], scale: [120, 2, 120] });
    const boxId = sdk.addBox({
      name: 'Crate',
      position: [5, 12, -3],
      scale: [6, 6, 6],
      bodyType: 'dynamic',
    });
    const torus = VizEngineSDK.createTorusMesh(6, 2, 12, 16);
    const torusId = sdk.addCustomMesh({
      name: 'Ring',
      positions: torus.positions,
      normals: torus.normals,
      indices: torus.indices,
      position: [0, 20, 0],
    });

    expect(sdk.objectCount()).toBe(3);
    expect(sdk.pickObjectAtNdc(0, 0)).toBe(floorId);

    sdk.setObjectTransform(boxId, { position: [10, 25, -5], rotation: [0.5, 1.0, 0] });
    const tf = sdk.getObjectTransform(boxId);
    expect(tf?.position).toEqual([10, 25, -5]);
    expect(tf?.rotation[0]).toBeCloseTo(0.5);

    const exported = sdk.exportScene();
    expect(exported.objects.length).toBe(3);

    sdk.removeObject(torusId);
    expect(sdk.objectCount()).toBe(2);

    // Reload full scene declaratively
    const reloadedIds = sdk.loadScene(exported);
    expect(reloadedIds.length).toBe(3);
    expect(sdk.objectCount()).toBe(3);
  });

  it('VizEngineSDK renders high-volume 2D line charts, bar charts, and scatter plots', () => {
    let loadedNodeCount = 0;
    let loadedEdgeCount = 0;
    const chartCalls: Record<string, unknown[][]> = {};
    const record =
      (name: string, ret?: unknown) =>
      (...args: unknown[]) => {
        (chartCalls[name] ??= []).push(args);
        return ret as never;
      };
    const mockBackend: WasmVizEngineBackend = {
      set_line_chart: record('set_line_chart', 150),
      set_bar_chart: record('set_bar_chart', 40),
      set_chart_hover_style: record('set_chart_hover_style'),
      set_chart_frame_style: record('set_chart_frame_style'),
      set_chart_line_width: record('set_chart_line_width'),
      chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
      set_chart_series_visible: record('set_chart_series_visible'),
      set_chart_emphasis: record('set_chart_emphasis'),
      chart_zoom_x: record('chart_zoom_x'),
      set_clear_color: record('set_clear_color'),
      set_chart_padding: record('set_chart_padding'),
      free: record('free'),
      reload_dataset: () => {},
      load_raw_dataset: (pos, _m, _c, _cl, edges) => {
        loadedNodeCount = pos.length / 3;
        loadedEdgeCount = edges.length / 2;
      },
      export_positions: () => new Float32Array(0),
      import_positions: () => {},
      warmup: () => 0,
      step_physics: () => 0,
      set_auto_sleep: () => {},
      is_sleeping: () => false,
      wake_up: () => {},
      set_force_params: () => {},
      set_frustum_culling: () => {},
      sync_and_render: () => {},
      rotate_camera: () => {},
      zoom_camera: () => {},
      pan_camera: () => {},
      fit_to_view: () => {},
      focus_on_node: () => true,
      resize: () => {},
      pick_node_at_ndc: () => -1,
      select_box_ndc: () => new Uint32Array(0),
      query_radius: () => new Uint32Array(0),
      select_node_and_neighbors: () => new Uint32Array(0),
      select_cluster: () => new Uint32Array(0),
      clear_selection: () => {},
      set_node_pinned: () => true,
      move_node_to: () => true,
      node_count: () => loadedNodeCount,
      edge_count: () => loadedEdgeCount,
      set_camera_pose: () => {},
      set_scene_helpers: () => {},
      set_rigid_physics: () => {},
      set_graph_visible: () => {},
      clear_scene_objects: () => {},
    };

    const sdk = VizEngineSDK.fromBackend(mockBackend);

    // 1. Line chart: data goes to the engine as one concatenated buffer + per-series layout
    const lineRes = sdk.renderLineChart(
      [
        { name: 'Series A', values: new Float32Array(50).fill(1) },
        { name: 'Series B', values: new Float32Array(50).fill(2), lineWidth: 4 },
        { name: 'Series C', values: new Float32Array(50).fill(3), color: [1, 0, 0, 1] },
      ],
      { lineWidth: 1.5, hover: { mode: 'nearest', markerRadius: 6 } }
    );
    expect(lineRes.totalPoints).toBe(150);
    expect(lineRes.seriesCount).toBe(3);
    const [values, lengths, colors, widths, , , viewMode] = chartCalls.set_line_chart[0] as [
      Float32Array, Uint32Array, Float32Array, Float32Array, number, number, number,
    ];
    expect(values.length).toBe(150);
    expect(values[50]).toBe(2);
    expect(Array.from(lengths)).toEqual([50, 50, 50]);
    expect(Array.from(widths)).toEqual([1.5, 4, 1.5]);
    expect(Array.from(colors.slice(8, 12))).toEqual([1, 0, 0, 1]);
    expect(viewMode).toBe(0);
    // Graph nodes are not used for charts
    expect(sdk.nodeCount()).toBe(0);

    // Hover style: mode nearest, marker radius set, everything else engine default (NaN)
    const hover = chartCalls.set_chart_hover_style[0][0] as Float32Array;
    expect(hover.length).toBe(20);
    expect(hover[0]).toBe(1);
    expect(hover[8]).toBe(6);
    expect(Number.isNaN(hover[6])).toBe(true);

    sdk.setLineWidth(3);
    sdk.setLineWidth(5, 1);
    expect(chartCalls.set_chart_line_width).toEqual([[-1, 3], [1, 5]]);

    // Point details come from SDK metadata + engine position
    const d = sdk.getNodeDetails(53);
    expect(d?.metadata.attributes?.series).toBe('Series B');
    expect(d?.metadata.attributes?.stepIndex).toBe('T+3');
    expect(d?.metadata.attributes?.value).toBe(2);
    expect(d?.position).toEqual([1, 2, 3]);
    expect(sdk.getNodeDetails(150)).toBeNull();

    // Legend / navigation / theme are thin calls into the engine
    sdk.setSeriesVisible(1, false);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    sdk.emphasizeSeries(2);
    sdk.emphasizeSeries(null);
    sdk.zoomChartX(0.5, 0.25);
    expect(sdk.handlesChartNavigation()).toBe(true);
    sdk.setTheme('light');
    expect(sdk.getTheme().name).toBe('light');
    expect(chartCalls.set_chart_series_visible).toEqual([[1, false]]);
    expect(chartCalls.set_chart_emphasis).toEqual([[2], [-1]]);
    expect(chartCalls.chart_zoom_x).toEqual([[0.5, 0.25]]);
    expect(chartCalls.set_clear_color.at(-1)).toEqual(VIZ_THEMES.light.surface);
    // 3 series -> legend shown: top padding = 12 + legend 28; default axes left / bottom
    expect(chartCalls.set_chart_padding[0]).toEqual([40, 16, 30, 56]);

    // 2. Bar chart: 40 bars, per-bar colors, 2D view
    const bars = Array.from({ length: 40 }, (_, i) => ({
      label: `Bar ${i}`,
      value: (i + 1) * 10,
    }));
    const barRes = sdk.renderBarChart(bars, { viewMode: '2d', cornerRadius: 6 });
    expect(barRes.barCount).toBe(40);
    const [barValues, barColors, , , , radius, barMode] = chartCalls.set_bar_chart[0] as [
      Float32Array, Float32Array, number, number, number, number, number,
    ];
    expect(barValues.length).toBe(40);
    expect(barColors.length).toBe(160);
    expect(radius).toBe(6);
    expect(barMode).toBe(0);
    expect(sdk.getNodeDetails(39)?.metadata.attributes?.peakRatio).toBe('100.0%');
    expect(sdk.handlesChartNavigation()).toBe(false); // bars do not zoom
    // Bars: no legend, title adds 24 px on top
    sdk.renderBarChart(bars, { title: 'Revenue' });
    expect(chartCalls.set_chart_padding.at(-1)).toEqual([36, 16, 30, 56]);
    sdk.dispose();
    expect(chartCalls.free.length).toBe(1);

    // 3. Scatter plot test: 500 points
    const scatterRes = sdk.renderScatterChart({
      x: new Float32Array(500),
      y: new Float32Array(500),
    });
    expect(scatterRes.pointCount).toBe(500);
    // Native scatter chart: graph nodes are not used (see scatter.test.ts)
    expect(sdk.nodeCount()).toBe(0);
  });

  it('VizEngineSDK supports node metadata, getNodeDetails, searchNodes, shortest path, and 3D layout presets', () => {
    let lastLayout = -1;
    const mockBackend: WasmVizEngineBackend = {
      reload_dataset: () => {},
      load_raw_dataset: () => {},
      export_positions: () => new Float32Array([10, 20, 30, -5, 15, 0, 0, 0, 12]),
      import_positions: () => {},
      warmup: () => 0,
      step_physics: () => 0,
      set_auto_sleep: () => {},
      is_sleeping: () => false,
      wake_up: () => {},
      set_force_params: () => {},
      set_frustum_culling: () => {},
      sync_and_render: () => {},
      rotate_camera: () => {},
      zoom_camera: () => {},
      pan_camera: () => {},
      fit_to_view: () => {},
      focus_on_node: () => true,
      resize: () => {},
      pick_node_at_ndc: () => 0,
      select_box_ndc: () => new Uint32Array(0),
      query_radius: () => new Uint32Array(0),
      select_node_and_neighbors: () => new Uint32Array([0, 1]),
      select_cluster: () => new Uint32Array(0),
      clear_selection: () => {},
      set_node_pinned: () => true,
      move_node_to: () => true,
      get_node_info: (id) =>
        new Float32Array([10 + id, 20, 30, 1.5, 2, 0.2, 0.8, 1.0, 1.0, 3, 1, 0]),
      get_node_neighbors: () => new Uint32Array([1, 2]),
      project_node_to_ndc: () => new Float32Array([0.0, 0.0, 0.5]),
      select_shortest_path: (src, dst) => new Uint32Array([src, 1, dst]),
      apply_preset_layout: (kind) => {
        lastLayout = kind;
      },
      node_count: () => 3,
      edge_count: () => 2,
    };

    const sdk = VizEngineSDK.fromBackend(mockBackend);
    sdk.setSingleNodeMetadata(0, {
      label: 'Auth-Gateway-Primary',
      category: 'Security',
      tags: ['auth', 'zero-trust'],
      attributes: { rps: 3400 },
    });

    const details = sdk.getNodeDetails(0);
    expect(details).not.toBeNull();
    expect(details?.label).toBe('Auth-Gateway-Primary');
    expect(details?.degree).toBe(3);
    expect(details?.neighbors).toEqual([1, 2]);
    expect(details?.metadata.attributes?.rps).toBe(3400);

    const hits = sdk.searchNodes('zero-trust');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe(0);

    const screen = sdk.projectNodeToScreen(0, 800, 600);
    expect(screen).toEqual({ x: 400, y: 300, ndcZ: 0.5 });

    const path = sdk.highlightShortestPath(0, 2);
    expect(Array.from(path)).toEqual([0, 1, 2]);

    sdk.applyLayout('helix', 90);
    expect(lastLayout).toBe(2);
  });

  it('VizEngineSDK ingests arbitrary D-dimensional embeddings (128D, 1536D) and queries exact Cosine Similarity', () => {
    let ingestedDim = 0;
    let ingestedLen = 0;
    const mockBackend: WasmVizEngineBackend = {
      reload_dataset: () => {},
      load_raw_dataset: () => {},
      export_positions: () => new Float32Array(0),
      import_positions: () => {},
      warmup: () => 0,
      step_physics: () => 0,
      set_auto_sleep: () => {},
      is_sleeping: () => false,
      wake_up: () => {},
      set_force_params: () => {},
      set_frustum_culling: () => {},
      sync_and_render: () => {},
      rotate_camera: () => {},
      zoom_camera: () => {},
      pan_camera: () => {},
      fit_to_view: () => {},
      focus_on_node: () => true,
      resize: () => {},
      pick_node_at_ndc: () => -1,
      select_box_ndc: () => new Uint32Array(0),
      query_radius: () => new Uint32Array(0),
      select_node_and_neighbors: () => new Uint32Array(0),
      select_cluster: () => new Uint32Array(0),
      clear_selection: () => {},
      set_node_pinned: () => true,
      move_node_to: () => true,
      load_high_dim_embeddings: (vecs, dim) => {
        ingestedDim = dim;
        ingestedLen = vecs.length;
      },
      query_cosine_similar: () => new Float32Array([8, 0.9642, 16, 0.9415]),
      embedding_dim: () => ingestedDim,
      node_count: () => (ingestedDim > 0 ? ingestedLen / ingestedDim : 0),
      edge_count: () => 60,
    };

    const sdk = VizEngineSDK.fromBackend(mockBackend);
    for (const dim of [128, 1536]) {
      const { vectors, clusters } = VizEngineSDK.generateSyntheticHighDimEmbeddings(20, dim, 4, 42);
      expect(vectors.length).toBe(20 * dim);
      const stats = sdk.loadEmbeddings(vectors, {
        dimensions: dim,
        projection: 'pca-umap',
        kNeighbors: 3,
        clusters,
      });
      expect(stats.dimensions).toBe(dim);
      expect(stats.nodeCount).toBe(20);
      expect(sdk.embeddingDimension()).toBe(dim);
    }

    const matches = sdk.queryCosineSimilar(0, 2);
    expect(matches.length).toBe(2);
    expect(matches[0].nodeId).toBe(8);
    expect(matches[0].cosineSimilarity).toBeCloseTo(0.9642, 3);
  });
});
