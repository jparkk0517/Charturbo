# 오차 막대 · 임펄스

서로 독립된 샘플을 위한 두 가지 단독 차트입니다. 오차 막대 차트는 각 중심값 주위에 하한에서 상한까지 수염을 그립니다. 임펄스(스템) 차트는 기준선에서 각 샘플까지 줄기를 그립니다. 두 차트 모두 선처럼 이웃 샘플을 잇거나 데시메이션하지 않습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#08-error-bars)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderErrorBarChart([
  { name: '측정값', x: [1, 2, 3], values: [10, 15, 12], errorLow: 2, errorHigh: [3, 5, 4],
    capWidth: 12, showCenter: true },
]);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// 임펄스 차트
sdk.renderImpulseChart([
  { name: '이벤트', x: [0, 1, 2, 3], values: [0, 5, -3, 0], baseline: 0, showMarker: true },
]);
sdk.render();
```

```ts
renderErrorBarChart(
  series: ErrorBarSeriesDescriptor[],
  options?: ErrorBarChartOptions
): { totalPoints: number; seriesCount: number }

renderImpulseChart(
  series: ImpulseSeriesDescriptor[],
  options?: ImpulseChartOptions
): { totalPoints: number; seriesCount: number }
```

## 데이터 형식 {#data-format}

두 차트는 다음 시리즈 필드를 함께 씁니다.

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 범례와 툴팁에 쓰는 이름. |
| `values` | `Float32Array \| number[]` | — | 중심값(오차 막대) 또는 샘플 값(임펄스). |
| `x` | `Float64Array \| number[] \| Date[]` | 인덱스 | 유한하고 감소하지 않아야 합니다. 모든 시리즈에 주거나, 어느 시리즈에도 주지 않습니다. |
| `color` | `ColorInput` | 테마 팔레트 | 시리즈 색. |
| `lineWidth` | `number` | 차트 값, 없으면 `1.5` | 선 두께(CSS px). |
| `yAxis` | `'left' \| 'right'` | `'left'` | 오른쪽 y축. |

### 오차 막대 범위

오차 막대 시리즈는 세 가지 표현 중 정확히 하나를 씁니다.

| 필드 | 의미 |
|---|---|
| `low`, `high` | 절대 범위. 값마다 하나. 뒤바뀐 범위는 서로 바꿉니다. |
| `error` | 대칭 상대 오차: 숫자 또는 배열. |
| `errorLow`, `errorHigh` | 비대칭 상대 오차: 숫자 또는 배열. |

상대 오차는 절댓값을 써서 `values`를 중심으로 적용합니다. 표현을 섞으면 예외를 던집니다.

### 오차 막대 스타일

이 필드는 시리즈마다 지정하거나, 옵션에서 차트 전체 기본값으로 지정할 수 있습니다. 시리즈 값이 우선합니다.

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `errorMode` | `'both' \| 'high' \| 'low'` | `'both'` | `'both'`는 low ↔ high를 그립니다. `'high'` / `'low'`는 중심 ↔ 해당 범위를 그립니다. |
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'`: `low` / `high`가 x 좌표이고 `values`가 y 좌표입니다. |
| `capWidth` | `number \| string` | `'40%'` | 캡 전체 길이: CSS px 숫자, 또는 평균 카테고리 간격에 대한 백분율 문자열(`'55%'`). |
| `drawWhiskers` | `boolean` | `true` | 캡을 그립니다. |
| `drawConnector` | `boolean` | `true` | 범위 사이 줄기를 그립니다. |
| `showCenter` | `boolean` | `false` | 중심값에 마커를 표시합니다. |
| `symbolSize` | `number` | `6` | 중심 마커 크기. |

- 사용하는 범위나 중심값이 유한하지 않은 샘플은 빈틈이 됩니다.
- `direction: 'horizontal'`이면 중심 마커는 `(x, values)`에 놓입니다. 상대 오차와 한쪽 줄기는 ChartGPU v0.4.0과 마찬가지로 여전히 `values`를 기준으로 합니다. 일반적인 가로 신뢰 구간에는 절대 `low` / `high`와 `errorMode: 'both'`를 쓰세요.

### 임펄스 스타일

시리즈마다, 또는 차트 전체 기본값으로 지정합니다.

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `baseline` | `number` | `0` | 데이터 단위의 줄기 바닥. |
| `showMarker` | `boolean` | `true` | 원형 끝 마커. 값이 기준선과 같으면 줄기는 생략하고 마커만 남깁니다. |
| `symbolSize` | `number` | `6` | 끝 마커 크기. |

## 옵션 {#options}

`ErrorBarChartOptions`와 `ImpulseChartOptions`는 `viewMode`, `nulls`, `animation`을 뺀 모든 [선 차트 옵션](./line#options)을 받고, 위 스타일 필드를 기본값으로 받습니다. `lineWidth` 기본값은 `1.5`입니다. 두 차트 모두 2D 전용이고 샘플링 옵션이 없습니다.

```ts
sdk.renderErrorBarChart(
  [{ name: '추정치', x: [12, 20, 28], values: [1, 2, 3],
     low: [5, 8, 20], high: [22, 35, 39], direction: 'horizontal', showCenter: true }],
  { title: '신뢰 구간', capWidth: 16, axes: { x: { title: '효과' } } }
);
```

## hover, 툴팁, 선택 {#hover-tooltips-and-selection}

- 포인터는 실제 줄기, 캡, 마커로 hit 테스트합니다.
- XY 브러시는 데이터 단위로 상자를 지나는 줄기 / 범위를 선택합니다. CSS px 단위 캡 너비는 브러시 범위에 들어가지 않습니다.
- 툴팁 `chartType`과 선택 `kind`는 `'errorBar'` 또는 `'impulse'`입니다. 오차 막대 항목에는 `errorBar: { low, high, direction }`이, 임펄스 항목에는 `baseline`이 들어 있습니다.
- 키보드 툴팁과 CSV는 중심, low, high(오차 막대) 또는 값과 기준선(임펄스)을 제공합니다. SVG 내보내기는 벡터 경로를 씁니다.
- 색, 오른쪽 y축, 범례, 줌, 팬을 지원합니다.

[툴팁과 hover](../guide/tooltips), [상호작용](../guide/interactions) 참고.

## 데이터 갱신 {#updating-data}

모든 채널을 넣어 `renderErrorBarChart` 또는 `renderImpulseChart`를 다시 호출합니다. `setSeriesData`와 `appendSeriesData`는 두 차트 종류 모두에서 예외를 던집니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="errorBar" data={series} options={{ capWidth: 12 }} />
<CharturboChart type="impulse" data={series} />
```

[React](../guide/react), [Vue](../guide/vue) 참고.

추가 예제: [가로 오차 막대](https://jparkk0517.github.io/Charturbo/line.html#09-error-horizontal), [임펄스](https://jparkk0517.github.io/Charturbo/line.html#10-impulse).

## 함께 보기 {#see-also}

- [선](./line)
- [밴드 · 범위](./band)
- [막대](./bar) — 막대의 오차 막대
