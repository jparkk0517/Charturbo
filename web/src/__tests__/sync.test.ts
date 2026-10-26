import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameScheduler, VizHoverEvent, VizRange } from '../sdk/chart-events';
import { connectCharts, joinSyncGroup, leaveSyncGroup, syncMembership, type ChartSyncMember } from '../sdk/chart-sync';
// The a11y layer has its own tests and needs a full DOM: replaced by an inert stand-in
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));

import { VizEngineSDK, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

/** Manual frame scheduler: `run()` fires the pending frame callbacks. */
function frames() {
  let queue: (() => void)[] = [];
  const scheduler: FrameScheduler = {
    request: (cb) => queue.push(cb),
    cancel: () => (queue = []),
  };
  return {
    scheduler,
    pending: () => queue.length,
    run: () => {
      const q = queue;
      queue = [];
      q.forEach((cb) => cb());
    },
  };
}

/** Chart stand-in: records what the group asks of it; `domain` clamps `setXRange` like the engine. */
function member(domain: [number, number] = [0, 100]) {
  const handlers: { hover: ((e: VizHoverEvent) => void)[]; rangechange: ((r: VizRange) => void)[] } = {
    hover: [],
    rangechange: [],
  };
  let range: [number, number] = [...domain];
  const log = { hoverAt: [] as (number | null)[], tooltip: [] as boolean[], setX: [] as [number, number][], renders: 0 };
  let hoverX: number | null = null;
  const m: ChartSyncMember = {
    on: ((event: 'hover' | 'rangechange', h: never) => {
      handlers[event].push(h);
      return () => (handlers[event] = handlers[event].filter((x) => x !== h) as never);
    }) as ChartSyncMember['on'],
    getHoverX: () => hoverX,
    hoverAtX: (x, o) => {
      log.hoverAt.push(x);
      log.tooltip.push(!!o?.tooltip);
      return x !== null;
    },
    getXRange: () => [...range],
    setXRange: (lo, hi) => {
      log.setX.push([lo, hi]);
      const next: [number, number] = [Math.max(domain[0], lo), Math.min(domain[1], hi)];
      const changed = next[0] !== range[0] || next[1] !== range[1];
      range = next;
      return changed;
    },
    render: () => log.renders++,
  };
  return {
    m,
    log,
    /** Pointer hover at data x (null = leave), as `enableNodeInteractions` reports it */
    hover(x: number | null) {
      hoverX = x;
      const chart = x === null ? null : ({ chartType: 'line', index: 0, xLabel: '', items: [], details: null } as never);
      handlers.hover.forEach((h) => h({ chart, node: null, clientX: 0, clientY: 0 }));
    },
    /** `'rangechange'` with the current range (the SDK emits it one frame after a zoom) */
    emitRange() {
      handlers.rangechange.forEach((h) => h({ xMin: range[0], xMax: range[1] }));
    },
    zoom(lo: number, hi: number) {
      range = [lo, hi];
      this.emitRange();
    },
    listeners: () => handlers.hover.length + handlers.rangechange.length,
  };
}

describe('chart sync groups', () => {
  it('relays the hovered data x to the other members once per frame; leaving clears them', () => {
    const f = frames();
    const [a, b, c] = [member(), member(), member()];
    const disconnect = connectCharts([a.m, b.m, c.m], {}, f.scheduler);
    a.hover(10);
    a.hover(11);
    a.hover(12);
    expect(f.pending()).toBe(1);
    expect(b.log.hoverAt).toEqual([]);
    f.run();
    // Only the latest x of the frame, no tooltip by default, origin untouched
    expect(b.log.hoverAt).toEqual([12]);
    expect(c.log.hoverAt).toEqual([12]);
    expect(b.log.tooltip).toEqual([false]);
    expect(a.log.hoverAt).toEqual([]);
    expect([b.log.renders, c.log.renders, a.log.renders]).toEqual([1, 1, 0]);

    a.hover(null);
    f.run();
    expect(b.log.hoverAt).toEqual([12, null]);
    expect(c.log.hoverAt).toEqual([12, null]);
    // Nothing shown anymore: a second leave is a no-op
    a.hover(null);
    f.run();
    expect(b.log.hoverAt.length).toBe(2);
    disconnect();
  });

  it('switching the hovered chart moves the cursor without echoing it back', () => {
    const f = frames();
    const [a, b] = [member(), member()];
    const disconnect = connectCharts([a.m, b.m], {}, f.scheduler);
    a.hover(5);
    f.run();
    // The pointer moves to b: a leaves (clears b), b hovers (drives a)
    a.hover(null);
    b.hover(7);
    f.run();
    expect(a.log.hoverAt).toEqual([7]);
    expect(b.log.hoverAt).toEqual([5]);
    // hoverAtX never emits 'hover', so nothing else is queued
    expect(f.pending()).toBe(0);
    disconnect();
  });

  it('zoom relays in data units; the echo of a synced range does not loop back', () => {
    const f = frames();
    // b has a narrower domain: the engine clamps the relayed range
    const [a, b] = [member([0, 100]), member([20, 80])];
    const disconnect = connectCharts([a.m, b.m], {}, f.scheduler);
    a.zoom(10, 50);
    f.run();
    expect(b.log.setX).toEqual([[10, 50]]);
    expect(b.m.getXRange()).toEqual([20, 50]);
    expect(b.log.renders).toBe(1);
    // b's own 'rangechange' for that move (clamped, one frame later) is recognized as the echo
    b.emitRange();
    expect(f.pending()).toBe(0);
    f.run();
    expect(a.log.setX).toEqual([]);
    // A real zoom on b afterwards goes the other way
    b.zoom(30, 40);
    f.run();
    expect(a.log.setX).toEqual([[30, 40]]);
    // ...and the echo from a is dropped too
    a.emitRange();
    f.run();
    expect(b.log.setX.length).toBe(1);
    disconnect();
  });

  it('a relayed range that does not move the follower arms no echo filter', () => {
    const f = frames();
    const [a, b] = [member([0, 100]), member([0, 10])];
    const disconnect = connectCharts([a.m, b.m], {}, f.scheduler);
    // b already shows its whole domain: setXRange returns false (no 'rangechange' will follow)
    a.zoom(0, 100);
    f.run();
    expect(b.log.renders).toBe(0);
    // A later user zoom on b to the same numbers is still relayed
    b.zoom(0, 10);
    f.run();
    expect(a.log.setX).toEqual([[0, 10]]);
    disconnect();
  });

  it('flags: cursor / x off per member or per group; tooltip on followers', () => {
    const f = frames();
    const [a, b, c] = [member(), member(), member()];
    joinSyncGroup(a.m, { key: 'flags' }, f.scheduler);
    joinSyncGroup(b.m, { key: 'flags', x: false }, f.scheduler);
    joinSyncGroup(c.m, { key: 'flags' }, f.scheduler);
    const disconnect = connectCharts('flags', { tooltip: true, cursor: false }, f.scheduler);
    expect(syncMembership(b.m)).toEqual({ key: 'flags', cursor: false, x: false, tooltip: true });
    a.hover(3);
    a.zoom(10, 20);
    f.run();
    expect(b.log.hoverAt).toEqual([]); // group: cursor off
    expect(b.log.setX).toEqual([]); // member: x off
    expect(c.log.setX).toEqual([[10, 20]]);
    disconnect();
    // Disbanded: every member left
    expect([syncMembership(a.m), syncMembership(b.m), a.listeners()]).toEqual([null, null, 0]);

    joinSyncGroup(a.m, { key: 'tip' }, f.scheduler);
    joinSyncGroup(b.m, { key: 'tip', tooltip: true }, f.scheduler);
    a.hover(4);
    f.run();
    expect(b.log.tooltip.at(-1)).toBe(true);
    leaveSyncGroup(a.m);
    leaveSyncGroup(b.m);
  });

  it('disconnect unsubscribes, clears synced cursors, and drops pending work', () => {
    const f = frames();
    const [a, b] = [member(), member()];
    const disconnect = connectCharts([a.m, b.m], {}, f.scheduler);
    a.hover(5);
    f.run();
    a.zoom(1, 2);
    disconnect();
    // b's synced cursor is cleared immediately; the queued zoom never lands
    expect(b.log.hoverAt).toEqual([5, null]);
    f.run();
    expect(b.log.setX).toEqual([]);
    expect([a.listeners(), b.listeners()]).toEqual([0, 0]);
    a.hover(9);
    f.run();
    expect(b.log.hoverAt.length).toBe(2);
    disconnect(); // idempotent
  });

  it('joining another group leaves the previous one', () => {
    const f = frames();
    const [a, b, c] = [member(), member(), member()];
    joinSyncGroup(a.m, { key: 'one' }, f.scheduler);
    joinSyncGroup(b.m, { key: 'one' }, f.scheduler);
    const leaveA = joinSyncGroup(a.m, { key: 'two' }, f.scheduler);
    joinSyncGroup(c.m, { key: 'two' }, f.scheduler);
    expect(a.listeners()).toBe(2);
    a.hover(1);
    f.run();
    expect(b.log.hoverAt).toEqual([]);
    expect(c.log.hoverAt).toEqual([1]);
    leaveA();
    expect(syncMembership(a.m)).toBeNull();
    leaveSyncGroup(b.m);
    leaveSyncGroup(c.m);
  });
});

/** Engine stand-in for one chart: data-x hover / range calls are recorded. */
function syncBackend(domain: [number, number]) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let x = [...domain];
  let hoverX = NaN;
  const backend: WasmVizEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    chart_series_count: () => 1,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: record('set_clear_color'),
    set_node_hover_style: record('set_node_hover_style'),
    chart_zoom_x: (factor: number) => {
      const mid = (x[0] + x[1]) / 2;
      const half = ((x[1] - x[0]) * factor) / 2;
      x = [mid - half, mid + half];
    },
    chart_range: () => new Float64Array([x[0], x[1], NaN, NaN]),
    chart_set_x_range: (lo: number, hi: number) => {
      record('chart_set_x_range')(lo, hi);
      const next = [Math.max(domain[0], lo), Math.min(domain[1], hi)];
      const changed = next[0] !== x[0] || next[1] !== x[1];
      x = next;
      return changed;
    },
    // Pointer hit at sample 2 (global id 2) whose x is 1.7e12 + 2 min
    chart_hover_at_ndc: () => {
      hoverX = 1.7e12 + 120_000;
      return new Float64Array([0, 0, 1, 0, 2, 6, 2]);
    },
    chart_clear_hover: () => {
      record('chart_clear_hover')();
      hoverX = NaN;
    },
    chart_hover_x: () => hoverX,
    chart_hover_at_data_x: (v: number) => {
      record('chart_hover_at_data_x')(v);
      return new Float64Array([0, 0, 1, 0, 1, 5, 1]);
    },
    project_node_to_ndc: () => new Float32Array([0, 0]),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([56, 16, 200, 100, 0]),
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
    sync_and_render: record('sync_and_render'),
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
    set_camera_pose: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    clear_scene_objects: () => {},
  };
  return { backend, calls };
}

function timeSdk(domain: [number, number]) {
  const mock = syncBackend(domain);
  const sdk = VizEngineSDK.fromBackend(mock.backend);
  const t0 = 1.7e12;
  sdk.renderLineChart([{ name: 'A', values: [1, 2, 6, 4], x: [0, 1, 2, 3].map((i) => t0 + i * 60_000) }], {
    axes: { x: { type: 'time' } },
  });
  return { sdk, ...mock };
}

function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers };
}

describe('VizEngineSDK.connect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pointer hover on one chart hovers the other at the same epoch-ms x', () => {
    const t0 = 1.7e12;
    const a = timeSdk([t0, t0 + 180_000]);
    const b = timeSdk([t0, t0 + 180_000]);
    const { canvas, handlers } = fakeCanvas();
    a.sdk.enableNodeInteractions(canvas, { builtInTooltip: false });
    const disconnect = VizEngineSDK.connect([a.sdk, b.sdk]);
    expect(b.sdk.getSync()).toMatchObject({ cursor: true, x: true, tooltip: false });

    handlers.pointermove({ buttons: 0, clientX: 100, clientY: 50 });
    expect(a.sdk.getHoverX()).toBe(t0 + 120_000);
    expect(b.calls.chart_hover_at_data_x).toBeUndefined(); // next frame
    vi.advanceTimersByTime(20);
    expect(b.calls.chart_hover_at_data_x).toEqual([[t0 + 120_000]]);
    const renders = b.calls.sync_and_render.length;
    expect(renders).toBeGreaterThan(0);
    expect(a.calls.chart_hover_at_data_x).toBeUndefined();

    handlers.pointerleave({ pointerType: 'mouse' });
    vi.advanceTimersByTime(20);
    expect(b.calls.chart_clear_hover?.length).toBe(1);
    expect(b.calls.sync_and_render.length).toBe(renders + 1);
    disconnect();
    expect(b.sdk.getSync()).toBeNull();
  });

  it('zoom syncs without a feedback loop and stops after disconnect', () => {
    const a = timeSdk([0, 100]);
    const b = timeSdk([0, 50]);
    const disconnect = VizEngineSDK.connect([a.sdk, b.sdk], { cursor: false });
    a.sdk.zoomChartX(0.5); // a: [25, 75]
    a.sdk.zoomChartX(0.5); // a: [37.5, 62.5] (same frame: one 'rangechange')
    vi.advanceTimersByTime(200);
    // b gets one clamped call; a never hears back from b's echo
    expect(b.calls.chart_set_x_range).toEqual([[37.5, 62.5]]);
    expect(b.sdk.getXRange()).toEqual([37.5, 50]);
    expect(a.calls.chart_set_x_range).toBeUndefined();

    disconnect();
    a.sdk.zoomChartX(0.5);
    vi.advanceTimersByTime(200);
    expect(b.calls.chart_set_x_range.length).toBe(1);
  });

  it('per-instance sync key; dispose leaves the group', () => {
    const a = timeSdk([0, 100]);
    const b = timeSdk([0, 100]);
    a.sdk.setSync({ key: 'dash' });
    b.sdk.setSync({ key: 'dash', cursor: false });
    expect(a.sdk.getSync()).toEqual({ key: 'dash', cursor: true, x: true, tooltip: false });
    b.sdk.setXRange(10, 20);
    vi.advanceTimersByTime(200);
    expect(a.calls.chart_set_x_range).toEqual([[10, 20]]);
    b.sdk.dispose();
    expect(b.sdk.getSync()).toBeNull();
    a.sdk.setXRange(0, 30);
    vi.advanceTimersByTime(200);
    expect(b.calls.chart_set_x_range).toEqual([[10, 20]]);
    a.sdk.setSync(null);
  });

  it('hoverAtX: data x / Date reach the engine; null clears; no chart is a no-op', () => {
    const a = timeSdk([0, 100]);
    expect(a.sdk.hoverAtX(5)).toBe(true);
    expect(a.calls.chart_hover_at_data_x).toEqual([[5]]);
    expect(a.sdk.hoverAtX(null)).toBe(false);
    expect(a.calls.chart_clear_hover.length).toBe(1);
    expect(a.sdk.hoverAtX(new Date(7))).toBe(true);
    expect(a.calls.chart_hover_at_data_x.at(-1)).toEqual([7]);
    expect(VizEngineSDK.fromBackend(syncBackend([0, 1]).backend).hoverAtX(1)).toBe(false);
  });
});
