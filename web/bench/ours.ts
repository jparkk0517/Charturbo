/**
 * charturbo scenarios of the benchmark page: data (untimed) + one full render call per
 * scenario, and how the steady phase drives it (wheel / drag zoom-pan, hover sweep, streaming).
 */

import type { Charturbo } from '../src/index';
import * as gen from './data';

export type Interaction = 'zoom-x' | 'zoom-xy' | 'hover' | 'stream';

export interface OurScenario {
  id: string;
  /** Marks in the dataset (points, cells, bars, leaves, nodes) */
  size: number;
  interaction: Interaction;
  /** Builds the dataset (not timed) and returns the render call */
  prepare(): (sdk: Charturbo) => void;
  /** `stream`: called once per frame after the first render */
  stream?: (sdk: Charturbo, frame: number) => void;
}

const PADDING = { top: 36, right: 24, bottom: 36, left: 64 };

function line(id: string, total: number, count: number): OurScenario {
  return {
    id,
    size: total,
    interaction: 'zoom-x',
    prepare() {
      const series = gen.lineSeries(total, count).map((values, s) => ({ name: `S${s + 1}`, values }));
      return (sdk) => void sdk.renderLineChart(series, { title: id, padding: PADDING, lineWidth: 1 });
    },
  };
}

function scatter(id: string, n: number): OurScenario {
  return {
    id,
    size: n,
    interaction: 'zoom-xy',
    prepare() {
      const { x, y } = gen.scatter(n);
      return (sdk) => void sdk.renderScatterChart({ x, y }, { title: id, padding: PADDING, pointRadius: 1.5, opacity: 0.6 });
    },
  };
}

function heatmap(id: string, size: number): OurScenario {
  return {
    id,
    size: size * size,
    interaction: 'zoom-xy',
    prepare() {
      const values = gen.heatmap(size);
      return (sdk) =>
        void sdk.renderHeatmap({ cols: size, rows: size, values, xExtent: [0, size], yExtent: [0, size] }, { title: id, padding: { ...PADDING, right: 72 } });
    },
  };
}

const STREAM_WINDOW = 1_000_000;
const STREAM_CHUNK = 10_000;

export const OUR_SCENARIOS: OurScenario[] = [
  line('line-100k-1s', 100_000, 1),
  line('line-100k-10s', 100_000, 10),
  line('line-1m-1s', 1_000_000, 1),
  line('line-1m-10s', 1_000_000, 10),
  line('line-10m-1s', 10_000_000, 1),
  line('line-10m-10s', 10_000_000, 10),
  scatter('scatter-1m', 1_000_000),
  scatter('scatter-5m', 5_000_000),
  {
    id: 'area-stacked-1m',
    size: 1_000_000,
    interaction: 'zoom-x',
    prepare() {
      const series = gen.lineSeries(1_000_000, 4).map((v, s) => ({ name: `S${s + 1}`, values: v.map((y) => Math.abs(y) + 10) }));
      return (sdk) => void sdk.renderAreaChart(series, { mode: 'stacked', title: 'area-stacked-1m', padding: PADDING });
    },
  },
  {
    id: 'bar-10k',
    size: 10_000,
    interaction: 'hover',
    prepare() {
      const { labels, values } = gen.bars(10_000);
      const items = labels.map((label, i) => ({ label, value: values[i] }));
      return (sdk) => void sdk.renderBarChart(items, { title: 'bar-10k', padding: PADDING });
    },
  },
  heatmap('heatmap-2048', 2048),
  heatmap('heatmap-4096', 4096),
  {
    id: 'candle-1m',
    size: 1_000_000,
    interaction: 'zoom-x',
    prepare() {
      const ohlc = gen.candles(1_000_000);
      return (sdk) => void sdk.renderCandlestickChart(ohlc, { title: 'candle-1m', padding: PADDING });
    },
  },
  {
    id: 'stream-1m',
    size: STREAM_WINDOW,
    interaction: 'stream',
    prepare() {
      const values = gen.walk(1, STREAM_WINDOW);
      return (sdk) => void sdk.renderLineChart([{ name: 'Live', values }], { title: 'stream-1m', padding: PADDING, lineWidth: 1 });
    },
    stream: (() => {
      // Pre-generated chunks (cycled): appends never wait on the PRNG
      const chunks = Array.from({ length: 8 }, (_, k) => gen.walk(100 + k, STREAM_CHUNK));
      return (sdk: Charturbo, frame: number) => {
        sdk.appendSeriesData(0, chunks[frame % chunks.length], undefined, { maxPoints: STREAM_WINDOW });
      };
    })(),
  },
  {
    id: 'treemap-100k',
    size: 100_000,
    interaction: 'hover',
    prepare() {
      const data = gen.tree(100_000);
      return (sdk) => void sdk.renderTreemap(data, { title: 'treemap-100k', legend: false });
    },
  },
  {
    id: 'sankey-10k',
    size: 10_000,
    interaction: 'hover',
    prepare() {
      const data = gen.sankey(10_000);
      return (sdk) => void sdk.renderSankey(data, { title: 'sankey-10k', labels: false });
    },
  },
];

/** Datasets of the cross-library comparison (same generators / seeds as above). */
export const COMPARE_IDS = ['line-1m-1s', 'line-10m-1s', 'scatter-1m', 'bar-10k'] as const;
export type CompareId = (typeof COMPARE_IDS)[number];
