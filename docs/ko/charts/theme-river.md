# 테마 리버

`renderThemeRiverChart`는 스트림 그래프(ECharts `themeRiver`)를 그립니다. 이름마다 스트림 하나를 만들고, 전체 모양이 매끄럽도록 움직이는 기준선 둘레에 쌓습니다. 주제·카테고리·출처의 구성이 시간에 따라 어떻게 바뀌는지 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#13-theme-river)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderThemeRiverChart(
  [
    ['2026-01-01', 12, 'Rust'],
    ['2026-01-02', 18, 'Rust'],
    ['2026-01-01', 7, 'WebGPU'],
    ['2026-01-02', 11, 'WebGPU'],
  ],
  { title: '주제별 언급 수' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderThemeRiverChart(
  data: readonly ThemeRiverDatum[],
  options?: ThemeRiverChartOptions
): { totalPoints: number; seriesCount: number }
```

## 데이터 형식 {#data-format}

```ts
type ThemeRiverDatum = readonly [x: number | Date | string, value: number, name: string];
```

- 행은 `name`으로 묶입니다. 스트림은 처음 나온 순서로 쌓입니다(첫 이름이 맨 아래).
- 모든 스트림의 x 값을 합쳐 정렬합니다. 어떤 x에 행이 없는 스트림은 그 x에서 0입니다. x와 이름이 같은 행은 더합니다.
- `x`는 숫자, `Date`, 날짜 문자열(`Date.parse`)입니다. `Date`나 문자열 x를 쓰면 x축이 시간 축이 됩니다.
- `value`는 유한하고 `>= 0`이어야 하며, `x`도 유한해야 합니다. 그렇지 않으면 예외를 던집니다.

`themeRiverSeries(data, options)`는 렌더링 없이 묶인 스트림을 돌려줍니다.

## 옵션 {#options}

`ThemeRiverChartOptions`는 `viewMode`와 `nulls`를 뺀 모든 [선 차트 옵션](./line#options)과 다음을 받습니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `offset` | `'wiggle' \| 'silhouette' \| 'zero'` | `'wiggle'` | 기준선. `'wiggle'`은 스트림의 가중 흔들림을 최소화합니다(d3 `stackOffsetWiggle`). `'silhouette'`은 누적을 0 중심에 둡니다. `'zero'`는 일반 누적입니다. |
| `order` | `'none' \| 'insideOut'` | `'none'` | 누적 순서. `'none'`은 입력 순서를 유지합니다. `'insideOut'`은 일찍 정점에 이르는 스트림을 가운데, 늦은 스트림을 바깥에 둡니다(d3 `stackOrderInsideOut`). |
| `smooth` | `boolean` | `true` | 매끄러운(monotone) 스트림 가장자리. `false`면 직선 구간으로 그립니다. |
| `colors` | `Record<string, ColorInput> \| ColorInput[]` | 테마 팔레트 | 이름별 또는 스트림 순서의 색. |
| `fillOpacity` | `number` | `0.85` | 스트림 색의 채우기 알파 배율. |
| `labels` | `boolean \| { show?: boolean; minHeight?: number }` | 표시 | 각 스트림 왼쪽 끝의 이름. 그 자리에서 `minHeight` CSS px(기본 12)보다 얇은 스트림은 라벨이 없고, 더 두꺼운 스트림의 라벨과 겹치는 라벨은 생략합니다. |

y축과 격자선은 기본으로 숨깁니다(`axes.y.show: true`로 표시). `axes.y.autoscale: 'visible'`은 강 전체가 보이도록 `'all'`로 동작합니다. 기준선 값은 d3와 수치가 일치합니다.

## 범례와 툴팁 {#legend-and-tooltips}

- 범례 항목을 클릭하면 스트림을 숨기고, 엔진이 나머지를 다시 쌓아 기준선을 다시 계산합니다.
- 호버하면 그 x의 모든 스트림과 합계(`ctx.total`)를 보여 줍니다. `ctx.chartType`은 `'themeRiver'`입니다. 포인터 아래 스트림이 주 항목이 되어 강조되고 나머지는 흐려집니다.

[툴팁 · 호버](../guide/tooltips)를 참고하세요.

## 데이터 갱신 {#updating-data}

`appendAreaData`로 새 샘플을 스트리밍합니다. 스트림마다 청크 하나를 스트림 순서(처음 나온 순서)대로, 모두 같은 x로 넘깁니다.

```ts
sdk.appendAreaData(
  [{ values: [14], x: [nextDay] }, { values: [9], x: [nextDay] }],
  { maxPoints: 365 }
);
sdk.render();
```

업데이트마다 남아 있는 샘플 전체로 기준선을 다시 계산합니다. 규칙은 [영역](./area#updating-data)을 참고하세요.

## 접근성과 내보내기 {#accessibility-and-export}

영역 차트처럼 요약, 데이터 표, 키보드 탐색을 제공합니다. CSV 내보내기는 원래 스트림 값을 나열하고, SVG·PNG 내보내기에는 스트림 라벨이 들어갑니다. React·Vue 컴포넌트는 `type: 'themeRiver'`와 `data`, `options`를 받습니다.

## 함께 보기 {#see-also}

- [영역](./area)
- [선](./line)
- [실시간 스트리밍](../guide/streaming)
