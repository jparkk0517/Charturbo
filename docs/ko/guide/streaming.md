# 실시간 스트리밍

선 · 영역 차트는 차트를 다시 만들지 않고 새 샘플을 받을 수 있습니다. 시리즈 하나를 교체하거나, 슬라이딩 창으로 끝에 추가하거나, 모든 영역 시리즈에 한 번에 추가합니다. 스타일, 범례 상태, 줌 창은 유지됩니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
const t0 = Date.now();
sdk.renderLineChart(
  [
    { name: 'p50', values: [40], x: [t0] },
    { name: 'p99', values: [95], x: [t0] },
  ],
  {
    title: '요청 지연 시간 (ms)',
    axes: { x: { type: 'time' }, y: { min: 0, autoscale: 'visible' } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

setInterval(() => {
  const x = Date.now();
  sdk.appendSeriesData(0, [readP50()], [x], { maxPoints: 4_000 });
  sdk.appendSeriesData(1, [readP99()], [x], { maxPoints: 4_000 });
  sdk.render(); // 한 주기의 추가를 모두 마친 뒤 한 번 렌더
}, 50);
```

## 갱신 메서드

| 메서드 | 반환값 | 설명 |
|---|---|---|
| `setSeriesData(series, values, x?)` | 새 샘플 수 | 선 / 영역 시리즈 하나의 데이터 교체 |
| `appendSeriesData(series, values, x?, { maxPoints }?)` | 새 샘플 수 | 선 또는 overlap 영역 시리즈 하나에 추가 |
| `appendAreaData(chunks, { maxPoints }?)` | 시리즈별 유지된 길이 | 영역 시리즈마다 chunk 하나를 원자적으로 한 번에 추가 |

- `x`는 차트를 `x`와 함께 렌더했으면 필수이고, 그렇지 않으면 전달할 수 없습니다. 숫자, epoch ms, `Date`를 받습니다.
- 추가하는 `x`는 시리즈의 마지막 x보다 작으면 안 됩니다.
- `setSeriesData`는 툴팁과 접근성을 위해 `values`를 참조로 보관합니다. 이후 배열을 바꾸지 마세요.
- 갱신 후 `render()`를 호출하세요(상호작용으로 생기는 프레임은 `autoRender`가 처리합니다).

## 슬라이딩 창

`maxPoints`는 시리즈마다 가장 최근 N개 샘플만 남깁니다. `0`이나 생략은 무제한입니다. `appendAreaData`는 0..4294967295 정수를 요구합니다.

데이터 포인트 id는 갱신마다 다시 매겨집니다. 인덱스 0은 항상 남아 있는 가장 오래된 샘플입니다. 갱신을 넘어 id를 보관하지 마세요.

## 최신 데이터 따라가기

- 줌하지 않은 차트는 계속 전체 데이터를 보여 줍니다.
- 줌 창이 오른쪽 끝에 닿아 있으면 같은 x 폭으로 최신 데이터를 따라갑니다.
- 그렇지 않으면 절대 x 창을 유지합니다.

새 데이터로 보이는 범위가 움직이면 `'rangechange'`가 발생합니다.

## 스트리밍 중 y축

`axes.y.autoscale` 옵션이 새 데이터에 대한 y 도메인 반응을 정합니다([데이터와 축](./data-and-axes#y-domain) 참고).

| `autoscale` | 동작 |
|---|---|
| `'all'`(기본) | 유지된 전체 데이터의 범위 |
| `'visible'` | 보이는 창의 범위, 히스테리시스로 갱신 (떨림 없음) |
| `'none'` | 한 번 정한 뒤 유지 |

수동 y 줌(`setYRange`, Shift + 휠)은 y 창을 고정합니다. `resetChartZoom()` 전까지 스트리밍이 바꾸지 않습니다.

## 영역 차트

```ts
// 렌더 순서대로 시리즈마다 chunk 하나 (숨긴 시리즈 포함)
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

- `overlap` 영역은 시리즈별로 `setSeriesData` / `appendSeriesData`도 쓸 수 있습니다.
- `stacked`와 `percent` 영역은 `appendAreaData`로 추가해야 하며, chunk의 길이와 `x`가 같아야 합니다. 이 모드에서 `setSeriesData`는 다른 시리즈와 같은 길이와 x를 유지해야 합니다.
- 배치 전체를 먼저 검증합니다. 잘못된 배치는 아무것도 바꾸지 않습니다.
- 툴팁과 CSV는 누적값이 아닌 최신 원시 값을 읽습니다.

## 성능

- `appendSeriesData`는 엔진에서 분할 상환 O(추가분)이며, 다음 프레임에 보이는 창만 다시 데시메이션합니다.
- `stacked` · `percent` 영역은 갱신마다 유지된 모든 샘플의 누적값을 다시 계산합니다(O(유지된 샘플 수)). 큰 스트림에서는 배치 크기와 `maxPoints`를 조절하세요.
- SDK는 스트리밍 데이터의 복사본을 두지 않습니다. 툴팁과 접근성은 엔진에서 다시 읽습니다. 접근성 요약과 데이터 테이블은 초당 최대 4회 갱신합니다.
- 여러 추가를 묶고 주기마다 `render()`를 한 번 호출하세요.

## 제한

- `appendSeriesData`는 `stacked` / `percent` 영역, 독립 밴드 차트, 오차 막대 / 임펄스 차트에서 오류를 던집니다(이 차트들은 다시 렌더하세요).
- `band`가 있는 선 시리즈에 추가한 샘플에는 밴드가 없습니다. 툴팁에 범위가 표시되지 않고, 스트리밍 후 데이터 테이블의 밴드 열은 비어 있습니다. 길이가 바뀌는 `setSeriesData`는 밴드를 해제합니다.
- 다른 차트는 render 메서드를 다시 호출해 갱신합니다. 3D 차트에는 자체 스트리밍 메서드(`appendPointCloud3D`, `updateSurface3D`)가 있습니다. [PointCloud3D · Surface3D](../charts/scientific-3d)를 참고하세요.

## React · Vue

`onReady(sdk)` 또는 컴포넌트 ref의 `whenReady()`로 얻은 SDK에서 이 메서드를 호출하세요. 스트리밍 중에는 `data`와 `options` prop 참조를 유지하세요. 새 참조를 넘기면 전체 render 메서드가 다시 실행됩니다.

## 함께 보기

- [데이터와 축](./data-and-axes)
- [선](../charts/line) · [영역](../charts/area)
- [성능](./performance)
- [React](./react) · [Vue](./vue)
