# React

`charturbo/react`는 `<CharturboChart>` 컴포넌트와 `useCharturboChart` 훅을 제공합니다. 마운트된 차트마다 `Charturbo` 엔진을 하나씩 가지며, props의 참조가 바뀔 때만 다시 렌더링하고, props로 다루지 않는 기능은 ref로 엔진에 직접 접근해 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/react.html)

## 설치

```sh
npm install charturbo react react-dom
```

`react`와 `react-dom`(>= 18)은 선택적 peer 의존성입니다. 코어 엔트리(`charturbo`)는 React를 import하지 않습니다. `charturbo/react`는 ESM 전용입니다(CommonJS 빌드 없음).

## 기본 사용법

```tsx
import { useMemo, useRef } from 'react';
import { CharturboChart, type CharturboChartHandle } from 'charturbo/react';

export function CpuChart({ values, dark }: { values: Float32Array; dark: boolean }) {
  const chart = useRef<CharturboChartHandle>(null);
  // data / options는 참조로 비교: 바뀔 때만 다시 렌더링되도록 메모이즈
  const data = useMemo(() => [{ name: 'CPU', values }], [values]);
  const options = useMemo(() => ({ title: 'CPU 사용률', legend: false }), []);

  return (
    <>
      <button onClick={() => chart.current?.sdk?.downloadImage('cpu.png')}>PNG 저장</button>
      <CharturboChart
        ref={chart}
        type="line"
        data={data}
        options={options}
        theme={dark ? 'dark' : 'light'} // 바뀌면 setTheme만 호출(데이터 재전송 없음)
        syncGroup="dash"                 // 같은 키의 차트끼리 크로스헤어 · 줌/팬 동기화
        style={{ height: 320 }}          // 래퍼 크기 = 캔버스 크기
        onRangeChange={(r) => console.log(r.xMin, r.xMax)}
        onError={(e) => console.error(e)} // WebGPU / WebGL2 없음(CharturboInitError), 잘못된 데이터 등
      />
    </>
  );
}
```

## Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `type` | `CharturboChartType` | 필수 | 차트 종류. [차트 종류](#차트-종류) 참고. |
| `data` | `CharturboChartData<T>` | 필수 | 그 종류의 데이터. `type`에 따라 타입이 정해집니다. |
| `options` | `CharturboChartOptions<T>` | — | 대응하는 `render*` 메서드의 옵션. |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | —(현재 테마 유지) | 바뀌면 `setTheme`를 호출합니다. |
| `syncGroup` | `string \| ChartSyncMemberOptions \| null` | —(동기화 안 함) | 동기화 그룹 키, 또는 `setSync`용 전체 멤버 옵션. |
| `interactions` | `NodeInteractionOptions \| false` | SDK 기본값(툴팁, 줌 / 팬) | `enableNodeInteractions` 옵션에 `autoRender: true`를 더해 적용합니다. `false` = 정적 차트. 스파크라인은 기본으로 상호작용이 없습니다. |
| `createOptions` | `CharturboCreateOptions` | — | `Charturbo.create` 옵션(`locale`, `autoResize`(기본 `true`), `device`, `animation` 등). 마운트 시 한 번만 읽습니다. |
| `className` / `style` | `string` / `CSSProperties` | — | 래퍼 `<div>`(`position: relative`가 붙음). 차트 크기는 여기서 줍니다. |
| `canvasClassName` / `canvasStyle` | `string` / `CSSProperties` | — | 안쪽 `<canvas>`(기본 스타일: `display: block; width: 100%; height: 100%`). |
| `onReady`, `onError`, `on*` | 함수 | — | [이벤트](#이벤트) 참고. |

## 차트 종류

| `type` | SDK 메서드 |
|---|---|
| `'line'`, `'area'`, `'band'` | `renderLineChart`, `renderAreaChart`, `renderBandChart` |
| `'errorBar'`, `'impulse'` | `renderErrorBarChart`, `renderImpulseChart` |
| `'bar'` | `data`가 배열이면 `renderBarChart`, `{ categories, series }`면 `renderGroupedBarChart` |
| `'scatter'`, `'histogram'`, `'heatmap'`, `'box'` | `renderScatterChart`, `renderHistogram`, `renderHeatmap`, `renderBoxPlot` |
| `'candlestick'`, `'ohlc'` | `renderCandlestickChart`, `renderOhlcChart` |
| `'pie'`, `'combo'`, `'radar'`, `'gauge'`, `'funnel'`, `'waterfall'` | `renderPieChart`, `renderComboChart`, `renderRadarChart`, `renderGauge`, `renderFunnelChart`, `renderWaterfallChart` |
| `'calendar'` | `renderCalendarHeatmap` |
| `'treemap'`, `'sunburst'`, `'sankey'` | `renderTreemap`, `renderSunburst`, `renderSankey` |
| `'chord'` | `renderChordChart` |
| `'sparkline'` | `renderSparkline` |
| `'pointCloud3d'`, `'surface3d'` | `renderPointCloud3D`, `renderSurface3D` |

## 이벤트

| Prop | 페이로드 | 시점 |
|---|---|---|
| `onReady` | `Charturbo` | 엔진이 만들어지고 첫 차트가 렌더링됨. |
| `onError` | `unknown` | `create` 실패(WebGPU / WebGL2가 없으면 `CharturboInitError`) 또는 렌더링 중 예외(잘못된 데이터). |
| `onHover` | `CharturboEventMap['hover']` | hover 대상이 바뀜. |
| `onClick` | `CharturboEventMap['click']` | 드래그 없는 클릭 또는 탭. |
| `onSelect` | `CharturboEventMap['select']` | 브러시 선택이 확정되거나 해제됨. |
| `onRangeChange` | `CharturboRange`(`xMin`, `xMax`, `yMin?`, `yMax?`) | 보이는 범위가 바뀜(줌, 팬, 리셋, `setXRange`). |
| `onLegendToggle` | `{ series, visible }` | 시리즈를 보이거나 숨김. |
| `onThemeChange` | `CharturboTheme` | 테마가 바뀜. |
| `onResize` | `{ width, height }` | 렌더 대상 크기가 바뀜(물리 px). |
| `onDrill` | `CharturboEventMap['drill']` | 트리맵 / 선버스트에서 드릴다운 또는 드릴업. |

콜백은 인라인 함수여도 됩니다. 컴포넌트는 항상 최신 콜백을 호출하며 다시 구독하지 않습니다. 렌더링 오류는 예외로 던지지 않고 `onError`로 전달합니다.

## SDK 접근

ref는 `CharturboChartHandle`입니다.

| 멤버 | 타입 | 설명 |
|---|---|---|
| `sdk` | `Charturbo \| null` | 엔진. 준비 전과 언마운트 후에는 `null`. |
| `canvas` | `HTMLCanvasElement \| null` | 안쪽 캔버스. |
| `whenReady()` | `Promise<Charturbo \| null>` | 엔진으로 resolve되며, 먼저 언마운트됐거나 `create`가 실패하면 `null`. |

```tsx
chart.current?.sdk?.setXRange(0, 100);
const sdk = await chart.current?.whenReady();
await sdk?.downloadChartPDF('cpu.pdf');
```

props로 다루지 않는 기능(내보내기, `setXRange`, `resetChartZoom`, [스트리밍](./streaming) append)은 SDK로 호출합니다. 한 번만 하는 초기 설정이면 ref 대신 `onReady={(sdk) => ...}`를 써도 됩니다.

## 갱신 규칙과 메모이즈

컴포넌트는 props를 깊게 비교하지 않습니다.

- `type`, `data`, `options`: 이 중 하나의 **참조**가 바뀌면 `render*`를 한 번 호출해 차트를 다시 렌더링합니다. 부모가 렌더링될 때마다 새 객체나 배열을 넘기면(예: `options`에 인라인으로 쓴 `{ title: 'CPU' }`) 매번 다시 렌더링됩니다. 이 값들은 `useMemo`, state, 모듈 상수로 두세요.
- typed array를 제자리에서 바꾸면 감지하지 못합니다. 새 배열이나 객체를 넘기세요. 갱신이 잦다면 `data`를 바꾸는 대신 ref로 SDK의 스트리밍 메서드를 호출하세요.
- `theme`: 바뀌면 `setTheme`만 호출하고 데이터는 다시 보내지 않습니다. `undefined`면 현재 테마를 유지합니다.
- `syncGroup`: 키나 플래그(`cursor`, `x`, `tooltip`)가 바뀔 때만 `setSync`를 호출하므로 인라인 객체여도 됩니다.
- `interactions`: 참조가 바뀌면 `enableNodeInteractions`를 다시 바인딩합니다. 객체를 넘긴다면 메모이즈하세요.
- `createOptions`: 마운트 시 한 번만 읽고 이후 변경은 무시합니다. 새 값을 적용하려면 다시 마운트하세요(예: `key` 변경).
- 엔진 준비 전에 바뀐 props는 준비 직후 최신 값으로 한 번만 적용됩니다.

## `useCharturboChart` 훅

캔버스를 직접 배치할 때 훅을 씁니다. 캔버스의 부모는 position이 지정되어 있어야 합니다. 라벨, 범례, 툴팁 오버레이가 그곳에 붙습니다.

```tsx
import { useCharturboChart } from 'charturbo/react';

function Revenue({ items }: { items: { label: string; value: number }[] }) {
  const { canvasRef, sdk, error } = useCharturboChart({ type: 'bar', data: items });
  return (
    <div style={{ position: 'relative', height: 240 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

훅은 컴포넌트와 같은 props(`className` / `style` / `canvas*` 제외)를 받고 다음을 돌려줍니다.

| 멤버 | 타입 | 설명 |
|---|---|---|
| `canvasRef` | `RefObject<HTMLCanvasElement \| null>` | `<canvas>`에 연결합니다. |
| `sdk` | `Charturbo \| null` | 준비된 엔진(state라 바뀌면 컴포넌트가 다시 렌더링됨). |
| `error` | `unknown` | 마지막 `create` / 렌더링 오류. |
| `getSdk()` | `Charturbo \| null` | 다시 렌더링 없이 현재 엔진을 얻습니다(`onReady` 안, `whenReady` 뒤). |
| `whenReady()` | `Promise<Charturbo \| null>` | 핸들과 같습니다. 마운트 effect 전에 호출하면 `null`. |

## 크기

래퍼 `<div>`에는 `position: relative`가 붙고, 오버레이 라벨과 범례가 여기에 붙습니다. `className`이나 `style`로 크기를 주면 캔버스가 100%로 채우고, SDK의 `autoResize`가 `ResizeObserver`로 backing store 크기를 맞춥니다.

## 수명 주기

- 엔진은 마운트 시 한 번 만들고(`Charturbo.create`, 비동기) 언마운트 시 해제합니다.
- 생성이 끝나기 전에 언마운트되면 도착한 엔진을 바로 해제하고 콜백은 호출하지 않습니다.
- React StrictMode의 마운트 → 언마운트 → 마운트에서도 엔진은 하나만 만들어집니다. 생성을 마이크로태스크 하나만큼 늦춰 첫 바인딩은 시작 전에 폐기됩니다.

## SSR

- Node에서 `charturbo/react`를 import해도 안전합니다. import 시점에 `window` / `document`에 접근하지 않습니다.
- 엔진은 클라이언트 effect에서만 만듭니다. 서버에서는 `<div><canvas></canvas></div>` 마크업만 렌더링합니다.
- 엔트리에 `'use client'` 지시어가 없습니다. React Server Components 프레임워크(예: Next.js App Router)에서는 `'use client'`를 붙인 파일에서 `<CharturboChart>`를 렌더링하세요.

## 함께 보기

- [Vue](./vue)
- [공유 GPU 디바이스](./shared-device)
- [대시보드 동기화](./dashboard-sync)
- [상호작용](./interactions)
- [설치와 번들러](./installation)
