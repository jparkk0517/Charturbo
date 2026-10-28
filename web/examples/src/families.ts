import { themeControl } from './theme';

/** Pages of the examples site (one HTML page per family, demos in src/demos/<id>/). */
export interface Family {
  id: string;
  title: string;
  description: string;
}

export const FAMILIES: Family[] = [
  { id: 'scientific3d', title: 'PointCloud3D · Surface3D', description: 'XYZ clouds and Y-up height grids with fixed axes, data aspect, orthographic projection, scalar colors, holes, height contours and live streaming.' },
  { id: 'line', title: 'Line · Area · Band · ErrorBar · Impulse', description: '1M-point lines, stacked areas, standalone bands, scientific error bars, event stems and live streaming.' },
  { id: 'bar', title: 'Bar · Horizontal · Labels', description: 'Grouped / stacked / percent bars, horizontal bars with data labels and error bars, histograms.' },
  { id: 'scatter', title: 'Scatter · Brush', description: '60k-point scatter with rectangle brush selection, bubble chart with per-point sizes.' },
  { id: 'candlestick', title: 'Candlestick · OHLC · Navigator', description: 'Candles and independent OHLC bars with volume and pixel-column aggregation, range navigator under a long time series.' },
  { id: 'heatmap', title: 'Heatmap', description: 'GPU texture heatmap with color bar and switchable color scales.' },
  { id: 'box', title: 'Box plot · Violin', description: 'Per-group statistics in O(n), Tukey whiskers, outliers, KDE violins.' },
  { id: 'pie', title: 'Pie · Donut · Rose', description: 'Pie with outside labels and leader lines, donut with center total, Nightingale rose.' },
  { id: 'combo', title: 'Combo', description: 'Stacked bars, area and a dashed line on a right axis in one plot.' },
  { id: 'business', title: 'Radar · Gauge · Funnel · Waterfall', description: 'Business charts: radar, live gauge with status bands, conversion funnel, waterfall with subtotals.' },
  { id: 'hierarchy', title: 'Treemap · Sunburst · Sankey', description: 'Hierarchies with click drill-down and energy flows.' },
  { id: 'graph', title: '3D Graph · Network', description: 'Force-directed 3D networks up to 20k nodes (Barnes-Hut): metadata tooltips, neighbor highlight, layout presets, shortest paths, search.' },
  { id: 'embeddings', title: 'Embeddings · Similarity', description: '1536-dim embeddings projected to 3D (PCA / UMAP-style / random projection) with cosine k-NN edges and top-k similarity queries.' },
  { id: 'scene', title: '3D Scene · Physics', description: 'Primitives with PBR-style materials and lighting, rigid-body drops onto a floor, raycast picking.' },
  { id: 'sparklines', title: 'Sparklines grid', description: '24 sparklines on one shared GPU device (CharturboDevice).' },
  { id: 'animation', title: 'Animations', description: 'Opt-in enter and update tweens computed in Rust.' },
  { id: 'export', title: 'SVG · PDF · PNG export', description: 'Vector SVG, one-page PDF and PNG export including the DOM labels.' },
  { id: 'react', title: 'React', description: '<CharturboChart> component from charturbo/react with memoized props.' },
  { id: 'vue', title: 'Vue', description: '<CharturboChart> component from charturbo/vue with shallowRef data.' },
];

/** Top navigation shared by the gallery and the family pages. */
export function renderHeader(active: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'site-header';
  const brand = document.createElement('a');
  brand.href = './index.html';
  brand.className = 'brand';
  brand.textContent = 'Charturbo';
  const nav = document.createElement('nav');
  const gallery = document.createElement('a');
  gallery.href = './gallery.html';
  gallery.textContent = 'Examples';
  if (active === 'gallery') gallery.setAttribute('aria-current', 'page');
  nav.appendChild(gallery);
  const benchmarks = document.createElement('a');
  benchmarks.href = './benchmarks.html';
  benchmarks.textContent = 'Benchmarks';
  if (active === 'benchmarks') benchmarks.setAttribute('aria-current', 'page');
  nav.appendChild(benchmarks);
  for (const f of FAMILIES) {
    const a = document.createElement('a');
    a.href = `./${f.id}.html`;
    a.textContent = f.title.split(' · ')[0];
    if (f.id === active) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  header.append(brand, nav, themeControl());
  return header;
}
