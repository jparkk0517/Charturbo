# 데이터와 축

2D 차트에서 시리즈 데이터가 x축과 y축에 놓이는 방식을 설명합니다. 샘플 인덱스와 실제 x 값, 시간 축과 시간대, 로그 · 반전 스케일, y 도메인, 두 번째 y축, 범위 선택기 띠를 다룹니다. 대부분 선 · 영역 차트에 해당하며, 막대 · 산점도 · 캔들스틱 차트는 표시한 곳에서 같은 축 옵션을 받습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] 또는 epoch ms (Float64Array / number[])
    { name: 'GPU', values: gpu, x: otherTimestamps }, // 시리즈마다 길이 · 간격이 달라도 됨
  ],
  {
    axes: {
      x: { type: 'time', title: '시간' },
      y: { title: '사용률 (%)', min: 0, max: 100 },
    },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

## 시리즈 데이터

- `values`는 `Float32Array` 또는 `number[]`입니다. `NaN`, `null`, `undefined`는 결측값이며, 그리는 방식은 `nulls`로 정합니다([선](../charts/line) 참고).
- `x`가 없으면 샘플은 인덱스 간격으로 놓입니다. 기본 x 라벨과 툴팁은 `xLabelPrefix` 옵션을 앞에 붙인 인덱스를 보여 줍니다(`T`이면 `T+120`).
- `x`를 주면 모든 샘플이 실제 x 값을 가집니다. `values`와 길이가 같은 `Float64Array`, `number[]`, `Date[]`입니다.
  - `x`는 모든 시리즈에 주거나 모두 생략합니다.
  - 값은 유한하고 오름차순이어야 합니다(같은 값은 허용). 아니면 render 호출이 오류를 던집니다. 불규칙한 간격도 됩니다.
  - 시리즈마다 길이와 간격이 달라도 됩니다. x 범위는 모든 시리즈가 공유합니다.
  - epoch 밀리초는 최솟값 기준 f64 오프셋으로 저장하므로 밀리초 정밀도가 유지됩니다.

## 시간 축

`axes.x.type`은 숫자 `x`를 읽는 방식을 정합니다.

- `'numeric'`: 1 / 2 / 5 × 10ⁿ 단위의 눈금. 숫자 `x`의 기본값입니다.
- `'time'`: `x`를 epoch 밀리초로 읽습니다. `x`가 `Date[]`이면 기본값입니다.

시간 눈금은 차트 시간대의 달력 경계에 놓입니다. 1, 2, 5, 10, 15, 30초 또는 분, 1, 3, 6, 12시간, 1, 2일, 1주(월요일), 1, 3, 6개월, 1, 2, 5, 10, … 년입니다. 기본 라벨 형식은 눈금이 놓인 경계를 따릅니다(`HH:mm`, `MMM d`, `MMM`, `yyyy`). 라벨을 바꾸려면 `axes.x.format(value, granularity)`를 주세요. [숫자·날짜 형식](./number-format#date-and-time-labels)을 참고하세요.

캔들스틱 · OHLC 차트도 `t`를 같은 방식으로 읽습니다. `t`를 주면 `axes.x.type` 기본값은 `'time'`입니다.

## 시간대 {#time-zones}

```ts
const sdk = await Charturbo.create(canvas, { timeZone: 'Asia/Seoul' }); // 'UTC' | 'local' | IANA 이름
sdk.setTimeZone('America/New_York'); // 활성 차트의 눈금과 라벨을 다시 그림
sdk.getTimeZone();                   // 'America/New_York'

// 차트 자체 옵션이 SDK 값보다 우선
sdk.renderLineChart(series, { axes: { x: { type: 'time' } }, timeZone: 'UTC' });
sdk.renderCandlestickChart(ohlc, { timeZone: 'Europe/Berlin' });
```

- 기본값은 보는 사람의 시간대인 `'local'`입니다.
- 모든 시간 텍스트가 같은 시간대를 씁니다. x 눈금 라벨, 툴팁과 `getNodeDetails`, 접근성 요약, 데이터 테이블, `exportChartCSV()`입니다.
- 눈금은 현지 경계에 놓입니다. 자정, 월초, 연초, DST 날(23시간 / 25시간)의 시각, +05:30이나 +05:45 같은 오프셋 시간대의 정시입니다.
- 모르는 시간대 이름은 `RangeError`를 던집니다(`create`, `setTimeZone`).
- 선 · 영역 · 캔들스틱 차트의 `'time'` x축에 적용됩니다. 숫자 · 로그 · 인덱스 축과 히트맵 범위에는 영향이 없습니다.

::: tip 팁
서버 렌더링이나 스냅샷 테스트처럼 실행 환경과 무관한 출력이 필요하면 `'UTC'`나 IANA 이름을 명시하세요.
:::

## 축 옵션

`axes.x`, `axes.y`, (선 차트) `axes.y2`가 받는 옵션입니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `show` | `boolean` | `true` | 눈금 라벨 표시 |
| `title` | `string` | — | 눈금 라벨 옆의 축 제목 |
| `format` | 형식 스펙 문자열, `Intl.NumberFormatOptions`, `(value, granularity?) => string` | 로캘 숫자 / 시간 라벨 | 눈금 라벨 텍스트. [숫자·날짜 형식](./number-format) 참고 |
| `type` | `'numeric' \| 'time'` | x가 `Date[]`이면 `'time'`, 아니면 `'numeric'` | 선 · 캔들스틱 x축 전용 |
| `scale` | `'linear' \| 'log'` | `'linear'` | 값 스케일 (선, 영역, 산점도) |
| `reverse` | `boolean` | `false` | y는 아래로, x는 왼쪽으로 증가 |
| `tickCount` | `number` | y: 그리드 행 수, x: 약 90 px당 1개 | 목표 눈금 수 |
| `min` / `max` | `number` | 데이터 기준 | 선 y 도메인의 고정 끝 |
| `autoscale` | `'all' \| 'visible' \| 'none'` | `'all'` | 선 y 도메인이 데이터를 따르는 방식 |
| `nice` | `boolean` | `true` | 데이터에서 정한 끝을 눈금 단위로 넓힘 |

마지막 세 행과 `min` / `max`는 선 · 영역 y축 옵션입니다(`axes.y`, `axes.y2`). 눈금은 1 / 2 / 5 × 10ⁿ 단위이고 그리드선도 같은 값에 그립니다.

## 로그 · 반전 · 눈금 수

```ts
sdk.renderLineChart(series, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 4 } } }); // 양수 숫자 x 필요
sdk.renderScatterChart(data, { axes: { x: { scale: 'log' }, y: { scale: 'log' } } });

sdk.setAxisScale('y', { scale: 'log' }); // 'x' | 'y' | 'y2', 현재 옵션에 병합
sdk.getAxisScale('y');                   // { scale, reverse, tickCount } | null
```

- `scale: 'log'`는 log10이며 10의 거듭제곱 눈금을 씁니다(범위가 좁으면 1 / 2 / 5 보조 눈금). 0 이하 값은 그리지 않습니다. 선은 끊기고 산점도 점은 생략됩니다.
- 선 차트의 x 로그는 모든 시리즈의 `x`가 양수 숫자일 때만 적용됩니다. 인덱스 · 시간 x이거나 0 이하 x가 있으면 선형으로 남습니다(`reverse`와 `tickCount`는 적용).
- 줌, 데시메이션, hover, 주석, 범위 API는 모든 스케일에서 동작합니다. 축 스케일을 바꾸면 그 축의 줌이 초기화됩니다.
- `setAxisScale`은 선 · 영역 · 산점도 차트에서 동작합니다.

## y 도메인 {#y-domain}

선 · 영역 y 도메인은 엔진이 `axes.y`로 계산합니다.

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // 현재 옵션에 병합. 끝을 풀려면 min: undefined
sdk.getYDomain();                     // [min, max] | null
```

- `'all'`(기본): 전체 데이터 범위. 데이터가 바뀌면 다시 계산합니다.
- `'visible'`: x 줌 창 안의 보이는 시리즈 범위. 줌 · 팬 · 데이터 갱신 때 히스테리시스를 두고 다시 계산합니다. 데이터가 도메인을 벗어나거나 도메인의 60% 미만으로 줄 때만 바뀌므로 축이 떨리지 않습니다.
- `'none'`: 한 번 정한 뒤 데이터가 바뀌어도 유지합니다.
- `min` / `max`는 해당 끝을 고정합니다. `nice`는 데이터에서 정한 끝만 넓힙니다.
- `autoscale: 'all'`에서는 시리즈를 숨겨도 y 범위가 유지됩니다.
- 수동 y 줌(`setYRange`, Shift + 휠)은 리셋할 때까지 도메인을 고정합니다. [상호작용](./interactions#y-zoom-and-box-zoom)을 참고하세요.

캔들스틱 차트는 대신 `yFit: 'visible' | 'all'`(기본 `'visible'`)을 씁니다. 콤보 차트의 y 도메인은 고정이며 `axes.y` / `axes.y2`의 `min`, `max`, `nice`로 정합니다([콤보](../charts/combo) 참고).

## 이중 y축

두 번째 y축은 옵트인입니다. 선 시리즈 하나라도 `yAxis: 'right'`를 주면 켜집니다.

```ts
sdk.renderLineChart(
  [
    { name: '기온', values: temp },
    { name: '강수량', values: rain, yAxis: 'right' },
  ],
  { axes: { y: { title: '°C' }, y2: { title: 'mm', scale: 'log', min: 1, format: (v) => `${v} mm` } } }
);
sdk.setY2Domain({ autoscale: 'visible' }); // setYDomain과 같은 옵션, 오른쪽 축
sdk.getY2Domain();                         // [min, max] | null
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: '호우 기준' }]);
```

- 2D 선 차트 전용입니다. 영역 차트와 2.5D 뷰에는 오른쪽 축 라벨이 없습니다.
- 오른쪽 축은 자체 도메인, autoscale, 스케일, 눈금을 가집니다. 그리드선은 왼쪽 축을 따릅니다. 라벨과 제목을 위한 오른쪽 여백은 SDK가 잡습니다.
- 주석은 `yAxis: 'right'`로 오른쪽 축을 씁니다.

::: warning 주의
y축이 두 개면 교차점과 기울기가 각 축의 범위를 어떻게 잡느냐에 따라 달라져 오해하기 쉽습니다. 단위가 다른 두 측정값은 먼저 다음을 고려하세요. x를 공유하는 작은 다중 차트([대시보드 동기화](./dashboard-sync)로 줌 동기화), 지수화한 단일 축(첫 값 = 100 또는 % 변화량), 한 값을 다른 값에 대해 그린 산점도입니다. x 정렬이 핵심일 때만 이중 축을 쓰고, 축 제목과 시리즈 색으로 각 축을 분명히 표시하세요.
:::

## 범위 선택기

플롯 아래 띠가 전체 x 범위와 드래그할 수 있는 줌 창을 보여 줍니다.

```ts
sdk.renderLineChart(series, { navigator: true }); // 또는 { navigator: { height: 64 } } (CSS px, 기본 48)
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
sdk.enableNodeInteractions(canvas);
sdk.on('rangechange', ({ xMin, xMax }) => { /* 창 드래그, 핸들, 휠도 같은 이벤트 */ });
sdk.getNavigatorRect(); // [left, top, width, height] CSS px, 없으면 null
```

- 2D 선 · 영역 차트 전용입니다.
- 창 안을 드래그하면 이동, 가장자리(±8 px)는 크기 조절, 창 밖을 클릭하면 그 지점으로 창 중심을 옮긴 뒤 드래그를 이어 가고, 띠 위에서 휠을 굴리면 포인터 기준으로 줌합니다. 마우스 · 터치 · 펜 모두 띠 위에서 누르면 창을 조작합니다.
- 띠는 보이는 시리즈를 전체 x 범위에 대해 띠 폭 기준으로 데시메이션해 그리므로 1M개 이상의 포인트에서도 가볍습니다. 데이터, 가시성, 뷰가 바뀔 때만 다시 만듭니다.

[라이브 예제: 범위 선택기](https://jparkk0517.github.io/Charturbo/candlestick.html)

## 막대 · 산점도 축

- 막대 차트는 `axes.x` / `axes.y`에 `show`, `title`, `format`을 받습니다. `orientation: 'horizontal'`이면 `axes.x`가 값 축, `axes.y`가 카테고리 축입니다. [막대](../charts/bar)를 참고하세요.
- 산점도 차트는 `axes.x` / `axes.y`에 스케일 옵션(`scale`, `reverse`, `tickCount`)도 받습니다. 두 축 모두 줌 · 팬합니다. [산점도 · 버블](../charts/scatter)을 참고하세요.

## 함께 보기

- [상호작용](./interactions): 줌, 팬, 범위, 이벤트
- [숫자·날짜 형식](./number-format)
- [실시간 스트리밍](./streaming)
- [선](../charts/line) · [영역](../charts/area) · [콤보](../charts/combo)
