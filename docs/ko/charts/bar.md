# 막대

막대 차트는 카테고리 사이의 값을 비교합니다. `renderBarChart`는 단일 시리즈를 그리고, `renderGroupedBarChart`는 여러 시리즈를 그룹, 누적, 100% 누적으로 그립니다. 막대는 세로 또는 가로로 그릴 수 있고, 데이터 라벨과 오차 막대를 붙이거나 조명이 적용된 3D 매트릭스 보기로 바꿀 수 있습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '북부', values: [10, 20, 30, 40] },
      { name: '남부', values: [5, -5, 15, NaN] }, // NaN = 값 없음
    ],
  },
  { mode: 'stacked', title: '매출' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBarChart(
  items: BarChartItemDescriptor[],
  options?: BarChartOptions
): { barCount: number }

renderGroupedBarChart(
  data: GroupedBarChartData,
  options?: GroupedBarChartOptions
): { barCount: number; seriesCount: number; categoryCount: number }
```

## 데이터 형식 {#data-format}

### 단일 시리즈

`renderBarChart`는 막대마다 항목 하나를 받습니다.

```ts
sdk.renderBarChart(
  [
    { label: '월', value: 42, error: 4 },
    { label: '화', value: 37 },
  ],
  { labels: true, legend: true, seriesName: '방문' }
);
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `label` | `string` | 카테고리 라벨. |
| `value` | `number` | 막대 값. 음수는 0 기준선 아래로 내려갑니다. |
| `error` | `number \| [number, number] \| null` | 오차 막대: 값 단위의 `±e` 또는 `[minus, plus]`(2D). |
| `category` | `string` | 선택 사항인 그룹 키. `color` 옵션이 없으면 같은 카테고리의 항목은 팔레트 색 하나를 함께 쓰고, 단일 시리즈 범례에 카테고리가 나열됩니다. |
| `color` | `ColorInput` | 막대 색. 카테고리 색과 `color` 옵션보다 우선합니다. |
| `attributes` | `Record<string, string \| number \| boolean>` | 막대 상세 정보(`getNodeDetails`, 클릭 콜백)에 병합할 추가 키 / 값. |

데이터 포인트 id는 막대 인덱스입니다.

### 다중 시리즈

`renderGroupedBarChart`는 `{ categories, series }`를 받습니다. 모든 시리즈는 카테고리마다 값 하나를 가지며, `NaN`은 값 없음입니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `categories` | `string[]` | 카테고리 라벨. |
| `series[].name` | `string` | 시리즈 이름. |
| `series[].values` | `Float32Array \| number[]` | 카테고리마다 값 하나. |
| `series[].error` | `(number \| [number, number] \| null)[]` | 카테고리별 오차 막대(`null` = 없음). |
| `series[].color` | `ColorInput` | 기본: 시리즈 순서대로 테마 팔레트. |

데이터 포인트 id = `seriesIndex * categories.length + categoryIndex`.

## 옵션 {#options}

`BarChartOptions`(두 메서드 공통):

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | 평면 막대 또는 조명이 적용된 3D 매트릭스. 다중 시리즈 3D는 첫 시리즈만 보여 줍니다. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | 가로 막대(2D만). |
| `labels` | `boolean \| 'auto' \| BarLabelOptions` | 끔 | 데이터 라벨(2D). [데이터 라벨](#data-labels) 참고. |
| `errorBars` | `BarErrorBarStyle` | — | 오차 막대 모양. [오차 막대](#error-bars) 참고. |
| `background` | `boolean \| BarBackgroundOptions` | 끔 | 막대마다 값 축 전체 길이로 그리는 배경 트랙(2D). [배경 트랙](#background-tracks) 참고. |
| `legend` | `ChartLegendOptions \| boolean` | 다중: 시리즈 2개 이상이면 표시, 단일: 숨김 | 단일 시리즈: 항목 `category` 값의 정적 범례, 또는 `seriesName` 이름의 항목 하나. |
| `seriesName` | `string` | `'값'` (로캘별) | 단일 시리즈 차트의 범례 항목 이름. |
| `color` | `ColorInput` | 팔레트 첫 색 | `color`가 없는 항목의 기본 막대 색. |
| `cornerRadius` | `number` | `4` | 데이터 끝 쪽 모서리 둥글기(CSS px, 2D). |
| `barThickness` | `number` | 슬롯의 72% | 월드 단위 막대 너비. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 축 제목과 형식. `'horizontal'`이면 `x`가 값 축, `y`가 카테고리 축입니다. `axes.x.labelRotate`는 x축 눈금 라벨을 회전합니다. [라벨 회전](#label-rotation) 참고. |
| `hover` | `ChartHoverStyle` | — | hover 스타일. 예: `barHighlightColor`. |
| `grid` | `ChartGridStyle` | — | 그리드 행 수, 색, 선 두께. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. |
| `width` | `number` | `164` | 플롯의 월드 너비. |
| `maxBarHeight` | `number` | `78` | 가장 높은 막대의 월드 높이. |

`GroupedBarChartOptions`는 다음을 추가합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `mode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | 시리즈를 나란히, 누적, 또는 100% 누적으로 배치합니다. |
| `groupGap` | `number` | `0.28` | 각 카테고리 슬롯에서 그룹 사이에 비우는 비율. `barThickness`를 주면 무시합니다. |
| `barGap` | `number` | `2` | 그룹 안 막대 사이 또는 누적 구간 사이 간격(CSS px). |

## 모드 {#modes}

- `grouped`: 각 카테고리 슬롯 안에 시리즈가 나란히 놓입니다.
- `stacked`: 양수는 위로, 음수는 아래로 따로 쌓습니다. 값 축은 누적 합을 씁니다. 바깥쪽 구간 끝만 둥글게 합니다.
- `percent`: 각 카테고리의 절댓값 합을 100%로 정규화합니다. y 라벨에 `%`가 붙습니다.

## 가로 막대 {#horizontal-bars}

```ts
sdk.renderGroupedBarChart(data, { orientation: 'horizontal' });
```

- 카테고리는 왼쪽 축을 따라 위에서 아래로 놓이고, 첫 카테고리가 맨 위입니다. 라벨은 약 18 px당 하나로 솎아 냅니다.
- 값은 nice 눈금과 세로 그리드 선이 있는 x축을 따라 놓입니다. 둥근 끝은 오른쪽을 향합니다(음수는 왼쪽).
- 단일, 그룹, 누적, 퍼센트 막대에서 모두 됩니다. 왼쪽 여백은 카테고리 라벨 길이에 맞춥니다.
- 가로 막대에서는 브러시가 꺼집니다. 주석은 x = 값, y = 카테고리 인덱스를 씁니다.
- 3D 막대와 히스토그램은 항상 세로입니다.

## 데이터 라벨 {#data-labels}

```ts
sdk.renderGroupedBarChart(data, {
  labels: { show: 'auto', position: 'inside', format: { maximumFractionDigits: 1 } },
});
```

`labels`는 `true`, `'auto'`, `BarLabelOptions`를 받습니다.

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `show` | `boolean \| 'auto'` | `true` | `'auto'`는 안에 들어가지 않는 inside 라벨을 바깥으로 옮기고, 캔버스를 벗어나거나 다른 라벨과 겹치거나 다른 막대를 가리는 라벨은 숨깁니다. |
| `position` | `'outside' \| 'inside' \| 'insideBase' \| 'center'` | `'outside'` | `'outside'`는 데이터 끝과 그 오차 막대보다 바깥입니다. |
| `format` | 함수, 형식 문자열, `Intl.NumberFormatOptions` | 값 축 형식 | `(value, ctx) => string`, `'.1f'`나 `'$,.0f'` 같은 형식 문자열, 또는 `Intl` 옵션. 퍼센트 막대는 비율을 형식화합니다. |
| `color` | `ColorInput` | 자동 | outside: 테마 텍스트 색. inside: 막대 휘도에 따라 밝은 색 또는 어두운 색. |
| `rotate` | `number` | `0` | 텍스트 회전 각도(도), 양수 = 반시계 방향, -90~90. [라벨 회전](#label-rotation) 참고. |

- 엔진이 라벨 앵커, 맞춤, 충돌 판정을 CSS px로 계산하고, DOM은 텍스트를 배치만 합니다. 라벨은 PNG 내보내기에 포함됩니다.
- 누적 구간 라벨은 항상 안쪽(가운데)에 놓이고, 텍스트가 들어갈 때만 보입니다.
- 형식 문자열은 [숫자·날짜 형식](../guide/number-format)에 설명되어 있습니다.

## 오차 막대 {#error-bars}

항목에는 `error`를, 시리즈에는 `error[]`를 지정합니다: 값 단위의 `±e` 또는 `[minus, plus]`.

| `errorBars` 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `color` | `ColorInput` | 테마 보조 텍스트 색 | 선 색. |
| `width` | `number` | `1.25` | 선 두께(CSS px). |
| `cap` | `number` | `0.4` | 막대 두께에 대한 캡 길이 비율. `0` = 캡 없음. |

엔진은 캡이 달린 선분을 그리고 이를 값 도메인에 포함합니다(누적 막대: 구간의 누적 끝 기준, 퍼센트 모드는 오차를 무시). 툴팁은 `±e` 또는 `+p / −m`(`ChartTooltipItem.error`)을 보여 줍니다.

## 배경 트랙 {#background-tracks}

```ts
sdk.renderBarChart(items, { background: true });
sdk.renderGroupedBarChart(data, { mode: 'stacked', background: { color: '#94a3b8', opacity: 0.18 } });
```

ECharts `showBackground`처럼 `background`는 막대마다 값 축 전체 길이의 트랙을 막대와 같은 폭 · 모서리로 막대 뒤에 그립니다.

| `background` 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `color` | `ColorInput` | 테마 `baseline`, 알파 × 0.2 | 트랙 색(ECharts 기본 트랙은 `rgba(180,180,180,0.2)`). |
| `opacity` | `number` | `1` | 색 알파에 곱하는 값, 0~1. |

- grouped 막대는 막대 칸마다 트랙 하나를 그리며, 값이 없는 칸도 포함합니다(ECharts와 같음). stacked · percent 막대는 카테고리마다 하나입니다.
- 시리즈를 숨기면 그 트랙도 사라집니다. 등장 애니메이션 동안 트랙은 전체 길이를 유지합니다.
- 트랙은 hover 대상이 아닙니다.
- 2D 막대 차트 전용입니다. 3D 뷰, 히스토그램, 폭포, 콤보 차트에서는 지원하지 않습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html#04-background)

## 라벨 회전 {#label-rotation}

```ts
sdk.renderGroupedBarChart(data, {
  labels: { rotate: 90, position: 'insideBase' },
  axes: { x: { labelRotate: 30, format: (i) => categories[i] ?? '' } },
});
```

두 옵션 모두 ECharts `label.rotate`, `axisLabel.rotate`처럼 도 단위 각도를 받으며, 양수가 반시계 방향이고 범위는 -90~90입니다(범위 밖 값은 잘라 냄).

- `labels.rotate`는 막대 값 라벨을 회전합니다. 위치, 안쪽 들어맞음 판정, `'auto'` 충돌 숨김은 회전된 텍스트의 외곽 상자로 판정합니다. 모든 `position`과 가로 막대에도 적용됩니다.
- `axes.x.labelRotate`는 x축 눈금 라벨을 회전합니다(x축 전용). ECharts처럼 양수면 글자 끝이, 음수면 글자 시작이 눈금에 붙습니다. 라벨은 회전된 차지 영역 기준으로 솎아 내고, 자동으로 정한 아래 여백은 회전된 높이만큼 늘어납니다(직접 준 `padding.bottom`은 유지).
- 회전한 카테고리 라벨은 이름 전체를 보여 줍니다. 회전하지 않은 카테고리 이름은 12자를 넘으면 줄입니다.
- 카테고리 축이 아닌 x축은 첫 배치 후 아래 여백이 한 번 늘어날 수 있습니다.
- 지원하지 않음: y축 라벨 회전, 폭포 차트 값 라벨 회전, 양 끝 라벨이 좌우로 넘칠 때의 여백 확보.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html#05-label-rotation)

## 범례, hover, 선택 {#legend-hover-and-selection}

- 다중 시리즈 범례: 클릭하면 시리즈를 숨기고 엔진이 다시 배치하거나 다시 쌓습니다(값 축은 고정). hover하면 다른 시리즈를 흐리게 합니다. `setSeriesVisible(i, false)`와 `emphasizeSeries(i)`도 같은 일을 합니다.
- hover: 그룹 막대는 포인터 아래 막대를 반환합니다. 누적 / 퍼센트 막대는 해당 카테고리의 모든 시리즈를 반환하고(툴팁 `ctx.total`, `item.percent`), 포인터 아래 구간이 primary 항목입니다.
- 브러시 선택은 항상 카테고리의 x 범위를 선택합니다.

[툴팁과 hover](../guide/tooltips), [상호작용](../guide/interactions) 참고.

## 데이터 갱신 {#updating-data}

막대 차트에는 부분 갱신 메서드가 없습니다. 새 데이터로 `renderBarChart` 또는 `renderGroupedBarChart`를 다시 호출하세요. 스타일만 바꿀 때: `setChartHoverStyle`, `setChartGrid`.

## 프레임워크 {#frameworks}

`type="bar"`는 항목 배열(단일 시리즈) 또는 `{ categories, series }`를 받습니다.

```tsx
<CharturboChart type="bar" data={{ categories, series }} options={{ mode: 'stacked' }} />
```

## 함께 보기 {#see-also}

- [히스토그램](./histogram)
- [콤보](./combo) — 막대와 선
- [숫자·날짜 형식](../guide/number-format)
