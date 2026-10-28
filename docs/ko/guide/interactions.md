# 상호작용

`enableNodeInteractions(canvas, options)`는 마우스, 휠, 터치, 펜, 키보드 입력을 차트에 연결합니다. 툴팁, 줌과 팬, 실행 취소가 되는 박스 줌, 브러시 선택, SDK 이벤트가 여기에 포함됩니다. 이 페이지는 2D 차트의 탐색과 선택을 다루며, 툴팁은 별도 페이지에서 설명합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: '처리량' });
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// 나중에: 리스너와 툴팁 제거 (dispose()도 같은 일을 함)
detach();
```

`autoRender`(기본 `false`)는 hover, 클릭, 탐색이 바뀐 뒤 `sdk.render()`를 호출합니다. 끄면 `render()`를 직접 호출해야 합니다. React · Vue 컴포넌트는 기본값이 `true`입니다.

## 마우스 조작

| 입력 | 선 / 영역 / 캔들스틱 | 산점도 |
|---|---|---|
| 휠 | 포인터 기준 x 줌 | x와 y 줌 |
| Shift + 휠 | y 줌 (선 y 도메인 고정) | y 줌 |
| 드래그 | x 팬 | x와 y 팬 |
| Ctrl / ⌘ + 드래그 | 박스 줌 (x + y) | 박스 줌 |
| 더블클릭 | 줌 리셋 | 줌 리셋 |
| Ctrl / ⌘ + Z | 줌 실행 취소 (캔버스 포커스) | 줌 실행 취소 |
| Ctrl / ⌘ + Shift + Z, Ctrl + Y | 줌 다시 실행 | 줌 다시 실행 |

히트맵은 두 축 모두 줌 · 팬합니다. 막대 차트에는 휠 · 드래그 탐색이 없습니다. 콤보 차트는 x 휠 줌, 팬, 줌 기록만 지원합니다(박스 줌과 y 줌 없음). 그래프와 3D 뷰는 자체 카메라 조작을 씁니다([3D 네트워크 그래프](../charts/graph-3d) 참고).

## 상호작용 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `autoRender` | `boolean` | `false` | hover / 클릭 / 탐색 변경 시 자동 렌더 |
| `chartNavigation` | `boolean` | `true` | 2D 차트의 휠 줌, 드래그 팬, 더블클릭 리셋 |
| `zoom` | `'x' \| 'y' \| 'xy'` | `'x'` | 휠이 줌하는 축. Shift + 휠은 항상 y |
| `zoomMode` | `'pan' \| 'box'` | `'pan'` | `'pan'`: 드래그 = 팬, Ctrl / ⌘ + 드래그 = 박스 줌. `'box'`: 드래그 = 박스 줌, Alt + 드래그 = 팬 |
| `brush` | `'x' \| 'xy' \| false` | 변경 없음 (꺼짐) | 드래그로 브러시 선택. [브러시 선택](#brush-selection) 참고 |
| `brushStyle` | `BrushStyleOptions` | — | 브러시 사각형 모양 |
| `touch` | `false \| TouchInteractionOptions` | 모두 켜짐 | 터치 · 펜 제스처 |
| `cameraControls` | `false \| CameraControlOptions` | 모두 켜짐 | 그래프 / 3D 뷰의 카메라 조작 |
| `builtInTooltip`, `tooltip`, `formatChartTooltip`, … | | | [툴팁과 hover](./tooltips) 참고 |
| `onNodeHover` | `(details, pointer) => void` | — | hover 중인 점 / 노드가 바뀜 |
| `onNodeClick` | `(details, event) => void` | — | 클릭. 빈 곳이면 `null` |

## 코드로 줌 · 팬

```ts
sdk.setXRange(Date.parse('2026-01-01'), Date.parse('2026-02-01')); // 데이터 단위, 시간 축은 Date도 가능
sdk.getXRange();          // [min, max] | null
sdk.setYRange(55, 95);    // 산점도: y 줌, 선 / 영역: y 도메인 고정
sdk.getYRange();          // [min, max] | null
sdk.zoomChartX(0.5);      // factor < 1이면 확대, NDC 기준점 x (기본 0)
sdk.zoomChartXY(0.5, 0, 0); // 산점도: 두 축
sdk.panChartX(0.1);       // NDC 이동량
sdk.resetChartZoom();
sdk.render();
```

- 범위는 데이터 단위입니다. 선 차트는 시리즈 `x`(시간 축은 epoch ms) 또는 샘플 인덱스, 산점도 차트는 x / y 값입니다.
- `setXRange`와 `setYRange`는 휠과 같이 데이터와 줌 한계로 범위를 제한하고, 뷰가 움직였으면 `true`를 반환합니다.
- 이 호출들은 줌 기록에 남지 않습니다. 실행 취소가 되게 하려면 먼저 `pushZoomHistory()`를 호출하세요.

## Y축 줌 · 박스 줌 {#y-zoom-and-box-zoom}

```ts
sdk.enableNodeInteractions(canvas, {
  zoom: 'x',       // 휠 축: 'x'(기본) | 'y' | 'xy'
  zoomMode: 'pan', // 'pan'(기본) | 'box'
});
sdk.zoomChartY(0.5, 0);                 // NDC 기준점 y로 y 줌
sdk.zoomChartBox(-0.4, 0.5, 0.3, -0.3); // NDC 사각형으로 x + y 줌
```

- 선 · 영역 차트에서 수동 y 줌은 데이터 단위의 y 창을 **고정**합니다. autoscale, 데이터 갱신, 스트리밍이 더 이상 y를 바꾸지 않습니다. `resetChartZoom()`(더블클릭)이 고정을 풀고 autoscale로 돌아갑니다. 이중 y축 차트는 두 y축이 같은 화면 구간으로 함께 줌합니다. 산점도 차트는 y 창만 줌합니다.
- 박스 줌은 드래그 중 점선 사각형을 그리고, 놓으면 플롯 안으로 제한한 범위로 x와 y를 줌합니다. 4 px보다 작은 박스는 클릭으로 처리합니다. Escape는 진행 중인 박스를 취소합니다. 박스 줌은 기존 브러시 선택을 지웁니다.
- 박스 줌은 선, 영역, 산점도, 캔들스틱 차트에서 동작합니다.

## 줌 기록

```ts
sdk.undoZoom();      // 뷰가 움직였으면 true
sdk.redoZoom();
sdk.zoomHistory;     // { undo, redo, max: 50 }
sdk.pushZoomHistory();
sdk.clearZoomHistory();
```

- 마우스 제스처마다 시작 전에 한 단계를 기록합니다. 휠 연속 입력(400 ms 안의 이벤트), 드래그 팬, 박스 줌이 각각 한 단계입니다. 터치 제스처는 기록하지 않습니다. 새 제스처는 다시 실행 단계를 지웁니다.
- 최대 50단계를 보관합니다. 더블클릭 리셋은 기록을 비우고, 새 차트는 빈 기록으로 시작합니다.
- 프로그램 호출(`setXRange` 등)은 기록하지 않습니다.

## 브러시 선택 {#brush-selection}

```ts
sdk.enableNodeInteractions(canvas, {
  brush: 'x', // 'x' = x 구간(시간 범위), 'xy' = 사각형, false = 끔
  brushStyle: { color: '#3b82f6', fillOpacity: 0.15, borderWidth: 1 },
});
sdk.on('select', (sel) => {
  if (!sel.xRange) return clearDetail(); // 해제됨 (Escape, 클릭, clearChartSelection)
  if (sel.kind === 'line') sel.ranges.forEach(({ series, start, end }) => { /* [start, end) 샘플 */ });
  else console.log(sel.ids, sel.count);  // 산점도: 점 id, 막대: 카테고리 인덱스, 캔들스틱: 캔들 인덱스
});

sdk.setChartBrush('xy');           // 런타임 전환. getChartBrush()로 조회
sdk.selectChartRange([new Date('2026-02-01'), new Date('2026-03-01')]); // 'select' 발생
sdk.selectChartRange([1, 2], [-3, 4]);                                  // y 범위까지 지정
sdk.getSelection();                // 확정된 선택 또는 null
sdk.clearChartSelection();         // 선택이 있었으면 빈 'select' 발생
```

- 브러시가 켜져 있으면 드래그가 브러시를 그리고(5 px 미만 이동은 클릭), 놓으면 확정되며 `'select'`가 발생합니다. **Alt + 드래그**는 팬이고, 휠 줌과 더블클릭 리셋은 그대로 동작합니다. 클릭, Escape(캔버스 포커스), `clearChartSelection()`이 선택을 해제합니다.
- 막대는 항상 x 구간으로 선택합니다. 영역 차트는 `kind: 'line'`으로 보고합니다.
- 브러시는 데이터 프레임이 있는 2D 차트에서 동작합니다. 히트맵, 박스 플롯, 파이, 콤보, 비즈니스, 계층 차트에는 브러시가 없어 `'select'` 페이로드가 비어 있습니다. 가로 막대, 3D 막대, 2.5D 선 뷰도 브러시가 없습니다.
- 데이터나 범례가 바뀌면 `getSelection()`은 다시 질의한 결과를 돌려줍니다. 새 차트를 렌더하면 남아 있던 선택에 대해 빈 `'select'`가 발생합니다.

`CharturboSelection`(`'select'` 페이로드):

| 필드 | 타입 | 설명 |
|---|---|---|
| `kind` | `'line' \| 'bar' \| 'scatter' \| 'candlestick' \| …` | 차트 종류 |
| `mode` | `'x' \| 'xy'` | 브러시 모양 |
| `xRange` | `[number, number] \| null` | 데이터 단위의 x 범위. `null` = 해제 |
| `yRange` | `[number, number] \| null` | y 범위(`'xy'` 모드), 아니면 `null` |
| `ranges` | `{ series, start, end }[]` | 선 / 영역: 보이는 시리즈별 선택된 샘플 구간 |
| `ids` | `Uint32Array` | 산점도 점 id, 막대 카테고리 인덱스, 캔들 인덱스 (오름차순, 보이는 시리즈만) |
| `count` | `number` | 선택된 샘플 / 점 / 카테고리 수 |

`BrushStyleOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `color` | `ColorInput` | 엔진 청회색 | 테두리 색. 채움은 같은 색에 `fillOpacity` 적용 |
| `fillOpacity` | `number` | `0.15` | 채움 알파 배율 |
| `borderWidth` | `number` | `1` | 테두리 두께 CSS px (`0` = 없음) |

## 터치 · 펜 {#touch-and-pen}

`enableNodeInteractions`는 Pointer Events로 터치와 펜 입력을 읽습니다(마우스 동작은 그대로입니다). 연결되어 있는 동안 캔버스에 `touch-action: none`을 걸고, 해제하면 원래 값으로 돌려놓습니다.

| 제스처 | 2D 선 차트 | 그래프 / 3D (2D 산점도 · 막대는 회전 대신 이동) |
|---|---|---|
| 한 손가락 드래그 (8 px 이상) | x 팬, 손을 떼면 관성 | 카메라 회전 |
| 핀치 | 두 손가락 중점 기준 x 줌 | 카메라 줌 |
| 두 손가락 드래그 | x 팬 | 카메라 팬 |
| 탭 | 다음 탭까지 그 지점에 툴팁 고정 | 노드 선택 + 툴팁 (`onNodeClick`) |
| 길게 누르기 (450 ms) | 스크럽: 툴팁이 손가락을 따라감, 팬 없음 | 동일 |
| 더블탭 | 줌 리셋 | 노드 포커스 |

```ts
sdk.enableNodeInteractions(canvas, {
  touch: { pinchZoom: true, tapTooltip: true, longPressScrub: true }, // 모두 기본 true, touch: false면 끔
});
```

## 이벤트

```ts
const off = sdk.on('rangechange', ({ xMin, xMax, yMin, yMax }) => {});
sdk.on('hover', ({ chart, node, clientX, clientY }) => {});
sdk.on('click', ({ chart, node, event }) => {});
off(); // 또는 sdk.off(event, handler)
```

| 이벤트 | 페이로드 | 발생 시점 |
|---|---|---|
| `hover` | `{ chart, node, clientX, clientY }` | hover 대상이 바뀜. 포인터가 떠나면 `null`. `enableNodeInteractions` 필요 |
| `click` | `{ chart, node, event }` | 드래그 없는 클릭 또는 탭. `enableNodeInteractions` 필요 |
| `rangechange` | `{ xMin, xMax, yMin?, yMax? }` | 보이는 범위가 바뀜 (줌, 팬, 리셋, `setXRange`, 범위 선택기, 스트리밍). 프레임당 최대 1회, 실제로 바뀐 경우만 |
| `legendtoggle` | `{ series, visible }` | 범례 클릭 또는 `setSeriesVisible` |
| `select` | `CharturboSelection` | 브러시 확정 또는 해제 |
| `themechange` | `CharturboTheme` | `setTheme` |
| `resize` | `{ width, height }` | 렌더 대상 크기 변경 (물리 px) |
| `drill` | `CharturboDrillEvent` | 트리맵 / 선버스트 드릴다운 또는 상위 이동 |

- `chart`는 `ChartTooltipContext`(차트 hover), `node`는 그래프 노드 또는 주 차트 포인트의 `NodeDetails`입니다.
- `rangechange`는 산점도 차트와 선 · 영역 y 도메인에 대해 `yMin` / `yMax`를 포함합니다.
- 이벤트는 `onNodeHover` / `onNodeClick` 콜백과 함께 동작합니다. 핸들러가 예외를 던져도 다른 핸들러는 계속 실행되며, 오류는 비동기로 다시 던져집니다.

## 자체 포인터 핸들러가 있는 앱

앱도 캔버스의 포인터 이벤트를 듣는다면, SDK가 어떤 입력을 맡는지 확인하세요.

```ts
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && sdk.handlesTouchGestures()) return; // 터치 / 펜은 SDK 담당
  if (sdk.handlesChartBrush() && !e.altKey) return;                     // 드래그가 브러시를 그림
  if (sdk.handlesChartNavigation()) return;                             // 휠 / 드래그가 차트를 탐색
  // 앱 자체 처리
});
```

`handlesCameraControls()`는 그래프와 3D 카메라 조작에 대해 같은 질문에 답합니다.

## 함께 보기

- [툴팁과 hover](./tooltips)
- [데이터와 축](./data-and-axes): y 도메인, 범위 선택기
- [대시보드 동기화](./dashboard-sync): 차트 간 커서와 줌 공유
- [접근성](./accessibility): 키보드 탐색
