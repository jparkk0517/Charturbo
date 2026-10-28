# Vue

`charturbo/vue`는 Vue 3용 `<CharturboChart>` 컴포넌트와 `useCharturboChart` 컴포저블을 제공합니다. 마운트된 차트마다 `Charturbo` 엔진을 하나씩 가지며, prop이 교체될 때만 다시 렌더링하고(얕은 watch), 템플릿 ref로 엔진에 접근합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/vue.html)

## 설치

```sh
npm install charturbo vue
```

`vue`(>= 3.3)는 선택적 peer 의존성입니다. 코어 엔트리(`charturbo`)는 Vue를 import하지 않습니다. `charturbo/vue`는 ESM 전용입니다(CommonJS 빌드 없음).

## 기본 사용법

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { CharturboChart, type CharturboChartInstance } from 'charturbo/vue';

const data = shallowRef([{ name: 'CPU', values: new Float32Array(10_000) }]);
const options = { title: 'CPU 사용률' }; // 상수로: 템플릿 인라인 객체는 렌더링마다 새 참조
const chart = ref<CharturboChartInstance | null>(null);

function update(values: Float32Array) {
  data.value = [{ name: 'CPU', values }]; // 배열을 교체해야 다시 렌더링(얕은 watch)
}
</script>

<template>
  <button @click="chart?.sdk?.downloadChartSVG('cpu.svg')">SVG 저장</button>
  <CharturboChart
    ref="chart"
    type="line"
    :data="data"
    :options="options"
    theme="light"
    sync-group="dash"
    style="height: 320px"
    @range-change="(r) => console.log(r.xMin, r.xMax)"
    @error="(e) => console.error(e)"
  />
</template>
```

## Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `type` | `CharturboChartType` | 필수 | 차트 종류. 값은 [React](./react#차트-종류)와 같습니다. |
| `data` | `CharturboChartData` | 필수 | 그 종류의 데이터(typed array, 디스크립터 배열, 객체. 런타임 타입 검사 없음). |
| `options` | `CharturboChartOptions` | — | 대응하는 `render*` 메서드의 옵션. |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | —(현재 테마 유지) | 바뀌면 `setTheme`를 호출합니다. |
| `sync-group` | `string \| ChartSyncMemberOptions \| null` | —(동기화 안 함) | 동기화 그룹 키, 또는 `setSync`용 전체 멤버 옵션. |
| `interactions` | `NodeInteractionOptions \| false` | SDK 기본값(툴팁, 줌 / 팬) | `enableNodeInteractions` 옵션에 `autoRender: true`를 더해 적용합니다. `false` = 정적 차트. 스파크라인은 기본으로 상호작용이 없습니다. |
| `create-options` | `CharturboCreateOptions` | — | `Charturbo.create` 옵션(`locale`, `autoResize`(기본 `true`), `device`, `animation` 등). 컴포넌트 setup 때 한 번만 읽습니다. |
| `canvas-class` | `string` | — | 안쪽 `<canvas>`의 class. |

`class`와 `style`은 래퍼 `<div>`(`position: relative`)로 전달됩니다. 차트 크기는 여기서 줍니다.

## 이벤트

| 이벤트 | 페이로드 | 시점 |
|---|---|---|
| `@ready` | `Charturbo` | 엔진이 만들어지고 첫 차트가 렌더링됨. |
| `@error` | `unknown` | `create` 실패(WebGPU / WebGL2가 없으면 `CharturboInitError`) 또는 렌더링 중 예외(잘못된 데이터). |
| `@hover` | `CharturboEventMap['hover']` | hover 대상이 바뀜. |
| `@click` | `CharturboEventMap['click']` | 드래그 없는 클릭 또는 탭. |
| `@select` | `CharturboEventMap['select']` | 브러시 선택이 확정되거나 해제됨. |
| `@range-change` | `CharturboRange`(`xMin`, `xMax`, `yMin?`, `yMax?`) | 보이는 범위가 바뀜(줌, 팬, 리셋, `setXRange`). |
| `@legend-toggle` | `{ series, visible }` | 시리즈를 보이거나 숨김. |
| `@theme-change` | `CharturboTheme` | 테마가 바뀜. |
| `@resize` | `{ width, height }` | 렌더 대상 크기가 바뀜(물리 px). |
| `@drill` | `CharturboEventMap['drill']` | 트리맵 / 선버스트에서 드릴다운 또는 드릴업. |

렌더링 오류는 예외로 던지지 않고 `error` 이벤트로 보냅니다.

## SDK 접근

템플릿 ref는 `CharturboChartInstance`입니다(노출된 ref는 언래핑됨).

| 멤버 | 타입 | 설명 |
|---|---|---|
| `sdk` | `Charturbo \| null` | 엔진. 준비 전과 언마운트 후에는 `null`. |
| `error` | `unknown` | 마지막 `create` / 렌더링 오류. |
| `canvas` | `HTMLCanvasElement \| null` | 안쪽 캔버스. |
| `whenReady()` | `Promise<Charturbo \| null>` | 엔진으로 resolve되며, 먼저 언마운트됐거나 `create`가 실패하면 `null`. |

```ts
const chart = ref<CharturboChartInstance | null>(null);
chart.value?.sdk?.setXRange(0, 100);
const sdk = await chart.value?.whenReady();
```

props로 다루지 않는 기능(내보내기, `setXRange`, `resetChartZoom`, [스트리밍](./streaming) append)은 SDK로 호출합니다.

## 갱신 규칙과 반응성

watch는 얕습니다. 각 prop을 참조로만 비교하고 깊게 비교하지 않습니다.

- `type`, `data`, `options`: 이 중 하나가 **교체**되면 `render*`를 한 번 호출해 차트를 다시 렌더링합니다(같은 tick에 여러 개가 바뀌어도 한 번).
- `data`는 `shallowRef`에 두고 새 배열이나 객체를 대입해 갱신하세요. `reactive` 배열이나 typed array를 제자리에서 바꾸면 감지하지 못합니다. `shallowRef`는 큰 데이터에 깊은 프록시가 생기는 것도 막습니다.
- 템플릿의 인라인 객체(`:options="{ title: 'CPU' }"`)는 부모가 렌더링될 때마다 새 참조가 되어 매번 차트를 다시 렌더링합니다. 상수, `shallowRef`, `computed`를 쓰세요.
- `theme`: 바뀌면 `setTheme`만 호출하고 데이터는 다시 보내지 않습니다. `undefined`면 현재 테마를 유지합니다.
- `sync-group`: 키나 플래그(`cursor`, `x`, `tooltip`)가 바뀔 때만 `setSync`를 호출합니다.
- `interactions`: 참조가 바뀌면 `enableNodeInteractions`를 다시 바인딩합니다.
- `create-options`: 한 번만 읽고 이후 변경은 무시합니다. 새 값을 적용하려면 다시 마운트하세요(예: `key` 변경).
- 값은 SDK에 넘기기 전에 `toRaw`로 언래핑합니다.

## `useCharturboChart` 컴포저블

캔버스를 직접 배치할 때 컴포저블을 씁니다. position이 지정된 부모 안의 `<canvas>`에 템플릿 ref를 넘기세요. 라벨, 범례, 툴팁 오버레이가 그 부모에 붙습니다.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useCharturboChart } from 'charturbo/vue';

const canvas = shallowRef<HTMLCanvasElement | null>(null);
const items = shallowRef([{ label: 'A', value: 3 }, { label: 'B', value: 5 }]);
const { sdk, error, whenReady } = useCharturboChart(canvas, { type: 'bar', data: items });
</script>

<template>
  <div style="position: relative; height: 240px">
    <canvas ref="canvas" style="width: 100%; height: 100%" />
  </div>
</template>
```

`useCharturboChart(canvasRef, props)`는 컴포넌트와 같은 props를 일반 값, ref, getter(`MaybeRefOrGetter`)로 받고, `on*` 콜백(`onReady`, `onError`, `onHover`, `onRangeChange` 등)도 받습니다. 반환값은 다음과 같습니다.

| 멤버 | 타입 | 설명 |
|---|---|---|
| `sdk` | `ShallowRef<Charturbo \| null>` | 준비된 엔진. |
| `error` | `ShallowRef<unknown>` | 마지막 `create` / 렌더링 오류. |
| `whenReady()` | `Promise<Charturbo \| null>` | 컴포넌트 인스턴스와 같습니다. |

## 수명 주기

- 엔진은 `onMounted`에서 한 번 만들고(`Charturbo.create`, 비동기) `onBeforeUnmount`에서 해제합니다.
- 생성이 끝나기 전에 언마운트되면 도착한 엔진을 바로 해제하고 이벤트는 보내지 않습니다.

## SSR

- Node에서 `charturbo/vue`를 import해도 안전합니다. import 시점에 `window` / `document`에 접근하지 않습니다.
- 엔진은 서버에서 실행되지 않는 `onMounted`에서만 만듭니다. 서버 렌더링 결과는 `<div><canvas></canvas></div>` 마크업뿐입니다.

## 함께 보기

- [React](./react)
- [공유 GPU 디바이스](./shared-device)
- [대시보드 동기화](./dashboard-sync)
- [상호작용](./interactions)
- [설치와 번들러](./installation)
