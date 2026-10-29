# 캘린더 히트맵

`renderCalendarHeatmap`은 하루에 셀 하나를 벽걸이 달력처럼 주 단위로 배치하고, 값에 따라 셀을 색칠합니다. 커밋 수, 매출, 센서 가동률처럼 몇 달에서 몇 년에 걸친 일별 활동을 볼 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/heatmap.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderCalendarHeatmap(
  [
    ['2023-01-02', 4],
    ['2023-01-03', 7],
    ['2023-01-05', null], // 데이터 없음
  ],
  { range: 2023, firstDay: 1, title: '일별 커밋', valueLabel: '커밋' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderCalendarHeatmap(data: CalendarHeatmapData, options?: CalendarHeatmapOptions): { dayCount: number; calendarCount: number }
```

## 데이터 형식

```ts
type CalendarDate = string | number | Date;
type CalendarHeatmapData = ArrayLike<readonly [CalendarDate, number | null | undefined]>;
```

- `'YYYY-MM-DD'` 문자열은 적힌 날짜 그대로 씁니다. 시간대를 적용하지 않습니다.
- 에포크 밀리초, `Date` 객체, 시각이 있는 ISO 문자열(`'2023-01-02T09:00Z'`)은 차트 시간대 기준의 날짜로 셉니다. 시간대는 `options.timeZone`, 없으면 SDK 시간대(`setTimeZone`, 기본 `'local'`)입니다. `Z`나 오프셋이 없는 시각은 먼저 브라우저 시간대로 읽습니다(`Date.parse`). [데이터와 축](../guide/data-and-axes)을 참고하세요.
- 값이 `null`, `undefined`, `NaN`이면 데이터가 없는 날입니다. 같은 날이 두 번 나오면 마지막 값을 씁니다.
- 어느 범위에도 들지 않는 날은 무시합니다. `'2023-02-30'`처럼 잘못된 날짜는 예외를 던집니다.

## 범위와 여러 캘린더

`range`는 캘린더 하나를, `ranges`는 여러 개를 지정합니다. 여러 캘린더는 위에서 아래로 쌓이고(가로), 세로 방향에서는 나란히 놓입니다.

| 값 | 의미 |
| --- | --- |
| `2023` 또는 `'2023'` | 한 해 전체 |
| `'2023-02'` | 한 달 |
| `'2023-02-14'` | 하루 |
| `['2023-01-15', '2023-03']` | 양 끝을 포함하는 구간. 끝이 월이나 연도면 그 마지막 날까지 |

`range`와 `ranges`가 없으면 데이터가 걸친 해마다 캘린더를 하나씩 만듭니다(데이터가 없으면 올해). 시작이 끝보다 늦은 범위는 예외를 던집니다. 모든 범위를 합쳐 최대 40,000일입니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `range` | `CalendarRange` | 데이터의 연도 | 캘린더 하나. |
| `ranges` | `CalendarRange[]` | | 여러 캘린더. `range`보다 우선합니다. |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | 가로: 주가 왼쪽에서 오른쪽으로, 요일이 행. 세로: 주가 위에서 아래로, 요일이 열. |
| `cellSize` | `number` | 맞춤 | 셀 한 변의 최대 크기(CSS px). 플롯에 맞게 줄어듭니다. |
| `cellGap` | `number` | `2` | 셀 사이 간격(CSS px). |
| `firstDay` | `number` | `0` | 주의 첫 요일: `0` 일요일 ~ `6` 토요일. 다른 값은 예외를 던집니다. |
| `dayLabels` | `boolean \| { show?, names? }` | `true` | 요일 이름. `names`: 일요일부터 7개. 셀이 작으면 한두 행씩 건너뜁니다. |
| `monthLabels` | `boolean \| { show?, names? }` | `true` | 월 이름. `names`: 1월부터 12개. 겹치는 레이블은 생략합니다. |
| `yearLabel` | `boolean` | `true` | 캘린더마다 연도(여러 해에 걸치면 `2023–2024`). |
| `splitLine` | `boolean \| { show?, color?, width? }` | `true` | 월 경계선. 기본 색은 테마 기준선, 두께 1 px. |
| `colorScale` | `HeatmapColorScale` | `'sequential'` | 색상 맵. [히트맵](./heatmap)과 같습니다: `'sequential'`, `'viridis'`, `'magma'`, `'diverging'`, … |
| `color` | `ColorInput` | | sequential / diverging 스케일의 색조. |
| `reverse` | `boolean` | `false` | 색상 맵을 뒤집습니다. |
| `min`, `max`, `center` | `number` | 데이터 범위 | 값 도메인. `center`는 diverging의 중앙값. |
| `emptyColor` | `ColorInput` | 테마 그리드 색 | 데이터가 없는 날의 색. |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | `true` | 캘린더 오른쪽 컬러바(`title` 기본값은 `valueLabel`). |
| `timeZone` | `CharturboTimeZone` | SDK 시간대 | 에포크 밀리초 / `Date`를 날짜로 바꿀 때의 시간대. |
| `valueLabel` | `string` | `'Value'`(현지화) | 툴팁, 데이터 표, 컬러바의 값 이름. |
| `format` | `ChartValueFormat` | 로캘 숫자 | 툴팁과 접근성의 값 텍스트. [숫자 · 날짜 형식](../guide/number-format) 참고. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근 가능한 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

요일과 월 이름은 차트 로캘(`setLocale`)을 따릅니다. 캘린더에는 범례가 없습니다.

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다. 데이터가 없는 날을 포함해 어느 날이든 마우스를 올리면 셀이 강조되고 날짜와 값이 보입니다. 브러시, 확대/축소, 이동은 꺼져 있습니다. 데이터 포인트 id는 모든 캘린더의 날짜를 순서대로 센 값입니다(첫 캘린더의 첫날이 `0`).

툴팁 컨텍스트([툴팁과 호버](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'calendar'
// ctx.index = 날짜 id
// ctx.calendar = { date: '2023-01-02', day, value, calendar }  // value가 NaN이면 데이터 없음
```

## 참고 사항

- 레이아웃, 월 경계선, 레이블 위치, 히트 테스트, 색상 맵은 엔진(Rust)에서 계산합니다. 셀은 벡터 마크라서 `exportChartSVG`가 SVG 경로로 씁니다.
- 접근성: 요약은 기간, 데이터가 있는 날 수, 값 범위를 알려 줍니다. 데이터 표와 `exportChartCSV`는 데이터가 있는 날(날짜, 값)을 나열합니다. 키: 위 / 아래는 하루, 왼쪽 / 오른쪽은 한 주(세로 방향에서는 반대), Page Up / Page Down은 한 달, Home / End는 첫날 / 마지막 날로 이동합니다. [접근성](../guide/accessibility)을 참고하세요.
- React / Vue: `type="calendar"`.

## 함께 보기

- [히트맵](./heatmap)
- [데이터와 축](../guide/data-and-axes)
- [툴팁과 호버](../guide/tooltips)
