# 평행 좌표

`renderParallelChart`는 여러 축을 가로질러 행마다 폴리라인 하나를 그립니다(ECharts `parallel`). 축은 값 · 범주 · 시간 축이며 나란히 또는 위아래로 쌓아 놓습니다. 축을 따라 드래그하면 구간을 브러시하고, 브러시 밖의 행은 흐려집니다. 많은 레코드를 여러 차원에서 비교하고 대화형으로 걸러 낼 때 씁니다. 자동차, 상품, 실험 실행, 센서 로그 등에 맞습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#05-parallel)

## 기본 사용법

```ts
import { Charturbo, type ParallelChartData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const data: ParallelChartData = {
  dimensions: ['MPG', 'Horsepower', { name: 'Origin', categories: ['US', 'EU', 'JP'] }, { name: 'Year', type: 'time' }, { name: 'Weight', inverse: true }],
  series: [
    { name: 'Sedan', data: [[31, 88, 'JP', new Date('1978-01-01'), 2200], [24, 110, 'EU', new Date('1974-01-01'), 2700]] },
    { name: 'Truck', data: [[16, 150, 'US', new Date('1972-01-01'), 4100]] },
  ],
};
sdk.renderParallelChart(data, { title: 'Cars' });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderParallelChart(data: ParallelChartData, options?: ParallelChartOptions): { rowCount: number; dimensionCount: number; seriesCount: number }
setParallelBrush(intervals: ParallelBrushInterval[]): number   // 활성 행 수
clearParallelBrush(): void
getParallelBrush(): ParallelBrushRange[]
getParallelActiveRows(): number[]
exportParallelCSV(options?: { activeOnly?: boolean }): string
```

## 데이터 형식

```ts
interface ParallelChartData {
  dimensions: (string | ParallelDimension)[]; // 축 2~64개, 문자열은 값 축
  rows?: ParallelCell[][];                     // 시리즈 하나
  series?: ParallelSeries[];                   // 또는 시리즈별로 묶은 행
}

interface ParallelDimension {
  name: string;
  type?: 'value' | 'category' | 'time';        // 기본: 첫 셀에서 추론
  min?: number | string | Date;                // 기본: 데이터 범위를 보기 좋게 반올림
  max?: number | string | Date;
  inverse?: boolean;                           // 큰 값을 축 시작 쪽으로
  categories?: string[];                       // 축 순서(기본: 처음 나온 순서)
  format?: ChartValueFormat;                   // 눈금 · 툴팁 · 접근성 텍스트
}

interface ParallelSeries { name?: string; data: ParallelCell[][]; color?: ColorInput }

type ParallelCell = number | string | Date | null | undefined;
```

- 각 행은 차원마다 셀 하나를 가집니다. 문자열 셀은 범주, `Date`(또는 에포크 ms, 날짜 문자열)는 시간입니다.
- `null` / `undefined`는 결측값이며 그 축에서 선이 끊깁니다. 범주 셀에는 범주 인덱스도 쓸 수 있습니다.
- 최대 1,000,000행. 잘못된 입력(숫자가 아닌 값, 잘못된 날짜, 주어진 `categories`에 없는 이름, 길이가 다른 행, `max`보다 작지 않은 `min`, 없는 `colorBy`, 잘못된 색)은 현재 차트를 지우기 전에 에러를 던집니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | 가로: 축을 나란히, 값은 위로. 세로: 축을 쌓고, 값은 오른쪽으로. |
| `lineWidth` | `number` | `1` | 선 두께(CSS px). |
| `opacity` | `number` | `0.45` | 선 불투명도, 0~1. |
| `smooth` | `boolean` | `false` | 축 사이를 부드러운 곡선으로. |
| `colorBy` | `number \| string` | | 값 · 시간 차원으로 행에 히트맵 색상 맵을 입힙니다(컬러바 포함). |
| `colorScale` · `color` · `reverse` | | `'viridis'` | `colorBy`의 색상 맵, [히트맵](./heatmap)과 같습니다. |
| `colorRange` | `[number, number]` | 데이터 범위 | `colorBy`의 색 도메인. |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | 표시 | `colorBy`의 컬러바. |
| `brush` | `ParallelBrushInterval[]` | | 초기 브러시(이벤트 없음). |
| `brushable` | `boolean` | `true` | 포인터 · 키보드 브러시. |
| `inactiveOpacity` | `number` | `0.25` | 브러시 밖 행의 불투명도(`opacity` 기준 비율). |
| `inactiveColor` | `ColorInput` | 테마 grid 톤 | 브러시 밖 행이 흐려지는 색. |
| `brushColor` | `ColorInput` | 테마 crosshair, 알파 25% | 브러시 띠 색. |
| `axisColor` | `ColorInput` | 테마 baseline | 축 선 색. |
| `legend` | `ChartLegendOptions \| boolean` | `colorBy` 없이 시리즈 2개 이상 | 시리즈 범례, 클릭하면 시리즈를 켜고 끕니다. |
| `format` | `ChartValueFormat` | 로캘 숫자 | 자체 `format`이 없는 값 축의 값 텍스트. |
| `title` · `description` · `padding` | | | 제목, 접근 가능한 이름, 플롯 여백. |

```ts
sdk.renderParallelChart(data, { orient: 'vertical', smooth: true });
sdk.renderParallelChart(data, { colorBy: 'MPG', colorScale: 'magma', opacity: 0.6 });
```

## 브러시

- 축을 따라 드래그하면 그 축에 구간을 브러시합니다. Shift + 드래그는 같은 축에 구간을 하나 더 추가합니다. 드래그 없이 축을 클릭하면 그 축을 해제합니다.
- 한 축의 여러 구간은 합집합, 여러 축의 브러시는 교집합을 고릅니다. Escape는 브러시를 모두 해제합니다.
- 브러시가 바뀌면 GPU의 행별 플래그만 다시 씁니다. 선 기하는 `renderParallelChart`마다 한 번만 업로드합니다.
- `setParallelBrush`는 축 기준 구간(범주 이름 · 날짜 · 숫자, 순서 무관, 축마다 최대 16개)을 받습니다. `[]`는 해제입니다.

```ts
sdk.setParallelBrush([
  { dimension: 'Origin', range: ['EU', 'JP'] },
  { dimension: 'Weight', range: [1800, 2600] },
  { dimension: 'Weight', range: [3200, 3600] },
]);
sdk.on('parallelBrush', (e) => console.log(e.activeCount, e.total, e.intervals, e.source));
// e.source: 'pointer' | 'keyboard' | 'api'
const rows = sdk.getParallelActiveRows();          // 브러시 안의 행 인덱스
const csv = sdk.exportParallelCSV({ activeOnly: true });
```

React / Vue: `<CharturboChart type="parallel" data={...} options={...} onParallelBrush={...} />` (Vue: `@parallel-brush`).

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#06-parallel-brush)

## 성능

100,000행 × 8차원(선분 700,000개)도 대화형으로 동작합니다. CPU에서 차트 생성은 약 11 ms, 브러시 변경은 약 1 ms(플래그 400 KB 업로드), 호버 히트 테스트는 1 ms 미만입니다(release 빌드, 데스크톱). 대용량 예제는 생성 · 브러시 · 프레임 시간을 실시간으로 보여 줍니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html#07-parallel-large)

## 상호작용

`enableNodeInteractions(canvas)`로 켭니다. 호버는 가장 가까운 선을 강조하고 그 행의 모든 차원을 보여 줍니다. 줌 · 팬 · 커서 동기화는 꺼져 있습니다.

툴팁 컨텍스트([툴팁 · 호버](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'parallel'
// ctx.xLabel = 'Sedan · Row 12'
// ctx.parallel = { row, series, seriesName, values: [{ dimension, value, text }, ...] }
```

## 참고

- 접근성: 요약(행 · 차원 · 시리즈 수, 브러시 안의 행 수), 차원마다 범위나 범주를 알려 주는 문장, 브러시된 축마다 한 문장, 데이터 표. 키보드: Up / Down(세로: Left / Right)으로 포커스된 축의 값 순서대로 행을 이동하고, Left / Right(세로: Up / Down)로 축을 바꿉니다. Home / End, Page Up / Down을 지원합니다. Shift와 함께 이동하면 시작 위치부터 범위를 브러시하고, Delete는 포커스된 축을, Escape는 전부를 해제합니다. [접근성](../guide/accessibility) 참고.
- CSV 내보내기는 모든 행(시리즈, 차원별 열)을 담습니다. SVG 내보내기는 선 · 축 · 브러시 띠를 벡터로 그립니다.
- 레이블: 가로 배치에서는 눈금이 각 축 왼쪽, 이름이 플롯 위에 놓입니다. 세로 배치에서는 눈금이 각 축 아래, 이름이 왼쪽에 놓입니다.

## 함께 보기

- [히트맵](./heatmap) (색상 맵과 컬러바)
- [레이더](./radar)
- [툴팁 · 호버](../guide/tooltips)
