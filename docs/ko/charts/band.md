# 밴드 · 범위

밴드 차트는 중심선 없이 두 가장자리 사이를 채웁니다. 단독으로 보여 줄 예측 범위, 최소–최대 포락선, 신뢰 구간에 씁니다. 선 아래에 밴드를 그리려면 선 시리즈의 `band` 옵션을 쓰세요([선](./line#range-band) 참고).

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#06-band)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBandChart(
  [{
    name: '예측 범위',
    x: new Float64Array([0, 1, 2, 3]),
    lower: [8, 12, 20, 11],
    upper: [12, 18, 16, 15], // 교차 허용: 채널 순서를 유지함
    lowerLineWidth: 1.5,
    upperLineWidth: 1.5,
  }],
  { fillOpacity: 0.3, axes: { x: { title: '시간' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBandChart(
  series: BandSeriesDescriptor[],
  options?: BandChartOptions
): { totalPoints: number; seriesCount: number }
```

가장자리 한 쌍이 시리즈 하나입니다.

## 데이터 형식 {#data-format}

`BandSeriesDescriptor`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 범례와 툴팁에 쓰는 이름. |
| `lower` | `Float32Array \| number[]` | — | 첫 번째 가장자리. 이름은 관례일 뿐이며, `upper`와 교차해도 그대로 유지합니다. |
| `upper` | `Float32Array \| number[]` | — | 두 번째 가장자리. `lower` 샘플마다 값 하나. |
| `x` | `Float64Array \| number[] \| Date[]` | — | 각 쌍의 x. 유한하고 감소하지 않아야 합니다. 모든 시리즈에 주거나, 어느 시리즈에도 주지 않습니다. |
| `color` | `ColorInput` | 테마 팔레트 | 채우기와 가장자리 색. |
| `yAxis` | `'left' \| 'right'` | `'left'` | 오른쪽 y축. |
| `curve` | `LineCurve` | `'linear'` | 가장자리 보간 방식. 선 차트와 같습니다. |
| `lowerLineWidth` | `number` | 차트 값, 없으면 `0` | 아래 가장자리 선 두께(CSS px). `0` = 채우기만. |
| `upperLineWidth` | `number` | 차트 값, 없으면 `0` | 위 가장자리 선 두께(CSS px). |
| `fillOpacity` | `number` | 차트 값, 없으면 `0.25` | 시리즈 색에 곱하는 알파, 0..1. |
| `connectNulls` | `boolean` | 차트 값, 없으면 `false` | 결측 쌍을 건너 잇기. |

- 한 시리즈 안에서 `lower`, `upper`, `x`는 길이가 같아야 합니다.
- 시간 축을 쓰려면 `axes.x.type: 'time'` 또는 `Date[]`를 쓰세요.
- 어느 한쪽 가장자리에 잘못된 값이 있는 쌍은 쌍 전체가 빈틈이 됩니다. `connectNulls: true`이면 이웃한 유효한 쌍을 잇습니다.
- 가장자리가 교차하는 곳에서는 엔진이 실제 교점에서 채우기 삼각형을 나눕니다.

## 옵션 {#options}

`BandChartOptions`는 `viewMode`, `lineWidth`, `nulls`, `animation`을 뺀 모든 [선 차트 옵션](./line#options)을 받고, 시리즈 필드의 차트 전체 기본값을 추가합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `lowerLineWidth` | `number` | `0` | 아래 가장자리 선 두께 기본값(CSS px). |
| `upperLineWidth` | `number` | `0` | 위 가장자리 선 두께 기본값(CSS px). |
| `fillOpacity` | `number` | `0.25` | 채우기 알파 배수 기본값. |
| `connectNulls` | `boolean` | `false` | 결측 쌍을 건너 잇기 기본값. |

시리즈 값이 차트 값보다 우선합니다. 밴드 차트는 항상 2D입니다.

## hover, 툴팁, 선택 {#hover-tooltips-and-selection}

- 대용량 데이터 LOD는 두 채널의 최솟값과 최댓값, 그리고 빈틈을 남깁니다.
- hover와 XY 브러시는 중간점이 아니라 실제 범위로 판정합니다.
- 툴팁 `chartType`과 선택 `kind`는 `'band'`입니다. `items[].band`에 원래 두 가장자리가 들어 있습니다. `items[].value`는 선택에 쓰는 내부 중간점입니다.
- 키보드 탐색, 범례, 축, 줌, 팬, SVG 내보내기를 지원합니다. CSV 내보내기는 두 가장자리만 씁니다.

[툴팁과 hover](../guide/tooltips), [상호작용](../guide/interactions) 참고.

## 데이터 갱신 {#updating-data}

두 가장자리를 모두 넣어 `renderBandChart`를 다시 호출합니다. `setSeriesData`와 `appendSeriesData`는 채널 하나만 갱신하게 되므로 밴드 차트에서는 예외를 던집니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="band" data={series} options={{ fillOpacity: 0.3 }} />
```

[React](../guide/react), [Vue](../guide/vue) 참고.

## 함께 보기 {#see-also}

- [선](./line) — 선 아래의 `band` 옵션
- [영역](./area)
- [오차 막대 · 임펄스](./errorbar-impulse)
