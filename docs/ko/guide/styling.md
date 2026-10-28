# 스타일과 테마

테마는 GPU 마크와 DOM 오버레이가 함께 쓰는 색을 정합니다. 배경, 시리즈 팔레트, 그리드선, 글자, 툴팁입니다. 그 위에 차트별 옵션으로 시리즈 색, 제목, 범례, 그리드, 여백, 선 두께를 정합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 내장 테마

```ts
import { Charturbo, CHARTURBO_THEMES } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.setTheme('light');          // 'dark'(기본) | 'light'
sdk.getTheme().name;            // 'light'
CHARTURBO_THEMES.dark.palette;  // RgbaTuple[]
```

각 내장 팔레트는 자기 배경에 대해 색각 이상 구분 검증을 통과한 8색 순서입니다.

## 커스텀 테마

기존 테마를 펼친 뒤 필요한 토큰만 덮어씁니다. GPU 색 토큰(`surface`, `palette`, `grid`, `baseline`, `crosshair`)에도 CSS 색 문자열을 쓸 수 있습니다.

```ts
sdk.setTheme('light');
sdk.setTheme({
  ...sdk.getTheme(),
  name: 'brand',
  surface: '#faf6ed',
  palette: ['#3182f6', '#14b8a6', '#f59e0b'],
  textPrimary: '#14213d',
  fontFamily: 'system-ui, sans-serif',
});
sdk.renderBarChart(
  [
    { label: 'A', value: 32, color: '#3182f6' },
    { label: 'B', value: 18, color: '#14b8a6' },
  ],
  { orientation: 'horizontal', cornerRadius: 8, labels: true }
);
sdk.render();
```

테마 토큰(`CharturboTheme`):

| 토큰 | 타입 | 설명 |
|---|---|---|
| `name` | `string` | 테마 이름 |
| `surface` | `RgbaTuple` | 캔버스 배경색 |
| `palette` | `RgbaTuple[]` | 시리즈 색 순서 |
| `grid` | `RgbaTuple` | 그리드선 |
| `baseline` | `RgbaTuple` | 기준선. 선 · 점 주석의 기본 색 |
| `crosshair` | `RgbaTuple` | 크로스헤어. 구간 주석의 기본 색 |
| `textPrimary` | `string` | 제목, 라벨 |
| `textSecondary` | `string` | 보조 글자 |
| `textMuted` | `string` | 흐린 글자 |
| `tooltipBackground` | `string` | 툴팁과 라벨 알약의 배경 |
| `tooltipBorder` | `string` | 툴팁과 라벨 알약의 테두리 |
| `fontFamily` | `string` | DOM 오버레이(제목, 범례, 눈금, 라벨, 툴팁)의 글꼴 |

`getTheme()`은 GPU 토큰을 CSS 문자열로 주었더라도 튜플로 돌려줍니다.

## setTheme이 바꾸는 것

`setTheme`은 배경, 글자, 그리드선, 툴팁, 주석 기본 색, 범위 선택기, 그리고 차트 종류별 테마 스타일(파이, 히트맵, 비즈니스, 계층 팔레트 등)을 갱신하고 `'themechange'`를 발생시킵니다.

render 호출에 직접 전달한 시리즈 · 항목 색은 유지됩니다. 이 색도 바꾸려면 새 옵션으로 `render*Chart()`를 다시 호출한 뒤 `render()`하세요.

[벤치마크 페이지](https://jparkk0517.github.io/Charturbo/benchmarks.html)는 이 방식으로 테마, 강조색, 팔레트, 글꼴, 모서리, 라벨을 바꿉니다. 미드나이트 · 페이퍼 테마는 예제의 커스텀 테마이며, SDK의 내장 문자열 테마는 `'light'`와 `'dark'`입니다.

## 시리즈 색

```ts
sdk.renderLineChart([
  { name: 'cpu', values: cpu, color: '#3b82f6' },
  { name: 'mem', values: mem, color: [0.94, 0.35, 0.33, 1] },
  { name: 'net', values: net }, // 다음 팔레트 색
]);
```

모든 색 옵션은 `ColorInput`을 받습니다.

- 0..1 범위의 `[r, g, b, a]` 튜플
- `'#rgb'`, `'#rgba'`, `'#rrggbb'`, `'#rrggbbaa'`, `rgb()` / `rgba()`, `hsl()` / `hsla()`: DOM 없이 파싱
- 그 밖의 CSS 색(이름 색 등): `document`가 있을 때 2D 캔버스로 해석

잘못된 문자열은 `TypeError`를 던집니다. 파서는 `parseColor`로 export됩니다.

## 제목과 범례

```ts
sdk.renderLineChart(series, {
  title: '인프라 텔레메트리',
  legend: { show: true, toggle: true, emphasize: true, position: 'top', overflow: 'scroll' },
});
sdk.setSeriesVisible(1, false); // 범례 클릭과 같음
sdk.emphasizeSeries(0);         // 다른 시리즈를 흐리게 (null = 해제)
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 플롯 위의 차트 제목 |
| `legend` | `boolean \| ChartLegendOptions` | 시리즈 2개 이상이면 표시 | `true` / `false` 또는 아래 객체 |
| `legend.show` | `boolean` | 시리즈 2개 이상이면 `true` | 범례 표시 |
| `legend.toggle` | `boolean` | `true` | 클릭으로 시리즈 표시 전환 |
| `legend.emphasize` | `boolean` | `true` | hover하면 다른 시리즈를 흐리게 |
| `legend.position` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | 범례가 놓이는 플롯의 쪽 |
| `legend.overflow` | `'scroll' \| 'wrap'` | `'scroll'` | 한 줄(위 · 아래) 또는 한 열(왼쪽 · 오른쪽)에 들어가지 않는 항목: 페이지로 나누거나 여러 줄로 줄바꿈 |

범례 항목은 `<button aria-pressed>` 요소라 키보드로도 조작됩니다. 전환하면 `'legendtoggle'`이 발생합니다.

### 범례 위치와 페이지 {#legend-position-and-paging}

```ts
sdk.renderLineChart(series16, { legend: { position: 'bottom' } });                   // 한 줄, 페이지 나눔
sdk.renderScatterChart(data, { legend: { position: 'right' } });                     // 한 열, 페이지 나눔
sdk.renderLineChart(series16, { legend: { position: 'top', overflow: 'wrap' } });    // 줄 추가
```

- `position`: `'top'`과 `'bottom'`은 해당 쪽 여백에 28 px 한 줄을 더합니다. `'left'`와 `'right'`는 가장 긴 이름에 맞춘 열(72~200 px)에 항목을 세로로 쌓고, 그 폭과 8 px 간격을 해당 쪽 여백에 더합니다. `padding`으로 지정한 쪽은 지정한 값을 유지합니다.
- `overflow: 'scroll'`(기본값): 범례는 한 줄 또는 한 열을 유지합니다. 실제로 잰 항목 크기로 페이지를 나누되 항목을 자르지 않고, ‹ n / m › 버튼으로 페이지를 넘깁니다. 크기가 바뀌면 페이지를 다시 나누고, 현재 첫 항목이 있는 페이지를 계속 보여 줍니다. 다른 페이지의 항목은 `display: none`이라 Tab 이동 순서와 이미지 내보내기에서 빠집니다.
- `overflow: 'wrap'`: 항목을 여러 줄로 줄바꿈합니다. 위 · 아래 범례 전용입니다(왼쪽 · 오른쪽 범례는 항상 페이지로 나눔). 늘어난 줄은 여백에 반영되지 않아 플롯을 덮을 수 있습니다.
- 페이지 버튼 라벨(`aria-label`)은 차트 로캘을 따릅니다. [다국어 지원](./i18n)을 참고하세요.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#11-legend-paged)

## 그리드

```ts
sdk.renderLineChart(series, { showBackdropGrid: true, grid: { rows: 4, strokeWidth: 1 } });
sdk.setChartGrid(true, { rows: 4, color: '#e5e7eb' }); // 렌더 후
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드선과 기준선 |
| `grid.rows` | `number` | `5` | 가로 그리드 간격 수 |
| `grid.color` | `ColorInput` | 테마 `grid` | 그리드선 색 |
| `grid.baselineColor` | `ColorInput` | 테마 `baseline` | 기준선 색 |
| `grid.strokeWidth` | `number` | `1` | 선 두께 CSS px |
| `verticalGrid` | `boolean` | `true` | 산점도 전용: x 눈금 위치의 세로 그리드선 |

## 여백

```ts
sdk.renderLineChart(series, { padding: { right: 24 } });
```

`padding`(`top`, `right`, `bottom`, `left`, CSS px)은 플롯 여백을 정합니다. 생략한 쪽은 제목, 범례, 축에 맞춰 계산합니다.

## 선 두께

```ts
sdk.renderLineChart(series, { lineWidth: 2 }); // 모든 시리즈, CSS px (기본 2)
sdk.setLineWidth(1.5);    // 렌더 후: 모든 시리즈
sdk.setLineWidth(4, 0);   // 0번 시리즈만
```

시리즈 `lineWidth`가 차트 값보다 우선합니다. 두께는 줌과 무관하게 일정합니다. 마커, 점선, 곡선은 [선](../charts/line)에서 설명합니다.

## CSS 클래스

오버레이는 일반 DOM이므로 CSS로 꾸밀 수 있습니다.

| 클래스 | 요소 |
|---|---|
| `.charturbo-sdk-chart-overlay` | 캔버스 위 오버레이 루트 |
| `.charturbo-sdk-chart-title` | 제목 |
| `.charturbo-sdk-chart-legend`, `.charturbo-sdk-legend-item` | 범례와 항목 |
| `.charturbo-sdk-legend-pager`, `.charturbo-sdk-legend-page` | 범례 페이지 이동 영역과 ‹ › 버튼 |
| `.charturbo-sdk-axis-tick`, `.charturbo-sdk-axis-title` | 눈금 라벨과 축 제목 |
| `.charturbo-sdk-annotation-label` | 주석 라벨 |
| `.charturbo-sdk-node-tooltip` | 툴팁 |

## 함께 보기

- [툴팁과 hover](./tooltips): hover 레이어 스타일
- [주석](./annotations)
- [내보내기: PNG · SVG · PDF](./export)
- [접근성](./accessibility)
