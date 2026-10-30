# 극좌표

`renderPolarChart`는 극좌표계에 시리즈를 그립니다. 원을 도는 각도 축과 중심에서 바깥으로 가는 반지름 축을 씁니다(ECharts `polar` + `angleAxis` / `radiusAxis`). 두 축 모두 범주 축이나 값 축이 될 수 있습니다. 시리즈는 방사형 막대, 링 막대, 누적 막대, 선(열림 · 닫힘, 곡선, 채움), 산점, 히트맵 셀을 지원합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#08-polar-bar)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'Sales', data: [5, 8, 3, 6, 9, 4], roundCap: true },
      { type: 'bar', name: 'Cost', data: [3, 4, 6, 2, 5, 7] },
    ],
  },
  { title: 'Weekly sales', angleAxis: { data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, innerRadius: 0.15 }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderPolarChart(data: PolarChartData, options?: PolarChartOptions): { seriesCount: number; itemCount: number }
```

## 데이터 형식

```ts
interface PolarChartData { series: PolarSeriesOptions[] }

interface PolarSeriesOptions {
  type: 'bar' | 'line' | 'scatter' | 'heatmap';
  name?: string;
  data: ArrayLike<number | null> | ReadonlyArray<ReadonlyArray<number | string | null>>;
  stack?: string;
  color?: ColorInput;
  roundCap?: boolean;   // 막대
  smooth?: boolean;     // 선
  area?: boolean;       // 선
  closed?: boolean;     // 선
  symbolSize?: number;  // 선 / 산점, CSS px
  lineWidth?: number;   // 선, CSS px
}
```

- 범주 축이 정확히 하나면 막대 · 선 시리즈는 범주마다 값 하나인 단순 배열이 될 수 있습니다(`null` = 빈 값).
- 그 밖에는 ECharts처럼 `[반지름, 각도]` 쌍입니다. 히트맵 항목은 `[반지름, 각도, 값]` 셀입니다(`값`이 `null`이면 빈 셀). 범주 축의 좌표는 범주 이름이나 인덱스입니다.
- 막대는 범주 축이 정확히 하나여야 합니다. 각도 축이 범주 축이면 막대가 바깥으로 자라고(방사형 막대), 반지름 축이 범주 축이면 원을 따라 돕니다(링 막대).
- 히트맵은 각도 축과 반지름 축이 모두 범주 축이어야 합니다.
- 같은 `stack` 이름의 시리즈는 쌓입니다. 양수와 음수는 따로 쌓습니다.
- 한도: 시리즈 64개, 항목 200,000개, 축마다 범주 10,000개.
- 입력은 현재 차트를 바꾸기 전에 검증합니다. 예외가 나면 이전 차트가 그대로 남습니다.

## 축

```ts
interface PolarAxisOptions {
  type?: 'category' | 'value'; // 기본: data가 있으면 'category', 없으면 'value'
  data?: string[];             // 범주 이름
  min?: number;
  max?: number;
  splitNumber?: number;        // 눈금 개수 힌트, 기본 5
  labels?: boolean;            // 기본 true
  splitLine?: boolean;         // 원(반지름) / 방사선(각도), 기본 true
  name?: string;               // 툴팁 / 표 이름
}
```

값 축은 데이터에 맞춘 깔끔한 눈금을 씁니다. 반지름 축은 0에서 시작합니다. 각도 축이 한 바퀴 전체를 덮을 때 마지막 눈금이 첫 눈금과 겹치거나 너무 가까우면 뺍니다.

```ts
sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'A', data: [40, 28, 35, 22], stack: 'total' },
      { type: 'bar', name: 'B', data: [25, 30, 18, 26], stack: 'total' },
    ],
  },
  { radiusAxis: { data: ['N', 'S', 'E', 'W'] }, angleAxis: { max: 100 }, startAngle: 90 }
);
```

[라이브 예제: 누적 링 막대](https://jparkk0517.github.io/Charturbo/business.html#09-polar-stacked)

## 선과 산점

```ts
const curve = Array.from({ length: 36 }, (_, k) => [2 + Math.sin(k / 3), k * 10]);
sdk.renderPolarChart(
  {
    series: [
      { type: 'line', name: 'Curve', data: curve, smooth: true, closed: true, area: true },
      { type: 'scatter', name: 'Points', data: [[1, 30], [3.5, 140], [4, 250]], symbolSize: 8 },
    ],
  },
  { angleAxis: { min: 0, max: 360 }, radiusAxis: { max: 5 } }
);
```

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#10-polar-line)

## 극좌표 히트맵

```ts
const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
sdk.renderPolarChart(
  { series: [{ type: 'heatmap', name: 'Requests', data: days.flatMap((d) => hours.map((h, i) => [d, h, i % 7])) }] },
  { angleAxis: { data: hours }, radiusAxis: { data: days }, innerRadius: 0.2, colorScale: 'viridis' }
);
```

색은 [히트맵](./heatmap)의 색상 맵(`colorScale`, `color`, `reverse`, `min` / `max` / `center`)과 컬러바를 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#11-polar-heatmap)

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `angleAxis` | `PolarAxisOptions` | 값 축 | 각도 축. |
| `radiusAxis` | `PolarAxisOptions` | 값 축 | 반지름 축. |
| `startAngle` | `number` | `0` | 각도 축 시작 위치. 12시 방향에서 시계 방향 각도(파이 · 코드와 같음). ECharts는 3시 방향에서 반시계 방향으로 잽니다. |
| `clockwise` | `boolean` | `true` | 각도 축이 시계 방향으로 갑니다. |
| `innerRadius` | `number` | `0` | 가운데 구멍. 바깥 반지름에 대한 비율(0 ~ 0.9). |
| `barCategoryGap` | `number` | `0.2` | 범주 사이 간격. 범주 폭에 대한 비율(0 ~ 0.95). |
| `barGap` | `number` | `0.3` | 한 범주 안 막대 사이 간격. 막대 폭에 대한 비율(-1 ~ 10). |
| `palette` | `ColorInput[]` | 테마 팔레트 | 시리즈 색. |
| `showGrid` | `boolean` | `true` | 분할 원과 방사선. |
| `legend` | `boolean \| ChartLegendOptions` | 시리즈 2개 이상이면 표시 | 시리즈 범례. 마우스를 올리면 강조, 클릭하면 숨김. |
| `colorScale` · `color` · `reverse` | | `'sequential'` | 히트맵 색상 맵(`renderHeatmap`과 같음). |
| `min` · `max` · `center` | `number` | 데이터 범위 | 히트맵 값 범위. |
| `emptyColor` | `ColorInput` | 테마 격자 색 | 값이 없는 히트맵 셀. |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | 히트맵이 있으면 표시 | 히트맵 컬러바. |
| `valueLabel` | `string` | `'값'`(로캘) | 툴팁 · 표 · 컬러바의 히트맵 값 이름. |
| `format` | `ChartValueFormat` | 로캘 숫자 | 툴팁 · 레이블 · 접근성의 값 표기. [숫자 · 날짜 형식](../guide/number-format) 참고. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

잘못된 입력은 예외를 던집니다: 알 수 없는 시리즈 · 축 타입, 범주 축이 정확히 하나가 아닌 막대 시리즈, 범주 축이 둘이 아닌 히트맵, 알 수 없는 범주, 유한하지 않은 값 · 범위, `min >= max`, 범위를 벗어난 `innerRadius` / `barCategoryGap` / `barGap` / `symbolSize` / `lineWidth`, 너무 많은 시리즈 · 항목 · 범주.

## 상호작용

`enableNodeInteractions(canvas)`로 켭니다.

- 막대나 셀에 마우스를 올리면 외곽선을 그리고, 선과 점은 가까운 것을 잡습니다. 툴팁은 시리즈, 각도 · 반지름 좌표, 값을 보여 줍니다.
- 범례에 마우스를 올리면 시리즈를 강조합니다. 클릭하면 시리즈를 숨기고 막대를 다시 쌓고 값 축을 다시 맞춥니다. `animation`이 켜져 있으면 새 레이아웃으로 트윈됩니다.
- 브러시, 줌, 팬은 꺼집니다.

데이터 포인트 id: 시리즈 `s`의 항목 `i`는 `s` 앞 시리즈들의 항목 수 + `i`입니다.

툴팁 컨텍스트([툴팁과 호버](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'polar'
// ctx.polar = { series, seriesName, type, index, angle, radius, value }
// angle / radius: 범주 이름 또는 형식화한 값. value: 히트맵은 셀 값, 그 밖에는 값 축 좌표
```

## 참고 사항

- 축 스케일, 눈금, 막대, 선, 셀, 격자, 히트 테스트, 강조, 레이블 위치는 엔진(Rust)에서 계산합니다. 마크는 벡터 도형이라 `exportChartSVG`가 SVG 경로로 씁니다.
- 접근성: 요약(시리즈 수, 두 축의 범위). 데이터 표와 `exportChartCSV`는 모든 항목(시리즈, 각도, 반지름, 히트맵이면 값)입니다. 키보드: 왼쪽 / 오른쪽은 시리즈 안 항목 이동, 위 / 아래는 시리즈 변경, Home / End는 처음 / 마지막 항목, Page Up / Page Down은 10개씩 이동. [접근성](../guide/accessibility) 참고.
- 레이블 폭은 추정값(11px 글자당 약 6.8px)입니다.
- React / Vue: `type="polar"`.

## 함께 보기

- [레이더](./radar)
- [파이 · 도넛](./pie)
- [히트맵](./heatmap)
