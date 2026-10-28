# PointCloud3D · Surface3D

`renderPointCloud3D`는 서로 독립된 XYZ 샘플을 화면을 향하는 점으로 그리고, `renderSurface3D`는 Y-up 높이 그리드를 조명과 컬러맵이 적용된 면으로 그립니다. 힘 기반 그래프가 아니라 실제 X/Y/Z 축, 선택, 스트리밍이 필요한 측정 3D 데이터(스캔, 궤적, 시뮬레이션 결과)에 사용합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scientific3d.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 0: 기본 시드 그래프를 만들지 않음
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.renderPointCloud3D([
  { name: 'Scan', data: new Float32Array([0, 1, 2, 3, 4, 5]), size: 5 },
  { name: 'Reference', data: [{ x: 1, y: 2, z: 3 }], color: '#ff9933', size: 10 },
], { title: 'XYZ 클라우드', legend: true });

// 궤도 회전 / 팬 / 줌, hover 툴팁, 키보드 탐색
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

면도 같은 방식입니다.

```ts
sdk.renderSurface3D([{
  name: 'Height',
  data: { columns: 3, rows: 2, xStart: -1, xStep: 1, zStart: 0, zStep: 2,
    y: [0, 1, 0, 1, 2, 1] },
  colormap: 'viridis', lighting: 0.65,
  contours: { show: true, levels: 8, color: '#f8fafc' },
}], { title: 'Y-up 면', showGrid: true });
sdk.render();
```

두 메서드 모두 `{ pointCount, seriesCount }`를 반환합니다. 좌표는 Y-up입니다. 원본 XYZ 값은 렌더 좌표와 분리해 보관하므로 툴팁, 키보드 포커스, CSV 내보내기는 항상 원본 값을 보여 줍니다. 내부 렌더 좌표는 Float32 정밀도입니다.

## 데이터 형식

### 포인트 클라우드 (`PointCloud3DSeries.data`)

다음 형태 중 하나를 받습니다.

| 형태 | 예 |
| --- | --- |
| interleaved `Float32Array` 또는 `Float64Array` | `new Float32Array([x0, y0, z0, x1, y1, z1])` |
| 튜플 배열 | `[[x, y, z], ...]` |
| 객체 배열 | `[{ x, y, z }, ...]` |
| 길이가 같은 열 | `{ x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number> }` |

`null` 항목이나 유한하지 않은 좌표는 gap입니다. 그리지 않지만 나머지 샘플은 원본 ID를 유지합니다.

### 면 (`Surface3DSeries.data`)

```ts
interface Surface3DGridData {
  columns: number; // 2 이상
  rows: number;    // 2 이상
  xStart: number; xStep: number; // 유한한 시작점, 0이 아닌 step (음수 가능)
  zStart: number; zStep: number;
  y: ArrayLike<number>;           // row-major: y[row * columns + column]
}
```

유한하지 않은 꼭짓점이 하나라도 있는 셀은 hole이 됩니다.

차트 하나는 전체 최대 4,000,000개 샘플을 담습니다.

## 옵션

### 시리즈 옵션

두 시리즈 공통:

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `name` | `string` | | 범례·툴팁 이름 |
| `color` | `ColorInput` | 팔레트 | 시리즈 색 |
| `visible` | `boolean` | `true` | 초기 표시 여부 |
| `opacity` | `number` | | 시리즈 불투명도 |

`PointCloud3DSeries`:

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `data` | `PointCloud3DData` | | XYZ 샘플 (위 참고) |
| `size` | `number` | `3` | 점 지름, CSS px |
| `colorBy` | `{ values, colormap?, min?, max? }` | | 점마다 scalar 하나를 `'viridis'`(기본) 또는 `'magma'`로 매핑합니다. `min` / `max`는 색상 범위를 고정합니다 |

`Surface3DSeries`:

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `data` | `Surface3DGridData` | | 높이 그리드 |
| `colormap` | `'viridis' \| 'magma'` | `'viridis'` | 높이 컬러맵. `colormap` 없이 `color`만 지정하면 단색입니다 |
| `yMin` / `yMax` | `number` | 데이터 범위 | 컬러맵의 색상 범위 |
| `wireframe` | `boolean` | `false` | 셀을 채우지 않고 격자선으로 그림 |
| `lighting` | `number` | `0.65` | 평면 확산 조명, 0..1 |
| `contours` | `Surface3DContourOptions` | | 높이 등고선, [등고선](#contours) 참고 |

### 차트 옵션 (`Scientific3DChartOptions`)

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `title` | `string` | | 차트 제목 |
| `description` | `string` | | 접근성 설명 |
| `legend` | `boolean \| ChartLegendOptions` | | 시리즈 범례 |
| `grid` | `ChartGridStyle` | | 격자선 스타일 |
| `showGrid` | `boolean` | | 격자 표시 |
| `hover` | `ChartHoverStyle` | | hover 마커 스타일 |
| `axes3d` | `{ x?, y?, z? }` | | 축별 범위·이름·눈금·표시 여부 |
| `aspect` | `'cube' \| 'data' \| [x, y, z]` | `'cube'` | 박스 비율 |
| `camera` | `Scientific3DCameraOptions` | | 투영과 초기 자세 |

카메라는 정규화된 렌더 공간의 Y-up orbit 카메라입니다. resize 후에도 회전·팬·거리·투영 크기를 유지합니다.

## 축 범위 · 비율 · 직교 투영

```ts
sdk.renderPointCloud3D([{ data: measuredXYZ, size: 4 }], {
  axes3d: {
    x: { name: 'X', min: 0, max: 120, tickCount: 4 },
    y: { min: 0, max: 40, tickCount: 3 },
    z: { min: 0, max: 20, tickCount: 3 },
  },
  aspect: 'data', // 'cube'(기본) 또는 [2, 1, 0.5] 같은 상대 XYZ 박스 길이
  camera: { type: 'orthographic' }, // 기본은 perspective, orthoSize 생략 시 자동 framing
});
```

`axes3d.x` / `y` / `z` (`Scientific3DAxisOptions`):

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `name` | `string` | | 축 이름 |
| `min` / `max` | `number` | 데이터 범위 | 데이터 단위의 고정 프레임 범위 |
| `tickCount` | `number` | `5` | 정수 2..50, 범위 안에서 균등 간격 |
| `visible` | `boolean` | `true` | `false`면 이 축의 눈금과 그 방향 격자를 숨김 |

- 생략한 끝점은 숨긴 시리즈를 포함한 모든 유한 샘플의 범위를 따릅니다. 양 끝을 모두 지정하면 `min < max`여야 합니다. 한쪽 끝만 고정했는데 자동 끝점이 그 값을 넘으면 자동 쪽을 고정 값의 5 %(최소 1 단위)만큼 넓힙니다.
- 고정 범위는 **축 프레임**입니다. 범위 밖 geometry를 잘라내지 않습니다.
- 축 라벨은 DOM 요소입니다. 전체 격자는 `showGrid`로 제어합니다.
- `aspect: 'cube'`는 각 축을 `[-60, 60]`으로 독립 정규화합니다. `aspect: 'data'`는 축 범위 길이 비율을 써서 같은 데이터 단위를 같은 길이로 표현합니다. 숫자 튜플은 양수인 상대 박스 길이입니다. 가장 긴 변은 120 렌더 단위입니다. 툴팁·CSV·접근성 출력은 원본 XYZ를 유지합니다.
- 스트리밍 중에는 고정 끝점을 유지하고 자동 끝점만 다시 계산합니다.

`camera` (`Scientific3DCameraOptions`):

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `type` | `'perspective' \| 'orthographic'` | `'perspective'` | 투영 방식 |
| `eye` | `[x, y, z]` | 데이터 박스에 맞춤 | 렌더 공간의 눈 위치 |
| `target` | `[x, y, z]` | `[0, 0, 0]` | 렌더 공간의 orbit 대상. `eye`가 필요합니다 |
| `orthoSize` | `number` | 자동 | 초기 세로 반높이 (직교 투영 전용, 양수). 휠 줌에 따라 바뀝니다 |

직교 피킹은 화면 위치마다 평행 광선을 사용합니다. `getCameraState()`가 `projection`과 `orthoSize`를 알려 줍니다. 다른 차트로 전환하면 perspective로 돌아갑니다.

## 등고선 {#contours}

면 시리즈의 `contours: { show?, levels?, color?, width?, opacity? }`는 높이 등고선을 그립니다.

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `show` | `boolean` | `false` | 등고선 표시 |
| `levels` | `number \| number[]` | `12` | 정수 1..64: `yMin..yMax`(생략 시 유한 높이 범위) 안쪽을 균등 분할하고 양 끝은 제외합니다. 범위가 한 값이면 그 값 하나입니다. 유한 숫자 배열: 원본 Y 높이를 그대로 사용합니다 |
| `color` | `ColorInput` | `'#e2e8f0'` | 선 색 |
| `width` | `number` | `1.5` | CSS px 굵기가 아닌 시각적 가중치입니다. 선은 1px hairline이며 alpha는 `min(1, opacity × colorAlpha × (0.75 + 0.15 × min(width, 4)))`입니다 |
| `opacity` | `number` | `0.85` | 0..1 |

잘못된 값은 렌더 전에 거부합니다. 등고선은 렌더링하는 삼각형 위에서 marching triangles로 만들고 면과 같은 좌표 매핑을 쓰므로, 고정 `axes3d`·모든 `aspect`·직교 투영에서도 면 위에 놓입니다. hole 셀에는 그리지 않고, 시리즈 가시성·강조를 따르며, 깊이 테스트로 가려지지만 선택 대상은 아닙니다. `updateSurface3D`는 갱신된 높이와 `yMin` / `yMax`로 개수 기반 levels를 다시 계산합니다.

## 스트리밍 갱신

```ts
// 클라우드 시리즈 0에 추가. 반환값은 그 시리즈에 남은 샘플 수
sdk.appendPointCloud3D(0, new Float32Array([1, 2, 3, 4, 5, 6]), { maxPoints: 2400 });
// colorBy 시리즈는 추가한 점마다 colorValues 하나가 필요합니다:
// sdk.appendPointCloud3D(0, xyz, { maxPoints: 2400, colorValues: scalars });
sdk.render();

// 렌더한 면에 적용 (위 클라우드와는 다른 차트)
sdk.updateSurface3D(0, { mode: 'replaceY', y: heights, yMin: -1, yMax: 1 });
sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: nextColumn });
sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: nextRow, scrollZ: false });
sdk.render();
```

### `appendPointCloud3D(seriesIndex, data, options?)`

`renderPointCloud3D`와 같은 XYZ 형태를 받고, 시리즈에 남은 샘플 수를 반환합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `maxPoints` | `number` | `0` (무제한) | 가장 최근 N개만 유지 |
| `colorValues` | `ArrayLike<number>` | | 시리즈가 `colorBy`를 쓰면 필수(추가한 점마다 하나), 아니면 전달할 수 없음 |

컬러맵과 고정 `min` / `max`는 유지하고, 자동 색상 범위는 남은 scalar로 다시 계산합니다.

### `updateSurface3D(seriesIndex, update)`

해당 시리즈의 `{ columns, rows, pointCount }`를 반환합니다.

| `mode` | 필드 | 설명 |
| --- | --- | --- |
| `'replaceY'` | `y`, `yMin?`, `yMax?` | 높이 전체(row-major, `rows * columns`)를 교체합니다. `yMin` / `yMax`는 이후 갱신에도 유지되고, 생략하면 현재 설정을 유지합니다 |
| `'appendColumns'` | `columns`, `y`, `scrollX?` | `y`는 column-major strip: `y[newColumn * rows + row]` |
| `'appendRows'` | `rows`, `y`, `scrollZ?` | `y`는 row-major block: `y[newRow * columns + column]` |

`scrollX` / `scrollZ`가 `true`(기본)이면 그리드 크기를 유지합니다. 가장 오래된 열/행을 버리고 원점을 `추가 개수 × step`만큼 옮깁니다. 창보다 큰 청크는 마지막 창 크기만 남깁니다. `false`면 원점을 고정하고 그리드를 늘립니다. 음수 step도 지원합니다.

### 갱신 규칙

- 갱신은 원자적입니다. 길이·범위·종류·시리즈 인덱스가 잘못됐거나 backend가 지원하지 않으면 현재 데이터를 바꾸지 않고 거부합니다.
- 입력은 복사하므로 이후 배열을 바꿔도 차트에 영향이 없습니다. 청크 하나와 차트 전체는 각각 최대 4,000,000개 샘플입니다. 빈 append도 허용합니다(클라우드의 더 작은 `maxPoints`는 적용됨).
- 카메라·스타일·가시성·강조·고정 축 끝점은 유지합니다. 자동 범위는 남은 데이터 전체로 다시 계산합니다. ID는 현재 시리즈 순서와 샘플 위치로 다시 매깁니다. 고정된 툴팁이나 키보드 포커스는 해제하고, CSV·접근성·툴팁은 갱신된 XYZ를 사용합니다.
- 현재 구현은 SDK 메타데이터를 복사하고 변경된 시리즈를 WebAssembly에 다시 전달하며, Rust가 범위와 geometry를 다시 계산합니다. GPU 부분 업로드나 O(추가량) 비용은 보장하지 않습니다.

## 상호작용과 내보내기

- `enableNodeInteractions(canvas, { autoRender: true })`를 호출하면 궤도 회전(왼쪽 드래그), 팬(Shift / 오른쪽 / 가운데 드래그), 줌(휠)을 쓸 수 있습니다. 카메라 조작은 [3D 네트워크 그래프](./graph-3d#camera)를 참고하세요.
- 포인트 클라우드 선택은 허용 반경 안에서 가장 앞에 있는 샘플을 반환합니다. 면 선택은 삼각형과 교차를 계산해 `point3d: { x, y, z, column, row }`를 반환합니다. wireframe 면도 셀 내부를 선택합니다.
- 키보드 탐색과 CSV는 보간하지 않은 원본 꼭짓점 XYZ를 제공합니다.
- SVG 내보내기는 래스터 이미지로 대체하고, PNG와 PDF는 현재 3D 화면을 담습니다.

## 프레임워크에서 사용

React와 Vue는 같은 `options`로 `type="pointCloud3d"`, `type="surface3d"`를 지원합니다. 갱신하려면 전체 데이터를 render API에 다시 전달합니다. 스트리밍에는 `onReady(sdk)` 또는 컴포넌트 ref의 `whenReady()`로 얻은 SDK에서 `appendPointCloud3D` / `updateSurface3D`와 `render()`를 호출하고, `data` / `options` prop 참조를 그대로 유지하세요. 새 참조를 넘기면 전체 render API가 다시 실행됩니다.

## 참고

- 현재 hover는 모든 점/셀을 검사합니다.
- 반투명 geometry는 깊이를 기록하지만 깊이 정렬은 하지 않습니다. 정확한 다중 투명면 합성은 지원하지 않습니다.
- 아직 제공하지 않는 기능: 3D 브러시와 동기화, 등고선 라벨, FOV / near / far / up 카메라 설정, nice ticks, GPU glyph 라벨, 독립 박스 토글.

## 함께 보기

- [3D 네트워크 그래프](./graph-3d)
- [상호작용](../guide/interactions)
- [내보내기: PNG · SVG · PDF](../guide/export)
- [React](../guide/react) · [Vue](../guide/vue)
