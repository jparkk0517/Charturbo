# 성능

Charturbo는 무거운 작업을 WebAssembly에서 하고 데이터를 GPU에 두어 줌·팬·hover를 화면 주사율로 유지합니다. 이 페이지는 속도가 어디서 나오는지, 큰 데이터에서 그 속도를 어떻게 유지하는지, 벤치마크가 무엇을 측정했는지 설명합니다.

[벤치마크 비교](https://jparkk0517.github.io/Charturbo/benchmarks.html)

## 빠른 이유

| 기법 | 적용 대상 |
|---|---|
| Rust에서 픽셀 열 단위 M4 데시메이션(열마다 처음, 마지막, 최소, 최대) | 선·영역 차트: 샘플 100만 개가 선분 수천 개로 줄고 스파이크는 유지 |
| 픽셀 열 단위 OHLC 집계 | 폭이 2 px보다 좁아진 캔들스틱 |
| GPU 인스턴싱, 점은 한 번만 업로드 | 산점도 / 버블 차트: 줌과 팬은 뷰만 바꿈 |
| 값 그리드를 `R32Float` 텍스처 하나 + 256색 룩업 테이블로 | 4096 × 4096 셀까지의 히트맵: 쿼드 하나, 컬러맵 변경 시 재업로드 없음 |
| hit-test, 누적 계산, 눈금 배치, 계층·생키 레이아웃을 Rust에서 | hover와 레이아웃 비용이 JavaScript에 남지 않음 |
| 바뀐 것만 업로드 | 스트리밍은 데시메이션 결과만 업로드(1M 창에서 프레임당 약 155 KB). 생키 hover와 트리맵 범례 강조는 지오메트리 대신 uniform만 바꿈 |
| GPU에 상주하는 그래프 레이아웃(`stepPhysicsAsync`, WebGPU) | 위치와 속도가 GPU 버퍼에 머묾. GPU가 Barnes-Hut 옥트리를 만들고 적분까지 수행 |
| DOM은 텍스트에만 | 제목, 범례, 축 라벨, 툴팁. 눈금 라벨 DOM은 눈금이 바뀔 때만 다시 만듦 |

## 큰 데이터를 다루는 팁

### 타입 배열을 넘기세요

값은 `Float32Array`, x 값과 타임스탬프는 `Float64Array`를 쓰세요. 일반 배열도 받지만 먼저 변환합니다. 시리즈가 하나이고 `Float32Array`(와 선택적 `Float64Array` x)로 주면, SDK는 이어 붙인 복사본을 만들지 않고 배열을 그대로 엔진에 넘깁니다. 벤치마크에서 이 경로로 샘플 1000만 개 선의 WebAssembly 메모리가 78 MB에서 41 MB로 줄었습니다.

```ts
const values = new Float32Array(n);
const x = new Float64Array(n); // 시간 축이면 epoch ms
sdk.renderLineChart([{ name: '센서', values, x }], { axes: { x: { type: 'time' } } });
sdk.render();
```

### 다시 렌더링하지 말고 추가하세요

`appendSeriesData`는 기존 시리즈에 샘플을 추가하고, `maxPoints`는 슬라이딩 창을 유지합니다. 오래된 샘플 정리는 분할 상환 O(추가한 샘플 수)이며, 다음 프레임은 보이는 구간만 다시 데시메이션합니다. 누적 영역은 `appendAreaData`가 같은 일을 합니다. 갱신할 때마다 전체 데이터로 `renderLineChart`를 호출하면 모든 데이터를 다시 복사합니다.

```ts
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 1_000_000 });
sdk.render();
```

### 바뀐 것이 있을 때만 렌더링하세요

쉬는 동안 도는 루프는 없으며 `render()`는 프레임 하나를 그립니다. 데이터나 뷰를 바꾼 뒤 호출하거나, `enableNodeInteractions`에 `autoRender: true`를 쓰세요. 스트리밍에서는 갱신을 모아 애니메이션 프레임당 한 번 렌더링하세요.

### 차트가 많으면 GPU 디바이스를 공유하세요

`Charturbo.create(canvas)`는 캔버스마다 어댑터와 디바이스를 요청하고 모든 파이프라인을 컴파일합니다. 브라우저는 WebGL 컨텍스트를 16개 안팎으로 제한합니다. `CharturboDevice`를 쓰면 스파크라인 100개의 생성과 첫 렌더가 WebGPU 165 ms, WebGL2 717 ms였습니다(헤드리스 Chrome). [공유 GPU 디바이스](./shared-device)를 보세요.

### 한계를 알아 두세요

- 산점도는 점 데시메이션이 없어 모든 점을 그립니다. 점 500만 개에서는 줌·팬 중 GPU 바운드로 12~13 fps였습니다.
- 차트의 staged 마크가 50,000개를 넘으면(예: 점 100만 개 산점도) 애니메이션을 생략합니다.
- 노드 10만 개의 그래프 물리는 CPU로는 실시간이 아닙니다. 먼저 `warmup()`으로 배치한 뒤 렌더링만 하거나, 스텝을 덜 자주 돌리거나, WebGPU에서 `stepPhysicsAsync`를 쓰세요.
- WebGL2 폴백에서는 산점도·히트맵·다중 시리즈 차트의 WebAssembly 메모리 최대치가 1.6~2.4배 컸습니다.

### 측정하세요

`sdk.getRenderStats()`는 GPU 버퍼·텍스처 바이트, 마지막 프레임이 업로드한 바이트, staged 마크 수, WebAssembly 메모리 크기를 반환합니다(카운터가 없는 백엔드에서는 `null`).

## 벤치마크 요약

`web/bench/` 하네스로 한 대의 머신에서 측정했습니다: Apple M1, 헤드리스 Chrome 156, 960 × 540 캔버스, DPR 1, 60 Hz. 정상상태는 휠 줌과 드래그 팬 3초입니다(막대는 hover 스윕). 다른 머신과 브라우저에서는 수치가 달라집니다.

| 시나리오 | TTFF ms WebGPU / WebGL2 | 정상상태 프레임 med / p95 / max ms | 누락 vsync / 프레임 | 프레임당 작업 med ms | GPU MB |
|---|---|---|---|---|---|
| line-1m-1s | 16.7 / 16.6 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 0.7 |
| line-10m-1s | 91.8 / 92.3 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 0.7 |
| area-stacked-1m | 26.9 / 25.6 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 5.3 |
| scatter-1m | 46.1 / 46.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 32.7 |
| scatter-5m | 210 / 244 | 83.3 / 117 / 117 | 144/37 | 1.6 | 128.7 |
| bar-10k | 19.0 / 19.1 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.2 |
| heatmap-4096 | 92.9 / 96.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 64.7 |
| candle-1m | 33.2 / 33.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 0.7 |
| stream-1m | 15.9 / 16.2 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 0.7 |

TTFF와 프레임 시간은 16.7 ms vsync로 양자화됩니다. 16.7은 "한 프레임 안"이라는 뜻입니다. `stream-1m`은 1M 창에 프레임마다 점 10k개를 추가합니다.

그래프 레이아웃, 정상상태 3초(2026-10-27, 레이아웃이 GPU 상주로 바뀌기 전):

| 노드 / 엣지 | CPU 물리 ms / FPS | 하이브리드 GPU 물리 ms / FPS |
|---|---|---|
| 10k / 20k | 17.74 / 52.7 | 6.23 / 60.0 |
| 100k / 200k | 285.76 / 3.7 | 41.87 / 19.6 |

라이브러리 비교(uPlot, ECharts, Chart.js, Plotly, ChartGPU, SciChart, Highcharts, three.js, deck.gl, cosmos.gl, 3d-force-graph), 전체 측정 방법, 알려진 한계는 [벤치마크 방법](../contributing/benchmarks)에 있습니다. 직접 돌려 보려면 `cd web && npm run bench`.

## 함께 보기

- [실시간 스트리밍](./streaming)
- [공유 GPU 디바이스](./shared-device)
- [3D 네트워크 그래프](../charts/graph-3d)
