import { Charturbo, type ThemeRiverDatum } from 'charturbo';

export const meta = {
  title: 'ThemeRiver (streamgraph)',
  description:
    '[date, value, name] rows become streams around a wiggle baseline (d3 stackOffsetWiggle). Hover lists every stream at that date and emphasizes the one under the pointer; legend toggles recompute the baseline.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  const day = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  const topics = ['Rust', 'WebGPU', 'WASM', 'TypeScript', 'Shaders', 'Charts'];
  const rows: ThemeRiverDatum[] = [];
  topics.forEach((name, k) => {
    for (let i = 0; i < 60; i++) {
      // Each topic swells once at its own time over a small steady interest
      const peak = 8 + k * 9;
      const value = 4 + 30 * Math.exp(-(((i - peak) / (6 + k)) ** 2)) + 3 * Math.sin(i / 4 + k);
      rows.push([new Date(start + i * day), Math.max(0, value), name]);
    }
  });

  sdk.renderThemeRiverChart(rows, {
    offset: 'wiggle', // 'silhouette' | 'zero'
    order: 'insideOut', // 'none' keeps the input order
    title: 'Mentions by topic',
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true, tooltip: { sort: 'desc', valueFormatter: ',.0f' } });
  sdk.render();
  return sdk;
}
