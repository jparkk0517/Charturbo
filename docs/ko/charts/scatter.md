# 산점도 · 버블

2D 산점도는 점마다 GPU 인스턴스 하나를 그립니다. 점은 한 번만 업로드하므로 1,000,000개 이상의 점에서도 60 FPS를 유지합니다. 점마다 크기를 주면 버블 차트가 됩니다. 두 변수 사이의 관계나 군집의 모양을 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderScatterChart(
  { x: xs, y: ys, clusters: seriesIds },
  {
    title: '세그먼트 분포',
    seriesNames: ['A', 'B', 'C'],
    axes: { x: { title: 'x' }, y: { title: 'y' } },
    pointRadius: 3,
    opacity: 0.85,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 휠: x/y 줌, 드래그: 팬
sdk.render();
```

```ts
renderScatterChart(
  data: ScatterChartData,
  options?: ScatterChartOptions
): { pointCount: number; trendlines: ScatterTrendlineFit[] }
```

데이터 포인트 id = 점 인덱스. `trendlines`에는 `trendline` 옵션의 적합 결과가 들어 있습니다(옵션이 없으면 빈 배열). [회귀선](#trendlines) 참고.

## 데이터 형식 {#data-format}

`ScatterChartData`는 점마다 항목 하나씩 갖는 병렬 배열입니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `x` | `Float32Array \| number[]` | x 좌표. |
| `y` | `Float32Array \| number[]` | y 좌표. |
| `sizes` | `Float32Array \| number[]` | 선택 사항. 점별 반지름(CSS px, 버블 차트). 기본: `pointRadius`. |
| `clusters` | `Uint16Array \| number[]` | 선택 사항. 점별 시리즈 id: 범례 항목, 팔레트 색, 표시 토글에 씁니다. |
| `colors` | `Float32Array \| number[]` | 선택 사항. 점별 RGBA(`4 * N`개 값, 0..1). 시리즈 색보다 우선합니다. |
| `z` | `Float32Array \| number[]` | 지원 중단이며 무시합니다. 차트는 2D입니다. |

시리즈 id는 `seriesNames`와 `seriesColors`의 인덱스입니다.

### 버블 차트

```ts
sdk.renderScatterChart(
  { x: gdp, y: lifeExpectancy, sizes: radiusPx, clusters: region },
  {
    seriesNames: ['아프리카', '아메리카', '아시아', '유럽'],
    opacity: 0.7,
    axes: { x: { title: '1인당 GDP', scale: 'log', format: '$,.0f' }, y: { title: '년' } },
  }
);
```

`sizes`를 주면 기본으로 각 점에 표면 색의 1 px 링이 붙으므로(`pointRing`) 겹친 버블도 알아볼 수 있습니다.

## 옵션 {#options}

`ScatterChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `seriesNames` | `string[]` | `Series <id>` | 각 시리즈 id의 범례와 툴팁 이름. |
| `seriesColors` | `ColorInput[]` | 테마 팔레트, 순환 | 각 시리즈 id의 색. |
| `pointRadius` | `number` | `3` | `sizes`가 없을 때 점 반지름(CSS px). |
| `opacity` | `number` | `0.85` | 채우기 알파 배수. 값을 낮추면 밀도가 드러납니다. |
| `pointRing` | `number` | `sizes`가 있으면 `1`, 없으면 `0` | 각 점 둘레의 표면 색 링(CSS px). |
| `symbol` | `'circle' \| 'square' \| 'diamond' \| 'triangle'` | `'circle'` | 모든 시리즈의 점 심볼. [심볼](#symbols) 참고. |
| `seriesSymbols` | `(ScatterSymbol \| undefined)[]` | — | 시리즈 id별 심볼. 빈 항목은 `symbol`을 씁니다. |
| `ripple` | `ScatterRippleOptions \| boolean` | 꺼짐 | 선택한 시리즈의 점 둘레에 퍼지는 고리. `true` = 모든 시리즈, 기본값. [파동 효과](#ripple-effect) 참고. |
| `jitter` | `{ x?: number; y?: number; seed?: number }` | 꺼짐 | 겹친 점을 데이터 단위의 고정된 무작위 오프셋으로 흩뜨립니다. [지터](#jitter) 참고. |
| `trendline` | `ScatterTrendline \| ScatterTrendline[]` | — | 시리즈마다 맞춘 회귀선. [회귀선](#trendlines) 참고. |
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | 제목, 형식, `scale: 'log'`, `reverse`, `tickCount`. [데이터와 축](../guide/data-and-axes) 참고. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이거나 회귀선이 있으면 표시 | 토글과 강조가 되는 시리즈 범례. |
| `hover` | `ChartHoverStyle` | `hitRadius: 12` | 산점도는 항상 가장 가까운 점을 고릅니다. |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `verticalGrid` | `boolean` | `true` | x 눈금 위치의 세로 그리드 선. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. |
| `width` | `number` | `168` | 플롯의 월드 너비. |
| `height` | `number` | `94` | 플롯의 월드 높이. |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | 지원 중단: `'2d'`만 지원합니다. |

## 상호작용 {#interactions}

- 휠은 x와 y를 함께 줌하고, 드래그는 팬하고, 더블클릭은 초기화합니다. `zoomChartXY(factor, anchorNdcX?, anchorNdcY?)`, `setXRange`, `setYRange`, `resetChartZoom`으로 코드에서 같은 일을 합니다.
- 줌과 팬은 변환 uniform만 갱신합니다. 점은 데이터나 보이는 시리즈가 바뀔 때만 다시 업로드합니다.
- hover는 엔진의 균일 그리드 해시로 가장 가까운 점을 찾습니다. 기본 12 px 이내, 또는 버블 자신의 반지름 이내입니다. 툴팁은 시리즈, x, y(`ctx.point`)를 보여 줍니다.
- 브러시 선택(`brush: 'xy'`)은 같은 공간 해시로 점을 선택합니다. `selection.ids`에는 보이는 시리즈의 점 id가 들어 있습니다.

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
sdk.on('select', (sel) => console.log(`점 ${sel.count}개 선택됨`));
```

[상호작용](../guide/interactions), [툴팁과 hover](../guide/tooltips) 참고.

## 로그 축 {#log-axes}

`scale: 'log'`는 log10을 쓰고 10의 거듭제곱에 눈금을 둡니다. 로그 축에서 값이 0 이하인 점은 그리지 않습니다.

## 심볼 {#symbols}

```ts
sdk.renderScatterChart(
  { x, y, clusters },
  {
    seriesNames: ['북서', '북동', '남서', '남동'],
    pointRadius: 4,
    seriesSymbols: ['circle', 'square', 'diamond', 'triangle'],
  }
);
```

- `symbol`은 모든 시리즈의 모양을, `seriesSymbols`는 시리즈 id별 모양을 정합니다.
- 모양은 선 마커와 같은 signed distance 함수로 안티에일리어싱하며, 원과 비슷한 시각적 무게를 가집니다.
- hover 마커, SVG 내보내기, 범례 견본도 같은 모양을 씁니다. 삼각형 견본은 `▲` 글자라 이미지 내보내기에도 그대로 나옵니다.
- hit test는 모든 심볼을 원으로 취급합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html#03-symbols)

## 파동 효과 {#ripple-effect}

```ts
sdk.renderScatterChart(
  { x, y, clusters, sizes },
  {
    seriesNames: ['측정값', '경보'],
    seriesColors: ['#64748b', '#ef4444'],
    ripple: { series: [1], period: 4, scale: 3, count: 3, fill: false },
  }
);
sdk.setEffectTime(1.5); // 주기의 1.5초 시점에 고정 (스크린샷, 내보내기)
sdk.setEffectTime(null); // 다시 재생
```

ECharts `effectScatter`처럼 선택한 시리즈의 각 점 뒤로 고리가 점 반지름에서 `scale`배까지 커지며 `period`초 동안 사라집니다.

`ScatterRippleOptions`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `series` | `number[]` | 모든 시리즈 | 파동을 그릴 시리즈 id. |
| `period` | `number` | `4` | 고리 한 주기의 초(최소 0.1). |
| `scale` | `number` | `2.5` | 가장 바깥 고리 반지름 / 점 반지름, 1~10. |
| `count` | `number` | `3` | 동시에 보이는 고리 수, 1~8. 주기를 고르게 나눕니다. |
| `fill` | `boolean` | `false` | 1.5 px 선 대신 반투명하게 채운 고리. |

- 프레임마다 바뀌는 것은 시간 uniform 하나뿐입니다. SDK는 파동이 보일 때만 `requestAnimationFrame` 루프를 돌립니다. 차트가 바뀌면 스스로 멈추고, 숨긴 탭에서는 브라우저가 멈춥니다.
- `prefers-reduced-motion: reduce`이면 정지 프레임 하나만 그립니다.
- `setEffectTime(seconds)`는 고리를 주기의 해당 시점에 고정하고, `null`은 다시 재생합니다.
- 파동이 있는 동안 차트를 매 프레임 다시 그리므로 전체 데이터가 아니라 소수의 점을 강조할 때 쓰세요. SVG 내보내기에는 고리가 없습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html#04-ripple)

## 지터 {#jitter}

```ts
sdk.renderScatterChart(
  { x: serviceIndex, y: latencyMs, clusters: serviceIndex },
  { seriesNames: services, opacity: 0.6, jitter: { x: 0.28 } }
);
```

- ggplot2 `geom_jitter`처럼 각 점을 `[-x, x]`, `[-y, y]` 데이터 단위(로그 축은 10의 거듭제곱 단위)의 균등 오프셋만큼 옮깁니다. `x`와 `y`의 기본값은 `0`(해당 축은 오프셋 없음)입니다.
- 오프셋은 점 인덱스와 `seed`(기본 `0`)로만 정해지므로 다시 그려도 같은 그림이 나옵니다.
- 오프셋은 점을 배치할 때 더하므로 축 범위, hover, 브러시, 공간 해시가 흩뜨린 위치를 씁니다. 툴팁, 데이터 표, CSV는 원래 값을 보여 줍니다.
- ECharts의 픽셀 단위 · 겹침 회피(beeswarm) 지터와는 다릅니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html#05-jitter)

## 회귀선 {#trendlines}

```ts
const { trendlines } = sdk.renderScatterChart(data, {
  seriesNames: ['제품 A', '제품 B'],
  trendline: { type: 'linear' },                 // 또는 회귀선 배열
});
trendlines[0].expression; // 예: 'y = 1.234x + 5.6'
trendlines[0].r2;
sdk.getScatterTrendlines(); // 현재 차트의 같은 적합 결과, 다른 차트는 []
```

ECharts ecStat `regression`처럼 각 회귀선을 선택한 시리즈마다 최소제곱으로 맞추고 점 아래에 그립니다.

`ScatterTrendline`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `type` | `'linear' \| 'exponential' \| 'logarithmic' \| 'polynomial'` | — | 회귀 모델. 필수. |
| `order` | `number` | `2` | 다항식 차수, 2~6 정수(Excel 다항식 추세선도 6까지). |
| `series` | `number[]` | 모든 시리즈 | 맞출 시리즈 id, 각각 선 하나. |
| `color` | `ColorInput` | 시리즈 색 | 선 색. |
| `width` | `number` | `2` | 선 굵기(CSS px). |
| `dash` | `number[]` | 실선 | 점선 패턴(CSS px), `[on, off]` 또는 `[on, off, on, off]`. |

모델:

- `'linear'`: `y = a + bx`, 일반 최소제곱.
- `'logarithmic'`: `y = a + b·ln(x)`. `x > 0`인 점만 맞춥니다.
- `'exponential'`: `y = a·e^(bx)`, ecStat과 같은 y 가중 로그 최소제곱. `y > 0`인 점만 맞춥니다.
- `'polynomial'`: x의 오름차순 거듭제곱 계수, x를 [−1, 1]로 정규화해 풉니다.

R²는 모든 모델에서 원래 y 기준 `1 − SS_res / SS_tot`입니다(ecStat은 R²를 주지 않음). 모델의 정의역 밖에 있는 점은 빠지며, 그 수는 범례, 접근성 설명, `skipped`에 나옵니다.

- 곡선은 보이는 x 범위(줌, 로그 축 포함)에 걸쳐 그리며, 곡률에 맞춰 잘게 나눕니다.
- 범례에 각 선이 `y = … (R² = …)`로 나오므로, 회귀선이 있으면 범례를 기본으로 표시합니다. 시리즈가 여러 개면 시리즈 이름이 앞에 붙습니다.
- 범례와 접근성 설명 텍스트는 차트 로캘을 따릅니다.
- `type`, `order`, `series`, `width`, `dash`가 잘못되면 예외가 발생합니다.

`ScatterTrendlineFit` (`renderScatterChart`와 `getScatterTrendlines()`가 반환):

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `ScatterTrendlineType` | 모델. |
| `order` | `number` | 다항식 차수(다항식 적합만). |
| `series` | `number` | 맞춘 시리즈 id. |
| `coefficients` | `number[]` | linear, exponential, logarithmic은 `[a, b]`, polynomial은 `[c0, …, ck]`. 서로 다른 점이 너무 적으면 빈 배열. |
| `r2` | `number` | R² (적합 결과가 없거나 모든 y가 같으면 `NaN`). |
| `points` | `number` | 적합에 쓴 점 수. |
| `skipped` | `number` | 모델 정의역 밖이라 적합에서 뺀 유한한 점 수. |
| `expression` | `string` | 식 텍스트, 예: `y = 1.234x + 5.6`(적합 결과가 없으면 빈 문자열). |
| `color`, `width`, `dash` | `RgbaTuple`, `number`, `number[]` | 확정된 선 스타일. |

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html#06-trendline)

## 데이터 갱신 {#updating-data}

새 배열로 `renderScatterChart`를 다시 호출합니다. 다시 업로드하지 않고 시리즈 id를 숨기려면 `setSeriesVisible`을 쓰세요.

## 참고 사항 {#notes}

- 산점도는 2D 전용입니다. `z`와 `viewMode: '3d'`는 무시합니다. 3D 점은 [PointCloud3D · Surface3D](./scientific-3d)를 참고하세요.
- 산점도에서는 오차 막대를 지원하지 않습니다.

## 함께 보기 {#see-also}

- [선](./line)
- [히트맵](./heatmap) — 매우 조밀한 데이터를 그리드로
- [상호작용](../guide/interactions)
