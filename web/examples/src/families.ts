/** Pages of the examples site (one HTML page per family, demos in src/demos/<id>/). */
export interface Family {
  id: string;
  title: string;
  description: string;
}

export const FAMILIES: Family[] = [
  { id: 'line', title: 'Line · Area · Streaming', description: '1M-point lines (M4 decimation), stacked areas on a time axis, line styles with bands, live streaming.' },
  { id: 'bar', title: 'Bar · Horizontal · Labels', description: 'Grouped / stacked / percent bars, horizontal bars with data labels and error bars, histograms.' },
  { id: 'scatter', title: 'Scatter · Brush', description: '60k-point scatter with rectangle brush selection, bubble chart with per-point sizes.' },
  { id: 'candlestick', title: 'Candlestick · Navigator', description: 'OHLC with volume and pixel-column aggregation, range navigator under a long time series.' },
  { id: 'heatmap', title: 'Heatmap', description: 'GPU texture heatmap with color bar and switchable color scales.' },
  { id: 'box', title: 'Box plot · Violin', description: 'Per-group statistics in O(n), Tukey whiskers, outliers, KDE violins.' },
  { id: 'pie', title: 'Pie · Donut', description: 'Pie with outside labels and leader lines, donut with center total.' },
  { id: 'combo', title: 'Combo', description: 'Stacked bars, area and a dashed line on a right axis in one plot.' },
  { id: 'business', title: 'Radar · Gauge · Funnel · Waterfall', description: 'Business charts: radar, live gauge with status bands, conversion funnel, waterfall with subtotals.' },
  { id: 'hierarchy', title: 'Treemap · Sunburst · Sankey', description: 'Hierarchies with click drill-down and energy flows.' },
  { id: 'graph', title: '3D Graph · Network', description: 'Force-directed 3D networks up to 20k nodes (Barnes-Hut): metadata tooltips, neighbor highlight, layout presets, shortest paths, search.' },
  { id: 'embeddings', title: 'Embeddings · Similarity', description: '1536-dim embeddings projected to 3D (PCA / UMAP-style / random projection) with cosine k-NN edges and top-k similarity queries.' },
  { id: 'scene', title: '3D Scene · Physics', description: 'Primitives with PBR-style materials and lighting, rigid-body drops onto a floor, raycast picking.' },
  { id: 'sparklines', title: 'Sparklines grid', description: '24 sparklines on one shared GPU device (VizDevice).' },
  { id: 'animation', title: 'Animations', description: 'Opt-in enter and update tweens computed in Rust.' },
  { id: 'export', title: 'SVG · PDF · PNG export', description: 'Vector SVG, one-page PDF and PNG export including the DOM labels.' },
  { id: 'react', title: 'React', description: '<VizChart> component from viz-engine-sdk/react with memoized props.' },
  { id: 'vue', title: 'Vue', description: '<VizChart> component from viz-engine-sdk/vue with shallowRef data.' },
];

/** Top navigation shared by the gallery and the family pages. */
export function renderHeader(active: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'site-header';
  const brand = document.createElement('a');
  brand.href = './index.html';
  brand.className = 'brand';
  brand.textContent = 'viz-engine-sdk examples';
  const nav = document.createElement('nav');
  for (const f of FAMILIES) {
    const a = document.createElement('a');
    a.href = `./${f.id}.html`;
    a.textContent = f.title.split(' · ')[0];
    if (f.id === active) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  header.append(brand, nav);
  return header;
}
