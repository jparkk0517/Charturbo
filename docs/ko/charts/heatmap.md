# 히트맵

히트맵은 값 그리드의 각 셀에 색을 칠합니다. 그리드는 float 텍스처로 한 번 업로드하고 사각형(quad) 하나로 그리므로, 4096 × 4096 셀까지의 그리드도 상호작용이 가능합니다. 행렬, 캘린더(요일 × 시간), 조밀한 2D 데이터에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/heatmap.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const cols = 90; // 일
const rows = 24; // 시간
const values = new Float32Array(cols * rows); // values[row * cols + col]
// ... values 채우기

sdk.renderHeatmap(
  {
    cols,
    rows,
    values,
    xLabels: Array.from({ length: cols }, (_, c) => `${c + 1}일차`),
    yLabels: Array.from({ length: rows }, (_, r) => `${String(r).padStart(2, '0')}:00`),
  },
  { title: '시간대별 부하', valueLabel: '부하', colorScale: 'sequential', colorbar: { title: 'req/s' } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHeatmap(data: HeatmapChartData, options?: HeatmapChartOptions): { cellCount: number }
```

데이터 포인트 id = `row * cols + col`.

## 데이터 형식 {#data-format}

`HeatmapChartData`:

| 필드 | 타입 | 설명 |
|---|---|---|
| `cols` | `number` | 열 수. |
| `rows` | `number` | 행 수. |
| `values` | `Float32Array \| number[]` | 행 우선 값, `values[row * cols + col]`. `NaN` = 빈 셀. 최대 4096 × 4096. |
| `xLabels` | `string[]` | 열 라벨: 카테고리 x축(눈금 값 = 열 인덱스). |
| `yLabels` | `string[]` | 행 라벨: 카테고리 y축(눈금 값 = 행 인덱스). |
| `xExtent` | `[number, number]` | 대신 숫자 x축을 씁니다: 그리드 왼쪽과 오른쪽 가장자리의 데이터 x. |
| `yExtent` | `[number, number]` | 대신 숫자 y축을 씁니다: 그리드 아래쪽과 위쪽 가장자리의 데이터 y. |

카테고리 라벨은 겹치지 않도록 솎아 냅니다.

## 옵션 {#options}

`HeatmapChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `colorScale` | `'sequential' \| 'viridis' \| 'magma' \| 'diverging'` | `'sequential'` | 컬러맵. `'sequential'`은 밝은 색에서 어두운 색으로 가는 단일 색조이고, `'diverging'`은 `center`를 중심으로 두 색조를 씁니다. |
| `color` | `ColorInput` | 기준 파랑 램프 | sequential 스케일의 색조 원본. |
| `reverse` | `boolean` | `false` | 컬러맵의 양 끝을 뒤집습니다. |
| `min` | `number` | 데이터 최솟값 | 값 도메인의 아래 끝. |
| `max` | `number` | 데이터 최댓값 | 값 도메인의 위 끝. |
| `center` | `number` | 데이터가 0을 지나면 `0`, 아니면 도메인 중간 | diverging 중간점. `min` / `max` 없는 diverging 스케일은 이 값을 중심으로 대칭입니다. |
| `emptyColor` | `ColorInput` | 투명 | `NaN` 셀의 색. |
| `rowOrder` | `'top-down' \| 'bottom-up'` | `'top-down'` | `'top-down'`: 행 0이 맨 위(행렬 순서). `'bottom-up'`: 행 0이 맨 아래. |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | 표시 | 플롯 오른쪽의 컬러바: `{ show, title, format }`. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 컬러바에서 값의 이름. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 축 제목과 형식. |
| `hover` | `ChartHoverStyle` | — | 셀 외곽선: `markerRingColor`(바깥 링), `barHighlightColor`(안쪽 링). `marker: false`이면 끕니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `width` | `number` | `160` | 플롯의 월드 너비. |
| `height` | `number` | `90` | 플롯의 월드 높이. |

`HeatmapColorbarOptions`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `show` | `boolean` | `true` | 컬러바를 표시합니다. |
| `title` | `string` | `valueLabel` | 막대 위의 짧은 라벨. |
| `format` | `(value: number) => string` | 축약 숫자 | 눈금 라벨 텍스트. 함수만 받습니다(형식 문자열 불가). |

컬러바는 DOM이며 PNG 내보내기에 포함됩니다.

## 컬러맵 {#colormaps}

엔진은 OKLab 보간으로 256개 항목의 조회 테이블(LUT)을 만듭니다. 프래그먼트 셰이더가 각 셀 값을 읽어 `min` / `max`로(또는 `center`를 중심으로) 정규화하고 LUT 색을 고릅니다. `'sequential'`과 `'diverging'`의 양 끝은 테마의 표면 밝기에 따라 뒤집힙니다.

렌더링한 뒤에도 그리드를 다시 업로드하지 않고 컬러맵이나 도메인을 바꿀 수 있습니다.

```ts
sdk.setHeatmapColorScale('diverging');                 // 1 KB LUT만 다시 업로드
sdk.setHeatmapColorScale('sequential', { color: '#2a78d6', reverse: true });
sdk.setHeatmapDomain({ min: -5, max: 5, center: 0 }); // uniform만 갱신
sdk.render();
```

| 메서드 | 설명 |
|---|---|
| `setHeatmapColorScale(scale, options?)` | 컬러맵을 바꿉니다. `options`: `{ color?, reverse?, emptyColor? }`. `undefined`는 저장된 설정을 유지합니다. |
| `setHeatmapDomain({ min?, max?, center? })` | 값 도메인을 바꿉니다. 생략한 값은 데이터에서 가져옵니다. |

## 상호작용 {#interactions}

- 휠과 드래그로 두 축을 줌하고 팬합니다. 더블클릭은 초기화합니다. 코드에서는 `zoomChartXY`를 씁니다.
- hover는 O(1) 셀 계산입니다. 셀에 외곽선을 그리고, 툴팁은 행, 열, 값(`ctx.cell = { row, col, xLabel, yLabel }`)을 보여 줍니다.
- 히트맵에는 브러시가 없습니다. `'select'` 페이로드는 항상 비어 있습니다.

[상호작용](../guide/interactions), [툴팁과 hover](../guide/tooltips) 참고.

## 데이터 갱신 {#updating-data}

새 그리드로 `renderHeatmap`을 다시 호출합니다. 컬러맵이나 도메인만 바꿀 때는 위 메서드를 쓰세요.

## 참고 사항 {#notes}

- 기기의 2D 텍스처 한도보다 큰 그리드는 행 우선 순서로 텍스처에 접어 넣습니다.
- `xExtent`는 시간 축이 아닙니다. 시간대는 적용되지 않습니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="heatmap" data={{ cols, rows, values }} options={{ colorScale: 'viridis' }} />
```

## 함께 보기 {#see-also}

- [산점도 · 버블](./scatter)
- [스타일과 테마](../guide/styling)
- [내보내기: PNG · SVG · PDF](../guide/export)
