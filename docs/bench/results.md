# charturbo benchmark results

2026-10-26T07:40:28.358Z · Apple M1 · 16384.0 MB RAM · Darwin 24.1.0 (darwin arm64) · Chrome/156.0.8078.48
WebGPU adapter: apple / metal-3 · WebGL2: ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)
Base run: reps 5 (+1 warmup) · steady phase 3000 ms · canvas 960x540 CSS px @ DPR 1 · idle rAF interval median 16.7 ms. Merged comparisons use the per-scenario conditions below.

## charturbo scenarios

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

Same seeded data. Line / scatter: time-based zoom / pan via range APIs (1% minimum window); ChartGPU changes x only, including scatter. bar-10k: hover sweep. TTFF excludes engine initialization; SciChart methodology v2 includes data clear + append into wasm on every timed render.

Per-entry measurement metadata in results.json records date, version, repetitions and duration. Older merged runs may have different conditions; this is not a uniform ranking.

### line-1m-1s

- viz 0.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- uplot 1.6.32: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- echarts 6.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartjs 4.6.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- plotly 4.1.2: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartgpu 0.4.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- scichart 6.0.14: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- highcharts 13.1.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 16.2 (17.3) | 15.2 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.6 | 0.5 / 16.7 / 16.7 | 20.1 | 27.0 |
| uplot 1.6.32 | canvas2d | 16.4 (17.3) | 15.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.2 | 0.0 / 16.7 / 16.7 | 20.5 | 27.9 |
| echarts 6.1.0 | canvas2d | 23.9 (30.3) | 25.4 | 16.7 / 16.7 / 33.3 | 59 | 3/177 | 7.2 | 0.8 / 16.7 / 16.7 | 80.3 | 95.8 |
| chartjs 4.6.1 | canvas2d | 17.0 (20.1) | 16.2 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.5 | 0.1 / 16.7 / 16.7 | 57.6 | 64.0 |
| plotly 4.1.2 | webgl | 285 (320) | 278 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.8 | 0.1 / 16.7 / 4183 | 132.7 | 315.9 |
| chartgpu 0.4.0 | webgpu | 131 (147) | 100 | 50.0 / 83.3 / 150 | 18.8 | 125/56 | 55.0 | 0.0 / 16.7 / 33.3 | 57.7 | 71.4 |
| scichart 6.0.14 | webgpu | 33.3 (33.5) | 29.8 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.1 | 0.1 / 16.7 / 16.7 | 53.8 | 73.4 |
| highcharts 13.1.1 | webgl | 183 (200) | 164 | 66.7 / 100.0 / 133 | 14.3 | 140/43 | 71.7 | 0.3 / 16.7 / 16.7 | 95.8 | 124.7 |

### line-10m-1s

- viz 0.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- uplot 1.6.32: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- echarts 6.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartjs 4.6.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- plotly 4.1.2: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual failed), 3000 ms steady.
- chartgpu 0.4.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- scichart 6.0.14: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- highcharts 13.1.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 92.8 (94.0) | 94.4 | 16.7 / 16.7 / 33.3 | 58.7 | 4/176 | 7.3 | 0.7 / 16.7 / 16.7 | 123.1 | 130.0 |
| uplot 1.6.32 | canvas2d | 84.4 (86.3) | 84.2 | 16.7 / 33.3 / 100.0 | 52.8 | 22/160 | 9.9 | 0.1 / 16.7 / 16.7 | 123.5 | 130.9 |
| echarts 6.1.0 | canvas2d | 132 (137) | 119 | 16.7 / 83.3 / 200 | 34 | 79/102 | 29.6 | 0.8 / 16.7 / 16.7 | 526.6 | 542.1 |
| chartjs 4.6.1 | canvas2d | 115 (119) | 117 | 16.7 / 33.3 / 100.0 | 52.4 | 23/157 | 10.6 | 0.0 / 16.7 / 16.7 | 469.7 | 476.0 |
| plotly | - | FAILED: timeout after 300 s (page was in phase "steady") |  |  |  |  |  |  |  |  |
| chartgpu 0.4.0 | webgpu | 1088 (1118) | 857 | 617 / 1133 / 1133 | 1.8 | 195/5 | 812 | 0.1 / 183 / 200 | 410.0 | 423.8 |
| scichart 6.0.14 | webgpu | 33.0 (33.4) | 28.3 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.5 | 0.1 / 16.7 / 16.7 | 225.5 | 245.1 |
| highcharts 13.1.1 | webgl | 1715 (1833) | 1586 | 500 / 1033 / 1033 | 1.9 | 179/5 | 618 | 0.1 / 16.7 / 16.7 | 851.1 | 880.0 |

### scatter-1m

- viz 0.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- uplot 1.6.32: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- echarts 6.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartjs 4.6.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- plotly 4.1.2: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartgpu 0.4.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- scichart 6.0.14: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- highcharts 13.1.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 37.9 (44.2) | 71.5 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.2 | 1.1 / 16.7 / 33.3 | 16.2 | 23.1 |
| uplot 1.6.32 | canvas2d | 319 (319) | 359 | 16.7 / 16.7 / 350 | 43.3 | 55/141 | 14.5 | 0.1 / 16.7 / 16.7 | 16.7 | 24.0 |
| echarts 6.1.0 | canvas2d | 967 (1083) | 868 | 133 / 150 / 150 | 7.8 | 161/23 | 134 | 0.4 / 16.7 / 16.7 | 92.1 | 109.5 |
| chartjs 4.6.1 | canvas2d | 657 (659) | 741 | 300 / 633 / 633 | 3.3 | 174/9 | 340 | 0.0 / 367 / 383 | 202.1 | 208.4 |
| plotly 4.1.2 | webgl | 283 (300) | 310 | 16.7 / 16.7 / 33.3 | 58.3 | 5/175 | 15.9 | 0.1 / 16.7 / 16.7 | 124.6 | 307.8 |
| chartgpu 0.4.0 | webgpu | 130 (134) | 124 | 16.7 / 83.3 / 117 | 33.6 | 80/101 | 30.7 | 0.1 / 16.7 / 16.7 | 38.1 | 51.8 |
| scichart 6.0.14 | webgpu | 33.1 (35.1) | 46.8 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.6 | 0.1 / 16.7 / 16.7 | 57.5 | 77.1 |
| highcharts 13.1.1 | webgl | 233 (250) | 218 | 33.3 / 133 / 167 | 21.3 | 118/64 | 48.1 | 0.8 / 16.7 / 50.0 | 92.9 | 121.8 |

### bar-10k

- viz 0.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- uplot 1.6.32: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- echarts 6.1.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- chartjs 4.6.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- plotly 4.1.2: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual failed), 3000 ms steady.
- chartgpu 0.4.0: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- scichart 6.0.14: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- highcharts 13.1.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

| library | renderer | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | main-thread ms/frame | hover sync / interval med / p95 ms | JS heap MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 19.9 (21.8) | 24.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.0 | 1.8 / 16.7 / 16.7 | 11.8 | 18.7 |
| uplot 1.6.32 | canvas2d | 16.8 (16.9) | 7.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 1.4 | 0.2 / 16.7 / 16.7 | 9.5 | 16.9 |
| echarts 6.1.0 | canvas2d | 83.4 (84.3) | 69.0 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.5 | 2.8 / 16.7 / 16.7 | 32.2 | 49.7 |
| chartjs 4.6.1 | canvas2d | 52.6 (54.5) | 58.6 | 33.3 / 33.3 / 50.0 | 39.2 | 63/118 | 25.6 | 0.0 / 16.7 / 16.7 | 14.3 | 20.7 |
| plotly | - | FAILED: Error: unsupported: the plotly gl2d bundle has no bar trace |  |  |  |  |  |  |  |  |
| chartgpu 0.4.0 | webgpu | 19.6 (22.1) | 6.2 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.8 | 0.1 / 16.7 / 16.7 | 271.6 | 285.3 |
| scichart 6.0.14 | webgpu | 33.3 (33.5) | 27.0 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 0.3 | 0.1 / 16.7 / 16.7 | 35.1 | 54.8 |
| highcharts 13.1.1 | webgl | 51.6 (53.0) | 43.0 | 16.7 / 33.3 / 66.7 | 51.1 | 27/153 | 14.1 | 1.5 / 16.7 / 16.7 | 12.5 | 41.4 |

### graph-10k

- viz 0.1.0: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- three 0.186.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- deckgl 9.3.11: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- cosmos 3.5.1: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- forcegraph3d 1.80.1: 2026-10-27T03:20:48.712Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- vizgpu 0.1.0: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

10,000 nodes, 20,000 edges, 8 clusters, seed 42. Init = engine creation; cold = first load + presented frame; TTFF = warm reload + presented frame. viz / vizgpu / three use matching 3D Barnes-Hut models. vizgpu is opt-in hybrid GPU repulsion with CPU springs/integration/index: physics is wall time INCLUDING upload, GPU completion and readback. Other physics / render values are CPU execution/submission times, NOT GPU execution time. deck.gl: render only. cosmos.gl: 2D GPU layout, no orbit; methodology v3 pauses automatic simulation so each frame executes exactly one explicit step (v2 ran two). 3d-force-graph: d3-force-3d with different forces/integrator; v2+ waits for scene updates and validates one tick plus movement. See per-entry methodology and conditions; these are different workloads.

| library | renderer | init ms | cold ms | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | physics med (p95) ms | render med (p95) ms | main-thread ms/frame | JS heap MB | wasm MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 31.0 | 13.1 | 17.2 (18.3) | 5.3 | 16.7 / 33.3 / 33.3 | 52.7 | 22/158 | 17.7 (18.7) | 1.0 (1.2) | 19.1 | 9.0 | 7.6 | 15.9 |
| three 0.186.1 | webgl2 | 126 | 119 | 15.8 (17.8) | 19.4 | 50.0 / 66.7 / 83.3 | 20.2 | 120/60 | 47.2 (52.4) | 0.8 (1.7) | 50.3 | 29.4 | - | 49.9 |
| deckgl 9.3.11 | webgl2 | 105 | 26.3 | 19.7 (21.4) | 3.3 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 0.0 (0.0) | 1.2 (1.6) | 2.3 | 22.0 | - | 53.3 |
| cosmos 3.5.1 | webgl2 | 100 | 124 | 16.8 (18.6) | 11.8 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.5 (4.4) | 0.2 (0.3) | 3.9 | 23.4 | - | 40.4 |
| forcegraph3d 1.80.1 | webgl2 | 241 | 334 | 1919 (1941) | 1915 | 133 / 150 / 150 | 7.3 | 165/22 | 123 (128) | 18.4 (31.6) | 142 | 119.6 | - | 159.1 |
| vizgpu 0.1.0 | webgpu | 23.0 | 13.4 | 16.8 (17.2) | 5.1 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 6.2 (7.1) | 1.0 (1.4) | 3.6 | 9.1 | 7.6 | 16.0 |

### graph-100k

- viz 0.1.0: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- three 0.186.1: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- deckgl 9.3.11: 2026-10-27T03:15:02.515Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- cosmos 3.5.1: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.
- forcegraph3d 1.80.1: 2026-10-27T03:20:48.712Z, Chrome/156.0.8078.48, requested 5 reps (actual failed), 3000 ms steady.
- vizgpu 0.1.0: 2026-10-27T03:47:31.638Z, Chrome/156.0.8078.48, requested 5 reps (actual 5), 3000 ms steady.

100,000 nodes, 200,000 edges, 8 clusters, seed 42. Init = engine creation; cold = first load + presented frame; TTFF = warm reload + presented frame. viz / vizgpu / three use matching 3D Barnes-Hut models. vizgpu is opt-in hybrid GPU repulsion with CPU springs/integration/index: physics is wall time INCLUDING upload, GPU completion and readback. Other physics / render values are CPU execution/submission times, NOT GPU execution time. deck.gl: render only. cosmos.gl: 2D GPU layout, no orbit; methodology v3 pauses automatic simulation so each frame executes exactly one explicit step (v2 ran two). 3d-force-graph: d3-force-3d with different forces/integrator; v2+ waits for scene updates and validates one tick plus movement. See per-entry methodology and conditions; these are different workloads.

| library | renderer | init ms | cold ms | TTFF med (p95) ms | pixels ms | steady med / p95 / max ms | fps | dropped | physics med (p95) ms | render med (p95) ms | main-thread ms/frame | JS heap MB | wasm MB | UA memory MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 19.0 | 58.5 | 30.9 (31.9) | 40.5 | 283 / 317 / 317 | 3.7 | 184/11 | 286 (317) | 6.1 (7.8) | 296 | 14.0 | 72.6 | 20.9 |
| three 0.186.1 | webgl2 | 43.0 | 76.1 | 44.9 (48.3) | 75.0 | 1133 / 1167 / 1167 | 1.1 | 205/3 | 1148 (1152) | 21.1 (22.4) | 1160 | 117.7 | - | 138.2 |
| deckgl 9.3.11 | webgl2 | 51.0 | 26.6 | 18.4 (20.2) | 6.7 | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 0.0 (0.0) | 1.3 (1.6) | 2.4 | 35.2 | - | 66.5 |
| cosmos 3.5.1 | webgl2 | 49.0 | 179 | 66.3 (109) | 76.0 | 16.7 / 33.3 / 33.3 | 55.4 | 14/166 | 1.5 (3.7) | 0.2 (0.5) | 2.5 | 61.3 | - | 78.3 |
| forcegraph3d | - | FAILED: timeout after 300 s (page was in phase "ttff") |  |  |  |  |  |  |  |  |  |  |  |  |
| vizgpu 0.1.0 | webgpu | 18.0 | 54.2 | 27.1 (31.2) | 42.9 | 50.0 / 66.7 / 66.7 | 19.6 | 122/58 | 41.9 (50.0) | 5.9 (6.8) | 30.2 | 14.0 | 72.6 | 21.0 |
