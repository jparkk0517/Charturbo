---
layout: home

hero:
  name: Charturbo
  text: GPU-accelerated charts for the web
  tagline: Zoom and pan 1–10 million points at 60 FPS. Rust + WebGPU, with an automatic WebGL2 fallback.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Chart Manual
      link: /charts/line
    - theme: alt
      text: Live Examples
      link: https://jparkk0517.github.io/Charturbo/

features:
  - title: Fast on big data
    details: M4 decimation, hit-testing, stacking and tick layout run in Rust (WebAssembly) and draw on the GPU. The DOM only carries labels, legend and tooltip.
  - title: 25+ chart types
    details: Line, area, bar, scatter, candlestick, heatmap, box/violin, pie, radar, gauge, funnel, waterfall, treemap, sunburst, sankey, sparkline and 3D views.
  - title: Built for real apps
    details: Real-time streaming, time and log axes, zoom and pinch, range navigator, brush selection, dashboard sync and PNG/SVG/PDF export.
  - title: Accessible and multilingual
    details: Automatic summaries, data tables and keyboard navigation in English, Korean and Simplified Chinese.
  - title: React and Vue
    details: First-party components with full TypeScript types.
  - title: 3D at scale
    details: Barnes-Hut network graphs, embedding projection with cosine similarity search, and a 3D scene with rigid-body physics.
---
