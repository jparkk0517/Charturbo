# 선

Rust 엔진이 GPU에서 그리는 다중 시리즈 선 차트입니다. 엔진은 각 시리즈를 화면 해상도에 맞게 데시메이션(M4, 스파이크 보존)하므로 1,000,000개 이상의 점이 있어도 60 FPS를 유지합니다. 센서 데이터, 지표, 가격, 시계열 같은 연속 시리즈에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = Float32Array.from({ length: 50_000 }, (_, i) => Math.sin(i * 0.05) * 40);
sdk.renderLineChart([{ name: '센서', values }], {
  title: '센서 데이터',
  axes: { x: { title: '샘플' }, y: { title: '값' } },
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // hover, 휠 줌, 드래그 팬
sdk.render();
```

```ts
renderLineChart(
  seriesList: LineSeriesDescriptor[],
  options?: LineChartOptions
): { totalPoints: number; seriesCount: number }
```

데이터 포인트 id는 시리즈 오프셋에 샘플 인덱스를 더한 값입니다.

## 데이터 형식 {#data-format}

각 시리즈는 `LineSeriesDescriptor`입니다. `values`는 `Float32Array`(큰 데이터에 권장) 또는 `number[]`를 받습니다. `NaN`, `null`, `undefined`는 결측 샘플입니다(`nulls` 참고).

`x`는 선택 사항입니다. 모든 시리즈에 주거나, 어느 시리즈에도 주지 않습니다.

- `x`가 없으면 샘플은 인덱스에 따라 같은 간격으로 놓이고 `xLabelPrefix`로 라벨이 붙습니다(`T+120`).
- `x`가 있으면 각 값이 자기 x를 가집니다(`Float64Array`, `number[]`, `Date[]`, `values`와 같은 길이). 값은 유한하고 오름차순이어야 합니다(같은 값은 허용). 아니면 예외를 던집니다. 간격은 불규칙해도 되고, 시리즈마다 길이가 달라도 됩니다.
- `Date[]`를 주면 기본으로 시간 축을 씁니다. epoch 밀리초 숫자는 `axes.x.type: 'time'`이 필요합니다.

```ts
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] 또는 epoch ms
    { name: 'GPU', values: gpu, x: otherTimestamps }, // 길이와 간격이 달라도 됨
  ],
  { axes: { x: { type: 'time' } }, locale: 'en-US' }
);
```

### 시리즈 필드

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 범례와 툴팁에 쓰는 이름. |
| `values` | `Float32Array \| number[]` | — | 샘플 값. `NaN` / `null` / `undefined`는 결측. |
| `x` | `Float64Array \| number[] \| Date[]` | — | 각 샘플의 x(위 참고). |
| `color` | `ColorInput` | 테마 팔레트 | 0..1 범위의 `[r, g, b, a]` 또는 CSS 색 문자열. |
| `lineWidth` | `number` | 차트 `lineWidth` | 이 시리즈의 선 두께(CSS px). |
| `yAxis` | `'left' \| 'right'` | `'left'` | `'right'`이면 두 번째 y축(`axes.y2`)을 켭니다. 2D 선 차트에서만 됩니다. |
| `marker` | `LineMarkerOptions \| boolean` | — | 점 마커. `true`면 기본값을 씁니다. [선 스타일](#line-styles) 참고. |
| `dash` | `number[]` | 실선 | CSS px 단위 대시 패턴. 예: `[6, 3]`. |
| `curve` | `'linear' \| 'step' \| 'stepBefore' \| 'stepAfter' \| 'monotone'` | `'linear'` | 샘플 사이 보간 방식. |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | 차트 `nulls` | 이 시리즈의 결측 샘플 처리 방식. |
| `band` | `{ lower, upper, opacity? }` | — | 선 아래에 채우는 범위 밴드. [범위 밴드](#range-band) 참고. |
| `pointSize` | `number` | — | 지원 중단. `marker: { size }`로 매핑됩니다. |

## 옵션 {#options}

`LineChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 플롯 위의 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. 자동 요약을 대신하고, 자동 요약은 설명으로 옮겨 갑니다. |
| `viewMode` | `'2d' \| '2.5d'` | `'2d'` | 평면 2D 차트 또는 2.5D 원근 보기. |
| `lineWidth` | `number` | `2` | 모든 시리즈의 선 두께(CSS px). 줌과 관계없이 일정합니다. |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | 결측 샘플 처리: 선을 끊거나, 이웃을 잇거나, 0으로 그립니다. 시리즈 `nulls`가 우선합니다. |
| `axes` | `{ x?: LineXAxisOptions; y?: LineYAxisOptions; y2?: LineYAxisOptions }` | — | 축 제목, 형식, 스케일, y 도메인. `y2`는 시리즈에 `yAxis: 'right'`가 있을 때만 씁니다. [데이터와 축](../guide/data-and-axes) 참고. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이면 표시 | `{ show, toggle, emphasize }`. 클릭하면 시리즈를 토글하고, hover하면 나머지를 흐리게 합니다. |
| `hover` | `ChartHoverStyle` | — | 십자선과 hover 마커. [툴팁과 hover](../guide/tooltips) 참고. |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `grid` | `ChartGridStyle` | — | 그리드 행 수, 색, 선 두께. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). 생략한 쪽은 제목, 범례, 축에 맞춥니다. |
| `xLabelPrefix` | `string` | `'T'` | 시리즈에 `x`가 없을 때 x 라벨의 접두사(`T+120`). |
| `locale` | `string` | SDK 로케일 | 숫자 / 시간 라벨과 툴팁 값의 로케일. |
| `timeZone` | `CharturboTimeZone` | SDK 시간대, 없으면 `'local'` | 시간 x축의 시간대. |
| `navigator` | `boolean \| { height?: number }` | 끔 | 플롯 아래의 범위 선택 띠(2D만). 높이는 CSS px, 기본 48. |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. [애니메이션](../guide/animation) 참고. |
| `width` | `number` | `168` | 플롯의 월드 너비(가로세로 비율을 정합니다). |
| `height` | `number` | `86` | 플롯의 월드 높이. |

## 선 스타일 {#line-styles}

```ts
sdk.renderLineChart(
  [
    { name: '예측', values: forecast, curve: 'monotone', dash: [6, 3],
      band: { lower: lo, upper: hi, opacity: 0.2 } },
    { name: '실제', values: actual, marker: { shape: 'diamond', size: 8, show: 'auto' } },
    { name: '비율', values: rate, curve: 'stepAfter', nulls: 'connect' },
  ],
  { nulls: 'gap' } // 차트 기본값; 시리즈 `nulls`가 우선
);
```

`marker`(`LineMarkerOptions`):

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `shape` | `'circle' \| 'square' \| 'diamond' \| 'triangle' \| 'none'` | `'circle'` | `'none'`이면 마커를 끕니다. |
| `size` | `number` | `6` | 지름(CSS px). |
| `fill` | `ColorInput` | 시리즈 색 | 마커 채우기 색. |
| `stroke` | `ColorInput` | 차트 표면 색 | 구분용 외곽선. |
| `strokeWidth` | `number` | `1` | 외곽선 두께(CSS px). |
| `show` | `'auto' \| 'always' \| 'never'` | `'auto'` | `'auto'`는 데시메이션 후 보이는 점 사이가 8 CSS px 이상일 때만 마커를 보여 줍니다. 그래서 줌인하면 마커가 나타납니다. |

- `dash`: CSS px 단위의 `[on, off]` 또는 `[on, off, on, off]`. `[a]`는 `[a, a]`이고, 값이 3개면 앞의 2개를 씁니다. 엔진이 폴리라인을 따라 패턴 위상을 계산하므로 대시가 선분 경계를 넘어 이어집니다.
- `curve`: `'step'`은 중간 지점에서 꺾고, `'stepBefore'` / `'stepAfter'`는 샘플 위치에서 꺾습니다. `'monotone'`은 Fritsch–Carlson 단조 3차 보간입니다(오버슈트 없음). 곡선은 데시메이션 뒤에 적용합니다.
- `nulls`: `'gap'`은 선을 끊습니다. `'connect'`는 이웃을 잇습니다. `'zero'`는 샘플을 0에 그립니다(이때 값 축이 0을 포함합니다).

## 범위 밴드 {#range-band}

`band`는 선 아래에 범위(신뢰 구간, 최소–최대 포락선)를 시리즈 색으로 채웁니다.

- `lower` / `upper`는 샘플마다 값 하나를 가집니다(`NaN` = 결측). `opacity`는 시리즈 색의 알파에 곱합니다(기본 `0.2`).
- 밴드 LOD는 픽셀 열마다 lower 최솟값과 upper 최댓값을 남기므로, 1M 점에서도 극값이 사라지지 않습니다. 값 축은 밴드를 포함합니다.
- 밴드는 시리즈의 범례 항목을 함께 씁니다. 툴팁은 `value lower – upper`(`item.band`)를 보여 줍니다. 데이터 표와 CSV에는 `<name> lower`, `<name> upper` 열이 추가됩니다.
- 선 차트에서만 됩니다. 영역 차트는 `band`를 무시합니다. 중심선 없는 밴드는 [밴드 · 범위](./band)를 쓰세요.
- `appendSeriesData`로 추가한 샘플에는 밴드가 없습니다. 길이가 다른 데이터로 `setSeriesData`를 호출하면 밴드가 사라집니다.

## 데이터 갱신 {#updating-data}

```ts
sdk.setSeriesData(0, values, x);                                // 시리즈 하나 교체
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 100_000 }); // 추가하고 가장 오래된 샘플 버림
sdk.render();
```

| 메서드 | 설명 |
|---|---|
| `setSeriesData(seriesIndex, values, x?)` | 시리즈 하나를 교체합니다. 스타일, 범례 상태, 줌은 유지합니다. 새 샘플 수를 반환합니다. `x`는 차트를 `x`와 함께 렌더링했을 때만 필요합니다. |
| `appendSeriesData(seriesIndex, values, x?, options?)` | 샘플을 추가합니다. 새 `x`는 시리즈의 마지막 x보다 작으면 안 됩니다. `maxPoints`는 가장 최근 샘플만 남깁니다. 새 샘플 수를 반환합니다. |
| `setLineWidth(widthPx, seriesIndex?)` | 모든 시리즈 또는 시리즈 하나의 선 두께를 바꿉니다. |
| `setSeriesVisible(seriesIndex, visible)` | 범례 클릭과 같습니다. |
| `emphasizeSeries(seriesIndex \| null)` | 나머지 시리즈를 흐리게 합니다. `null`이면 해제합니다. |

데이터 포인트 id는 갱신할 때마다 다시 매겨집니다. 줌 창이 오른쪽 끝에 닿아 있으면 새 데이터를 따라갑니다. [실시간 스트리밍](../guide/streaming) 참고.

## Y 도메인과 축 {#y-domain-and-axes}

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // 현재 옵션에 병합
sdk.getYDomain();                     // [min, max]
```

- `autoscale`: `'all'`(기본, 전체 데이터 범위), `'visible'`(줌 창 안의 보이는 시리즈), `'none'`(한 번 구한 뒤 유지).
- `scale: 'log'`, `reverse`, `tickCount`는 `axes.x`, `axes.y`, `axes.y2`에서 동작합니다. 로그 x축에는 양수 숫자 `x`가 필요합니다.
- `yAxis: 'right'`인 시리즈는 자기 도메인을 가진 오른쪽 축을 추가합니다. 이 축에는 `setY2Domain` / `getY2Domain`을 씁니다. 이중 축은 조심해서 쓰세요. 두 범위를 어떻게 고르느냐에 따라 실제로 없는 교차가 보일 수 있습니다.

자세한 내용은 [데이터와 축](../guide/data-and-axes)에 있습니다.

## 상호작용 {#interactions}

`enableNodeInteractions(canvas)`를 호출하면 켜집니다.

- 휠은 x축을 줌하고, 드래그는 팬하고, 더블클릭은 초기화합니다. 터치에서는 한 손가락 팬, 핀치 줌, 탭으로 툴팁 고정, 길게 눌러 스크럽합니다.
- `hover.mode: 'index'`(기본)는 hover한 x의 모든 시리즈를 보여 주고, `'nearest'`는 가장 가까운 점만 보여 줍니다.
- 코드로 제어: `zoomChartX(factor, anchorNdcX?)`, `setXRange(min, max)`, `resetChartZoom()`.
- 브러시 선택, 내비게이터, 주석은 2D에서 지원합니다.

[상호작용](../guide/interactions), [툴팁과 hover](../guide/tooltips), [주석](../guide/annotations) 참고.

## 참고 사항 {#notes}

- 2.5D 보기는 항상 `'nearest'` hover를 씁니다. 여기서는 대시 위상과 monotone 세분화가 근사값입니다. 오른쪽 y축, 내비게이터, 브러시는 2D에서만 됩니다.
- 대시 시리즈와 마커는 강조 순서와 관계없이 실선 시리즈 위 레이어에 그립니다.
- `renderLineChart`는 툴팁과 접근성을 위해 `values`를 참조로 보관합니다. 호출 뒤에 값을 바꾸지 마세요.

## 함께 보기 {#see-also}

- [영역](./area)
- [밴드 · 범위](./band)
- [오차 막대 · 임펄스](./errorbar-impulse)
- [콤보](./combo)
- [실시간 스트리밍](../guide/streaming)
- [성능](../guide/performance)
