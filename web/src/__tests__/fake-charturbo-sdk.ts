/**
 * `Charturbo` stand-in for the React / Vue wrapper tests (`vi.mock('../sdk/charturbo')`):
 * `create` returns a pending promise settled by the test (`resolveNext` / `rejectNext`), every
 * method is a spy, and `emit` fires the handlers registered with `on`.
 */
import { vi } from 'vitest';

type Handler = (payload: unknown) => void;

export class FakeSDK {
  static instances: FakeSDK[] = [];
  private static pending: { resolve: (s: FakeSDK) => void; reject: (e: unknown) => void; canvas: HTMLCanvasElement }[] = [];

  static create = vi.fn(
    (canvas: HTMLCanvasElement, _options?: unknown) =>
      new Promise<FakeSDK>((resolve, reject) => FakeSDK.pending.push({ resolve, reject, canvas }))
  );

  static reset(): void {
    FakeSDK.instances = [];
    FakeSDK.pending = [];
    FakeSDK.create.mockClear();
  }

  static pendingCount(): number {
    return FakeSDK.pending.length;
  }

  /** Settles the oldest pending `create` with a new instance. */
  static resolveNext(): FakeSDK {
    const p = FakeSDK.pending.shift();
    if (!p) throw new Error('no pending create');
    const sdk = new FakeSDK(p.canvas);
    FakeSDK.instances.push(sdk);
    p.resolve(sdk);
    return sdk;
  }

  static rejectNext(err: unknown): void {
    const p = FakeSDK.pending.shift();
    if (!p) throw new Error('no pending create');
    p.reject(err);
  }

  readonly handlers = new Map<string, Set<Handler>>();
  /** Call order of the chart-facing methods */
  readonly calls: string[] = [];
  readonly detach = vi.fn();
  disposed = false;

  constructor(readonly canvas: HTMLCanvasElement) {}

  private spy(name: string) {
    return vi.fn((..._args: unknown[]) => {
      this.calls.push(name);
    });
  }

  renderLineChart = this.spy('renderLineChart');
  renderAreaChart = this.spy('renderAreaChart');
  renderBandChart = this.spy('renderBandChart');
  renderErrorBarChart = this.spy('renderErrorBarChart');
  renderImpulseChart = this.spy('renderImpulseChart');
  renderPointCloud3D = this.spy('renderPointCloud3D');
  renderSurface3D = this.spy('renderSurface3D');
  appendPointCloud3D = this.spy('appendPointCloud3D');
  updateSurface3D = this.spy('updateSurface3D');
  renderBarChart = this.spy('renderBarChart');
  renderGroupedBarChart = this.spy('renderGroupedBarChart');
  renderScatterChart = this.spy('renderScatterChart');
  renderCandlestickChart = this.spy('renderCandlestickChart');
  renderOhlcChart = this.spy('renderOhlcChart');
  renderHistogram = this.spy('renderHistogram');
  renderHeatmap = this.spy('renderHeatmap');
  renderBoxPlot = this.spy('renderBoxPlot');
  renderPieChart = this.spy('renderPieChart');
  renderComboChart = this.spy('renderComboChart');
  renderRadarChart = this.spy('renderRadarChart');
  renderGauge = this.spy('renderGauge');
  renderFunnelChart = this.spy('renderFunnelChart');
  renderCalendarHeatmap = this.spy('renderCalendarHeatmap');
  renderChordChart = this.spy('renderChordChart');
  renderParallelChart = this.spy('renderParallelChart');
  renderWaterfallChart = this.spy('renderWaterfallChart');
  renderTreemap = this.spy('renderTreemap');
  renderSunburst = this.spy('renderSunburst');
  renderSankey = this.spy('renderSankey');
  renderSparkline = this.spy('renderSparkline');
  renderThemeRiverChart = this.spy('renderThemeRiverChart');
  setTheme = this.spy('setTheme');
  setSync = this.spy('setSync');
  render = this.spy('render');
  enableNodeInteractions = vi.fn((..._args: unknown[]) => {
    this.calls.push('enableNodeInteractions');
    return this.detach;
  });
  dispose = vi.fn(() => {
    this.disposed = true;
    this.calls.push('dispose');
  });

  on = vi.fn((event: string, handler: Handler) => {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  });

  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }

  emit(event: string, payload: unknown): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(payload);
  }
}

/** Module shape returned by the `vi.mock` factory */
export const fakeSdkModule = { Charturbo: FakeSDK };

/** Lets pending promise callbacks (create -> ready) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
