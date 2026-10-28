# 툴팁과 hover

차트를 hover하면 GPU hover 레이어(크로스헤어, 포인트 마커, 강조된 막대)와 DOM 툴팁이 나타납니다. 이 페이지는 툴팁 옵션, 커스텀 툴팁 HTML, hover 스타일, hover 이벤트를 다룹니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 기본 사용법

상호작용을 켜면 기본 툴팁이 나타납니다.

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { hover: { mode: 'index', crosshair: true } });
sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  tooltip: {
    sort: 'desc',            // 'none'(기본, 시리즈 순서) | 'asc' | 'desc'
    shared: true,            // hover한 x의 모든 시리즈 (기본)
    pin: 'click',            // 클릭하면 툴팁 고정
    valueFormatter: '$,.2f', // 형식 스펙, Intl 옵션, 함수
  },
});
sdk.render();
```

## 툴팁 옵션

툴팁 모양을 정하는 `enableNodeInteractions` 옵션입니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `builtInTooltip` | `boolean` | `true` | 떠 있는 툴팁 표시 |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` 또는 `document.body` | 툴팁을 붙일 요소 |
| `tooltip.sort` | `'none' \| 'asc' \| 'desc'` | `'none'` | 값 기준 행 순서. `NaN`은 맨 뒤 |
| `tooltip.shared` | `boolean` | `true` | `true`: hover한 x / 카테고리의 모든 시리즈. `false`: 포인터에 가장 가까운 항목 하나 |
| `tooltip.pin` | `'click' \| false` | `false` | hover 중인 항목을 클릭하면 툴팁 고정 |
| `tooltip.valueFormatter` | 형식 스펙, `Intl.NumberFormatOptions`, `(v) => string` | y축 `format` 또는 로캘 숫자 | 기본 툴팁의 값 |
| `formatChartTooltip` | `(ctx: ChartTooltipContext) => string` | — | 차트 툴팁의 커스텀 HTML |
| `formatTooltip` | `(details: NodeDetails) => string` | — | 그래프 / 포인트 클라우드 노드 툴팁의 커스텀 HTML |
| `tooltipClassName` | `string` | — | 추가 클래스. 기본 클래스는 `charturbo-sdk-node-tooltip` |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | — | 기본 스타일 위에 병합할 인라인 스타일 |

- `sort`와 `shared`는 표시용입니다. 엔진 hit-test 결과는 그대로이고 `'hover'` / `'click'` 이벤트는 원래 순서와 전체 항목을 받습니다. `formatChartTooltip`은 정렬 · 필터된 컨텍스트를 받습니다.
- `shared: false`는 선, 영역, 누적 막대, 콤보 툴팁의 행만 줄입니다. GPU 마커는 모든 시리즈에 그대로 남습니다. 마커도 하나만 원하면 `hover: { mode: 'nearest' }`를 쓰세요.
- `valueFormatter`는 시리즈 값, 합계, OHLC, 히트맵 셀, 박스 통계, 파이 값, 산점도 y에 적용됩니다. `formatChartTooltip`이 아닌 기본 툴팁에만 적용됩니다. 스펙 문법은 [숫자·날짜 형식](./number-format)을 참고하세요.

## 고정

`pin: 'click'`이면 hover 중인 항목을 클릭할 때 툴팁과 엔진 hover(크로스헤어, 마커)가 그 자리에 고정됩니다. 고정된 요소에는 `data-pinned="true"`가 붙고, 포인터 이동, 캔버스 이탈, 동기화 커서로도 바뀌지 않습니다.

다음 클릭, 캔버스 밖 `pointerdown`, Escape(캔버스 포커스), 휠 줌 또는 드래그 팬, 키보드 포인트 이동, 새 차트가 고정을 풉니다. 빈 곳을 클릭하면 고정하지 않습니다. 풀리면 `'hover'` 이벤트와 `onNodeHover`에 `null`이 전달됩니다.

터치 기기에서는 탭이 다음 탭까지 그 지점에 툴팁을 고정하고, 길게 누르면 스크럽합니다([상호작용](./interactions#touch-and-pen) 참고).

::: warning 주의
고정 중에도 [동기화 그룹](./dashboard-sync)의 커서(`hoverAtX`)는 엔진 마커를 움직입니다. 툴팁만 고정됩니다.
:::

## 커스텀 툴팁 HTML

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatChartTooltip: (ctx) =>
    `<b>${escapeHtml(ctx.xLabel)}</b>` +
    ctx.items
      .map((it) => `<div style="color:${it.color}">${escapeHtml(it.seriesName)}: ${it.value}</div>`)
      .join(''),
  tooltipClassName: 'my-tooltip',
  tooltipStyle: { background: '#fff', color: '#111' },
});
```

::: warning 주의
반환한 문자열은 `innerHTML`로 들어갑니다. 데이터에서 온 문자열(시리즈 이름, 라벨, 메타데이터)은 모두 export된 `escapeHtml`로 감싸세요. 기본 툴팁은 이미 이스케이프합니다.
:::

`ChartTooltipContext`의 주요 필드입니다.

| 필드 | 설명 |
|---|---|
| `chartType` | `'line'`, `'bar'`, `'scatter'`, `'candlestick'`, `'heatmap'`, `'box'`, `'pie'`, `'combo'`, … (영역 차트는 `'line'`) |
| `index` | hover한 샘플 / 막대 / 점 인덱스 |
| `xLabel` | 형식화된 x (선), 카테고리 라벨 (막대), 형식화된 x (산점도) |
| `x` | 주 샘플의 시리즈 `x` (`x`가 있는 선 차트) |
| `items` | 행마다 `{ seriesName, value, color, nodeId, percent?, error?, band? }` |
| `total` | 누적 막대 / 영역: 보이는 시리즈의 합 |
| `areaMode` | 영역 차트: `'overlap' \| 'stacked' \| 'percent'` |
| `point` | 산점도: hover한 점의 데이터 좌표 |
| `ohlc` | 캔들스틱: 시가 / 고가 / 저가 / 종가 / 거래량 |
| `cell` | 히트맵: `{ row, col, xLabel, yLabel }` |
| `slice` | 파이: `{ label, value, percent, members? }` |
| `box` | 박스 플롯 통계 |
| `details` | 주 포인트(포인터에 가장 가까운 점)의 `NodeDetails` |

비즈니스 · 계층 차트는 자체 필드(`radar`, `gauge`, `funnel`, `waterfall`, `hierarchy`, `flow`)를 더합니다.

## hover 스타일

`hover` 차트 옵션(렌더 후에는 `setChartHoverStyle`)이 GPU hover 레이어의 모양을 정합니다. 색은 `ColorInput`입니다. 0..1 범위의 `[r, g, b, a]` 튜플 또는 CSS 색 문자열입니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `mode` | `'index' \| 'nearest'` | `'index'` | `'index'`: hover한 x의 모든 시리즈. `'nearest'`: 가장 가까운 점 하나 (2.5D 뷰는 항상 `'nearest'`) |
| `crosshair` | `boolean` | `true` | 2D 선 차트의 세로 가이드선 |
| `crosshairColor` | `ColorInput` | `[0.58, 0.64, 0.72, 0.55]` | 크로스헤어 색 |
| `crosshairWidth` | `number` | `1` | 크로스헤어 두께 CSS px |
| `marker` | `boolean` | `true` | 시리즈 색의 포인트 마커 |
| `markerRadius` | `number` | `4` | 마커 반지름 CSS px (링 제외) |
| `markerRingColor` | `ColorInput` | 차트 배경색 | 마커와 선을 구분하는 링 |
| `markerRingWidth` | `number` | `2` | 링 두께 CSS px |
| `hitRadius` | `number` | `24` (산점도: `12`) | `'nearest'` 판정 반경 CSS px |
| `barHighlightColor` | `ColorInput` | 막대 색 22% 밝게 | hover된 막대 색 |

```ts
sdk.setChartHoverStyle({ mode: 'nearest', markerRadius: 6 });

// 그래프 / 포인트 클라우드 노드 (기본: 자기 색을 밝게, 반지름 1.6배)
sdk.setNodeHoverStyle({ scale: 1.4, color: [1, 1, 1, 1] });
```

## hover 이벤트

```ts
sdk.on('hover', ({ chart, node }) => {
  if (!chart) return hideSidePanel(); // 포인터가 떠남
  showSidePanel(chart.xLabel, chart.items);
});
```

`chart`는 위와 같은 `ChartTooltipContext`이지만 정렬 · 필터되지 않은 값입니다. `'hover'`와 `onNodeHover` 모두 `enableNodeInteractions`가 필요합니다.

## 코드로 hover

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z'), { tooltip: true }); // 그 x에 포인터가 있는 것처럼
sdk.getHoverX();  // 현재 hover의 데이터 x 또는 null
sdk.hoverAtX(null); // 해제
sdk.render();
```

`hoverAtX`는 index 모드로 hover하며(막대: `round(x)` 카테고리) `'hover'` 이벤트를 내지 않습니다. `tooltip: true`이면 기본 툴팁도 보입니다. [대시보드 동기화](./dashboard-sync)가 이 방식을 씁니다.

## 로캘별 라벨

기본 툴팁 값은 차트 로캘(`locale` 옵션, 다음 `setLocale`, 다음 런타임 로캘)을 씁니다. Open / High / Low / Close / Volume 같은 내장 필드 라벨도 같은 로캘을 따릅니다(en, ko, zh-CN. 그 외는 영어). [다국어 지원](./i18n)을 참고하세요.

## 함께 보기

- [상호작용](./interactions)
- [숫자·날짜 형식](./number-format)
- [스타일과 테마](./styling): 툴팁 색은 테마에서 옵니다
