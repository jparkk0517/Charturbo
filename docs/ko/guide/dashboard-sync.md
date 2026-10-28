# 대시보드 동기화

한 페이지의 차트들이 hover 커서와 x 줌 / 팬을 공유할 수 있습니다. 각 차트는 자기 캔버스와 엔진을 그대로 가지며, 데이터 단위의 위치만 주고받습니다. 대시보드나 x축을 공유하는 작은 다중 차트에 씁니다.

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvases = [cpuCanvas, memCanvas, netCanvas];
const data = [cpuSeries, memSeries, netSeries];
const charts = await Promise.all(canvases.map((c) => Charturbo.create(c)));
charts.forEach((sdk, i) => {
  sdk.renderLineChart(data[i], { axes: { x: { type: 'time' } } });
  sdk.enableNodeInteractions(canvases[i], { autoRender: true });
  sdk.render();
});

const disconnect = Charturbo.connect(charts, { cursor: true, x: true }); // 둘 다 기본 true
// 나중에
disconnect();
```

## 키로 묶는 동기화 그룹

배열 대신 이름 붙은 그룹에 차트를 넣을 수 있습니다(ECharts `group`, Highcharts 동기화 차트와 같은 방식).

```ts
const a = await Charturbo.create(canvasA, { sync: { key: 'dash', tooltip: true } });
const b = await Charturbo.create(canvasB);
b.setSync({ key: 'dash' });   // 나중에 참여. setSync(null)이면 탈퇴
b.getSync();                  // { key: 'dash', cursor, x, tooltip } | null

const disband = Charturbo.connect('dash', { x: false }); // 그룹 공통 옵션
disband(); // 모든 멤버가 그룹에서 빠짐
```

- `Charturbo.connect(array, options)`는 새 그룹을 만들고, 반환 함수는 그 차트들의 연결을 끊습니다.
- `Charturbo.connect(key, options)`는 `key`에 참여하는 모든 차트의 옵션을 정합니다. 멤버 자체 옵션이 우선합니다. 반환 함수는 그룹을 해산합니다.
- 그룹에 참여하면 이전 그룹에서는 빠집니다. `dispose()`도 그룹에서 빠집니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `key` | `string` | — | 그룹 이름 (`create({ sync })`, `setSync`) |
| `cursor` | `boolean` | `true` | hover 공유: 나머지 차트가 hover한 데이터 x에 크로스헤어와 마커를 표시 |
| `x` | `boolean` | `true` | 데이터 단위로 x 줌 / 팬 공유 |
| `tooltip` | `boolean` | `false` | 따라가는 차트도 동기화된 x에 툴팁 표시 |
| `y` | `false` | — | y 범위는 공유하지 않음 |

## 동작 방식

- **커서**: hover 중인 차트가 데이터 x를 알립니다(선: 시리즈 `x` / epoch ms 또는 샘플 인덱스, 막대: 카테고리 인덱스, 산점도: x). 나머지 차트는 그 x로 index 모드 hit-test를 하고 크로스헤어와 시리즈별 가장 가까운 마커를 그립니다. 막대는 `round(x)` 카테고리를 강조하고, 산점도는 크로스헤어 없이 시리즈별 가장 가까운 점을 표시합니다. 차트 범위 밖의 x는 그 차트의 hover를 해제하고, 포인터가 떠나면 모두 해제합니다.
- **줌 / 팬**: 한 차트의 `'rangechange'`가 나머지 차트의 `setXRange`를 데이터 단위로 호출합니다. 각 엔진은 자기 도메인으로 범위를 제한합니다.
- 동기화로 생긴 되울림은 무시하므로 피드백 루프가 없습니다. 갱신은 그룹마다 애니메이션 프레임당 한 번 모아서 적용하고, 바뀐 차트만 다시 렌더합니다.
- hover하는 차트에는 `enableNodeInteractions`가 필요합니다.

::: tip 팁
동기화되는 위치는 데이터 단위입니다. 한 그룹의 차트는 같은 x 단위를 써야 합니다. 모두 시간 축의 epoch ms이거나, 모두 샘플 / 카테고리 인덱스여야 합니다.
:::

## 수동 커서

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z')); // 'hover' 이벤트 없이 데이터 x에서 hover
sdk.getHoverX();                               // 현재 hover의 데이터 x 또는 null
sdk.hoverAtX(null);                            // 해제
sdk.render();
```

`hoverAtX(x, { tooltip: true })`는 기본 툴팁도 보여 줍니다. 시간 슬라이더처럼 앱 자체 컨트롤로 차트를 움직일 때 쓰세요.

## React · Vue

컴포넌트는 `syncGroup` prop을 받습니다. 키 문자열 또는 전체 멤버 옵션입니다.

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={cpuSeries} syncGroup="dash" />
<CharturboChart type="line" data={memSeries} syncGroup={{ key: 'dash', tooltip: true }} />
```

```vue
<script setup lang="ts">
import { CharturboChart } from 'charturbo/vue';
</script>

<template>
  <CharturboChart type="line" :data="cpuSeries" sync-group="dash" />
</template>
```

## 함께 보기

- [상호작용](./interactions): `rangechange`, `setXRange`
- [툴팁과 hover](./tooltips): `hoverAtX`, 툴팁 고정
- [데이터와 축](./data-and-axes): 작은 다중 차트가 이중 y축보다 나은 이유
- [React](./react) · [Vue](./vue)
