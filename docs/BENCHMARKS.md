# 성능 벤치마크 (viz-engine-sdk)

이 문서는 `web/bench/` 하네스로 측정한 viz-engine-sdk(Rust + WebGPU/WebAssembly)의 성능 수치와 측정 방법, 그리고 uPlot · ECharts · Chart.js · Plotly(scattergl)와의 차트 비교, three.js와의 3D 그래프 비교 결과를 정리합니다. 수치는 아래 환경 한 대에서 측정한 값이며, **다른 머신 · 브라우저 · 디스플레이에서는 달라집니다.** 같은 명령으로 직접 재현할 수 있습니다.

- 원본 결과: [`docs/bench/results.json`](bench/results.json), [`results.md`](bench/results.md) (이 문서의 수치). 다시 측정하면 `web/bench/out/`에 새로 생기고(git 제외), `npm run bench:charts -- bench/out/results.json`으로 README 차트를 다시 그릴 수 있습니다
- 측정일: 2026-10-26

## 1. 재현 방법

```bash
cd web
npm install                  # 비교 라이브러리는 devDependencies (라이브러리 번들에는 포함되지 않음)
npm run bench                # 전체: 5회 반복(+1 워밍업), 정상상태 3초, 모든 시나리오 × WebGPU/WebGL2 + 라이브러리 비교 (~11분)
npm run bench -- --quick     # 스모크: 2회, 1초, 10M / 5M / 4096² 시나리오 제외
npm run bench -- --filter=line-1m,scatter --backend=webgpu --no-compare
npm run bench -- --compare-only --libs=viz,uplot
npm run bench -- --shots     # 각 페이지 스크린샷(web/bench/out/shots/) — 라이브러리가 실제로 그렸는지 확인용
npm run bench -- --profile   # 페이지별 CPU 프로파일 + self time 상위 함수
# 3D 그래프(viz vs three.js)만 다시 측정해 커밋된 결과에 병합 (~30초)
npm run bench -- --filter=graph --no-ours --merge=../docs/bench/results.json && npm run bench:charts
```

`--merge=<results.json>`은 이번 실행의 항목을 기존 파일에 합칩니다(같은 시나리오 + 라이브러리/백엔드는 교체, 나머지와 `meta`는 유지, 이번 실행 조건은 `meta.partialRuns`에 추가). `.md`도 합친 결과로 다시 씁니다.

러너(`bench/run-bench.mjs`)는 빈 포트에 자체 Vite 서버(cross-origin isolated: `measureUserAgentSpecificMemory` 사용 가능)를 띄우고, 고유 프로필로 헤드리스 Chrome(`--headless=new --enable-unsafe-webgpu`, macOS `--use-angle=metal`, `--js-flags=--expose-gc`)을 실행해 시나리오마다 **새 탭**에서 페이지를 엽니다. Chrome이 없으면 `SKIPPED`. 한 페이지가 300초 안에 끝나지 않으면(메인 스레드가 막혀도) 마지막으로 보고된 단계와 함께 `FAILED: timeout`으로 기록하고 다음으로 넘어갑니다.

## 2. 측정 환경

| 항목 | 값 |
|---|---|
| 머신 | Apple M1 (8코어), RAM 16 GB, macOS 15.1 (Darwin 24.1.0) |
| 브라우저 | Chrome 156.0.8078.48, 헤드리스(`--headless=new`) |
| WebGPU 어댑터 | apple / metal-3 |
| WebGL2 렌더러 | ANGLE (Apple, ANGLE Metal Renderer: Apple M1) |
| 캔버스 | 960×540 CSS px, DPR 1 (`deviceScaleFactor: 1`) |
| 프레임 주기 | 60 Hz (작업 없는 rAF 간격 중앙값 16.7 ms) |
| Node | v22.23.3 |
| 비교 대상 | uPlot 1.6.32, ECharts 6.1.0, Chart.js 4.6.1, plotly.js-gl2d-dist-min 4.1.2, three.js 0.170.0 (3D 그래프) |

## 3. 측정 방법

### 데이터
- 모든 데이터는 시드 고정 PRNG(mulberry32, `bench/data.ts`)로 생성 — 실행 · 라이브러리 · 머신에 관계없이 같은 샘플. 생성 시간은 측정에서 제외.
- 선: 랜덤 워크(`line-<N>-<S>s` = 총 N 샘플, S개 시리즈). 산점도: 3개 가우시안 군집. 막대 10k, 히트맵 2048² / 4096², OHLC 캔들 1M, 트리맵 리프 100k, 생키 노드 10k.
- 스트리밍(`stream-1m`): 1M 창(`maxPoints: 1_000_000`)에 프레임마다 10k 포인트 `appendSeriesData`.

### 단계 (시나리오마다 새 탭)
1. 엔진 생성(`VizEngineSDK.create`, 비교 대상은 라이브러리 import + 초기화) — `initMs`로 따로 기록.
2. **TTFF**: 워밍업 1회 후 5회 전체 렌더. 매 회 두 번의 rAF로 vsync 경계에 맞춘 뒤 시작.
   - `렌더 호출` = 동기 렌더 호출 시간(viz: `renderXxxChart()` + `render()`; uPlot/Chart.js: 차트 생성; ECharts: `setOption(notMerge)` → `finished`; Plotly: `newPlot` 완료 + 1 rAF)
   - `TTFF` = 호출 시작 → 그 다음 프레임이 컴포지터로 넘어간 시점(rAF 다음 task). **60 Hz vsync로 양자화**되므로 16.7 ms 미만의 차이는 `렌더 호출` 열로 비교하세요.
   - `pixels` = 렌더 + 1 px GPU 리드백(GPU 작업 완료까지) — `results.json`에 있음.
3. **메모리**: 강제 GC 2회 후 `performance.memory.usedJSHeapSize`(JS 힙), `measureUserAgentSpecificMemory`(UA 메모리: JS + wasm 등 페이지 전체), 엔진 통계의 wasm 메모리 크기와 GPU 버퍼 · 텍스처 바이트(`VizEngineSDK.getRenderStats()`).
4. **정상상태(steady) 3초**: rAF 루프에서 매 프레임 입력을 주고 rAF 간격을 기록. `드롭` = 16.7 ms를 넘긴 만큼의 누락 vsync 수 / 측정 프레임 수, `작업` = 그 프레임에 입력 처리 + 렌더에 쓴 JS+wasm 시간, `메인 스레드 ms/프레임` = CDP `Performance.getMetrics`의 TaskDuration 증가량 / 프레임 수(지연 실행 · 레이아웃 포함).
   - viz 시나리오: 실제 SDK 제스처 경로 — 휠 줌 인(35%) → 드래그 팬(30%) → 휠 줌 아웃(35%). 탐색이 없는 차트(막대, 트리맵, 생키)는 hover 스윕, 스트리밍은 프레임당 append.
   - 라이브러리 비교: 모든 라이브러리에 **같은 시간 기반 창 스케줄**(전체 → 1% 창으로 줌 인 → 1% 창 팬 → 전체로 줌 아웃)을 각자의 범위 API로 적용(viz `setXRange`/`setYRange`, uPlot `setScale`, ECharts `dataZoom` 액션, Chart.js `scales.min/max` + `update('none')`, Plotly `relayout`). 산점도는 x, y 모두.
5. **hover 지연**: 리셋된 전체 뷰에서 40 프레임 동안 프레임마다 포인터 1회 이동. `hover 동기` = 이벤트 디스패치 시간(그 자리에서 hit-test하는 핸들러), `간격 p95` = hover 중 rAF 간격(타이머/다음 프레임으로 미룬 작업까지 포함).
6. 반복 단계와 hover 단계에는 각각 30초 / 10초 예산이 있어, 10M 데이터에서 느린 라이브러리는 최소 3회만 측정합니다.

### 라이브러리 설정 (공정성)
각 라이브러리의 문서화된 대용량 데이터 설정을 사용했습니다(`bench/others.ts`).

| 라이브러리 | 설정 |
|---|---|
| viz | `ours.ts`와 같은 SDK 호출, `lineWidth: 1`, 산점도 `pointRadius: 1.5, opacity: 0.6`, WebGPU. 선은 M4 LOD(픽셀 열 단위 min/max) 자동 |
| uPlot | 타입 배열 열, 포인트 숨김(선 경로가 이미 픽셀 열 단위로 접힘). 산점도: `mode: 2` + 사용자 정의 사각형 드로어(uPlot 산점도 데모 방식 — 내장 `paths.points()`는 1M 원호를 담은 Path2D 하나를 만들고 Chrome에서 아무것도 그려지지 않음을 스크린샷으로 확인) |
| ECharts | canvas 렌더러, `animation: false`, 타입 배열 데이터, 선 `sampling: 'lttb'`, 산점도/막대 `large: true`, `inside` dataZoom |
| Chart.js | `parsing: false`, `normalized: true`, `animation: false`, 선은 decimation 플러그인(`min-max`), `pointRadius: 0`(선) / 1.5(산점도). `{x, y}` 객체 배열은 측정 전 1회만 생성 |
| Plotly | `scattergl`(WebGL) trace, gl2d 번들. 막대 trace가 없어 bar-10k는 제외 |

- `렌더 호출`의 범위가 라이브러리마다 다릅니다: viz는 엔진을 재사용하고 데이터만 다시 넘기며, uPlot / Chart.js는 매 회 차트를 파괴 후 새로 만들고, Plotly는 `purge` + `newPlot`입니다. 엔진/라이브러리 초기화 시간은 별도(`initMs`)입니다.
- 모든 라이브러리는 같은 패딩(좌 64 / 우 24 / 상 36 / 하 36 px)과 1 px 선, 같은 색을 씁니다. 툴팁은 각 라이브러리 기본 hover 동작을 켠 상태입니다.

## 4. 결과: viz-engine-sdk 시나리오

정상상태 / 드롭 / 작업 / hover / 메모리는 WebGPU 값입니다(WebGL2도 `results.md`에 전부 있음 — 정상상태는 두 백엔드가 거의 같았습니다). `GPU MB` = 할당된 GPU 버퍼 · 텍스처 용량, `업로드/프레임` = 정상상태 동안 프레임당 차트 데이터 업로드 평균.

| 시나리오 | 상호작용 | TTFF ms WebGPU / WebGL2 | 렌더 호출 ms | 정상상태 프레임 med / p95 / max ms | 드롭 | 프레임당 작업 med ms | hover 동기 ms | JS 힙 MB | wasm MB WebGPU / WebGL2 | GPU MB | 업로드/프레임 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| line-100k-1s | wheel+drag | 16.8 / 16.6 | 3.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 0.6 | 8.7 | 3.1 / 4.1 | 0.7 | 150 KB |
| line-100k-10s | wheel+drag | 16.7 / 17.8 | 5.8 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 0.8 | 9.1 | 8.4 / 13.0 | 2.3 | 633 KB |
| line-1m-1s | wheel+drag | 16.7 / 16.6 | 10.5 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 0.6 | 12.1 | 6.5 / 7.6 | 0.7 | 265 KB |
| line-1m-10s | wheel+drag | 17.1 / 17.2 | 16.7 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 1.0 | 16.0 | 9.6 / 22.9 | 2.3 | 1.5 MB |
| line-10m-1s | wheel+drag | 91.8 / 92.3 | 91.4 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 0.5 | 46.5 | 40.8 / 42.3 | 0.7 | 300 KB |
| line-10m-10s | wheel+drag | 72.9 / 73.4 | 72.5 | 16.7 / 16.7 / 33.3 | 6/175 | 4.8 | 1.2 | 84.6 | 78.7 / 86.9 | 2.3 | 2.6 MB |
| scatter-1m | wheel+drag | 46.1 / 46.9 | 45.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 0.9 | 15.9 | 55.7 / 113.5 | 32.7 | 736 B |
| scatter-5m | wheel+drag | 210 / 244 | 209 | 83.3 / 117 / 117 | 144/37 | 1.6 | 1.3 | 46.4 | 269.2 / 555.8 | 128.7 | 702 B |
| area-stacked-1m | wheel+drag | 26.9 / 25.6 | 26.4 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 0.9 | 16.0 | 39.4 / 64.6 | 5.3 | 4.3 MB |
| bar-10k | hover-sweep | 19.0 / 19.1 | 18.5 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.2 | 11.4 | 3.6 / 5.0 | 1.2 | 469 KB |
| heatmap-2048 | wheel+drag | 27.3 / 30.5 | 26.7 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 0.7 | 24.3 | 33.9 / 66.4 | 16.7 | 136 B |
| heatmap-4096 | wheel+drag | 92.9 / 96.4 | 92.1 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 0.7 | 72.3 | 129.9 / 258.4 | 64.7 | 136 B |
| candle-1m | wheel+drag | 33.2 / 33.3 | 32.8 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 0.8 | 23.5 | 40.4 / 40.9 | 0.7 | 80 KB |
| stream-1m | stream | 15.9 / 16.2 | 13.4 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 0.7 | 12.1 | 29.1 / 29.7 | 0.7 | 155 KB |
| treemap-100k | hover-sweep | 32.7 / 28.1 | 32.1 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 0.7 | 19.3 | 15.6 / 17.6 | 1.2 | 192 B |
| sankey-10k | hover-sweep | 100 / 81.0 | 99.2 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 0.7 | 11.2 | 99.9 / 140.4 | 64.7 | 7.2 KB |

요약:
- **1M 이하의 선 · 영역 · 캔들 · 막대 · 히트맵 · 트리맵**은 줌/팬/hover 동안 60 fps를 유지했습니다(드롭 0~1). 프레임당 작업은 1~6 ms.
- **선 10M**: 첫 프레임 73~92 ms(10M f32를 wasm으로 복사 + 범위 계산 + 첫 M4 LOD), 줌/팬 중 프레임당 작업 3~5 ms, 3초 동안 4~6 프레임 드롭.
- **스트리밍**: 1M 창에 프레임당 10k 추가하면서 60 fps(작업 3.2 ms/프레임, 업로드는 LOD 결과만 ~155 KB/프레임).
- **산점도 5M**은 줌/팬 중 12~13 fps(프레임 간격 중앙값 67~83 ms)로 **GPU 바운드**로 보입니다: JS+wasm 작업은 1.6 ms/프레임이지만 5M 점 인스턴스 래스터화가 프레임을 넘깁니다(포인트 LOD/밀도 집계 없음).
- **생키 10k**: hover 강조는 GPU의 fill 강조 uniform(48 B)과 lit 집합에 들어오고 나가는 노드·링크의 정점만 다시 써서, hover 스윕 중 업로드가 **프레임당 ~40 MB → ~7 KB**, hover 동기 처리가 **14.5 ms → 0.7 ms**로 줄었습니다(WebGPU / WebGL2 동일, 화면은 픽셀 단위로 이전과 같음). 트리맵의 범례 강조도 같은 uniform만 바꿉니다(선버스트 hover는 아직 호를 다시 테셀레이션).
- WebGL2 폴백은 TTFF와 정상상태가 WebGPU와 거의 같지만, wasm 메모리 피크가 산점도 · 히트맵 · 다중 시리즈에서 1.6~2.4배 큽니다(GL 백엔드 경로의 추가 스테이징 복사로 추정; wasm 메모리는 줄어들지 않으므로 피크 값).

## 5. 결과: 라이브러리 비교 (viz = WebGPU)

### line-1m-1s

| 라이브러리 | 렌더러 | 렌더 호출 ms | TTFF ms (p95) | 정상상태 프레임 med / p95 / max ms | fps | 드롭 | 메인 스레드 ms/프레임 | hover 동기 ms / 간격 p95 ms | JS 힙 MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 13.3 | 15.9 (16.6) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.7 | 0.6 / 16.7 | 19.8 | 26.5 |
| uplot 1.6.32 | canvas2d | 13.3 | 15.5 (16.0) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.0 | 0.1 / 16.7 | 20.2 | 27.4 |
| echarts 6.1.0 | canvas2d | 22.4 | 22.8 (31.8) | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 6.5 | 0.9 / 16.7 | 80.0 | 95.3 |
| chartjs 4.6.1 | canvas2d | 17.1 | 17.4 (20.3) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.0 | 0.1 / 16.7 | 57.3 | 63.5 |
| plotly 4.1.2 | webgl | 285 | 298 (367) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.5 | 0.1 / 4300 | 132.4 | 315.4 |

### line-10m-1s

| 라이브러리 | 렌더러 | 렌더 호출 ms | TTFF ms (p95) | 정상상태 프레임 med / p95 / max ms | fps | 드롭 | 메인 스레드 ms/프레임 | hover 동기 ms / 간격 p95 ms | JS 힙 MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 91.8 | 92.1 (92.6) | 16.7 / 16.7 / 33.3 | 58.7 | 4/176 | 7.0 | 0.6 / 16.7 | 122.8 | 129.5 |
| uplot 1.6.32 | canvas2d | 81.3 | 81.7 (84.2) | 16.7 / 33.3 / 83.3 | 52.8 | 22/160 | 9.4 | 0.1 / 16.7 | 123.2 | 130.4 |
| echarts 6.1.0 | canvas2d | 133 | 133 (142) | 33.3 / 83.3 / 183 | 30.8 | 88/92 | 32.6 | 0.9 / 16.7 | 526.3 | 541.6 |
| chartjs 4.6.1 | canvas2d | 114 | 114 (118) | 16.7 / 33.3 / 100.0 | 52.1 | 24/157 | 10.0 | 0.0 / 16.7 | 469.4 | 475.6 |
| plotly 4.1.2 | - | 실패: timeout after 300 s (page was in phase "steady") |  |  |  |  |  |  |  |  |

### scatter-1m

| 라이브러리 | 렌더러 | 렌더 호출 ms | TTFF ms (p95) | 정상상태 프레임 med / p95 / max ms | fps | 드롭 | 메인 스레드 ms/프레임 | hover 동기 ms / 간격 p95 ms | JS 힙 MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 42.8 | 43.3 (53.6) | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 1.8 | 1.0 / 33.3 | 15.9 | 22.7 |
| uplot 1.6.32 | canvas2d | 317 | 319 (323) | 16.7 / 33.3 / 300 | 44.6 | 49/141 | 13.6 | 0.1 / 16.7 | 16.4 | 23.6 |
| echarts 6.1.0 | canvas2d | 1035 | 1050 (1117) | 133 / 150 / 150 | 7.8 | 161/23 | 134 | 0.4 / 16.7 | 91.8 | 109.1 |
| chartjs 4.6.1 | canvas2d | 662 | 665 (670) | 283 / 617 / 617 | 3.2 | 193/10 | 339 | 0.0 / 383 | 201.8 | 208.0 |
| plotly 4.1.2 | webgl | 303 | 316 (332) | 16.7 / 16.7 / 33.3 | 58.3 | 5/175 | 16.2 | 0.1 / 16.7 | 124.3 | 307.3 |

### bar-10k

| 라이브러리 | 렌더러 | 렌더 호출 ms | TTFF ms (p95) | 정상상태 프레임 med / p95 / max ms | fps | 드롭 | 메인 스레드 ms/프레임 | hover 동기 ms / 간격 p95 ms | JS 힙 MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 19.1 | 19.6 (21.2) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.1 | 1.7 / 16.7 | 11.5 | 18.2 |
| uplot 1.6.32 | canvas2d | 3.2 | 16.8 (18.6) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 1.2 | 0.1 / 16.7 | 9.2 | 16.4 |
| echarts 6.1.0 | canvas2d | 67.4 | 83.4 (83.8) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.4 | 1.6 / 16.7 | 31.9 | 49.2 |
| chartjs 4.6.1 | canvas2d | 49.1 | 50.5 (54.7) | 33.3 / 33.3 / 66.7 | 37.6 | 68/113 | 26.9 | 0.0 / 16.7 | 14.0 | 20.2 |
| plotly 4.1.2 | - | 실패: Error: unsupported: the plotly gl2d bundle has no bar trace |  |  |  |  |  |  |  |  |

### 해석 — 이기는 곳과 지는 곳
- **산점도 1M**: viz가 가장 빠릅니다. 렌더 호출 43 ms vs Plotly 303 ms · uPlot 317 ms · Chart.js 662 ms · ECharts 1035 ms, 줌/팬 중 60 fps(드롭 1) vs Plotly 58 fps, uPlot 45 fps, ECharts 8 fps, Chart.js 3 fps. 메모리도 가장 작습니다(UA 22.7 MB vs Plotly 307 MB).
- **선 10M**: 줌/팬은 viz가 가장 매끄럽습니다(드롭 4 vs uPlot 22, Chart.js 24, ECharts 88; p95 프레임 16.7 ms vs 33~83 ms). **하지만 첫 렌더는 uPlot이 더 빠릅니다**(81 ms vs 92 ms). Plotly는 10M에서 줌 단계가 300초 안에 끝나지 않아 실패로 기록했습니다(`relayout`마다 전체 재처리).
- **선 1M**: viz와 uPlot이 사실상 동률(렌더 호출 13.3 ms 동일, 둘 다 60 fps). Chart.js(decimation)도 60 fps, ECharts는 렌더 22 ms에 드롭 1. Plotly는 첫 렌더 ~300 ms이고 hover 간격 p95가 4.3초(hover 처리 중 메인 스레드 정지).
- **막대 10k**: **uPlot이 이깁니다** — 렌더 호출 3.2 ms vs viz 19.1 ms(TTFF 16.8 vs 19.6 ms), hover 동기 0.1 vs 1.7 ms. 둘 다 60 fps. viz 쪽 원인(막대 레이아웃 · 축 · DOM 오버레이 중 어디인지)은 아직 분석하지 않았습니다(`--profile`로 확인 가능). Chart.js는 hover 스윕 중 38 fps.
- **JS 힙**: 선 1M/10M에서 viz와 uPlot은 비슷합니다(입력 Float32Array 자체가 대부분). ECharts / Chart.js는 10M에서 470~530 MB.
- viz의 GPU 메모리는 UA 메모리에 포함되지 않습니다(`GPU MB` 열 참고).

## 6. 결과: 3D 그래프 — viz vs three.js

`graph-10k`, `graph-100k` 시나리오(`bench/graph.ts`, `main.ts`의 `runGraph`). 측정일 2026-10-26, 위와 같은 머신 · Chrome · 반복 횟수(5회 + 워밍업 1, 정상상태 3초).

### 방법
- **데이터**: 데모 앱의 시드 생성기(`GraphDatasetTS.generateSeeded`, xorshift, seed 42) — 노드 N, 엣지 2N(80%는 같은 군집 안), 군집 8개, 반경 100 공간. 생성은 측정 제외. 두 엔진 모두 같은 TypedArray 버퍼를 `loadRawDataset`으로 받습니다.
- **엔진**: 데모 비교 화면이 쓰는 어댑터를 **그대로** 사용(`src/adapters/rust-wgpu-adapter.ts`, `src/adapters/three-js-adapter.ts`, 물리는 `src/three-engine/octree-physics.ts`). 벤치용 튜닝은 하지 않았습니다.
  - viz: Rust Barnes-Hut(wasm, 단일 스레드) + WebGPU, 노드는 구 빌보드 임포스터(사각형 1개), 엣지는 선.
  - three.js: 같은 알고리즘의 JS Barnes-Hut 옥트리 + `InstancedMesh`(8×6 분할 구, `MeshLambertMaterial`) 노드 + `LineSegments` 엣지, WebGL2(ANGLE Metal).
- **같은 조건**: 힘 모델과 상수(반발 25, 스프링 0.08 / 휴지 길이 8, 중심 인력 0.03, 감쇠 0.88, θ 0.75, softening 1.5, 최대 속도 60, 옥트리 최대 깊이 10), 프레임당 dt 0.016 고정, 카메라(거리 220, yaw 0.4, pitch 0.3, fov 45), 960×540 캔버스 @ DPR 1, 자동 sleep 꺼짐.
- **단계**:
  1. `초기화` = 엔진 생성(viz는 여기서 GPU 파이프라인을 모두 만듭니다). `cold` = 새 엔진에서 첫 데이터 로드 + 첫 프레임 표시(1회 측정). three.js는 셰이더를 첫 렌더에서 컴파일하므로 그 비용이 `cold`에 들어가고, viz는 `초기화`에 들어갑니다. 그래서 cold만 따로 비교하면 viz에 유리하고, `초기화 + cold`로 보는 편이 공정합니다(10k: 47.6 vs 123.8 ms, 100k: 86.5 vs 124.3 ms; three.js 초기화에는 모듈 동적 import도 포함).
  2. `TTFF` = 같은 버퍼 다시 로드(위치 초기화) + 첫 프레임 표시, 워밍업 1회 후 5회 중앙값. 60 Hz로 양자화됩니다.
  3. 정상상태 3초: 매 프레임 `tick(0.016, true)`(Barnes-Hut 한 스텝 + 버퍼 동기화 + 그리기)와 경과 시간 기준 카메라 궤도 회전(3초에 반 바퀴). `물리` = 스텝 시간, `렌더` = 동기화 + 드로우 제출 시간(GPU 실행은 비동기라 포함되지 않음 — 프레임 간격에 반영). **fps가 기준 지표**입니다. 프레임 작업이 16.7 ms를 조금 넘으면 rAF 간격이 16.7 / 33.3 ms로 번갈아 나와 중앙값이 16.7 ms로 보일 수 있습니다(viz 10k).
  4. 메모리: 정상상태 뒤 강제 GC 후 JS 힙, wasm 메모리(viz), UA 메모리.

### graph-10k (노드 10,000 · 엣지 20,000)

| 엔진 | 렌더러 | 초기화 ms | cold ms | TTFF ms (p95) | fps | 정상상태 프레임 med / p95 / max ms | 드롭 | 물리 med (p95) ms | 렌더 med (p95) ms | JS 힙 MB | wasm MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 30 | 17.6 | 16.7 (17.4) | **41.9** | 16.7 / 33.3 / 50.0 | 55/126 | **22.3** (23.1) | 1.0 (1.2) | 8.7 | 7.1 | 15.4 |
| three.js 0.170.0 | webgl2 | 87 | 36.8 | 16.8 (17.7) | 16.3 | 66.7 / 83.3 / 100 | 134/49 | 56.4 (81.4) | 0.9 (2.1) | 25.8 | - | 40.5 |

### graph-100k (노드 100,000 · 엣지 200,000)

| 엔진 | 렌더러 | 초기화 ms | cold ms | TTFF ms (p95) | fps | 정상상태 프레임 med / p95 / max ms | 드롭 | 물리 med (p95) ms | 렌더 med (p95) ms | JS 힙 MB | wasm MB | UA 메모리 MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 23 | 63.5 | **23.5** (38.9) | **3.0** | 367 / 383 / 383 | 190/9 | **361** (381) | 5.9 (7.9) | 13.6 | 63.0 | 20.4 |
| three.js 0.170.0 | webgl2 | 37 | 87.3 | 54.5 (60.4) | 0.8 | 1833 / 1833 / 1833 | 218/2 | 1799 (1818) | 30.0 (30.7) | 114.2 | - | 128.8 |

### 해석
- **물리 스텝**이 차이의 대부분입니다: 같은 Barnes-Hut를 Rust/wasm이 JS보다 10k에서 2.5배(22 vs 56 ms), 100k에서 5배(361 vs 1799 ms) 빠르게 돕니다. 그래서 시뮬레이션 + 회전 중 fps는 10k에서 41.9 vs 16.3입니다.
- **100k에서는 둘 다 실시간이 아닙니다.** 매 프레임 물리를 돌리면 viz도 3 fps(three.js 0.8 fps)입니다. 100k 그래프는 `warmup()`으로 미리 배치하고 렌더만 하거나, 물리를 몇 프레임에 한 번 돌리는 식으로 써야 합니다(렌더만의 fps는 이 시나리오에서 측정하지 않았습니다. 프레임당 렌더 제출 시간은 5.9 vs 30 ms).
- **첫 프레임**: 10k는 둘 다 한 프레임 안(16.7 vs 16.8 ms, vsync 양자화로 사실상 동률). 100k는 23.5 vs 54.5 ms, cold는 63.5 vs 87.3 ms.
- **메모리**: three.js 쪽은 노드마다 JS 객체를 두는 데이터 구조(`GraphDatasetTS`) 때문에 100k에서 JS 힙 114 MB입니다. viz는 JS 힙 13.6 MB + wasm 메모리 63 MB(wasm 메모리는 줄어들지 않으므로 반복 로드를 포함한 피크). GPU 메모리는 양쪽 모두 위 표에 포함되지 않습니다(viz 엔진 집계 GPU 버퍼 3.1 / 20.6 MB, three.js는 바이트 카운터가 없음).

### 공정성 메모 (three.js 쪽 구현의 알려진 핸디캡)
three.js 쪽은 데모 비교 화면의 구현을 손대지 않고 썼습니다. 일반적인 three.js 대규모 그래프 구성(`InstancedMesh` 노드 + `LineSegments` 엣지, 같은 Barnes-Hut)은 따르지만, 더 최적화할 여지가 있는 부분이 있습니다.
- 물리(`octree-physics.ts`): 노드를 객체 배열(AoS)로 두고, 노드마다 `computeRepulsion`이 `[fx, fy, fz]` 배열과 탐색 스택 배열을 새로 만들며, 옥트리 셀도 매 스텝 객체로 다시 만듭니다(GC 부담). 평탄한 TypedArray + 재사용 스택으로 바꾸면 JS 쪽 물리 시간이 줄어들 수 있습니다. 측정한 것은 "같은 알고리즘의 평범한 JS 구현"이지 최적화한 JS 구현이 아닙니다.
- 렌더(`three-js-adapter.ts` `syncBuffers`): 색이 바뀌지 않아도 매 프레임 모든 노드의 `setColorAt`과 엣지 색 버퍼를 다시 씁니다(100k에서 렌더 30 ms의 일부).
- 노드 지오메트리가 다릅니다: viz는 사각형 임포스터, three.js는 80 삼각형 구 메시(`SphereGeometry(1, 8, 6)`, Lambert 조명). 100k에서 three.js가 GPU에 더 많은 삼각형을 보냅니다. 여기서 프레임 시간은 물리가 지배하므로 영향은 작지만, 렌더만 비교할 때는 `THREE.Points` + 스프라이트 셰이더가 더 가까운 비교입니다.
- 알고리즘의 세부 차이(성능 영향은 무시할 수준): Rust는 감쇠를 `damping^(dt·60)`(dt 0.016에서 0.88^0.96)으로, JS는 스텝마다 0.88을 그대로 곱합니다. Rust 옥트리는 최대 깊이에서 겹친 노드를 연결 리스트로 유지하고 JS는 버립니다. three.js 어댑터의 `tick`은 운동 에너지 O(N) 합산을 `물리` 시간에 포함합니다(100k에서 약 1 ms).
- 화면 색이 다릅니다(three.js는 sRGB 출력 변환과 Lambert 조명, 배경색). 성능과는 무관합니다.
- viz 물리는 wasm 단일 스레드(SIMD · 스레드 없음)입니다. GPU 컴퓨트 물리가 아닙니다.

## 7. 이번 작업의 병목 수정 (전 → 후)

전(before) = 이번 수정 전 소스 + 통계 카운터만 추가한 빌드, 후(after) = 현재 소스. 같은 머신에서 before/after를 3라운드 교대로 실행(WebGPU, 5회 반복, 정상상태 2초), 라운드를 합친 샘플의 중앙값입니다. 각 라운드 명령: `npm run bench -- --no-compare --backend=webgpu --filter=line-1m-1s,line-10m,area-stacked-1m,candle-1m,scatter-1m,stream-1m --reps=5 --duration=2000`.

| 시나리오 | 렌더 호출 ms (전 → 후) | TTFF ms | 정상상태 작업 med ms | 정상상태 작업 p95 ms | 메인 스레드 ms/프레임 | 드롭 프레임 (3회 합) | wasm MB |
|---|---|---|---|---|---|---|---|
| line-1m-1s | 21.5 → 13 (-40%) | 22 → 15.3 | 2 → 2 | 4.7 → 5 | 3 → 3 | 0 → 0 | 9.5 → 6.5 |
| line-10m-1s | 109 → 91.8 (-16%) | 109 → 92.2 | 5 → 4.8 | 19.3 → 20.4 | 8.5 → 8.5 | 9 → 11 | 78.1 → 40.8 |
| line-10m-10s | 125 → 74.8 (-40%) | 125 → 75.3 | 9.4 → 6.7 | 25.8 → 21.4 | 13.3 → 10.2 | 36 → 13 | 78.7 → 78.7 |
| scatter-1m | 46 → 39.9 (-13%) | 46.5 → 40.4 | 1.1 → 1 | 1.9 → 1.7 | 1.8 → 1.6 | 0 → 0 | 55.7 → 55.7 |
| area-stacked-1m | 36.3 → 26.5 (-27%) | 36.8 → 26.9 | 7.4 → 6.5 | 13.4 → 11 | 9 → 8.1 | 0 → 0 | 37.8 → 39.4 |
| candle-1m | 58.3 → 35 (-40%) | 58.7 → 35.4 | 3.2 → 2.9 | 13 → 7.7 | 5.6 → 4.3 | 1 → 0 | 40.4 → 40.4 |
| stream-1m | 22.8 → 13.6 (-40%) | 23.2 → 16.4 | 3.9 → 3.2 | 8.2 → 6.1 | 4.9 → 4.4 | 0 → 0 | 32.5 → 29.1 |

수정 내용(모두 결과 동일 — 단위 테스트로 기존 구현과 비교):
1. **NaN 처리 없는 min/max** (`chart/finite.rs`, `line.rs`, `candle.rs`, `scatter.rs`): `f32::min`/`max`는 NaN 피연산자 처리 때문에 wasm32에서 비교마다 느린 시퀀스로 내려갑니다. 이미 `is_finite` 검사를 통과한 값에는 단순 비교-선택을 사용(2~3배 빠름).
2. **선 범위 계산 1패스** (`line.rs` `extents`): 유한 min/max와 양수 min/max(로그 축용)를 시리즈당 2패스 → 1패스.
3. **M4 LOD 내부 루프** (`line.rs` `push_m4`): 현재 min/max 값을 레지스터에 유지(이전엔 매 샘플마다 인덱스로 재조회), 동률 시 첫 인덱스 유지 규칙 동일. 줌/팬 프레임마다 보이는 모든 샘플을 도는 핫 루프.
4. **단일 시리즈 복사 제거** (`viz-engine-sdk.ts`, `lib.rs`): 시리즈 1개 + `Float32Array`(및 `Float64Array` x)는 연결용 새 배열을 만들지 않고 그대로 넘기고, Rust 쪽은 wasm-bindgen이 이미 복사한 `Vec`을 소유해 두 번째 복사를 하지 않습니다 → 10M 단일 시리즈 wasm 메모리 78 → 41 MB.
5. **접근성 요약의 O(n) 패스 공유** (`chart-a11y.ts` `withPassMemo`): 한 번의 갱신에서 요약과 설명이 같은 시리즈 통계를 각각 계산하던 것을 그 갱신 범위 안에서만 메모(데이터가 제자리에서 바뀌어도 다음 갱신에는 다시 계산).
6. **렌더 통계 API** (`renderer/stats.rs`, `lib_stats.rs`, `chart-stats.ts`, `VizEngineSDK.getRenderStats()`): GPU 버퍼/텍스처 바이트, 프레임당 차트 업로드 바이트, 레이어별 마크 수, wasm 메모리 크기. 벤치마크와 진단용(렌더링 결과 변화 없음).

개선되지 않은 것: line-10m-1s의 정상상태 작업 p95와 드롭 수는 차이가 없거나 노이즈 범위(9 → 11)입니다. 10M 첫 렌더의 남은 시간은 대부분 JS → wasm 복사와 첫 LOD입니다.

## 8. 한계와 주의사항
- **한 대의 머신(Apple M1, 헤드리스 Chrome 156, 60 Hz)** 결과입니다. 헤드리스 Chrome은 실제 디스플레이 합성과 다르게 프레임을 낼 수 있고, 120 Hz 디스플레이 · 다른 GPU · Windows/Linux · Firefox/Safari에서는 수치가 달라집니다.
- TTFF와 프레임 간격은 vsync(16.7 ms)로 양자화됩니다. 작은 데이터에서 "16.7 ms"는 "한 프레임 안"이라는 뜻이며 렌더 호출 열이 더 정밀합니다.
- GPU 실행 시간은 직접 측정하지 않습니다(타임스탬프 쿼리 미사용). `pixels`(1 px 리드백)와 프레임 간격이 GPU 바운드 상황을 간접적으로 보여줍니다(예: scatter-5m).
- 합성 입력(디스패치한 Pointer/Wheel 이벤트)과 시간 기반 스케줄을 사용합니다. 실제 사용자 입력 지연(입력 → 화면)은 측정하지 않습니다.
- 라이브러리 비교의 `렌더 호출`은 범위가 다릅니다(위 3절). 각 라이브러리는 문서화된 대용량 설정을 썼지만 모든 튜닝을 다 해본 것은 아닙니다(예: uPlot 산점도의 quadtree, ECharts `progressive` 조정, Chart.js 산점도 decimation 없음). 개선 제안은 `bench/others.ts`에 반영하면 됩니다.
- Plotly line-10m은 300초 타임아웃으로 실패, bar-10k는 gl2d 번들에 막대가 없어 제외했습니다.
- 3D 그래프 비교는 엔진 전체(데이터 구조 + 물리 + 렌더)의 비교입니다. three.js 자체의 렌더 성능 비교가 아니며, three.js 쪽 구현의 핸디캡은 6절에 적었습니다. graph-100k의 three.js 정상상태는 3초 동안 2 프레임뿐이라 fps 0.8은 거친 값입니다.
- 메모리: JS 힙은 GC 후 값, wasm 메모리는 줄어들지 않으므로 워밍업 포함 피크입니다. GPU 바이트는 viz 엔진이 할당한 용량이며 드라이버 오버헤드는 포함하지 않습니다.
- 전/후 비교의 노이즈: 같은 시나리오 반복 간 렌더 호출 편차는 대략 ±5%, 드롭 프레임은 ±수 프레임입니다.
