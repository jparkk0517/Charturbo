# viz-engine-sdk benchmark results

2026-10-26T07:40:28.358Z · Apple M1 · 16384.0 MB RAM · Darwin 24.1.0 (darwin arm64) · Chrome/156.0.8078.48
WebGPU adapter: apple / metal-3 · WebGL2: ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)
reps 5 (+1 warmup) · steady phase 3000 ms · canvas 960x540 CSS px @ DPR 1 · idle rAF interval median 16.7 ms

## viz-engine-sdk scenarios

TTFF = render call -> second rAF after it (frame presented); call = synchronous render call; pixels = render + GPU read-back of 1 px (GPU work finished). Steady = rAF interval during the interaction (wheel+drag zoom/pan, hover sweep or streaming); work = JS+wasm time per frame. Memory after GC.

| scenario | backend | TTFF med (p95) ms | call ms | pixels ms | steady med / p95 / max ms | dropped | work med ms | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | wasm MB | GPU MB | upload B/frame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| line-100k-1s | webgpu | 16.8 (16.9) | 3.9 | 6.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 2.1 | 0.6 / 16.7 / 16.7 | 8.7 | 3.1 | 0.7 | 154024 |
| line-100k-10s | webgpu | 16.7 (16.9) | 5.8 | 9.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 2.4 | 0.8 / 16.7 / 16.7 | 9.1 | 8.4 | 2.3 | 647960 |
| line-1m-1s | webgpu | 16.7 (16.8) | 10.5 | 15.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 2.5 | 0.6 / 16.7 / 16.7 | 12.1 | 6.5 | 0.7 | 271476 |
| line-1m-10s | webgpu | 17.1 (22.2) | 16.7 | 17.5 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 3.5 | 1.0 / 16.7 / 16.7 | 16.0 | 9.6 | 2.3 | 1543502 |
| line-10m-1s | webgpu | 91.8 (92.6) | 91.4 | 92.6 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 6.4 | 0.5 / 16.7 / 16.7 | 46.5 | 40.8 | 0.7 | 307561 |
| line-10m-10s | webgpu | 72.8 (92.0) | 72.5 | 74.4 | 16.7 / 16.7 / 33.3 | 6/175 | 4.8 | 8.2 | 1.2 / 16.7 / 16.7 | 84.6 | 78.7 | 2.3 | 2763195 |
| scatter-1m | webgpu | 46.1 (56.1) | 45.4 | 73.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 1.8 | 0.9 / 16.7 / 33.3 | 15.9 | 55.7 | 32.7 | 736 |
| scatter-5m | webgpu | 210 (282) | 209 | 311 | 83.3 / 117 / 117 | 144/37 | 1.6 | 2.3 | 1.3 / 100 / 200 | 46.4 | 269.2 | 128.7 | 702 |
| area-stacked-1m | webgpu | 26.9 (32.0) | 26.4 | 28.2 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 6.3 | 0.9 / 16.7 / 16.7 | 16.0 | 39.4 | 5.3 | 4557936 |
| bar-10k | webgpu | 19.0 (20.5) | 18.5 | 20.0 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.6 | 1.2 / 16.7 / 16.7 | 11.4 | 3.6 | 1.2 | 480000 |
| heatmap-2048 | webgpu | 27.3 (35.0) | 26.7 | 34.5 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 1.9 | 0.7 / 16.7 / 16.7 | 24.3 | 33.9 | 16.7 | 136 |
| heatmap-4096 | webgpu | 92.9 (113) | 92.1 | 105 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 2.0 | 0.7 / 16.7 / 16.7 | 72.3 | 129.9 | 64.7 | 136 |
| candle-1m | webgpu | 33.2 (39.9) | 32.8 | 37.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 2.9 | 0.8 / 16.7 / 16.7 | 23.5 | 40.4 | 0.7 | 81472 |
| stream-1m | webgpu | 15.9 (17.2) | 13.4 | 14.6 | 16.7 / 16.7 / 16.7 | 0/180 | 3.1 | 4.3 | 0.7 / 16.7 / 16.7 | 12.1 | 29.1 | 0.7 | 158255 |
| treemap-100k | webgpu | 32.7 (41.9) | 32.1 | 25.7 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 1.2 | 0.7 / 16.7 / 16.7 | 19.3 | 15.6 | 1.2 | 192 |
| sankey-10k | webgpu | 100 (104) | 99.2 | 108 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 1.1 | 0.7 / 16.7 / 16.7 | 11.2 | 99.9 | 64.7 | 7340 |
| line-100k-1s | webgl2 | 16.6 (18.6) | 4.1 | 6.8 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 1.9 | 0.8 / 16.7 / 16.7 | 8.8 | 4.1 | 0.7 | 154024 |
| line-100k-10s | webgl2 | 17.8 (18.5) | 6.4 | 9.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 2.1 | 1.3 / 16.7 / 16.7 | 9.3 | 13.0 | 2.3 | 647960 |
| line-1m-1s | webgl2 | 16.6 (17.2) | 13.0 | 15.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.8 | 2.6 | 0.7 / 16.7 / 16.7 | 12.3 | 7.6 | 0.7 | 271476 |
| line-1m-10s | webgl2 | 17.1 (18.7) | 16.6 | 21.4 | 16.7 / 16.7 / 16.7 | 0/180 | 2.4 | 3.3 | 1.1 / 16.7 / 16.7 | 16.1 | 22.9 | 2.3 | 1543502 |
| line-10m-1s | webgl2 | 92.3 (93.4) | 92.0 | 94.5 | 16.7 / 16.7 / 33.3 | 4/176 | 2.6 | 6.4 | 0.8 / 16.7 / 16.7 | 46.6 | 42.3 | 0.7 | 307561 |
| line-10m-10s | webgl2 | 73.4 (94.2) | 73.0 | 75.1 | 16.7 / 16.7 / 33.3 | 5/175 | 4.5 | 7.5 | 1.2 / 16.7 / 16.7 | 84.8 | 86.9 | 2.3 | 2763195 |
| scatter-1m | webgl2 | 46.9 (57.3) | 46.5 | 70.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.0 | 1.5 | 1.0 / 16.7 / 33.3 | 16.1 | 113.5 | 32.7 | 736 |
| scatter-5m | webgl2 | 244 (274) | 243 | 318 | 66.7 / 117 / 117 | 142/40 | 1.5 | 2.3 | 1.6 / 117 / 217 | 46.6 | 555.8 | 128.7 | 746 |
| area-stacked-1m | webgl2 | 25.6 (28.8) | 25.2 | 26.8 | 16.7 / 16.7 / 16.7 | 0/180 | 5.0 | 5.7 | 1.2 / 16.7 / 16.7 | 16.1 | 64.6 | 5.3 | 4484011 |
| bar-10k | webgl2 | 19.1 (19.6) | 18.6 | 19.6 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 1.7 | 1.5 / 16.7 / 16.7 | 11.6 | 5.0 | 1.2 | 480000 |
| heatmap-2048 | webgl2 | 30.5 (37.4) | 29.9 | 32.0 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.8 | 0.8 / 16.7 / 16.7 | 24.5 | 66.4 | 16.7 | 136 |
| heatmap-4096 | webgl2 | 96.4 (117) | 95.8 | 105 | 16.7 / 16.7 / 16.7 | 0/180 | 1.5 | 2.1 | 0.8 / 16.7 / 16.7 | 72.5 | 258.4 | 64.7 | 136 |
| candle-1m | webgl2 | 33.3 (40.5) | 33.0 | 37.3 | 16.7 / 16.7 / 16.7 | 0/180 | 2.0 | 3.5 | 0.8 / 16.7 / 16.7 | 23.7 | 40.9 | 0.7 | 81472 |
| stream-1m | webgl2 | 16.2 (17.1) | 13.0 | 15.1 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 4.3 | 0.7 / 16.7 / 16.7 | 12.3 | 29.7 | 0.7 | 158255 |
| treemap-100k | webgl2 | 28.1 (35.0) | 27.5 | 25.1 | 16.7 / 16.7 / 16.7 | 0/180 | 0.8 | 1.2 | 0.8 / 16.7 / 16.7 | 19.5 | 17.6 | 1.2 | 192 |
| sankey-10k | webgl2 | 81.0 (103) | 80.6 | 92.2 | 16.7 / 16.7 / 16.7 | 0/180 | 0.8 | 1.2 | 0.7 / 16.7 / 16.7 | 11.6 | 140.4 | 64.7 | 7340 |

## Cross-library comparison

Same seeded data for every library. Line / scatter steady phase: identical zoom-in / pan / zoom-out window schedule set through each library's range API (time-based, 1% minimum window). bar-10k: hover sweep. viz runs on WebGPU here.

### line-1m-1s

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 15.9 (16.6) | 14.3 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.7 | 0.6 / 16.7 / 16.7 | 19.8 | 26.5 |
| uplot 1.6.32 | canvas2d | 15.5 (16.0) | 14.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.0 | 0.1 / 16.7 / 16.7 | 20.2 | 27.4 |
| echarts 6.1.0 | canvas2d | 22.8 (31.8) | 20.1 | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 6.5 | 0.9 / 16.7 / 16.7 | 80.0 | 95.3 |
| chartjs 4.6.1 | canvas2d | 17.4 (20.3) | 14.8 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.0 | 0.1 / 16.7 / 16.7 | 57.3 | 63.5 |
| plotly 4.1.2 | webgl | 298 (367) | 285 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.5 | 0.1 / 16.7 / 4300 | 132.4 | 315.4 |
| chartgpu 0.4.0 | webgpu | 123 (139) | 99.8 | 50.0 / 133 / 133 | 18.4 | 43/18 | 60.6 | 0.0 / 16.7 / 33.3 | 56.8 | 70.6 |
| scichart 6.0.14 | webgl | 31.8 (33.5) | 24.1 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 4.2 | 0.1 / 16.7 / 16.7 | 45.8 | 65.4 |
| highcharts 13.1.1 | webgl | 199 (216) | 179 | 66.7 / 117 / 117 | 14.5 | 47/14 | 75.3 | 0.3 / 16.7 / 16.7 | 95.4 | 124.3 |

### line-10m-1s

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 92.1 (92.6) | 93.4 | 16.7 / 16.7 / 33.3 | 58.7 | 4/176 | 7.0 | 0.6 / 16.7 / 16.7 | 122.8 | 129.5 |
| uplot 1.6.32 | canvas2d | 81.7 (84.2) | 85.3 | 16.7 / 33.3 / 83.3 | 52.8 | 22/160 | 9.4 | 0.1 / 16.7 / 16.7 | 123.2 | 130.4 |
| echarts 6.1.0 | canvas2d | 133 (142) | 121 | 33.3 / 83.3 / 183 | 30.8 | 88/92 | 32.6 | 0.9 / 16.7 / 16.7 | 526.3 | 541.6 |
| chartjs 4.6.1 | canvas2d | 114 (118) | 85.7 | 16.7 / 33.3 / 100.0 | 52.1 | 24/157 | 10.0 | 0.0 / 16.7 / 16.7 | 469.4 | 475.6 |
| plotly | - | FAILED: timeout after 300 s (page was in phase "steady") |  |  |  |  |  |  |  |  |

### scatter-1m

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 43.3 (53.6) | 69.4 | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 1.8 | 0.9 / 16.7 / 33.3 | 15.9 | 22.7 |
| uplot 1.6.32 | canvas2d | 319 (323) | 343 | 16.7 / 33.3 / 300 | 44.6 | 49/141 | 13.6 | 0.1 / 16.7 / 16.7 | 16.4 | 23.6 |
| echarts 6.1.0 | canvas2d | 1050 (1117) | 892 | 133 / 150 / 150 | 7.8 | 161/23 | 134 | 0.4 / 16.7 / 16.7 | 91.8 | 109.1 |
| chartjs 4.6.1 | canvas2d | 665 (670) | 730 | 283 / 617 / 617 | 3.2 | 193/10 | 339 | 0.0 / 367 / 383 | 201.8 | 208.0 |
| plotly 4.1.2 | webgl | 316 (332) | 327 | 16.7 / 16.7 / 33.3 | 58.3 | 5/175 | 16.2 | 0.1 / 16.7 / 16.7 | 124.3 | 307.3 |
| chartgpu 0.4.0 | webgpu | 123 (130) | 130 | 16.7 / 83.3 / 117 | 33.3 | 28/34 | 33.1 | 0.1 / 16.7 / 16.7 | 37.3 | 51.0 |
| scichart 6.0.14 | webgl | 32.3 (33.5) | 52.7 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 4.2 | 0.1 / 16.7 / 16.7 | 42.0 | 61.6 |
| highcharts 13.1.1 | webgl | 233 (249) | 215 | 33.3 / 167 / 183 | 21.7 | 44/24 | 48.9 | 0.8 / 16.7 / 16.7 | 92.6 | 121.9 |

### bar-10k

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 19.6 (21.2) | 18.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.0 | 1.7 / 16.7 / 16.7 | 11.5 | 18.2 |
| uplot 1.6.32 | canvas2d | 16.8 (18.6) | 6.7 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 1.2 | 0.1 / 16.7 / 16.7 | 9.2 | 16.4 |
| echarts 6.1.0 | canvas2d | 83.4 (83.8) | 53.3 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.4 | 1.6 / 16.7 / 16.7 | 31.9 | 49.2 |
| chartjs 4.6.1 | canvas2d | 50.5 (54.7) | 58.7 | 33.3 / 33.3 / 66.7 | 37.6 | 68/113 | 26.9 | 0.0 / 16.7 / 16.7 | 14.0 | 20.2 |
| plotly | - | FAILED: Error: unsupported: the plotly gl2d bundle has no bar trace |  |  |  |  |  |  |  |  |
| chartgpu 0.4.0 | webgpu | 19.2 (21.7) | 7.4 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 3.1 | 0.1 / 16.7 / 16.7 | 270.9 | 284.5 |
| scichart 6.0.14 | webgl | 33.4 (33.4) | 22.8 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 0.3 | 0.1 / 16.7 / 16.7 | 34.6 | 54.3 |
| highcharts 13.1.1 | webgl | 50.7 (53.2) | 40.5 | 16.7 / 33.3 / 66.7 | 49.4 | 11/50 | 15.3 | 1.4 / 16.7 / 16.7 | 12.1 | 41.0 |

### graph-10k

10,000 nodes, 20,000 edges, 8 clusters, seed 42. Init = engine creation (viz builds its GPU pipelines here; three.js compiles its shaders at the first render, i.e. inside cold). Cold = first load + first presented frame on a fresh engine; TTFF = warm reload of the same buffers + presented frame. Steady = rAF interval over 3000 ms with one Barnes-Hut step (dt 0.016) + draw per frame while the camera orbits half a turn; physics / render = per-frame step / sync+draw-submit time (GPU work is asynchronous, see the frame interval). Memory after the steady phase and a forced GC. deck.gl has no layout engine (static positions, render only); cosmos.gl is 2D (GPU force layout, z dropped, no orbit); 3d-force-graph runs d3-force-3d, not Barnes-Hut.

| library | renderer | init ms | cold ms | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | physics med (p95) ms | render med (p95) ms | main-thread ms/frame | JS heap MB | wasm MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 37.0 | 13.4 | 16.6 (16.8) | 5.6 | 16.7 / 33.3 / 50.0 | 43.6 | 17/44 | 21.1 (22.6) | 0.9 (1.1) | 23.2 | 8.8 | 7.1 | 15.7 |
| three 0.170.0 | webgl2 | 87.0 | 36.8 | 16.8 (17.7) | 17.3 | 66.7 / 83.3 / 100 | 16.3 | 134/49 | 56.4 (81.4) | 0.9 (2.1) | 62.2 | 25.8 | - | 40.5 |
| deckgl 9.3.11 | webgl2 | 104 | 27.6 | 17.2 (18.2) | 1.6 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 0.0 (0.0) | 1.2 (1.7) | 2.3 | 21.8 | - | 51.1 |
| cosmos 3.5.1 | webgl2 | 77.0 | 121 | 17.9 (18.1) | 26.4 | 16.7 / 16.7 / 16.7 | 60 | 0/60 | 2.6 (4.2) | 2.6 (4.2) | 6.0 | 23.1 | - | 40.0 |
| forcegraph3d 1.80.1 | webgl2 | 215 | 8.5 | 1770 (1942) | 118 | 16.7 / 16.7 / 100.0 | 55.1 | 5/55 | 0.0 (0.0) | 11.1 (11.9) | 12.7 | 124.6 | - | 164.1 |

### graph-100k

100,000 nodes, 200,000 edges, 8 clusters, seed 42. Init = engine creation (viz builds its GPU pipelines here; three.js compiles its shaders at the first render, i.e. inside cold). Cold = first load + first presented frame on a fresh engine; TTFF = warm reload of the same buffers + presented frame. Steady = rAF interval over 3000 ms with one Barnes-Hut step (dt 0.016) + draw per frame while the camera orbits half a turn; physics / render = per-frame step / sync+draw-submit time (GPU work is asynchronous, see the frame interval). Memory after the steady phase and a forced GC. deck.gl has no layout engine (static positions, render only); cosmos.gl is 2D (GPU force layout, z dropped, no orbit); 3d-force-graph runs d3-force-3d, not Barnes-Hut.

| library | renderer | init ms | cold ms | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | physics med (p95) ms | render med (p95) ms | main-thread ms/frame | JS heap MB | wasm MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 23.0 | 63.5 | 23.5 (38.9) | 46.2 | 367 / 383 / 383 | 3 | 190/9 | 361 (381) | 5.9 (7.9) | 368 | 13.6 | 63.0 | 20.4 |
| three 0.170.0 | webgl2 | 37.0 | 87.3 | 54.5 (60.4) | 72.4 | 1833 / 1833 / 1833 | 0.8 | 218/2 | 1799 (1818) | 30.0 (30.7) | 1840 | 114.2 | - | 128.8 |
