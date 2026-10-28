# Charturbo 사용 가이드

> 처음이라면 [README](../README.md)의 빠른 시작부터 보세요. 이 문서는 기능별 전체 옵션 레퍼런스입니다.

**Rust + WebGPU (WebAssembly) 기반 초고성능 2D/3D 대규모 시각화 · 대용량 차트 · 임베딩 분석 · 공간 물리 엔진 라이브러리**

`Charturbo`는 수만 개의 데이터 포인트(선 그래프, 막대 그래프, 산점도)와 대규모 3D 네트워크 그래프/수천 차원 임베딩 포인트 클라우드를 DOM이나 Canvas2D의 프레임 저하 없이 WebGPU 하드웨어 가속(60 FPS)으로 실시간 렌더링하고, Three.js 스타일의 범용 3D 공간을 단일 Rust + `wgpu` 파이프라인으로 제공하는 **Zero-dependency** 웹 라이브러리입니다.

> 💡 **순수 라이브러리 vs 데모 쇼케이스 분리 안내**
> - **NPM 배포용 순수 라이브러리 (`npm run build:lib`)**: [`web/src/index.ts`](../web/src/index.ts) 엔트리포인트를 통해 오직 `Charturbo` 코어 클래스, 타입 선언(`.d.ts`), 그리고 WebAssembly 바이너리만 `web/dist-lib/`로 번들링됩니다. 데모 화면(예시 아카이브 갤러리, Three.js 벤치마크 비교 화면)은 라이브러리에 **일절 포함되지 않습니다**.

---

## ✨ 주요 기능 (Features)

1. **대용량 2D / 2.5D 차트 가속 (Massive Charts)**
   - **50,000+ 포인트 멀티 시리즈 선 그래프 (`renderLineChart`)**: DOM/SVG/Canvas2D 기반 차트 라이브러리에서 발생하는 버벅임 없이 60 FPS 유지
   - **겹침 / 누적 / 100% 누적 영역 차트 (`renderAreaChart`)**: 선 그래프와 같은 데시메이션 · 줌 · 시간 축, 범례 토글 시 엔진에서 재누적
   - **2D / 3D 막대 그래프 (`renderBarChart`: 단일 시리즈, `renderGroupedBarChart`: 그룹 / 누적 / 100% 누적)**: 2D 평면 모드 및 3D 입체 큐브 모드 자유 전환 지원
   - **100만 포인트 2D 산점도 / 버블 차트 (`renderScatterChart`)**: GPU 인스턴싱(포인트 1회 업로드), x/y 동시 줌·팬, 균일 그리드 해시 hover, 시리즈 범례
   - **캔들스틱 (OHLC) 차트 (`renderCandlestickChart`)**: 몸통(막대) + 심지(선), 2px 미만으로 좁아지면 Rust에서 픽셀 컬럼 단위 OHLC 집계, 거래량 패널, x 줌·팬 + 보이는 구간에 맞춘 가격 축, 십자선 · O/H/L/C/V 툴팁
   - **독립 OHLC 차트 (`renderOhlcChart`)**: 고가–저가 세로선 + 왼쪽 시가·오른쪽 종가 틱. 캔들의 거래량·집계·시간축·탐색을 공유하고 React/Vue `type="ohlc"`로 사용
   - **히스토그램 (`renderHistogram`)**: Rust에서 O(n) 구간화(Freedman–Diaconis, IQR 0이면 Sturges), 간격 없는 막대 + 구간 경계 숫자 눈금
   - **4096×4096 히트맵 / 행렬 차트 (`renderHeatmap`)**: 값 그리드를 R32Float 텍스처로 1회 업로드해 쿼드 하나로 렌더, 256색 LUT 컬러맵, x/y 줌·팬, 셀 hover, 컬러바
   - **박스 플롯 / 바이올린 (`renderBoxPlot`)**: 그룹별 O(n) 통계(선택 알고리즘, 정렬 없음), Tukey / min·max / 백분위 수염, 이상치 샘플링, binned KDE 바이올린, 시리즈 그룹 배치
   - **트리맵 · 선버스트 · 생키 (`renderTreemap`, `renderSunburst`, `renderSankey`)**: 계층 집계 · 순환 검출 · squarified / 방사형 분할 / d3-sankey 레이아웃 · 테셀레이션 · hit-test · 라벨 맞춤을 모두 Rust에서 계산(잎 10만 개 트리맵, 노드 1만 개 생키), 클릭 드릴다운 · 브레드크럼
2. **임의 차원 임베딩 프로젝션 & 코사인 유사도 (`loadEmbeddings`)**
   - 128차원, 768차원, 1536차원, 3072차원 등 **어떠한 고차원 벡터 임베딩이든 수용**
   - 메모리 친화적 **Matrix-Free Power Iteration PCA & JL Random Projection**으로 3D 공간 자동 투영
   - Spherical K-Means 기반 의미론적 클러스터링 및 Cosine k-NN 그래프 자동 생성
   - **임의의 벡터 간 정확한 코사인 유사도 질의 (`queryCosineSimilar`)**
3. **초고성능 3D 그래프 & 네트워크 토폴로지**
   - `Float32Array` / `Uint32Array` 기반 Zero-copy 벌크 데이터 적재 (`loadDataset`)
   - O(N log N) **Barnes-Hut 3D Octree** 척력 시뮬레이션 및 O(log N) 구체/절두체/광선 공간 질의
   - **즉시 적용 가능한 4종 3D 배치 프리셋 (`applyLayout`)**: `'cluster-sphere'`, `'radial-shells'`, `'helix'`, `'grid-3d'`
4. **시각화 노드 데이터 조회 & 인터랙션 (`enableNodeInteractions`)**
   - 각 노드에 도메인 메타데이터(이름, 카테고리, 설명, 태그, 비즈니스 속성) 바인딩 (`setNodeMetadata`, `setSingleNodeMetadata`)
   - 노드 마우스 오버 시 **자동 플로팅 HTML 툴팁**, 클릭 시 **1-Hop 이웃 하이라이트 & 상세 데이터 콜백(`NodeDetails`)**, 더블클릭 시 **카메라 자동 포커스**
   - **BFS 최단 경로 탐색 및 하이라이트 (`highlightShortestPath`)**, **노드 실시간 검색 (`searchNodes`)**, **3D ➔ 2D 화면 좌표 투영 (`projectNodeToScreen`)**
5. **Three.js 스타일 범용 3D 공간 & 강체 물리 엔진**
   - 기본 3D 도형(`addBox`, `addSphere`, `addCylinder`, `addPlane`) 및 커스텀 인덱스 삼각형 메시(`addCustomMesh`)
   - 부모-자식 계층형 트랜스폼(`parentId`), PBR 스타일 조명/재질(`setObjectMaterial`, `setLighting`), 3D 강체 물리(`setRigidPhysics`, `setObjectPhysics`), 정밀 삼각형 레이캐스팅(`raycastObjectAtNdc`)

---

## PointCloud3D / Surface3D

`renderPointCloud3D`·`renderSurface3D`는 `{ pointCount, seriesCount }`를 반환합니다. Y-up 좌표를 사용하며 원본 XYZ와 렌더 좌표를 분리합니다. 기본 `aspect: 'cube'`는 각 축을 `[-60, 60]`으로 독립 정규화합니다. `aspect: 'data'`는 XYZ의 같은 데이터 단위를 같은 길이로 표현합니다. 내부 좌표는 Float32 정밀도입니다.

```ts
sdk.renderPointCloud3D([
  { name: 'Scan', data: new Float32Array([0, 1, 2, 3, 4, 5]), size: 5 },
  { name: 'Reference', data: [{ x: 1, y: 2, z: 3 }], color: '#ff9933', size: 10 },
], { title: 'XYZ cloud', legend: true });

sdk.renderSurface3D([{
  name: 'Height',
  data: { columns: 3, rows: 2, xStart: -1, xStep: 1, zStart: 0, zStep: 2,
    y: [0, 1, 0, 1, 2, 1] },
  colormap: 'viridis', lighting: 0.65,
  contours: { show: true, levels: 8, color: '#f8fafc' },
}], { title: 'Y-up surface', showGrid: true });
sdk.enableNodeInteractions(canvas, { autoRender: true });
```

- Cloud 입력: interleaved `Float32Array`·`Float64Array`, `[x,y,z][]`, `{x,y,z}[]`, 또는 같은 길이의 `{x: ArrayLike, y: ArrayLike, z: ArrayLike}`. `null`·비유한 좌표는 원본 ID를 유지하는 gap입니다. `size`는 CSS px 지름(기본 3), `colorBy: { values, colormap?, min?, max? }`로 scalar 색상을 지정합니다.
- Surface 입력: `y[row * columns + column]`. 가로·세로 각각 2 이상, 유한한 시작점과 0이 아닌 step이 필요하며 음수 step도 지원합니다. 비유한 꼭짓점이 하나라도 있으면 해당 셀 전체가 hole입니다. `wireframe` 기본 false, `lighting`은 0..1, 기본 0.65입니다. `colormap`은 `'viridis'`·`'magma'`, `yMin/yMax`는 색상 범위입니다. 명시적 `color`만 지정하면 단색을 사용합니다.
- Surface `contours: { show?, levels?, color?, width?, opacity? }`는 ChartGPU v0.4.0 계약을 따릅니다. `show` 기본 false입니다. `levels`는 1..64 정수(기본 12)이면 `yMin..yMax`(생략 시 유한 높이 범위) 안쪽을 균등 분할하고 양 끝은 제외합니다. 범위가 한 값이면 그 값 하나입니다. 유한 숫자 배열이면 원본 Y 높이를 그대로 사용합니다. `color` 기본 `#e2e8f0`, `opacity` 0..1 기본 0.85입니다. `width`(기본 1.5)는 CSS px 굵기가 아니라 1px hairline의 alpha 가중치 `min(1, opacity × colorAlpha × (0.75 + 0.15 × min(width, 4)))`입니다. 잘못된 값은 렌더 전에 거부합니다.
- 등고선은 렌더링하는 삼각형 분할 위에서 marching triangles로 생성하며, 면과 같은 좌표 매핑을 씁니다. 따라서 고정 `axes3d`·`aspect`·직교 투영에서도 면 위에 놓입니다. hole 셀에는 그리지 않습니다. 시리즈 가시성·강조를 따르고 깊이 테스트로 가려지지만 선택 대상은 아닙니다. 면에 polygon offset(factor 1, units 1)을 적용해 같은 평면의 선이 끊기지 않게 합니다. `updateSurface3D`는 갱신된 높이와 `yMin/yMax`로 개수 기반 levels를 다시 계산합니다.
- 공통 시리즈 옵션: `name`, `visible`, `color`, `opacity`. 차트 옵션: `title`, `description`, `legend`, `grid`, `showGrid`, `hover`, `axes3d`, `aspect`, `camera`. 카메라는 정규화된 렌더 공간의 Y-up orbit이며 resize 후 회전·팬·거리·투영 크기를 보존합니다.
- 포인터 cloud 선택은 허용 반경 내 전면 샘플입니다. Surface는 삼각형 ray intersection으로 `point3d: {x,y,z,column,row}`를 반환합니다. Wireframe도 셀 내부를 선택합니다. 키보드·CSV는 보간하지 않은 원본 정점 XYZ를 제공합니다. SVG는 raster fallback, 이미지/PDF는 현재 3D 화면을 사용합니다.
- React/Vue `type="pointCloud3d"`·`type="surface3d"`, 예제 `/scientific3d.html`. 전체 데이터를 해당 render API에 다시 전달하여 갱신합니다. 최대 400만 샘플이며 현재 hover는 전체 점/셀을 검사합니다.
- 3D brush·sync, 정확한 다중 투명면 합성, 등고선 라벨은 후속 범위입니다. 반투명 geometry는 depth-write하지만 깊이 정렬하지 않습니다. 전체 ChartGPU v0.4.0 기능 동등성 완료를 뜻하지 않습니다.

### 3D 축 범위 · 비율 · 직교 투영

```ts
sdk.renderPointCloud3D([{ data: measuredXYZ, size: 4 }], {
  axes3d: {
    x: { name: 'X', min: 0, max: 120, tickCount: 4 },
    y: { min: 0, max: 40, tickCount: 3 },
    z: { min: 0, max: 20, tickCount: 3 },
  },
  aspect: 'data', // 'cube' (기본) 또는 [2, 1, 0.5] 같은 상대 XYZ 박스 비율
  camera: { type: 'orthographic' }, // perspective가 기본, orthoSize 생략 시 자동 framing
});
```

- `axes3d.x/y/z`: 원본 데이터 단위의 `min`·`max`, 눈금 이름 `name`, `tickCount`(정수 2..50, 기본 5), `visible`(기본 true). 눈금은 범위 내 균등 간격이며 `visible: false`는 해당 축 눈금과 그 방향 격자를 숨깁니다. 전체 격자는 `showGrid`로 제어합니다. 라벨은 DOM입니다.
- 생략한 끝점은 숨긴 시리즈를 포함한 유한 샘플의 범위를 따릅니다. 양 끝을 지정하면 `min < max`여야 합니다. 한쪽 끝만 고정했는데 자동 끝점과 역전되면 자동 쪽을 고정 끝점의 5%(최소 기준 단위 1)만큼 넓힙니다. 고정 범위는 **축 프레임**이며 범위 밖 geometry를 잘라내지 않습니다.
- `aspect: 'data'`는 축 범위 길이 비율, 숫자 튜플은 양의 상대 박스 길이입니다. 가장 긴 변을 120 렌더 단위로 맞추며 XYZ 툴팁·CSV·접근성 원본은 바꾸지 않습니다. 스트리밍 중 고정 끝점은 유지하고 자동 끝점만 재계산합니다.
- `camera.type`: `'perspective'` 또는 `'orthographic'`. `eye`·`target`은 렌더 공간 좌표이며 target 지정에는 eye가 필요합니다. `orthoSize`는 직교 투영의 초기 세로 반높이(양수)이며 휠 줌에 따라 변합니다. 직교 피킹은 화면 위치별 평행 광선을 사용합니다. `getCameraState()`의 `projection`·`orthoSize`로 읽을 수 있습니다.
- React/Vue의 `options`에도 동일하게 전달합니다. 비교 예제: `/scientific3d.html#06-axes-projection`. FOV·near/far·up 설정, nice ticks·GPU glyph·독립 box 토글은 아직 제공하지 않습니다.

### 3D 데이터 갱신 · 스트리밍

```ts
// 이미 렌더한 cloud 시리즈 0에 추가. 반환값은 해당 시리즈의 유지된 샘플 수.
sdk.appendPointCloud3D(0, new Float32Array([1, 2, 3, 4, 5, 6]), { maxPoints: 2400 });
// colorBy 시리즈에는 추가한 포인트마다 colorValues 하나가 필요합니다.
// sdk.appendPointCloud3D(0, xyz, { maxPoints: 2400, colorValues: scalars });
sdk.render();

// 이미 렌더한 surface에 적용 (cloud와는 별도 차트 인스턴스).
sdk.updateSurface3D(0, { mode: 'replaceY', y: heights, yMin: -1, yMax: 1 });
sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: nextColumn });
sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: nextRow, scrollZ: false });
sdk.render();
```

- `appendPointCloud3D(seriesIndex, data, options?)`: render API와 같은 XYZ 입력 형식을 받습니다. `maxPoints`는 0/생략 시 무제한, 양의 정수이면 가장 최근 N개만 유지합니다. 기존 `colorBy`가 있으면 `colorValues`가 필수이고, 없으면 전달할 수 없습니다. 기존 colormap과 고정 min/max를 유지하며 자동 색상 범위는 유지된 scalar로 재계산합니다.
- `updateSurface3D(seriesIndex, update)`는 해당 시리즈의 `{ columns, rows, pointCount }`를 반환합니다. `replaceY`는 전체 **row-major** 높이 배열(`rows * columns`)을 교체합니다. 선택적 `yMin`/`yMax`는 이후 갱신에도 유지되며 생략하면 기존 설정을 유지합니다.
- `appendColumns`의 `y`는 **column-major strip**(`y[newColumn * rows + row]`), `appendRows`는 **row-major block**(`y[newRow * columns + column]`)입니다. 기본 `scrollX: true` / `scrollZ: true`는 기존 크기를 유지하면서 오래된 열/행을 버리고 원점에 `추가 개수 × step`을 더합니다. 창보다 큰 청크는 마지막 창 크기만 남깁니다. `false`이면 원점은 고정하고 그리드 크기를 늘립니다. 음수 step도 지원합니다.
- 갱신은 원자적입니다. 잘못된 길이·범위·종류·시리즈 인덱스 또는 미지원 backend는 기존 데이터 변경 없이 거부합니다. 입력은 복사하므로 이후 호출자의 배열 변경은 차트에 영향을 주지 않습니다. 전체 차트는 유지된 샘플 합계 최대 400만 개, 입력 청크도 최대 400만 개입니다. 빈 append는 허용합니다(cloud의 `maxPoints` 축소는 적용).
- 카메라·스타일·가시성·강조·고정 축 끝점을 유지하며 자동 좌표 범위는 전체 유지 데이터로 재계산합니다. ID는 현재 시리즈 순서와 샘플 위치로 다시 매겨집니다. 이전 고정 툴팁/키보드 포커스는 해제하고, CSV·접근성·툴팁은 갱신된 XYZ를 사용합니다.
- 현재 경로는 SDK 메타데이터를 복사하고 변경 시리즈를 WASM에 다시 전달하며, Rust가 전체 범위 및 geometry를 재계산합니다. GPU 부분 버퍼 업로드나 O(추가량) 성능을 보장하지 않습니다.
- React/Vue에서는 `onReady(sdk)` 또는 컴포넌트 ref의 `whenReady()`로 얻은 SDK에서 위 메서드와 `render()`를 호출합니다. 스트리밍 중에는 `data`/`options` prop 참조를 유지하세요. 새 참조를 전달하면 전체 render API가 실행됩니다.
- 실행 예제: `/scientific3d.html#04-streaming-cloud`, `/scientific3d.html#05-streaming-surface`. Play/Pause·reduced motion·숨겨진 탭/화면 밖 정지와 dispose 정리를 지원합니다.

## 독립 ErrorBar / Impulse 차트

두 API는 `{ totalPoints, seriesCount }`를 반환합니다. 각 샘플을 독립적으로 그리므로 선 M4 데시메이션이나 이웃 샘플 연결을 적용하지 않습니다.

```ts
sdk.renderErrorBarChart([
  { name: '측정', x: [1, 2, 3], values: [10, 15, 12], errorLow: 2, errorHigh: [3, 5, 4],
    capWidth: 12, showCenter: true },
]);
sdk.renderImpulseChart([
  { name: '이벤트', x: [0, 1, 2, 3], values: [0, 5, -3, 0], baseline: 0, showMarker: true },
]);
```

- ErrorBar 입력은 `values`와 같은 길이의 절대 `low`·`high`, 대칭 `error`, 비대칭 `errorLow`·`errorHigh` 중 하나입니다. 상대 오차는 숫자 또는 배열이며 절댓값을 적용합니다. 뒤집힌 절대 경계는 정렬합니다.
- `errorMode`: `'both'`(기본), `'high'`, `'low'`. 양측은 low↔high, 단측은 중심값↔해당 경계입니다. 사용되는 경계나 중심값이 비유한 값이면 gap입니다.
- `direction: 'horizontal'`이면 high/low는 X 좌표, `values`는 Y 좌표입니다. 중심 마커는 `(x, values)`입니다. ChartGPU v0.4.0과 같이 상대 오차·단측 줄기의 기준은 수평에서도 `values`입니다. 일반 수평 신뢰구간에는 절대 경계와 `errorMode: 'both'`를 사용합니다.
- `capWidth`는 전체 길이(CSS px 숫자 또는 평균 카테고리 간격의 퍼센트, 기본 `'40%'`). `drawWhiskers`·`drawConnector` 기본 true, `showCenter` 기본 false, `symbolSize` 기본 6입니다.
- Impulse `baseline` 기본 0, `showMarker` 기본 true, `symbolSize` 기본 6입니다. 값이 baseline과 같으면 줄기는 생략하고 마커만 남깁니다.
- 두 종류 모두 `lineWidth` 기본 1.5px, 시리즈 `color`·오른쪽 Y축·범례·줌·팬을 지원합니다. `x`는 모든 시리즈에 제공하거나 모두 생략하며, 제공한 X는 유한·비감소 순서여야 합니다. 2D 전용이고 샘플링 옵션은 없습니다.
- 포인터는 실제 줄기·캡·마커를 hit-test합니다. XY brush는 데이터 단위 줄기/경계 교차를 선택합니다(CSS px 캡 폭은 brush 범위에 포함하지 않음). 툴팁/선택 종류는 `'errorBar'`·`'impulse'`입니다. 키보드 툴팁과 CSV는 각각 중심값·low/high 또는 값·baseline을 제공합니다. SVG는 벡터 경로입니다.
- React/Vue `<CharturboChart type="errorBar" ... />`, `type="impulse"`로 사용합니다. 데이터 갱신은 각 `render*Chart`에 전체 채널을 다시 전달합니다. `setSeriesData`·`appendSeriesData`는 두 종류에서 거부합니다.
- 예제: `/line.html#08-error-bars`, `#09-error-horizontal`, `#10-impulse`.

## 독립 Band / 범위 차트

중심선 없이 두 경계 사이를 채웁니다. 반환값은 `{ totalPoints, seriesCount }`이며 한 쌍의 경계를 하나의 시리즈로 셉니다.

```ts
sdk.renderBandChart([{
  name: '예측 범위',
  x: new Float64Array([0, 1, 2, 3]),
  lower: [8, 12, 20, 11],
  upper: [12, 18, 16, 15], // 교차 허용: 입력 채널 순서를 보존
  lowerLineWidth: 1.5,
  upperLineWidth: 1.5,
}], { fillOpacity: 0.3, axes: { x: { title: '시간' } } });
```

- `lower`·`upper`·선택적 `x`는 시리즈 내 길이가 같아야 합니다. `x`는 모든 시리즈에 제공하거나 모두 생략하며, 유한한 비감소 숫자 또는 `Date`를 받습니다. 시간축은 `axes.x.type: 'time'` 또는 `Date[]`로 지정합니다.
- 경계별 두께 기본값은 `0`(채우기만), `fillOpacity` 기본값은 `0.25`입니다. 시리즈별 설정이 차트 기본값보다 우선합니다. `curve`, `yAxis: 'right'`도 지원합니다.
- 어느 경계든 유효하지 않은 샘플은 쌍 전체의 gap입니다. `connectNulls: true`이면 이웃 유효 쌍을 연결합니다. 교차는 실제 교점에서 삼각형을 분할합니다.
- 대용량 LOD는 두 채널의 최소·최대와 gap을 함께 보존합니다. hover/XY brush는 중앙값이 아니라 실제 범위를 검사합니다. 툴팁 `chartType`과 선택 `kind`는 `'band'`이고, `items[].band`에 두 원본 경계를 반환합니다. 공통 `items[].value`는 내부 선택용 중간값입니다.
- 키보드 탐색·범례·축·줌·팬·SVG를 지원하며 CSV에는 두 경계만 출력합니다. React/Vue에서 `type="band"`와 같은 시리즈 배열을 사용합니다.
- 교체 시 `renderBandChart`에 두 경계를 함께 전달합니다. `setSeriesData`·`appendSeriesData`의 단일 채널 갱신은 지원하지 않습니다. 전체 ChartGPU API/샘플링 옵션 호환을 뜻하지 않습니다.
- 실행 예제: `line.html#06-band`(10만 쌍), `line.html#07-band-crossing`(교차).

## 🚀 빠른 시작 (Quick Start)

### 1. 50,000개 포인트 고속 2D 선 그래프
```ts
import { Charturbo } from 'charturbo';

const canvas = document.getElementById('my-canvas') as HTMLCanvasElement;
const sdk = await Charturbo.create(canvas);

// 5만 개 데이터 포인트 실시간 렌더링
sdk.renderLineChart(
  [
    {
      name: 'GPU Sensor Data',
      values: Float32Array.from({ length: 50000 }, (_, i) => Math.sin(i * 0.05) * 40),
      color: [0.224, 0.529, 0.898, 1.0], // 생략 시 기본 팔레트 순서대로 지정
      lineWidth: 3, // 시리즈별 선 두께 (CSS px)
    },
  ],
  {
    viewMode: '2d',
    lineWidth: 2, // 모든 시리즈 기본 선 두께 (CSS px, 줌해도 유지)
    hover: { mode: 'index', crosshair: true, markerRadius: 4 },
  }
);

// 마우스 오버 툴팁 활성화 (crosshair / 마커 / 막대 강조는 엔진이 GPU로 그림)
sdk.enableNodeInteractions(canvas);

// 렌더 후 선 두께 변경
sdk.setLineWidth(1.5); // 전체
sdk.setLineWidth(4, 0); // 0번 시리즈만
```

선/막대 차트는 Rust 엔진이 직접 처리합니다: 화면 해상도 기준 M4 데시메이션(100만 포인트도 화면 픽셀 수 수준의 세그먼트로 축약, 스파이크 보존), 줌과 무관하게 일정한 px 두께의 안티앨리어싱 선, 둥근 데이터 끝 막대, hover 판정과 crosshair/마커. 값이 `NaN`인 샘플은 선을 끊어 공백으로 표시됩니다.

#### 축 · 범례 · 제목 · 줌/팬
```ts
sdk.renderLineChart(series, {
  title: '실시간 인프라 텔레메트리',
  legend: { show: true, toggle: true, emphasize: true, position: 'top' /* | 'bottom' | 'left' | 'right' */, overflow: 'scroll' /* | 'wrap' */ }, // 2개 이상 시리즈면 기본 표시
  axes: {
    x: { title: '시간', format: (i) => new Date(t0 + i * 1000).toLocaleTimeString() },
    y: { title: '처리량 (req/s)', format: (v) => `${v / 1000}k` },
  },
  padding: { right: 24 }, // 생략한 쪽은 제목/범례/축에 맞춰 자동 계산
});
sdk.enableNodeInteractions(canvas); // 휠: x축 줌, 드래그: 팬, 더블클릭: 리셋

sdk.setSeriesVisible(1, false); // 범례 클릭과 동일
sdk.emphasizeSeries(0);         // 다른 시리즈 흐리게 (null = 해제)
sdk.zoomChartX(0.5);            // 프로그램으로 줌 (1 미만 = 확대)
sdk.resetChartZoom();
```
- 눈금은 엔진이 1·2·5×10ⁿ 단위로 계산하고 그리드도 같은 값에 그립니다. 라벨 DOM은 눈금이 실제로 바뀔 때만 다시 배치됩니다.
- 범례는 `<button aria-pressed>`라 키보드로도 조작됩니다. 시리즈를 숨겨도 y축 범위는 유지됩니다.
- 범례 위치(`position`): 위 · 아래는 한 줄(28px 여백), 왼쪽 · 오른쪽은 가장 긴 이름에 맞춘 세로 열(72~200px + 8px 간격)을 해당 쪽 여백에 더합니다. `padding`으로 지정한 쪽은 그 값이 이깁니다
- 넘침(`overflow`): `'scroll'`(기본)은 실제로 잰 항목 크기로 한 줄(열)에 온전히 들어가는 만큼씩 페이지를 나누고 ‹ n / m › 버튼으로 넘깁니다(크기가 바뀌면 다시 나누되 현재 첫 항목이 있는 페이지 유지). 다른 페이지 항목은 `display: none`이라 탭 이동 · 이미지 내보내기에서 빠집니다. `'wrap'`은 줄바꿈(위 · 아래 전용, 늘어난 줄은 플롯을 덮을 수 있음)
- CSS 클래스: `.charturbo-sdk-chart-overlay`, `.charturbo-sdk-chart-title`, `.charturbo-sdk-chart-legend`, `.charturbo-sdk-legend-item`, `.charturbo-sdk-legend-pager`, `.charturbo-sdk-legend-page`, `.charturbo-sdk-axis-tick`, `.charturbo-sdk-axis-title`

#### 터치 · 펜 제스처 (모바일)
`enableNodeInteractions`는 Pointer Events로 터치/펜 멀티 포인터를 직접 인식합니다 (마우스 동작은 그대로). 연결 중에는 캔버스에 `touch-action: none`을 걸고 해제 시 원래 값으로 복원합니다.

| 제스처 | 2D 선 그래프 | 그래프 / 3D (2D 산점도·막대는 회전 대신 이동) |
|---|---|---|
| 한 손가락 드래그 (8px 이상) | x축 팬 (손을 떼면 관성) | 카메라 회전 |
| 핀치 | 두 손가락 중점 기준 x축 줌 | 카메라 줌 |
| 두 손가락 드래그 | x축 팬 | 카메라 팬 |
| 탭 | 해당 지점 툴팁 고정 (다른 곳을 탭할 때까지) | 노드 선택 + 툴팁 (`onNodeClick`) |
| 길게 누르기 (450ms) | 스크럽: 툴팁이 손가락을 따라감 (팬 없음) | 동일 |
| 더블탭 | 줌 리셋 | 노드 포커스 |

```ts
sdk.enableNodeInteractions(canvas, {
  touch: { pinchZoom: true, tapTooltip: true, longPressScrub: true }, // 모두 기본 true, `touch: false`면 비활성
});
// 자체 포인터 핸들러가 있는 앱: 터치/펜은 SDK에 맡기기
if (e.pointerType !== 'mouse' && sdk.handlesTouchGestures()) return;
```

#### 산점도 / 버블 차트
```ts
sdk.renderScatterChart(
  { x: xs, y: ys, sizes: radiusPx, clusters: seriesIds }, // sizes / clusters / colors(4*N)는 선택
  {
    title: '세그먼트 분포',
    seriesNames: ['A', 'B', 'C'],  // clusters 값 = 시리즈 id (범례 · 팔레트 색 · 표시 토글)
    axes: { x: { title: 'x' }, y: { title: 'y' } },
    pointRadius: 3, opacity: 0.85, // sizes가 없을 때의 반지름 (CSS px), 채움 투명도
    pointRing: 1,                  // 배경색 링 (px, sizes가 있으면 기본 1)
    symbol: 'circle', seriesSymbols: ['circle', 'square', 'diamond', 'triangle'], // 시리즈별 심볼
    ripple: { series: [1], period: 4, scale: 2.5, count: 3, fill: false }, // 파동 효과 (true = 모든 시리즈)
    jitter: { x: 0.3, y: 0, seed: 0 }, // 겹친 점 흩뜨리기 (데이터 단위)
  }
);
sdk.enableNodeInteractions(canvas); // 휠: x/y 줌, 드래그: 팬, 더블클릭: 리셋, 툴팁: 시리즈 · x · y
sdk.zoomChartXY(0.5, 0, 0);         // 프로그램으로 줌 (NDC 기준점)
```
- 2D 전용입니다 (`z`, `viewMode: '3d'`는 무시). x/y 범위는 1·2·5×10ⁿ 눈금으로 맞춰지고, 그리드는 가로 + 세로(`verticalGrid`)입니다.
- 포인트(20 바이트 인스턴스)는 데이터 / 표시 시리즈가 바뀔 때만 업로드되고, 줌·팬은 레이어 변환 uniform만 갱신합니다.
- 심볼(`symbol` · `seriesSymbols`): 모양 번호를 시리즈 슬롯 칸에 `slot + 256 × 모양`으로 함께 실어 인스턴스 크기는 그대로입니다. 셰이더가 선 마커와 같은 signed distance(원 · 사각형 · 마름모 · 삼각형, 원과 비슷한 시각 무게)로 안티에일리어싱하며 원은 이전과 같은 픽셀입니다. hover 마커 · SVG 내보내기 · 범례 견본(삼각형은 `▲` 글자라 이미지 내보내기에도 그대로)이 같은 모양을 씁니다. hit test는 원 기준입니다
- 파동(`ripple`, ECharts `effectScatter`): 선택한 시리즈의 점 뒤로 고리가 점 반지름에서 `scale`배까지 커지며 `period`초 동안 사라집니다(`count`개가 위상을 나눔, 1.5px 선 또는 반투명 채움). 시리즈 플래그는 모양 비트에 함께 실리고, 매 프레임 바뀌는 것은 점 uniform의 시간 값뿐입니다. SDK는 파동이 보일 때만 `requestAnimationFrame` 루프를 돌리고(차트가 바뀌면 스스로 멈춤, 숨긴 탭은 브라우저가 멈춤), `prefers-reduced-motion: reduce`이면 정지 프레임 하나만 그립니다. `sdk.setEffectTime(초)`는 특정 시점에 고정합니다(스크린샷 · 내보내기), `null`은 다시 재생. 매 프레임 다시 그리므로 소수의 강조 점용입니다. SVG 내보내기에는 고리가 없습니다
- 지터(`jitter`): ggplot2 `geom_jitter`처럼 축마다 `[-x, x]` · `[-y, y]` 데이터 단위(로그 축은 10의 거듭제곱 단위) 균등 오프셋을 더합니다. 오프셋은 점 인덱스와 `seed`의 PCG 해시(Jarzynski & Olano 2020)로 정해져 다시 그려도 같습니다. 배치 단계에서 위치에 더하므로 범위 · hover · 브러시 · 공간 해시가 모두 흩뜨린 위치를 쓰고, 툴팁 · 표 · CSV는 원래 값을 보여 줍니다. ECharts의 픽셀 단위 · 겹침 회피(beeswarm) 지터는 아닙니다
- 회귀선(`trendline: { type, order?, series?, color?, width?, dash? }` 또는 배열, ECharts ecStat `regression`): 시리즈마다 따로 맞춥니다(기본: 모든 시리즈). `linear`는 최소제곱, `logarithmic`은 `y = a + b ln x`(x > 0만), `exponential`은 ecStat과 같은 y 가중 로그 최소제곱 `Σ y (ln y − ln a − bx)²`(MathWorld "Least Squares Fitting—Exponential" 식 9–10, y > 0만), `polynomial`(`order` 2~6, 상한은 Excel 추세선과 같음)은 x를 [−1, 1]로 정규화해 Givens QR(Golub & Van Loan)로 풉니다. R²는 모든 종류에서 원래 y 기준 `1 − SS_res / SS_tot`입니다(ecStat은 R²를 주지 않음). 정의역 밖이라 빠진 점 수는 범례 · 접근성 설명 · `getScatterTrendlines()`의 `skipped`로 알려 줍니다. 곡선은 보이는 x 범위(줌 · 로그 축 포함)를 곡률에 맞춰 잘게 그리고, 범례에 `y = … (R² = …)` 항목이 붙습니다(회귀선이 있으면 범례 기본 표시). `renderScatterChart`가 `trendlines` 적합 결과를 함께 반환합니다. WASM `set_chart_scatter_trendlines`, `chart_scatter_trend_fits`
- hover는 Rust의 균일 그리드 공간 해시로 가장 가까운 점(기본 반경 12 px, 버블은 자기 반지름 안)을 찾습니다. 점 id = 데이터 인덱스.

#### 히트맵 / 행렬 차트
```ts
sdk.renderHeatmap(
  { cols: 365, rows: 24, values, xLabels: days, yLabels: hours }, // values: 행 우선 Float32Array, NaN = 빈 셀
  {
    title: '시간대별 부하',
    colorScale: 'sequential', // 'sequential'(한 색상 밝음→어두움, 기본) | 'viridis' | 'magma' | 'diverging'
    // min / max: 기본은 데이터 범위, diverging은 center(기본 0 또는 중간값) 기준 대칭
    valueLabel: 'Load', colorbar: { title: 'ms' }, // 오른쪽 컬러바 (DOM, PNG 내보내기에 포함)
  }
);
sdk.setHeatmapColorScale('diverging'); // LUT(1 KB)만 재업로드
sdk.setHeatmapDomain({ min: -5, max: 5, center: 0 }); // uniform만 갱신
```
- 값은 R32Float 텍스처(장치 2D 한계를 넘는 그리드는 행 우선으로 감아 저장)에 한 번 올라가고, 프래그먼트 셰이더가 `textureLoad`(nearest, 샘플러 없음)로 셀 값을 읽어 min/max(또는 diverging center)로 정규화한 뒤 LUT 색을 고릅니다. 줌·팬은 uniform 창만 바꿉니다.
- 축: `xLabels` / `yLabels`는 카테고리 축(겹치지 않게 솎음), `xExtent` / `yExtent`(`[시작, 끝]`)는 숫자 눈금. `rowOrder: 'bottom-up'`이면 0행이 아래.
- 컬러맵은 OKLab 보간으로 Rust에서 만들고 테마 표면 밝기에 따라 sequential / diverging 끝점이 뒤집힙니다. hover는 셀 수학(O(1))이며 셀 테두리 강조, 툴팁: 행 · 열 · 값. 점 id = `row * cols + col`.

#### 박스 플롯 · 바이올린
```ts
sdk.renderBoxPlot(
  {
    categories: ['Mon', 'Tue', 'Wed'],
    series: [
      { name: 'Control', values: [monF32, tueF32, wedF32] }, // 카테고리마다 원시 샘플 Float32Array
      { name: 'Treated', values: [a, b, c] },
    ],
  },
  {
    title: '응답 시간', axes: { y: { title: 'ms' } },
    whiskers: 'tukey', // 'tukey'(1.5 IQR, 기본) | 'minmax' | [5, 95] (백분위)
    showOutliers: true, showMean: true, // outline: true 이면 테두리 박스
    // violin: true | { bandwidth, showBox: true, scale: 'area' | 'width', opacity: 0.3 }
  }
);
```
- 통계는 Rust에서 그룹당 O(n): `select_nth_unstable`로 사분위(numpy 선형 보간과 동일), 한 번 더 훑어 수염 끝·이상치 수·표준편차. 원시 샘플은 엔진에 남기지 않습니다.
- 이상치는 그룹당 최대 `maxOutliers`(기본 10,000)개만 결정적 등간격 샘플링으로 그리고(최솟값·최댓값 유지), 개수는 정확히 셉니다.
- 바이올린: 가우시안 KDE(기본 Silverman 대역폭)를 미세 격자에 선형 binning 후 128점에서 평가(O(n + grid), 100만 샘플도 O(n·grid) 아님), `band_triangles` 좌우 대칭 채움 + 외곽선, 내부 박스(수염선 · IQR 막대 · 중앙값 점).
- 박스는 중앙값에서 나뉜 두 막대(양 끝 4px 라운드, 중앙값은 2px 표면색 간격), 여러 시리즈는 그룹 막대처럼 나란히(2px 간격). 범례(2개 이상 시리즈) 토글 / 강조, 9개 이상 시리즈는 "Other"로 합침.
- hover: 박스 → 최소 · Q1 · 중앙값 · Q3 · 최대 · 평균 · 수염 · n · 이상치 수, 이상치 점 → 그 값. 점 id = `series * categories + category`, 이상치 id는 그 뒤. 브러시 · 줌은 지원하지 않습니다.
- 접근성: 요약, 카테고리 × 시리즈 행의 통계 데이터 테이블 / CSV, 키보드(좌우 = 카테고리, 상하 = 시리즈).

#### 콤보 차트 (막대 + 선 + 영역, `chart-combo.ts`, `lib_combo.rs`)
```ts
sdk.renderComboChart(
  {
    categories: ['Jan', 'Feb', 'Mar', 'Apr'],      // 또는 x: [...] (숫자 / epoch ms / Date[], 엄격히 증가)
    series: [
      { name: '온라인', type: 'bar', values: [12, 18, 22, 19] },
      { name: '매장', type: 'bar', values: [8, 9, 7, 11] },
      { name: '목표', type: 'area', values: [18, 22, 26, 28] },
      { name: '마진 %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27], marker: true, dash: [5, 3], curve: 'monotone' },
    ],
  },
  {
    barMode: 'stacked',                              // 'grouped'(기본) | 'stacked' | 'percent'
    axes: { x: { title: '월' }, y: { title: '매출', min: 0 }, y2: { title: '%', format: (v) => `${v}%` } },
    title: '채널별 매출과 마진', groupGap: 0.28, barGap: 2, fillOpacity: 0.2, // legend / hover / grid / padding / locale / timeZone
  }
);
sdk.getYDomain(); sdk.getY2Domain();                 // [min, max]
// React / Vue: <CharturboChart type="combo" data={...} options={{ barMode: 'grouped' }} />
```
- 한 플롯에서 x 매핑을 공유합니다: 카테고리 i는 데이터 x `i`(또는 `x[i]`)에 놓이고, x 도메인을 양쪽으로 반 칸씩 넓혀 **선의 점이 막대 칸 중앙에 정확히 정렬**됩니다. 숫자 / 시간 `x`면 막대 칸 폭 = 가장 작은 x 간격(막대끼리 겹치지 않음, 막대는 그 72%), x 눈금은 선 그래프와 같은 숫자 / 달력 눈금입니다.
- 엔진 구성: 막대 시리즈는 내부 `BarChart`(그룹 / 누적 / 100% 누적, 범례 토글 시 재누적), 선 · 영역 시리즈는 내부 `LineChart`(M4 데시메이션, 마커 · 대시 · 곡선 · 결측값 스타일, 줌 창)를 그대로 재사용합니다. 그리기 순서는 막대 → 영역 채움(반투명, 0까지) → 선 → 마커입니다.
- y 도메인은 고정(autoscale 없음): 축마다 그 축 시리즈 전체(숨긴 시리즈 포함, 누적 막대는 합계)의 범위를 nice 눈금으로 넓히고, 막대 축과 영역은 0을 항상 포함합니다. `axes.y` / `axes.y2`의 `min` / `max` / `nice`로 고정할 수 있습니다. 막대 시리즈는 모두 첫 막대 시리즈의 축을 공유하고, 그 결과 모든 시리즈가 오른쪽이면 왼쪽 축으로 옮깁니다. 선의 `nulls: 'zero'`로 채운 0도 도메인에 포함됩니다. 스케일 옵션(log · 반전)은 지원하지 않습니다.
- **이중 y축 주의**: 위 "이중 y축" 항목과 같습니다. 막대와 선을 다른 축에 두면 두 축의 범위 선택만으로 선이 막대를 "넘어서는" 지점이 생겨 관계를 오해하기 쉽습니다. 단위가 다를 때만 쓰고 축 제목과 시리즈 색으로 어느 축인지 분명히 표시하세요. 가능하면 같은 x를 공유하는 작은 다중 차트나 지수화한 단일 축을 먼저 고려하세요.
- hover(index 모드): 포인터가 있는 카테고리의 **모든 표시 시리즈**(막대 + 선 + 영역)를 툴팁 한 장에(`chartType: 'combo'`), 막대는 밝게 칠하고 선 · 영역 점에는 마커, 선 시리즈가 있으면 크로스헤어. 기본 항목은 포인터 아래(가장 가까운) 막대 조각 또는 선 점(막대 안의 선 점은 선이 우선)이고, `hover: { mode: 'nearest' }`나 `tooltip: { shared: false }`는 그 항목만 보입니다. `hoverAtX`(커서 동기화)는 가장 가까운 카테고리를 잡습니다.
- 범례: 막대 = 사각형, 선 = 선분, 영역 = 옅은 블록 + 윗선. 토글은 막대를 재누적 / 재그룹(도메인 고정)하고 hover를 다시 잡게 하며, 강조는 다른 종류까지 모두 흐리게 합니다.
- x 줌 / 팬(휠 · 드래그 · 터치 · `setXRange`)을 지원합니다(막대는 줌 창을 따라 넓어지고 플롯에 잘림). 브러시 · 네비게이터 · 막대 데이터 라벨 · 오차 막대 · 선 오차 범위(band)는 지원하지 않습니다. 영역은 누적되지 않습니다(각자 0까지).
- 접근성: 요약(종류별 시리즈, 이중 축 여부, 범위), 설명(축 제목 · 시리즈별 종류 / 축 / 최고 · 최저 · 평균), 데이터 테이블 / CSV(행 = 카테고리, 열 = 모든 시리즈), 키보드(좌우 = 카테고리, 상하 = 시리즈). 점 id = `series * categories + category`.
- 엔진 API: `set_combo_chart(values, series_count, kinds, axes, colors, widths, x, layout, y_axes)` (kinds 0 = 막대, 1 = 선, 2 = 영역; axes 0 = 왼쪽, 1 = 오른쪽; x 비면 카테고리; layout `[width, height, bar_mode, group_gap, gap_px, corner_radius_px, fill_opacity, x_kind(1 = 시간)]`; y_axes `[left_min, left_max, left_nice, right_min, right_max, right_nice]`, NaN = 기본), `chart_combo_y_domain(axis)`. 선 · 영역 스타일은 `set_line_series_styles`로 선 시리즈 순서(막대 제외)에 보냅니다.

#### 실제 x 값 · 시간 축
```ts
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] 또는 epoch ms (Float64Array / number[])
    { name: 'GPU', values: gpu, x: otherTimestamps }, // 시리즈마다 길이·간격이 달라도 됨
  ],
  { axes: { x: { type: 'time' } }, locale: 'ko-KR' } // Date[]면 'time'이 기본, 숫자면 'numeric'
);
```
- `x`는 모든 시리즈에 주거나 모두 생략합니다 (생략 시 기존처럼 인덱스 간격, `xLabelPrefix` 라벨). 유한하고 오름차순(같은 값 허용)이어야 하며 아니면 오류를 던집니다. 불규칙 간격도 됩니다.
- x 범위는 전 시리즈 공통입니다. M4 데시메이션은 x 기준 픽셀 열로 묶고, hover는 시리즈마다 이진 탐색으로 가장 가까운 x의 샘플을 고릅니다. epoch ms는 최소값 기준 f64 오프셋으로 저장해 ms 정밀도가 유지됩니다.
- `'time'` 눈금은 차트 시간대(아래 "시간대", 기본 `'local'`)의 달력 경계(1·2·5·10·15·30 초/분, 1·3·6·12 시간, 1·2 일, 1 주(월요일), 1·3·6 개월, 1·2·5·10… 년)에 놓이고, 기본 라벨은 같은 시간대로 눈금이 걸친 경계에 맞춰 `HH:mm` / `MMM d` / `MMM` / `yyyy` 형식을 고릅니다. `axes.x.format(value, granularity)`로 바꿀 수 있고(툴팁은 `granularity` 없이 호출), `formatChartTime(ms, granularity?, locale?, timeZone = 'UTC')`도 export됩니다.
- 엔진 API: `set_line_chart_xy(values, lengths, xs, colors, widths, width, height, view_mode, x_kind)` (`x_kind` 0 = numeric, 1 = time). `chart_axes()`는 기존 배열 뒤에 눈금별 granularity 코드(0 = 시간 아님, 1 = ms … 7 = 년)를 덧붙입니다.

#### 시간대 (`chart-timezone.ts`, `lib_timezone.rs`)
```ts
const sdk = await Charturbo.create(canvas, { timeZone: 'Asia/Seoul' }); // 'UTC' | 'local' | IANA 이름
sdk.setTimeZone('America/New_York');   // 활성 차트의 눈금 · 라벨을 즉시 다시 그림 (모르는 이름은 RangeError)
sdk.getTimeZone();                     // 'America/New_York'
sdk.renderLineChart(series, { axes: { x: { type: 'time' } }, timeZone: 'UTC' }); // 차트 옵션이 SDK 값보다 우선
sdk.renderCandlestickChart(ohlc, { timeZone: 'Europe/Berlin' });                  // 영역 차트도 동일
formatChartTime(ms, 'hour', 'ko-KR', 'Asia/Kolkata');                            // 직접 포맷 (기본 'UTC')
```
- **기본값은 `'local'`(보는 사람의 시간대)입니다.** epoch ms는 절대 시각이고 사용자는 자기 벽시계 기준으로 읽기를 기대합니다 (ECharts · Chart.js · Vega-Lite · d3 `scaleTime` · Grafana 브라우저 시간과 같은 선택; Highcharts만 UTC 기본). 이전 동작(UTC 고정)은 `create(canvas, { timeZone: 'UTC' })` 또는 `setTimeZone('UTC')` 한 줄로 돌아갑니다. 서버 렌더 · 스냅샷 테스트처럼 실행 환경과 무관한 출력이 필요하면 `'UTC'`나 IANA 이름을 명시하세요. 단독 함수 `formatChartTime`은 순수 함수라 인자가 없으면 기존처럼 `'UTC'`입니다.
- 같은 시간대를 모든 시간 텍스트가 씁니다: x 눈금 라벨, 툴팁 / `getNodeDetails`, 접근성 요약 · 키보드 안내, 데이터 테이블 · `exportChartCSV()`. 날짜만 표시(`MMM d, yyyy`)는 해당 시간대의 자정일 때입니다.
- 눈금은 현지 경계에 놓입니다: 자정 · 월초 · 연초, DST 날(23 시간 / 25 시간)의 시간 눈금(봄: 02:00 없음, 가을: 01:00 두 번), +05:30(Asia/Kolkata) · +05:45(Asia/Kathmandu) 같은 비정시 오프셋의 정시. 1일 이상 간격은 현지 날짜로 만들고 UTC로 되돌리며, 존재하지 않는 벽시계 시각은 JS `Date`처럼 점프 뒤로 갑니다.
- 구조: wasm에는 tz 데이터베이스가 없으므로 SDK가 `Intl.DateTimeFormat`으로 데이터 x 범위 ± 1년의 오프셋 전이 표를 만들고(주 단위 샘플 + 이진 탐색으로 초 단위 전이, 시간대·연도별 캐시) `set_chart_time_zone(transitions_ms, offsets_min)`으로 엔진에 넘깁니다. Rust(`chart/time_zone.rs`)는 이진 탐색으로 UTC↔현지를 변환해 현지 기준 눈금을 만든 뒤 UTC로 되돌립니다. granularity 코드는 그대로이며, 빈 표 = UTC로 기존 경로를 그대로 탑니다(추가 비용 없음).
- 표 갱신: 줌 · 팬은 데이터 범위 안에서만 움직이므로 표는 차트마다 한 번 보내고, `render()` 때 `chart_time_domain()`(시간 축의 전체 x 범위)이 덮인 연도를 벗어나면(스트리밍으로 범위가 늘어남) 다시 만들어 보냅니다. 새 차트는 엔진에서 UTC로 시작하므로 SDK가 첫 `render()`에서 다시 보냅니다.
- 대상: 라인 · 영역 · 캔들스틱의 `'time'` x 축. 히트맵 `x_extent`와 숫자 / 로그 / 인덱스 축은 시간 축이 아니라 영향이 없습니다.
- 한계: 1주 안에 두 번 바뀌어 원래 오프셋으로 돌아오는 전이는 놓칠 수 있습니다(현행 시간대에는 없음). 한 표는 최대 400년. 1900년 이전 LMT처럼 초 단위 오프셋은 분 단위 f32로 전달됩니다.

#### 영역 차트 (겹침 / 누적 / 100% 누적)
```ts
sdk.renderAreaChart(
  [
    { name: 'Search', values: search, x: days }, // x / 시간 축은 renderLineChart와 동일
    { name: 'Social', values: social, x: days },
  ],
  { mode: 'stacked', fillOpacity: 0.8, title: 'Traffic' } // 'overlap'(기본) | 'stacked' | 'percent'
);
```
- 2D 전용이며 선 그래프 옵션(축, 범례, 줌/팬, hover, `lineWidth` 등)을 그대로 받습니다. 채우기는 선과 같은 M4 데시메이션 샘플 위에서 Rust가 삼각형으로 분할합니다.
- `overlap`: 시리즈마다 0 기준선까지 채움 (기본 불투명도 0.2). `stacked`: 아래 시리즈 위에 누적 (기본 0.8, 위 가장자리에 선). `percent`: x마다 표시 시리즈 합을 100%로 정규화 (음수는 0 취급, y 축 라벨 `%`). 값 축은 항상 0을 포함합니다.
- 누적 모드는 모든 시리즈 길이가 같아야 하고, `x`를 주면 시리즈 간 `x`가 같아야 합니다 (아니면 오류). `NaN`은 자기 선·영역에 틈을 남기고 위 시리즈에는 0으로 누적됩니다.
- 범례 클릭 → 엔진이 재누적 (숨긴 동안 스트리밍된 값을 다시 표시하면 자동 값 축 확장), hover → 나머지 채우기·선 흐리게. 툴팁은 누적값이 아닌 원래 값을 보여주고 `stacked`는 합계(`ctx.total`), `percent`는 비율(`item.percent`)을 덧붙입니다. 마커는 누적된 위 가장자리에 놓입니다 (`ctx.areaMode`).
- 엔진 API: `set_area_chart(values, lengths, xs, colors, widths, width, height, mode, fill_opacity, x_kind)` (`mode` 0 = overlap, 1 = stacked, 2 = percent; `fill_opacity` NaN = 기본값).

영역 차트도 데이터를 재생성하지 않고 갱신할 수 있습니다:
```ts
// renderAreaChart의 시리즈 순서대로 모든 시리즈의 chunk를 한 번에 추가
const lengths = sdk.appendAreaData([
  { values: nextSearch, x: nextDays },
  { values: nextSocial, x: nextDays },
], { maxPoints: 4_000 });
sdk.render();
```
- `overlap`은 `setSeriesData` / `appendSeriesData`로 개별 갱신할 수도 있습니다. `stacked` / `percent`의 `setSeriesData`는 다른 시리즈와 같은 길이·x를 유지해야 하며, 추가는 `appendAreaData`를 사용합니다.
- batch에는 숨겨진 시리즈를 포함해 모든 시리즈가 있어야 합니다. 누적 모드는 chunk 길이·x도 같아야 합니다. 인덱스 축은 `x`를 생략하고, 명시적 축에는 각 값의 x(숫자 또는 `Date`)를 전달합니다. 전체 검증이 끝나야 갱신되므로 잘못된 batch는 기존 데이터를 바꾸지 않습니다.
- 반환값은 시리즈별 유지된 길이입니다. `maxPoints`는 0 또는 생략 시 무제한이며 0..4294967295 정수를 받습니다. FIFO 삭제 후 id는 다시 계산됩니다. 스타일·범례 가시성·줌은 유지하고 CSV·툴팁은 누적값이 아닌 최신 원시 값을 읽습니다.
- overlap은 선 차트의 FIFO 경로를 재사용합니다. **stacked / percent는 갱신마다 유지된 전체 샘플의 누적값을 O(유지된 샘플 수)로 다시 계산**합니다. 큰 스트림에서는 batch 크기와 `maxPoints`를 조절하세요.
- WASM: `append_area_data(values, lengths, xs, max_points)`는 시리즈 순서대로 평탄화한 버퍼를 받고 유지된 길이 배열을 반환합니다. 이전 WASM에 binding이 없으면 SDK는 오류를 냅니다.
- 실행 예제: `web/examples/src/demos/line/05-streaming-area.ts` 및 `web/examples/src/streaming-area.ts`. 랜딩은 정적 preview를 먼저 표시하고 화면에 들어올 때 SDK를 로드합니다. Play/Pause, reduced motion, 화면 밖·숨겨진 탭 정지를 지원합니다.

#### 선 스타일 · 결측값 · 오차 범위 (`chart-linestyle.ts`)
```ts
sdk.renderLineChart(
  [
    { name: 'Forecast', values: forecast, curve: 'monotone', dash: [6, 3],
      band: { lower: lo, upper: hi, opacity: 0.2 } },              // 신뢰 구간 / 최소~최대 범위
    { name: 'Actual', values: actual, marker: { shape: 'diamond', size: 8, show: 'auto' } },
    { name: 'Rate', values: rate, curve: 'stepAfter', nulls: 'connect' },
  ],
  { nulls: 'gap' } // 차트 기본값; 시리즈 `nulls`가 우선 (영역 차트도 동일)
);
```
- `marker`: `shape` `'circle'`(기본) | `'square'` | `'diamond'` | `'triangle'` | `'none'`, `size`(지름 CSS px, 기본 6), `fill` / `stroke`(ColorInput, 기본 시리즈 색 / 차트 표면색), `strokeWidth`(기본 1), `show` `'auto'`(기본: M4 데시메이션 후 보이는 점 간격이 8 CSS px 이상일 때만 — 확대하면 나타남) | `'always'` | `'never'`. `marker: true` = 기본값. 폐기 예정 `pointSize`는 `marker: { size }`로 매핑됩니다. hover 링은 그대로입니다.
- `dash`: CSS px 길이 `[on, off]` 또는 `[on, off, on, off]` (`[a]` = `[a, a]`, 3개면 앞 2개). 패턴 위상은 Rust가 폴리라인 누적 CSS px 길이로 계산해 선분 사이에서 끊기지 않습니다. 위상 기준점은 데이터 x 격자(줌 폭의 2배)에 고정돼 팬 중에는 점선이 그대로 있고, 기준점이 다음 격자로 넘어갈 때(화면 폭 약 2배 팬마다)만 한 번 어긋날 수 있습니다. 뷰 배율이 조금이라도 바뀌면 재빌드합니다.
- `curve`: `'linear'`(기본) | `'step'`(중간점에서 계단) | `'stepBefore'` | `'stepAfter'` | `'monotone'`(Fritsch–Carlson 단조 3차, 오버슛 없음). 곡선은 M4 데시메이션 *후* 적용하고, monotone은 화면 px 기준 약 4px 조각으로 적응 분할하며 픽이 평균 2px보다 촘촘하면 직선으로 둡니다. 영역 채우기도 같은 곡선을 따르고, 누적 영역의 아래 가장자리는 아래 시리즈의 곡선을 그대로 따라 틈·겹침이 없습니다.
- `nulls` (차트 / 시리즈): `NaN` · `null` · `undefined`는 결측값입니다. `'gap'`(기본: 선 / 영역 끊김), `'connect'`(이웃끼리 연결; 누적 영역은 x 기준 선형 보간 값으로 위 시리즈를 받치고 자기 마커는 생략), `'zero'`(0으로 그림, M4도 0으로 취급, 값 축이 0을 포함).
- `band` (선 차트 전용, 영역 차트는 무시): 시리즈 아래에 채우기로 그리는 범위 영역 (같은 색 × `opacity`, 기본 0.2). 픽셀 열마다 아래 경계 최솟값 / 위 경계 최댓값을 유지하는 LOD라 1M 포인트에서도 극값이 사라지지 않습니다. 범례 항목은 시리즈와 공유, 툴팁은 `값 lower – upper` (`item.band`), 데이터 테이블 / CSV는 `<이름> lower`, `<이름> upper` 열을 추가합니다. 값 축은 밴드를 포함합니다. `appendSeriesData`로 늘어난 샘플은 밴드 없음(툴팁에 범위 미표시), 스트리밍 후 데이터 테이블의 밴드 열은 비고, `setSeriesData`로 길이가 바뀌면 밴드는 해제됩니다.
- 구간 색칠(`pieces`, `piecesBy: 'y' | 'x'`, ECharts piecewise `visualMap`): `{ gt?, gte?, lt?, lte?, color }` 목록. 값(기본 y, `'x'`면 데이터 x · 시간 축은 epoch ms · x 없으면 샘플 인덱스)이 들어가는 첫 구간의 색을 쓰고, 어느 구간에도 없으면 시리즈 색입니다. `gte`가 `gt`보다, `lte`가 `lt`보다 우선(ECharts와 같음). 선은 그려진 경로(M4 · 곡선 적용 후)가 경계를 지나는 지점에서 선형 보간으로 잘려 색이 정확히 경계값에서 바뀌고(점선 패턴은 이어짐), 영역은 경계 사이 띠로 잘라(Sutherland–Hodgman) 채웁니다. 영역 + y 구간은 ECharts 그라데이션처럼 높이 기준 가로 띠이고, 누적 영역은 누적 높이로 판정합니다. 마커(명시 `fill` 제외) · hover 마커 · 툴팁 견본 · SVG가 구간 색을 씁니다. 줌 · 스트리밍 · 로그 / 반전 축 · 오른쪽 y축 지원. 범위 밴드 · 독립 Band / ErrorBar / Impulse · 콤보 · 범례 견본 · 데이터 표는 구간 색을 쓰지 않습니다. WASM `set_line_series_pieces(series, by, pieces)`(구간당 8개 값), `chart_line_piece_color(series, index)`
- 한계: 점선 시리즈와 마커는 실선 시리즈 위 레이어에 그려져 강조(emphasis) 순서와 무관하게 위에 옵니다. 2.5D 뷰에서는 점선 위상 · monotone 분할이 근사입니다. 사각형 · 마름모 · 삼각형 마커의 외곽선은 원보다 약간 얇습니다.
- 엔진 API (`lib_linestyle.rs`): `set_line_series_styles(styles)` (시리즈당 18 floats: 마커 모양 / 크기 / fill rgba / stroke rgba / 선 굵기 / show, dash ×4, curve, nulls; NaN = 기본), `set_line_series_band(series, lower, upper, opacity)`, `clear_line_series_band(series)`, `chart_line_band_at(series, index)`. 점선은 전용 dash 셰이더(`ChartDashSegmentRaw`), 마커는 기존 마커 파이프라인(`params.y` = 모양 코드)으로 그립니다.

#### 범위 선택기 (네비게이터 / 미니맵)
```ts
sdk.renderLineChart(series, { navigator: true });            // 또는 { navigator: { height: 64 } } (CSS px, 기본 48)
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
sdk.enableNodeInteractions(canvas);
sdk.on('rangechange', ({ xMin, xMax }) => {/* 창 드래그 / 핸들 / 휠도 같은 이벤트 */});
sdk.getNavigatorRect(); // [left, top, width, height] CSS px
```
- 2D 선 / 영역 차트 전용. 플롯 아래(사용자 bottom 패딩 = x축 라벨 아래)에 띠를 두고 카메라 프레이밍이 그 높이만큼 플롯을 올립니다. 띠는 전체 x 범위의 보이는 시리즈를 띠 픽셀 폭 기준 M4로 데시메이션해 얇은 선(+ 첫 시리즈 채우기)으로 그리므로 1M+ 포인트에서도 수천 개 선분 수준입니다.
- 띠는 데이터·가시성·뷰가 바뀔 때만 다시 만들고 (스트리밍 중 데이터 변경은 최대 6프레임에 한 번, 전체 O(N) 스캔), 줌 창(반투명 창 + 바깥 어둡게 + 핸들)은 줌이 바뀔 때만 몇 개의 사각형으로 다시 만듭니다. 시리즈 scissor에 잘리지 않습니다.
- 조작: 창 안 드래그 = 이동, 가장자리(±8px) = 크기 조절(`ew-resize`, 최소 줌 폭·범위로 고정), 창 밖 클릭 = 그 지점으로 창 중심 이동 후 드래그 계속, 띠 위 휠 = 포인터 기준 줌. 마우스·터치·펜 모두 띠 위에서 누르면 팬/제스처 대신 창을 조작합니다.
- 엔진 API: `set_chart_navigator(enabled, height_px, style[20])` (배경·마스크·창·외곽선·핸들 rgba, NaN = 기본), `chart_navigator_hit(ndc_x, ndc_y)` (0 없음, 1 창, 2 왼쪽 핸들, 3 오른쪽 핸들, 4 창 밖), `chart_navigator_drag(code, delta_ndc_x)`, `chart_navigator_center(ndc_x)`, `chart_navigator_zoom(factor, ndc_x)`, `chart_navigator_rect()`.

#### Y축 범위 · 실시간 스트리밍
```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' });                 // 현재 옵션에 병합
sdk.setSeriesData(0, values, x);                      // 시리즈 하나 교체 (스타일·줌 유지)
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 100_000 }); // 끝에 추가, 오래된 샘플 삭제
```
- `autoscale`: `'all'`(기본, 전체 데이터 범위) · `'visible'`(줌 창 안의 보이는 시리즈 범위; 범위가 도메인을 벗어나거나 도메인의 60% 미만으로 줄 때만 갱신해 떨림 없음) · `'none'`(한 번 정한 뒤 데이터가 바뀌어도 유지). `min` / `max`는 해당 끝을 고정하고, `nice`는 데이터에서 정한 끝만 눈금 단위로 넓힙니다.
- 줌 창이 오른쪽 끝(`w1 ≥ 0.999`)에 닿아 있으면 데이터가 늘어날 때 같은 x 폭으로 최신 데이터를 따라가고, 아니면 절대 x 창을 유지합니다. 줌하지 않은 차트는 계속 전체를 보여 줍니다.
- 추가할 `x`는 시리즈 마지막 x 이상이어야 합니다. `maxPoints` 정리는 엔진에서 앞쪽 포인터만 옮기고 가끔 압축하므로 분할 상환 O(추가분)이고, 다음 프레임에 보이는 구간만 다시 데시메이션합니다.
- **데이터 포인트 id는 매 갱신마다 재기준화됩니다**: id = 현재 길이의 누적 오프셋 + 남아 있는 가장 오래된 샘플부터의 인덱스. 툴팁·상세는 스트리밍된 값을 엔진(`chart_sample`, 7번째 값 = 데이터 x)에서 읽고, 접근성 요약·데이터 테이블은 필요할 때 `chart_series_values` / `chart_series_x`로 다시 읽습니다(최대 초당 4회 갱신).
- 엔진 API: `set_chart_series_data(series, values, xs)`, `append_chart_series_data(series, values, xs, max_points)` (새 길이 반환, `xs` 비움 = x 없음), `set_chart_y_domain(min, max, autoscale, nice)` (NaN = 데이터 기준, autoscale 0 = all, 1 = visible, 2 = none), `chart_y_domain()`.

#### 축 스케일 (로그 · 반전 · 눈금 수) · 이중 y축 (옵트인)
```ts
sdk.renderLineChart(series, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 4 } } }); // series에 양수 숫자 x 필요
sdk.renderScatterChart(data, { axes: { x: { scale: 'log' }, y: { scale: 'log' } } });
sdk.setAxisScale('y', { scale: 'log' });              // 'x' | 'y' | 'y2', 현재 옵션에 병합
sdk.getAxisScale('y');                                // { scale, reverse, tickCount } | null

// 이중 y축: 시리즈 하나라도 yAxis: 'right'를 줄 때만 켜집니다 (기본은 단일 축)
sdk.renderLineChart(
  [
    { name: '기온', values: temp },
    { name: '강수량', values: rain, yAxis: 'right' },
  ],
  { axes: { y: { title: '°C' }, y2: { title: 'mm', scale: 'log', min: 1, format: (v) => `${v} mm` } } }
);
sdk.setY2Domain({ autoscale: 'visible' });            // setYDomain과 같은 옵션, 오른쪽 축
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: '호우 기준' }]);
```
- `scale: 'log'`(log10, 10의 거듭제곱 눈금, 범위가 좁으면 1 / 2 / 5 보조 눈금): 0 이하 값은 그리지 않습니다(선은 틈, 산점도는 점 생략). 선 그래프 x 로그는 모든 x가 양수인 숫자 `x`일 때만 적용되고, 인덱스 / 시간 x나 0 이하 x가 있으면 선형으로 남습니다(반전과 `tickCount`는 적용). `reverse`는 y를 아래로, x를 왼쪽으로 증가시킵니다. `tickCount`는 목표 눈금 수입니다(기본: y는 그리드 행 수, x는 약 90 px당 1개).
- 엔진이 도메인을 스케일 공간(값 또는 log10)에 두고 선형으로 매핑하므로 줌 창, M4 데시메이션, hover 히트 테스트, 주석, 범위 API가 모든 스케일에서 그대로 동작합니다. 스케일이 바뀌면 해당 축 줌이 초기화됩니다.
- 이중 y축은 2D 선 그래프 전용입니다(영역 차트·2.5D는 오른쪽 축 라벨 없음). 오른쪽 축은 자체 도메인 / autoscale / 스케일 / 눈금을 갖고, 그리드선은 왼쪽 축을 따릅니다. 오른쪽 여백(라벨 56 px + 제목 20 px)과 제목은 SDK가 자동으로 잡습니다. 주석은 `yAxis: 'right'`로 오른쪽 축 값을 씁니다(오른쪽 축 시리즈가 없으면 왼쪽 축 기준).
- **이중 y축은 신중히 쓰세요**: 두 축의 범위를 어떻게 잡느냐에 따라 교차점·기울기가 임의로 만들어져 상관관계를 오해하기 쉽습니다. 단위가 다른 두 측정값은 대개 다음이 더 명확합니다.
  - 같은 x를 공유하는 **작은 다중 차트**(위아래로 쌓은 두 선 그래프, 줌/팬 범위는 `rangechange` 이벤트로 동기화)
  - 공통 기준으로 **지수화**(예: 첫 값 = 100, 또는 % 변화량)한 단일 축 차트
  - 관계 자체가 궁금하면 두 값을 x / y로 둔 **산점도**
  두 시리즈를 같은 척도로 비교할 수 없고 x 정렬이 핵심일 때만 이중 축을 쓰고, 축 제목과 시리즈 색으로 어느 축인지 분명히 표시하세요.
- 엔진 API: `set_chart_axis_scale(axis, kind, reverse, tick_count)` (axis 0 = x, 1 = 왼쪽 y, 2 = 오른쪽 y; kind 0 = linear, 1 = log; tick_count 0 = 기본), `chart_axis_scale(axis)` → `[kind, reverse, tick_count]`, `set_chart_series_axes(axes)` (시리즈마다 0 = 왼쪽, 1 = 오른쪽), `set_chart_y2_domain(min, max, autoscale, nice)`, `chart_y2_domain()`, `set_chart_annotation_y_axes(axes)` (`set_chart_annotations` 뒤에 호출). `chart_axes()`의 눈금 axis 2 = 오른쪽 y.

#### 테마 · 수명 주기
```ts
sdk.setTheme('light'); // 'dark' | 'light' | 사용자 CharturboTheme 객체 (배경, 팔레트, 그리드, 글자, 툴팁 색)
sdk.dispose();         // 이벤트 해제, 오버레이 DOM 제거, WASM 메모리 해제
```
기본 팔레트는 각 테마 배경에 대해 색각 이상 구분 검증을 통과한 8색 순서입니다 (`CHARTURBO_THEMES`).

커스텀 테마는 기존 테마를 펼친 뒤 필요한 토큰을 덮어씁니다. GPU 색 토큰에도 CSS 색 문자열을 사용할 수 있습니다.

```ts
sdk.setTheme('light');
sdk.setTheme({
  ...sdk.getTheme(),
  name: 'brand',
  surface: '#faf6ed',
  palette: ['#3182f6', '#14b8a6', '#f59e0b'],
  textPrimary: '#14213d',
  fontFamily: 'system-ui, sans-serif',
});
sdk.renderBarChart([
  { label: 'A', value: 32, color: '#3182f6' },
  { label: 'B', value: 18, color: '#14b8a6' },
], { orientation: 'horizontal', cornerRadius: 8, labels: true });
sdk.render();
```

`setTheme`은 배경·텍스트·격자·툴팁과 차트별 테마 스타일을 갱신합니다. 선·막대 등에서 이미 전달한 시리즈/항목 색이나 스타일도 바꾸려면 새 옵션으로 `render*Chart()`를 호출하고 `render()`합니다. [벤치마크 페이지](https://jparkk0517.github.io/Charturbo/benchmarks.html)는 이 방식으로 4개 테마·강조색·팔레트·글꼴·모서리·라벨 설정과 SVG 내보내기를 제공합니다. 미드나이트·페이퍼는 예제의 커스텀 테마이며 SDK의 내장 문자열 테마는 `'light'`와 `'dark'`입니다.

#### 초기화 · 이벤트 · 범위 · 색 · 로캘
```ts
if (!(await Charturbo.isSupported())) showFallback();   // WebGPU 어댑터 또는 WebGL2 폴백
try {
  sdk = await Charturbo.create(canvas, { autoResize: true, locale: 'ko-KR' });
} catch (e) {
  if (e instanceof CharturboInitError) console.warn(e.reason);  // 'no-webgpu' | 'adapter' | 'device' | 'wasm'
}
const off = sdk.on('rangechange', ({ xMin, xMax, yMin, yMax }) => syncOtherChart(xMin, xMax));
sdk.on('hover', ({ chart, node }) => {});   // 차트: ChartTooltipContext, 그래프: NodeDetails (떠나면 null)
sdk.on('click', ({ chart, node, event }) => {});
sdk.on('legendtoggle', ({ series, visible }) => {});
sdk.on('themechange', (theme) => {});
sdk.on('resize', ({ width, height }) => {});
sdk.on('select', (sel) => {});              // 브러시 선택 확정 / 해제 (아래 "브러시 · 박스 선택")
off();                                      // 또는 sdk.off(event, handler)

sdk.setXRange(Date.parse('2026-01-01'), Date.parse('2026-02-01')); // 데이터 단위 (라인: x 값 또는 인덱스)
sdk.getXRange();                            // [min, max] | null; 산점도는 getYRange / setYRange도
sdk.render();

sdk.renderLineChart([{ name: 'cpu', values, color: '#3b82f6' }]);  // RgbaTuple 또는 CSS 색 문자열
sdk.setLocale('de-DE');                     // 기본 눈금 · 툴팁 숫자 · 시간 라벨 (라인 `locale` 옵션이 우선)
```
- `'hover'` / `'click'`은 `enableNodeInteractions` 바인딩이 필요하며 기존 `onNodeHover` / `onNodeClick` 콜백과 함께 동작합니다. `'rangechange'`는 줌 · 팬 · 리셋 · `setXRange` 후 프레임당 최대 1회, 범위가 실제로 바뀐 경우에만 발생합니다.
- `autoResize`(기본 true): `ResizeObserver`(`device-pixel-content-box` 우선, 없으면 CSS 크기 x DPR) + `matchMedia` DPR 변경으로 `canvas.width/height`를 맞추고 `resize()` + `render()`를 호출합니다. 호스트가 캔버스 크기를 직접 관리하면 `false`로 끄세요 (벤치마크 어댑터는 끕니다). `dispose()`가 해제합니다.
- 색 입력(`ColorInput`): `'#rgb'`, `'#rrggbbaa'`, `rgb()/rgba()`, `hsl()/hsla()`는 DOM 없이 파싱하고, 이름 색 등 나머지 CSS 색은 `document`가 있을 때 2D 캔버스로 해석합니다 (`parseColor` export). 잘못된 문자열은 `TypeError`.
- 엔진 API: `chart_range()` → `[x_min, x_max, y_min, y_max]` (라인 y는 NaN), `chart_set_x_range(lo, hi)`, `chart_set_y_range(lo, hi)` (줌 한계 · 데이터 범위로 클램프, 바뀌면 true).

#### 대시보드 차트 동기화 (`chart-sync.ts`: 크로스헤어 · 줌/팬)
```ts
const disconnect = Charturbo.connect([cpu, mem, net], { cursor: true, x: true }); // 기본 둘 다 true
// 또는 인스턴스별 그룹 키 (ECharts group / Highcharts 방식)
await Charturbo.create(canvas, { sync: { key: 'dash', tooltip: true } });  // 또는 sdk.setSync({ key })
Charturbo.connect('dash', { x: false });  // 그룹 공통 옵션 (멤버 자체 옵션이 우선); 반환 함수 = 그룹 해산
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z')); sdk.getHoverX();             // 수동 커서 (null = 해제)
```
- 커서: 한 차트에서 hover한 데이터 x(라인 `x`/epoch ms 또는 인덱스, 막대 카테고리 인덱스, 산점도 x)에서 나머지 차트가 엔진 `chart_hover_at_data_x(x)`로 index 모드 hit-test → 크로스헤어 + 시리즈별 최근접 마커 (막대: `round(x)` 카테고리 강조, 산점도: 시리즈별 x 최근접 점, 크로스헤어 없음). 범위 밖이면 해제, 떠나면 모두 해제. 팔로워 툴팁은 기본 꺼짐 (`tooltip: true`). hover하는 차트에 `enableNodeInteractions`가 필요합니다.
- 줌/팬: `'rangechange'` → 나머지 `setXRange` (데이터 단위, 각 엔진이 자기 도메인으로 클램프). 동기화로 생긴 echo는 무시해 피드백 루프가 없고, 그룹당 rAF 1회로 모아 적용 후 바뀐 차트만 `render()`합니다. y는 동기화하지 않습니다. `dispose()`는 그룹에서 빠집니다.

#### 대량 라벨용 일괄 API
`sdk.projectNodesToScreen(ids, w, h)`는 노드 수천 개의 화면 좌표를 WASM 호출 한 번으로 돌려줍니다.

#### 차트 hover / 그리드 커스터마이징
색상은 모두 `RgbaTuple`(`[r, g, b, a]`, 0~1) 또는 CSS 색 문자열입니다.

| 옵션 (`hover`) | 기본값 | 설명 |
|---|---|---|
| `mode` | `'index'` | `'index'`: 같은 x의 모든 시리즈 표시 / `'nearest'`: 가장 가까운 점 하나 (2.5D 뷰는 항상 `'nearest'`) |
| `crosshair`, `crosshairColor`, `crosshairWidth` | `true`, `[0.58, 0.64, 0.72, 0.55]`, `1` | 2D 선 그래프의 세로 가이드선 (px) |
| `marker`, `markerRadius`, `markerRingColor`, `markerRingWidth` | `true`, `4`, 차트 배경색, `2` | hover 지점 마커 (시리즈 색 + 배경색 링, px) |
| `hitRadius` | `24` | `'nearest'` 모드 판정 반경 (px) |
| `barHighlightColor` | 막대 색 22% 밝게 | hover된 막대 색 |

| 옵션 (`grid`) | 기본값 | 설명 |
|---|---|---|
| `rows` | `5` | 가로 그리드 간격 수 |
| `color`, `baselineColor` | 어두운 회색, 밝은 회색 | 그리드 / 기준선 색 |
| `strokeWidth` | `1` | 선 두께 (px) |

막대 차트: `cornerRadius`(데이터 끝 모서리 px, 기본 4), `color`(기본 막대 색), 음수 값은 0 기준선 아래로 그려집니다. 단일 시리즈 `renderBarChart`의 `legend: true`는 항목 `category`별 색 키(카테고리마다 첫 막대 색, 2D 전용)를 표시합니다. 숨길 시리즈가 없으므로 토글 · 강조는 없고 기본은 숨김입니다 (`category`가 없는 항목은 키에 나오지 않음).

#### 주석 (기준선 · 구간 · 마커 · 텍스트)
```ts
sdk.renderLineChart(series, options);
sdk.setAnnotations([
  { type: 'hline', y: 250, label: 'SLO 250', dash: true, color: [0.94, 0.35, 0.33, 1], z: 'above' },
  { type: 'xband', from: 6800, to: 7000, label: '장애 구간', opacity: 0.16 },
  { type: 'point', x: 6900, y: 312, width: 6 },          // 마커 반지름 px
  { type: 'text', x: 100, y: 40, text: '배포 v2.3' },
]);
sdk.addAnnotation({ type: 'vline', x: new Date('2026-02-01'), labelPosition: 'start' });
sdk.clearAnnotations();
```
- 종류: `hline {y}`, `vline {x}`, `yband {from,to}`, `xband {from,to}`(±`Infinity` = 플롯 끝까지), `point {x,y}`, `text {x,y,text}`. 좌표는 **데이터 단위**입니다: 선 그래프 x = 샘플 인덱스(또는 `x` 값 / `Date`), 막대 x = 카테고리 인덱스(소수 허용), 산점도 x/y.
- 스타일: `color`, `width`(선 px · 구간 테두리, 점은 반지름), `dash`(px 또는 `true` = 6 px), `opacity`(구간 기본 0.18), `label` + `labelPosition`(`'start' | 'end' | 'center'`), `z`(`'below'` = 그리드와 함께 시리즈 아래, `'above'` = 시리즈 위 · hover 오버레이 아래).
- Rust가 데이터→월드 변환(줌 창 반영), 플롯 밖 클리핑/숨김, GPU 마크(밴드 삼각형 · 선 세그먼트 · 마커)를 만들고, 라벨은 오버레이 DOM 알약으로 엔진이 준 앵커에 놓입니다(리비전이 바뀔 때만 재배치). 2D 뷰 전용이며, 새 차트를 렌더하면 초기화됩니다.
- 엔진 API: `set_chart_annotations(kinds, coords, colors, widths, dash, opacity, layers, label_positions)`, `clear_chart_annotations()`, `chart_annotation_labels()` → `[count, (id, x, y, visible) * count]`, `chart_annotation_labels_revision()`.

#### 브러시 · 박스 선택 (`chart-brush.ts`)
```ts
sdk.enableNodeInteractions(canvas, {
  brush: 'x',                                   // 'x' = x 구간(시간 범위), 'xy' = 사각형, false = 끔(기본)
  brushStyle: { color: '#3b82f6', fillOpacity: 0.15, borderWidth: 1 },
});
sdk.on('select', (sel) => {
  if (!sel.xRange) return clearDetail();        // 해제됨 (Escape · 클릭 · clearSelection)
  if (sel.kind === 'line') sel.ranges.forEach(({ series, start, end }) => {}); // 시리즈별 [start, end) 샘플 구간
  else console.log(sel.ids, sel.count);         // 산점도: 점 id, 막대: 카테고리 인덱스, 캔들: 캔들 인덱스
});
sdk.setChartBrush('xy');                        // 런타임 전환 (getChartBrush()로 조회)
sdk.selectChartRange([new Date('2026-02-01'), new Date('2026-03-01')]);  // 코드로 선택 ('select' 발생)
sdk.selectChartRange([1, 2], [-3, 4]);          // y 범위까지 지정
sdk.getSelection();                             // 현재 확정된 선택 또는 null
sdk.clearChartSelection();                      // 선택이 있었을 때만 빈 'select' 발생
```
- 마우스 조작: 드래그 = 브러시(5 px 이내 이동은 클릭으로 처리), 릴리스 = 확정 + `'select'`, **Alt + 드래그** = 팬, 휠 줌 · 더블클릭 리셋은 그대로. 클릭 · `Escape`(캔버스 포커스) · `sdk.clearSelection()`이 선택을 해제합니다.
- `CharturboSelection`: `kind`(`'line' | 'bar' | 'scatter' | 'candlestick' | 'heatmap' | 'box' | 'pie'`, 영역 차트는 `'line'`; 히트맵 · 박스 플롯 · 파이는 브러시가 없어 항상 빈 선택), `mode`, `xRange` / `yRange`(데이터 단위: 샘플 인덱스 · `x` 값 · 카테고리 인덱스, `'x'` 모드는 `yRange = null`), `ranges`(선/영역), `ids`(`Uint32Array`, 오름차순 · 보이는 시리즈만), `count`. 막대는 항상 x 구간으로 선택합니다.
- Rust가 드래그 사각형을 데이터 단위로 변환해 그리고, 선택 질의(선 샘플 구간, 산점도는 공간 해시, 막대 카테고리)와 산점도 점 강조를 수행합니다. 데이터 · 범례가 바뀌면 `getSelection()`은 다시 질의된 결과를 돌려줍니다. 2D 차트 전용(`handlesChartBrush()`: 3D 막대 · 2.5D 선 · 히트맵에서는 false라 드래그가 그대로 팬/회전). 이중 y축의 `'xy'` 브러시는 오른쪽 축 시리즈를 같은 화면 구간의 오른쪽 축 값으로 비교하고, 로그 축에서도 범위는 데이터 단위입니다. 차트를 바꾸면 남아 있던 선택에 대해 빈 `'select'`가 발생합니다.
- 엔진 API: `chart_brush(mode, ax, ay, bx, by)`(NDC, mode 0 = x · 1 = xy), `chart_brush_end()`, `chart_select_range(x0, x1, y0, y1)`(y NaN = 전체), `chart_selection()` → `[kind, mode, x0, x1, y0, y1, count, n, (series, start, end) * n]`(비면 선택 없음), `chart_selection_ids()`, `chart_clear_selection()`, `set_chart_brush_style(params)`.

#### 다중 시리즈 막대 (그룹 / 누적 / 100% 누적)
```ts
sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'North', values: [10, 20, 30, 40] },
      { name: 'South', values: [5, -5, 15, NaN] }, // NaN = 값 없음
    ],
  },
  { mode: 'stacked', barGap: 2, title: 'Revenue' } // 'grouped'(기본) | 'stacked' | 'percent'
);
```
- `grouped`: 카테고리 슬롯 안에 시리즈를 나란히 배치 (`groupGap`: 그룹 사이 빈 비율, 기본 0.28 / `barGap`: 막대 사이 px, 기본 2)
- `stacked`: 양수는 위로, 음수는 아래로 따로 누적. 값 축은 누적 합 기준, 바깥쪽 세그먼트 끝만 둥글게, 세그먼트 사이 `barGap` px 간격
- `percent`: 카테고리마다 절댓값 합을 100%로 정규화 (y 축 라벨 `%`)
- 범례(시리즈 2개 이상 기본 표시): 클릭 → 시리즈 숨김 + 엔진에서 재배치/재누적 (값 축 고정), hover → 나머지 시리즈 흐리게. `sdk.setSeriesVisible(i, false)` / `sdk.emphasizeSeries(i)`도 동일
- hover: grouped는 포인터 아래 막대 하나, stacked/percent는 카테고리 전체 시리즈 (툴팁에 합계 `ctx.total` / 비율 `item.percent`), 포인터 아래 세그먼트가 primary + 하이라이트
- 데이터 포인트 id = `seriesIndex * categories.length + categoryIndex`. 3D(`viewMode: '3d'`)는 첫 시리즈만 표시

#### 가로 막대 · 데이터 라벨 · 오차 막대 (`chart-bar-style.ts`, 2D 전용)
```ts
sdk.renderGroupedBarChart(
  {
    categories: ['North America', 'Europe', 'Asia'],
    series: [
      { name: '2024', values: [31, 45, 28], error: [3, [2, 6], null] }, // ±e 또는 [minus, plus]
      { name: '2025', values: [36, 41, 33] },
    ],
  },
  {
    orientation: 'horizontal', // 'vertical'(기본) | 'horizontal'
    labels: { show: 'auto', position: 'inside', format: { maximumFractionDigits: 1 } },
    errorBars: { width: 1.25, cap: 0.4 }, // 색 기본: 테마 보조 텍스트 색
  }
);
sdk.renderBarChart([{ label: 'Mon', value: 42, error: 4 }], { labels: true, legend: true, seriesName: 'Visits' });
```
- `orientation: 'horizontal'`: 카테고리는 왼쪽 y 축(첫 카테고리가 맨 위, 플롯 높이에 맞춰 ~18 px당 하나로 솎음), 값은 x 축(nice 눈금, 세로 그리드), 둥근 끝은 오른쪽(음수는 왼쪽). 단일 / grouped / stacked / percent 모두 지원. 이때 `axes.x`는 값 축, `axes.y`는 카테고리 축. 왼쪽 여백은 카테고리 라벨 길이에 맞춰 자동 조정. 3D 막대와 히스토그램은 항상 세로. 가로 막대에서는 브러시 비활성(주석은 x = 값, y = 카테고리 인덱스)
- `labels`: `true` | `'auto'` | `{ show, position, format, color }`. `position`: `'outside'`(기본, 데이터 끝 바깥 · 오차 막대 너머) / `'inside'` / `'insideBase'` / `'center'`. `format`: `(value, ctx) => string`, 형식 스펙 문자열(`'.1f'`, `'$,.0f'`) 또는 `Intl.NumberFormatOptions` (기본: 값 축 `format`, percent 모드는 비율 `42.5%`)
  - 라벨 위치 · 들어맞음 · 충돌 판정은 엔진(Rust)이 CSS px로 계산하고(텍스트 크기는 SDK가 측정해 전달), SDK는 앵커에 DOM 텍스트만 배치 → PNG 내보내기에도 포함
  - `'auto'`: 안에 안 들어가는 inside 라벨은 바깥으로, 캔버스를 벗어나거나 다른 라벨 · 다른 막대와 겹치는 라벨은 숨김. 누적 세그먼트 라벨은 항상 안쪽(가운데)이며 들어갈 때만 표시
  - 색: 바깥 라벨은 테마 텍스트 토큰, 안쪽 라벨은 막대 휘도에 따라 밝은 / 어두운 글자 자동 선택 (`color`로 고정 가능). 범례 토글 시 텍스트(percent 비율 포함) 재계산
- 오차 막대: 항목 `error` / 시리즈 `error[]`, 값 단위 `±e` 또는 `[minus, plus]`. 엔진이 캡 달린 선분으로 그리고 값 도메인에 포함(누적은 세그먼트 누적 끝 기준, percent 모드는 무시). 툴팁에 `±e` / `+p / −m` 표시 (`ChartTooltipItem.error`). 산점도 오차 막대는 미지원
- 단일 시리즈 `renderBarChart`도 `legend` 옵션을 받음: 기본 숨김, `legend: true`면 `seriesName`(기본 `'Value'`) 항목 하나를 정적으로 표시(토글 / 강조 없음)
- 배경 트랙(`background: true | { color?, opacity? }`, ECharts `showBackground`): 막대마다 값 축 전체 길이의 트랙을 같은 폭 · 모서리로 막대 뒤에 그립니다. 기본 색은 테마 `baseline` 토큰에 알파 × 0.2(ECharts 기본 `rgba(180,180,180,0.2)`의 0.2), `opacity`는 알파 배수. grouped는 보이는 막대 칸마다(결측값 칸 포함, ECharts와 같음), stacked / percent는 카테고리마다 하나. 숨긴 시리즈는 트랙도 사라지고, 등장 애니메이션 동안 트랙은 전체 길이를 유지합니다. hover 대상이 아니며 3D · 히스토그램 · 폭포 · 콤보는 미지원. WASM `set_chart_bar_background(rgba)`
- 라벨 회전: 막대 값 라벨 `labels.rotate`(도, 양수 = 반시계, -90~90, ECharts `label.rotate`)는 회전된 외곽 상자로 위치 · 안쪽 들어맞음 · 충돌을 판정합니다(모든 `position`, 가로 막대 포함). x축 눈금 라벨 `axes.x.labelRotate`(같은 규칙, x축만)는 ECharts처럼 양수면 글자 끝, 음수면 시작이 눈금에 붙고, 솎기는 회전된 띠 간격(분리축 판정)으로 하며 아래 여백은 회전된 높이만큼 자동으로 늘어납니다(직접 준 `padding.bottom`은 유지). 회전하면 12자 카테고리 줄임을 하지 않습니다. 카테고리 축이 아닌 축은 첫 배치 후 여백이 한 번 늘어날 수 있습니다. y축 회전 · 폭포 값 라벨 회전 · 양 끝 라벨의 좌우 넘침 여백은 미지원. WASM `set_bar_label_boxes`, `set_bar_axis_label_rotation`

```ts
// 렌더 후 스타일만 변경
sdk.setChartHoverStyle({ mode: 'nearest', markerRadius: 6 });
sdk.setChartGrid(true, { rows: 4, strokeWidth: 1 });

// 그래프/포인트 클라우드 노드 hover 표시 (기본: 같은 색을 밝게 + 1.6배)
sdk.setNodeHoverStyle({ scale: 1.4, color: [1, 1, 1, 1] });

sdk.enableNodeInteractions(canvas, {
  // 툴팁 HTML 직접 작성
  formatChartTooltip: (ctx) =>
    `<b>${ctx.xLabel}</b>` + ctx.items.map((it) => `<div style="color:${it.color}">${it.seriesName}: ${it.value}</div>`).join(''),
  tooltipClassName: 'my-tooltip', // 기본 클래스: charturbo-sdk-node-tooltip
  tooltipStyle: { background: '#fff', color: '#111' },
  onNodeClick: (details) => console.log(details?.metadata.attributes),
});
```

#### 숫자 형식 (`chart-format.ts`)
축 `format`(`axes.x` / `y` / `y2`), 막대 라벨 `labels.format`, 툴팁 `valueFormatter`는 함수 외에 **d3-format 스타일 문자열** 또는 `Intl.NumberFormatOptions` 객체를 받습니다. 문자열은 차트 로캘(`locale` 옵션 → `setLocale` → 런타임)로 `Intl.NumberFormat`을 한 번 만들어 캐시하고, `setLocale` 시 눈금이 새 로캘로 다시 그려집니다.
```ts
import { createFormatter, formatNumber } from 'charturbo';

sdk.renderLineChart(series, {
  axes: { y: { format: '.2s' }, y2: { format: { style: 'percent' } }, x: { format: ',d' } },
});
formatNumber(1234.5, '$,.2f');                          // "$1,234.50"
formatNumber(1234.5, '$,.2f', 'de-DE', { currency: 'EUR' }); // "1.234,50 €"
const fmt = createFormatter('bytes', { locale: 'ko-KR' }); // (v) => string, 재사용
fmt(1536);                                              // "1.5 KB"
```
| 스펙 | 예 (en-US) | 설명 |
|---|---|---|
| `'.2f'`, `',.0f'` | `1234.57`, `1,234,568` | 고정 소수점, `,` = 천 단위 구분 |
| `'d'`, `',d'` | `4`, `12,345` | 정수 (반올림) |
| `'.1%'` | `12.3%` | ×100 퍼센트 |
| `'.2s'` | `1.5k`, `1.2M`, `1.2m` | SI 접두어 (유효 숫자, 반올림 시 다음 접두어로 올림) |
| `'.2e'` | `1.23e+4` | 지수 |
| `'$,.2f'` | `$1,234.50` | 통화 (`Intl` `style: 'currency'`, 코드 = `currency` 옵션, 기본 `USD`; 타입 없음 · `f` · `d` · `compact`와만) |
| `'compact'`, `'.1compact'` | `1.5K`, `2M` | `Intl` compact 표기 |
| `'bytes'`, `'.2bytes'` | `1.5 KB`, `1.50 KB` | 1024 단위 (B · KB · MB · GB · TB · PB · EB) |
| `'+.1f'` | `+1.3`, `-2.0`, `0.0` | 양수 · 음수 부호 (0은 부호 없음) |
- 문법: `[+|-][$][,][.정밀도][~][타입]`. `~`는 뒤쪽 0 제거(`'.3~s'` → `1.5k`). 정밀도 생략 시 d3-format처럼 6(`d`는 0, `compact`는 `Intl` 기본, `bytes`는 1), 타입이 없으면 로캘 기본 숫자 형식. 잘못된 문자열은 렌더 시 `TypeError`.
- 시간 축(`type: 'time'`)에 문자열 스펙을 주면 epoch ms를 숫자로 형식화합니다 — 날짜 라벨은 함수(`(ms, granularity) => ...`)나 기본 형식을 쓰세요. 파이 `format`, 히트맵 컬러바 `format`은 아직 함수만 받습니다.

#### 툴팁 옵션 (정렬 · 공유 · 고정 · 값 형식, `chart-tooltip.ts`)
```ts
sdk.enableNodeInteractions(canvas, {
  tooltip: {
    sort: 'desc',            // 'none'(기본, 시리즈 순서) | 'asc' | 'desc' — 값 기준, NaN은 맨 뒤
    shared: false,           // true(기본): 같은 x의 모든 시리즈 / false: 포인터에 가장 가까운 항목 하나
    pin: 'click',            // 클릭 = 툴팁 고정, 다시 클릭 · 캔버스 밖 누르기 · Escape = 해제
    valueFormatter: '$,.2f', // 스펙 · Intl 옵션 · 함수
  },
});
```
- `sort` / `shared`는 표시용(DOM)입니다: 엔진 hit-test 결과는 그대로이고 `'hover'` / `'click'` 이벤트도 원래 순서 · 전체 항목을 받습니다. `formatChartTooltip`을 주면 그 함수가 정렬 · 필터된 `ctx`를 받고, `valueFormatter`는 기본 툴팁에만 적용됩니다.
- `shared: false`는 선 · 영역 · 누적 막대 툴팁 행만 줄입니다 (GPU 마커는 그대로이므로 마커까지 한 점만 원하면 `hover: { mode: 'nearest' }`).
- `valueFormatter`: 시리즈 값 · 합계 · OHLC · 히트맵 셀 · 박스 통계 · 파이 값 · 산점도 y. 생략 시 기존처럼 y축 `format`(캔들 · 박스 · 산점도) 또는 로캘 숫자.
- `pin: 'click'`: hover 중인 항목을 클릭하면 툴팁과 엔진 hover(크로스헤어 · 마커)가 그 자리에 고정되고(`data-pinned="true"`), 포인터 이동 · 캔버스 이탈 · 동기화 커서에도 바뀌지 않습니다. 다음 클릭(그 지점 hover로 복귀), 캔버스 밖 `pointerdown`, `Escape`(캔버스 포커스), 휠 줌 · 드래그 팬, 키보드 포인트 이동, 차트 교체 시 해제됩니다. 빈 곳 클릭은 고정하지 않습니다. 해제되면 `'hover'` 이벤트 / `onNodeHover`에 `null`이 전달됩니다. 한계: 고정 중에도 동기화 그룹의 커서(`hoverAtX`)는 엔진 마커를 움직입니다 (툴팁만 고정).

#### 캔들스틱 · 독립 OHLC · 히스토그램

`renderOhlcChart`는 몸통 없이 고가–저가 세로선, 왼쪽 시가 틱, 오른쪽 종가 틱을 그립니다.
입력은 `OhlcChartData`(캔들과 동일한 `t`, `open`, `high`, `low`, `close`, 선택적 `volume`)이며
`t`는 유한한 오름차순 값이어야 합니다. 비유한 가격은 빈 구간으로 처리합니다.

```ts
const { barCount } = sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
  lineWidth: 1.5, // CSS px, 0.25–8 (기본 1)
  tickWidth: 0.8, // 좌우 틱 전체 너비 / bar 간격, 0.05–1 (기본 0.7)
  showVolume: true,
  yFit: 'visible',
  timeZone: 'UTC',
  axes: { y: { format: '$,.2f' } },
});
```

캔들의 시간축·줌·팬·집계·거래량 옵션을 공유하며 `hollowUp`, `wickWidth`, `bodyWidth`,
`cornerRadius` 대신 `lineWidth`·`tickWidth`를 사용합니다. 툴팁은 `chartType: 'ohlc'`와
`ohlc` 집계 값, 브러시는 `kind: 'ohlc'`를 반환합니다. 테마 변경 후에도 OHLC 모드가 유지됩니다.
React/Vue는 `<CharturboChart type="ohlc" ... />`로 사용합니다. 키보드 탐색·데이터 표·CSV·벡터 SVG도 지원합니다.
실행 예제: `candlestick.html#03-ohlc-bars`.

```ts
sdk.renderCandlestickChart(
  { t: dates /* Date[] | epoch ms; 생략 시 인덱스 */, open, high, low, close, volume /* 선택 */ },
  { title: 'ACME', hollowUp: true, yFit: 'visible' /* | 'all' */, upColor: '#2a78d6', downColor: '#eb6834' }
);
// 툴팁 ctx.chartType === 'candlestick', ctx.ohlc = { open, high, low, close, volume, x, xEnd, count }

const bins = sdk.renderHistogram(values /* Float32Array, 1M+ */, { bins: 'auto' /* | 40 */, range: [0, 100], density: false });
// bins = { binCount, edges, counts, heights, total, rule: 'freedman-diaconis' | 'sturges' | 'fixed' }
```
- 캔들 기본 색: 상승 = 테마 palette[0](파랑, 속 빈 몸통), 하락 = palette[1](주황, 채운 몸통) — 빨강/초록에만 의존하지 않음. 테마 변경 시 기본 색 자동 반영
- 캔들 몸통이 2 CSS px보다 좁아지면 3px 버킷으로 집계(시가 = 첫 값, 고가 = 최대, 저가 = 최소, 종가 = 마지막, 거래량 = 합) → 극값 보존, 툴팁은 버킷 집계값 + `count`
- 휠 / 드래그 / 핀치로 x 줌·팬, 더블클릭 리셋, `setXRange(Date, Date)`, 주석(x = t, y = 가격) 지원. 데이터 포인트 id = 캔들 인덱스
- 히스토그램: 막대 간격 `barGap`(기본 1px), x 눈금 = 구간 경계 값, 툴팁 라벨 `a – b`, `density: true`면 면적 합 1

#### 파이 · 도넛 (`renderPieChart`, `chart-pie.ts`)
```ts
sdk.renderPieChart(
  { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads'], values: [420, 260, 180, 90, 40] },
  { donut: 0.6 /* 0 = 파이 */, sort: 'desc', maxSlices: 8 /* false = 접지 않음 */, startAngle: 0, direction: 'clockwise',
    labels: 'outside' /* | 'percent' | 'none' */, centerLabel: 'Visits', colors: [undefined, '#d95926'], title: 'Traffic' }
);
// 툴팁 ctx.chartType === 'pie', ctx.slice = { label, value, percent, members? /* "Other"에 접힌 이름 */ }
```
- 값 검증(유한 · 0 이상, 아니면 예외) · "Other" 접기(가장 작은 조각들 합산, 항상 마지막) · 정렬 · 각도 · 퍼센트(보이는 합계 기준)는 모두 Rust에서 계산
- 조각은 Rust에서 삼각형으로 분할: 호 분할 수는 화면 반지름에 맞춰 현 오차 ≤ 0.25 CSS px, 조각 사이 2px 간격은 가장자리를 1px씩 안으로 밀어 비워 둠(덧칠 없음). MSAA가 없으므로 외곽선에 조각 색 1px AA 선(세그먼트 파이프라인)을 0.5px 안쪽에 그려 경계가 매끄럽고 면적은 정확
- hover: 각도 이진 탐색(O(log n)) + 반지름 검사(도넛 구멍 제외), hover 조각은 6px 바깥으로 이동. 범례 클릭 = 조각 숨김(나머지 재배치), 범례 hover = 강조. 도넛 중앙 라벨 = 합계(hover 시 해당 조각)
- 바깥 라벨: 앵커 · 지시선 · 좌우별 세로 겹침 회피는 Rust, DOM은 텍스트만 배치. 좁은 조각(기본 6° 미만, `labelMinAngle`)은 범례/툴팁만
- 접근성: 요약(상위 조각 %), 표(조각 · 값 · Percent), 좌우 화살표로 조각 이동. 브러시 · 줌 · 커서 동기화는 파이에서 비활성. 데이터 포인트 id = 표시 조각 인덱스
- 다중 고리(`{ rings: [{ name, labels, values, radius?, label?, maxSlices?, sort? }] }`): ECharts의 중첩 파이처럼 안쪽부터 고리를 그립니다. 퍼센트(고리 합계 대비) · 각도 · "Other" 접기 · 라벨 방식은 고리마다 따로 계산하고, hit test는 반지름으로 고리를 찾은 뒤 그 고리 안에서 각도를 이진 탐색합니다. 이름이 같은 조각은 고리를 넘어 색 · 범례 항목 · 강조를 공유합니다(범례 클릭은 모든 고리에서 숨김). `radius`를 생략하면 고리 `k`가 `donut`~바깥 사이를 n등분한 k번째 칸을 쓰고 이웃과 작은 간격을 둡니다. 라벨 기본값은 안쪽 고리 `'percent'`, 가장 바깥 고리는 차트 `labels`입니다. 툴팁 · 표 · 키보드 안내는 `고리 · 조각` 이름을 쓰고, 도넛 중앙 라벨은 기본으로 꺼집니다. `colors`는 모든 고리 값을 이어 붙인 순서를 따릅니다
- 둥근 모서리(`cornerRadius`, CSS px, 기본 0): 각 모서리 원이 안쪽으로 민 가장자리와 호에 동시에 접합니다(d3-shape `cornerRadius`와 같은 작도). 얇은 조각은 양쪽 모서리가 겹치지 않도록, 얇은 고리는 안팎 모서리가 겹치지 않도록 반지름을 줄입니다. 구멍 없는 파이의 중심 꼭짓점은 뾰족하게 남습니다. hit test는 둥글리기 전 모양을 씁니다
- 조각 각도 간격(`padAngle`, 도 단위, 기본 0 · 최대 45): 기존 2px 간격 위에 각도 간격을 더합니다. 각도 · 퍼센트 · hit test는 간격 없는 배치를 그대로 쓰고, 간격보다 좁은 조각은 그리지 않습니다(범례 · 툴팁 · 표에는 남음). 조각이 하나만 보이면 간격 없이 원 전체를 그립니다
- 부분 원(`endAngle`, 시작과 같은 나침반 각도): `startAngle: -90, endAngle: 90`이면 위쪽 반 도넛입니다. 조각들은 `direction` 방향으로 이 범위를 나눠 가집니다. 끝이 시작과 같거나 앞서면 한 바퀴, 한 바퀴를 넘으면 한 바퀴로 자릅니다(게이지와 같은 규칙). 화면은 범위의 bbox에 맞춰 잡으므로 반 도넛이 카드를 채웁니다
- 나이팅게일 로즈(`rose: 'radius' | 'area'`): 조각 반지름이 값을 나타내며, 조각 넓이(도넛이면 고리 넓이)가 값에 비례합니다 (`r² = r_in² + v / max · (R² − r_in²)`, Nightingale의 polar area diagram). `'radius'`는 각도가 비율을 따르고, `'area'`는 보이는 조각이 같은 각도를 나눕니다. 퍼센트 · 툴팁 · 표는 그대로 합계 대비 비율입니다. 범례로 조각을 숨기면 남은 최댓값 기준으로 반지름을 다시 계산합니다. hover · 키보드 · 바깥 지시선은 조각마다의 반지름을 따르고, 도넛 중앙 라벨은 `centerLabel`을 지정할 때만 표시합니다. ECharts의 min→안쪽 · max→바깥 선형 대응은 쓰지 않습니다 (가장 작은 조각이 사라지고 넓이가 값을 과장함)

#### 레이더 (스파이더) 차트 (`renderRadarChart`, `chart-radar.ts`, `radar.rs`)
```ts
sdk.renderRadarChart(
  { axes: ['Speed', 'Range', 'Cost', 'Comfort', 'Safety'],
    series: [{ name: 'Model A', values: [82, 64, null /* 결측 */, 71, 90] }, { name: 'Model B', values: [55, 88, 70, 62, 74], color: '#d95926' }] },
  { max: 100 /* 또는 축별 [100, null, 50] */, rings: 4, fillOpacity: 0.2, strokeWidth: 2, markers: true /* | 반지름 px */,
    grid: 'polygon' /* | 'circle' */, startAngle: 0, format: '.0f', title: 'Cars' }
);
// 툴팁 ctx.chartType === 'radar', ctx.index = 축, ctx.items = 그 축의 보이는 모든 시리즈, ctx.radar = { axis, max }
```
- 축 3개 이상, 시리즈 1~8개(색은 테마 팔레트 고정 순서, 순환 없음). 값은 유한 · 0 이상 또는 `null`/NaN(결측: 다각형이 중심을 지나고 마커 없음), 아니면 예외
- 공통 반지름 축의 nice 최댓값 · 링 눈금(`rings` 목표 개수)과 축별 최댓값, 다각형(중심 기준 팬 삼각형 = 별 모양이라 겹침 없음) · 선(캡슐 세그먼트 = 둥근 이음) · 꼭짓점 마커(표면색 링) · 다각형/원형 그리드는 모두 Rust. 선 · 마커는 GPU에서 CSS px 크기라 줌에도 재분할 없음
- hover: 포인터 각도에 가장 가까운 축을 고르고 그 축의 보이는 시리즈 전부를 반환(가장 가까운 꼭짓점 = primary), 해당 스포크 강조 + 확대 마커. 범례 클릭 = 시리즈 숨김, hover = 강조(나머지 흐리게, 강조 시리즈를 맨 위에)
- 축 이름 · 링 값 라벨: 앵커와 정렬(왼/가운데/오른, 위/가운데/아래)은 Rust, DOM은 텍스트만(hover 축 이름은 굵게). 축별 최댓값이면 링 값 라벨 생략
- 접근성: 요약(시리즈별 최고 축), 표(축 × 시리즈), 좌우 = 축, 상하 = 시리즈. 데이터 포인트 id = `series * axes + axis`

#### 게이지 (`renderGauge`, `setGaugeValue`, `chart-gauge.ts`, `gauge.rs`)
```ts
sdk.renderGauge({ value: 72 }, {
  min: 0, max: 100, label: 'CPU load', format: '.0f',
  bands: [{ from: 0, to: 60, status: 'good' }, { from: 60, to: 85, status: 'warning' }, { from: 85, to: 100, status: 'critical', label: 'Overload' }],
  indicator: 'needle' /* 밴드가 있으면 기본; 없으면 'progress' */, startAngle: -120, endAngle: 120, thickness: 0.2,
});
sdk.setGaugeValue(81); // 바늘(또는 진행 호)만 다시 만듦: 밴드 형상 · 라벨 배치는 그대로
// 툴팁 ctx.chartType === 'gauge', ctx.index 0 = 값, 1 + k = 밴드 k; ctx.gauge = { value, min, max, band? }
```
- 상태 색은 예약됨(dataviz 상태 팔레트, 테마와 무관): good `#0ca30c` · warning `#fab219` · serious `#ec835a` · critical `#d03b3b`, 항상 아이콘(✓ ▲ ◆ ✖) + 라벨과 함께(색만으로 의미 전달하지 않음, 텍스트는 텍스트 토큰). `color`를 주면 일반 밴드
- 호 · 밴드 · 트랙 분할(현 오차 ≤ 0.25 px, 밴드 사이 2px 간격, AA 외곽선 — 파이와 같은 방식), 범위 밖 밴드 자르기 · 정렬(겹치면 뒤 밴드 우선), 값이 속한 밴드, 바늘(캡슐 3px + 허브 마커), 진행 모드(값까지 채움 + 바깥 얇은 밴드 띠), hover(링 위 = 밴드, 안쪽 = 값), 최소/최대 · 값 · 밴드 라벨 앵커는 모두 Rust
- `setGaugeValue`: 밴드 형상은 화면 배율별로 캐시되어 값 변경 시 바늘 세그먼트(또는 진행 조각 2개)만 다시 만들고 fills 업로드도 생략(바늘 모드). 라벨 revision 불변, 중앙 값 텍스트만 DOM 갱신. 애니메이션 없음(정적)
- 접근성: 요약(값 · 상태 · 범위), 표(값 / 밴드별 From–To), 좌우 화살표 = 값 → 밴드들

#### 퍼널 (`renderFunnelChart`, `chart-funnel.ts`, `funnel.rs`)
```ts
sdk.renderFunnelChart(
  { labels: ['Visits', 'Sign-ups', 'Trials', 'Paid'], values: [12000, 5400, 2100, 760] },
  { orientation: 'vertical' /* | 'horizontal' */, shape: 'trapezoid' /* | 'bar' */, conversion: 'first' /* | 'previous' | 'both' | 'none' */,
    format: ',.0f', color: '#3987e5' /* 기본: 팔레트 첫 색 (시리즈 1개 = 한 색) */, colors: [/* 단계별 (예: 서수 램프) */] }
);
// 툴팁 ctx.chartType === 'funnel', ctx.funnel = { stage, value, ofFirst, ofPrevious }
```
- 값 검증(유한 · 0 이상), 단계 폭(최대값 대비, 최소 `minWidth`), 전환율(첫 단계 대비 · 이전 단계 대비, 0으로 나누면 NaN)은 Rust. 사다리꼴은 다음 단계 폭으로 좁아지고(마지막은 직사각형), 단계 사이 2px 표면 간격 + AA 외곽선(볼록 다각형 inset, `shape.rs`). hover 단계는 밝게
- 라벨: 세로 퍼널은 오른쪽 열(이름 / 값 · 전환율), 가로 퍼널은 단계 아래. 앵커는 Rust, 여백은 SDK가 라벨 길이로 확보
- 접근성: 요약(첫 → 마지막, 최종 전환율), 표(단계 · 값 · % of first · % of previous), 좌우 화살표 = 단계

#### 워터폴 (`renderWaterfallChart`, `chart-waterfall.ts`, `waterfall.rs`)
```ts
sdk.renderWaterfallChart(
  { labels: ['Q1 start', 'Sales', 'Services', 'Refunds', 'H1', 'Costs', 'Tax'],
    values: [400, 180, 90, -60, null, -220, -45], totals: [4] /* 소계 인덱스 (또는 boolean[]) */ },
  { total: 'End' /* 마지막 합계 막대 추가 */, orientation: 'vertical' /* | 'horizontal' */, connectors: true, labels: 'auto',
    format: ',.0f', colors: { increase: '#3987e5', decrease: '#d95926', total: '#a3a29c' } }
);
// 툴팁 ctx.chartType === 'waterfall', ctx.waterfall = { kind: 'increase' | 'decrease' | 'total', change, start, end }
```
- 누적 합계(변화 막대 = 직전 합계 → 이후 합계, 소계/합계 = 0 → 누적 합계)는 Rust에서 계산하고 2D 막대 차트(`bar.rs`)의 막대별 base(떠 있는 막대)로 그림: 값 축 도메인 · 그리드 · 축 눈금 · hover · 가로 방향 · 데이터 라벨 충돌 처리를 그대로 재사용(일반 막대 · 히스토그램은 변화 없음)
- 연결선: 각 막대 끝 높이에서 다음 막대까지 점선(Rust). 색은 팔레트 슬롯 + 중립색(빨강/초록만으로 구분하지 않음), 라벨 · 툴팁에 항상 부호(`+180`, `−60`), 합계는 값만. 범례 = 존재하는 종류(정적)
- 접근성: 요약(최종 합계, 최대 증가/감소), 표(항목 · Change · Running total), 좌우 화살표 = 막대

공통: 네 차트 모두 `ChartValueFormat` `format`(spec · Intl 옵션 · 함수, `setLocale` 추적), 테마 전환 시 팔레트 · 트랙 · 바늘 색 재전송, 브러시 · 줌 · 팬 제외(엔진에서 워터폴은 막대처럼 x 커서 동기화 대상), React / Vue `type` (`'radar' | 'gauge' | 'funnel' | 'waterfall'`). WASM 바인딩은 `lib_business.rs`.
#### 트리맵 · 선버스트 (`renderTreemap`, `renderSunburst`, `chart-hierarchy.ts`, `lib_hierarchy.rs`)
```ts
// 중첩 트리: 잎에 value, 부모 값 = 자식 합 (부모의 value는 무시)
const tree = { name: 'Revenue', children: [
  { name: 'Americas', children: [{ name: 'Hardware', value: 420 }, { name: 'Software', value: 310 }] },
  { name: 'Europe', children: [{ name: 'Hardware', value: 260 }, { name: 'Services', value: 180 }] },
] };
sdk.renderTreemap(tree, { title: 'Revenue', format: '$,.0f', maxDepth: 0 /* 0 = 전부 */, innerPadding: 2, headerHeight: 20,
  colorBy: 'auto' /* | 'group' | 'value' */, colormap: 'sequential', labels: true });
// 평면 행: { id, parent, value } (parent 없음 / null = 루트, 루트가 여럿이면 rootLabel('All') 가상 루트)
sdk.renderSunburst([{ id: 'r', name: 'Revenue' }, { id: 'am', parent: 'r' }, { id: 'hw', parent: 'am', value: 420 }]);
sdk.on('drill', (e) => console.log(e.path.join(' › '))); // { kind, node, id?, name, path }
sdk.drillTo('Americas'); sdk.drillUp(); sdk.render();
// 툴팁 ctx.chartType === 'treemap' | 'sunburst', ctx.hierarchy = { node, name, path, value, percentOfParent, percentOfTotal, depth, children }
```
- 입력 검증(부모 인덱스, 잎 값 유한 · 0 이상, NaN = 0) · 순환 검출(노드 이름으로 된 경로를 담은 예외) · 값 집계 · 자식 정렬(큰 값 먼저)은 Rust `Tree`에서 O(n)
- 트리맵: Bruls et al. squarified 레이아웃을 플롯의 CSS px 단위로 계산해 부모마다 헤더 띠 + 안쪽 여백, 셀은 반 간격씩 안으로 밀고 디바이스 픽셀에 스냅 → 이웃 셀 사이 2px 표면 간격이 정확하고 축 정렬 모서리는 AA 없이 선명. 자식 평균 면적이 36px² 미만인 부모(또는 `maxDepth` 경계)는 통째로 한 셀로 그려 화면이 그리는 양을 정함(잎 10만 개: release 빌드 레이아웃 + 테셀레이션 ≈ 15ms). hover는 현재 루트부터 사각형을 따라 내려가며(헤더 · 여백 = 부모) 외곽선만 오버레이로 그림(재테셀레이션 없음)
- 선버스트: 깊이별 링, 각도 ∝ 값, 파이 테셀레이션 재사용(현 오차 ≤ 0.25px, 각도 · 반지름 방향 2px 간격, 1px AA 외곽선). 1px보다 짧은 호는 하위 트리까지 생략. hover 경로(조상 + 하위 트리) 외에는 표면 쪽으로 흐려짐. 중앙 원 = 현재 루트(값 + 이름, hover 시 해당 노드와 비율)
- 색: 최상위 그룹별 팔레트(고정 순서, 팔레트를 넘는 그룹은 회색 "Other"로 접음, 깊이마다 표면 쪽으로 조금씩 밝기 변화) 또는 값(히트맵 컬러맵 LUT 재사용, 깊이별 정규화). `'auto'`는 그룹 수가 팔레트 이하이면 그룹, 아니면 값. 범례 = 그룹(hover 강조, 토글 없음)
- 라벨: Rust가 텍스트가 들어갈 셀 / 호만 앵커 + 상자 크기로 내보내고(큰 것부터 최대 600 / 300개) DOM은 글자만 배치(잘리는 이름은 JS에서 줄임표, PNG 내보내기와 일치)
- 드릴다운: 클릭 = 트리맵은 현재 루트의 해당 자식 그룹, 선버스트는 클릭한 호(중앙 = 위로). 브레드크럼(제목 · 범례 아래) 클릭 · Escape = 위로. `'drill'` 이벤트, React `onDrill` / Vue `@drill`
- 접근성: 요약(노드 수 · 합계 · 상위 그룹 비율), 표 = 노드마다 경로 · 값 · 부모 대비 · 전체 대비, 키보드 = 좌우 화살표 형제 이동 · 아래 첫 자식 · 위 부모 · Enter 드릴다운 · Escape 위로(엔진에 id로 직접 hover). 브러시 · 줌 · 커서 동기화는 비활성. 데이터 포인트 id = 노드 인덱스(트리 입력은 깊이 우선 순서, 가상 루트는 마지막)

#### 생키 (`renderSankey`)
```ts
sdk.renderSankey(
  { nodes: [{ id: 'coal', name: 'Coal' }, { id: 'power', name: 'Electricity', column: 1 }, { id: 'homes', name: 'Homes', group: 'use' }],
    links: [{ source: 'coal', target: 'power', value: 30 }, { source: 'power', target: 'homes', value: 28 }] },
  { title: 'Energy', format: ',.0f', nodeWidth: 12, nodePadding: 10, iterations: 32, align: 'justify' /* | 'left' | 'right' | 'center' */,
    linkColor: 'source' /* | 'target' | 'neutral' | 'gradient' */, linkOpacity: 0.5,
    orient: 'horizontal' /* | 'vertical' */, levels: [{ column: 0, color: '#ef4444', linkOpacity: 0.8 }] }
);
// 툴팁 ctx.flow = { kind: 'link', source, target, value, percentOfSource } | { kind: 'node', source, value, inflow, outflow }
```
- 세로 방향(`orient: 'vertical'`): 같은 배치를 흐름 좌표(흐름 방향 · 가로지르는 방향)에서 계산하고 화면에서 x · y만 바꿉니다. 열은 위에서 아래로 쌓이는 행이 되고, hit test · 키보드 위치 · 내보내는 노드 사각형도 같은 변환을 씁니다. 라벨은 막대 가운데에 맞춰 위쪽 절반은 아래, 아래쪽 절반은 위에 놓고, 같은 행에서는 가장 긴 라벨 폭(SDK 추정)만큼 떨어뜨립니다
- 링크 색 `'gradient'`: 리본 정점 색이 출발 노드 색에서 도착 노드 색으로 리본 매개변수에 따라 선형으로 바뀝니다
- 단계 스타일(`levels`, ECharts `levels`): 열마다 노드 색(노드 `color`가 우선)과 그 열에서 나가는 링크의 불투명도를 정합니다. 같은 열을 여러 번 쓰면 마지막 항목이 이깁니다
- d3-sankey 방식을 Rust로: 최장 경로 열 배정(정렬 / 명시적 `column` = 최소 열: 출발 노드보다 항상 오른쪽, 사용된 열만 압축), 노드 값 = max(유입, 유출), 가장 빽빽한 열 기준 `ky`로 폭 ∝ 값, `iterations`회 이완(가중 y로 이동, 오른쪽→왼쪽 / 왼쪽→오른쪽, alpha 0.99^i) + 열마다 충돌 해소(마지막 회차는 완전 해소 → 같은 열 노드는 겹치지 않음). 노드별 링크 순서는 패스마다 재정렬, 부착 오프셋은 누적합이라 허브 노드가 있어도 회차당 O(N + L log L)(노드 1만 · 링크 1.8만: release ≈ 50ms)
- 링크 = 양 끝 수평 접선 3차 베지어 리본(두께 = 값), 화면 곡률에 맞춘 분할 수, 반투명, 두꺼운 것부터 그려 얇은 흐름이 위에 보임. hover: 노드(열 → 사각형) 다음 리본(x(t) = x 풀이 후 밴드 비교, 위에서부터). hover한 노드 / 링크와 연결된 흐름만 밝게(지오메트리는 그대로, 색만 다시 칠함)
- 순환 링크는 예외(`Sankey links form a cycle: "A" -> "B" -> "A"`), 자기 자신 링크 · 음수 / 비유한 값 · 양 끝이 모두 명시적인데 앞 열로 가는 링크도 예외
- 색: 그룹(`group`)이 있으면 그룹별, 노드가 팔레트 이하이면 노드별, 아니면 열별(팔레트를 넘으면 회색). 라벨: 왼쪽 절반 노드는 오른쪽, 나머지는 왼쪽에 이름 + 값, 같은 열에서 줄 간격보다 가까우면 큰 노드가 우선
- 접근성: 요약(노드 · 열 · 링크 수, 가장 큰 흐름), 표 = 링크마다 출발 · 도착 · 값 · 출발 대비 비율, 좌우 화살표로 링크 이동. 데이터 포인트 id = 노드 인덱스, 링크는 노드 수 + 링크 인덱스

#### 접근성 · 데이터 테이블 (`chart-a11y.ts`)
```ts
sdk.renderLineChart(series, { title: '추론 트래픽', description: '배포 후 RPS가 두 배로 증가' });
sdk.getChartSummary();  // "추론 트래픽. Line chart, 4 series, 5,000 points; AI-Inference-RPS ranges 52.6–247.1; ..."
sdk.showDataTable(document.querySelector('#table')!, { maxRows: 1000 }); // 생략 시 캔버스 컨테이너 바로 뒤
sdk.hideDataTable();
sdk.getChartDataTable(); // { columns, rows, totalRows, sampled } — 전체 데이터 (다운샘플 없음)
sdk.exportChartCSV();    // RFC 4180 CSV (CRLF), 수식으로 해석될 문자열(=, +, -, @ 시작)은 ' 접두
```
- 캔버스: `role="img"`, `aria-label` = 자동 요약 (`description`을 주면 그 문장, 요약은 설명으로 이동), `aria-describedby` → 시각적으로 숨긴 긴 설명 (축 범위, 시리즈별 최소/최대/평균/추세, 키보드 안내).
- 키보드: 차트 렌더 시 캔버스가 `tabindex="0"`. ←/→ 이전/다음 샘플(막대: 카테고리), PageUp/PageDown ±10, Home/End 처음/끝, ↑/↓ 시리즈 전환(숨긴 시리즈 건너뜀), Esc 해제. 포커스된 점은 `project_node_to_ndc` → `chart_hover_at_ndc`로 엔진 hover(crosshair/마커/막대 강조)를 그대로 쓰고, `aria-live="polite"` 영역이 `"T+120, AI-Inference-RPS 135.9."`처럼 읽어 줍니다. `enableNodeInteractions`를 켰다면 같은 툴팁(`formatChartTooltip` 포함)이 그 점에 뜹니다.
- 데이터 테이블: `<caption>`(제목), `<th scope="col|row">`, 스크롤 영역은 `role="region"` + 포커스 가능. `maxRows`(기본 1000)보다 길면 처음·끝을 포함해 균등 샘플링하고 안내 문구를 붙입니다. 테마 변경 / 차트 재렌더 시 자동 갱신.
- 고대비(`forced-colors: active`): 범례 스와치에 `CanvasText` 테두리 + `forced-color-adjust: none`(시리즈 색 유지), 숨긴 시리즈는 점선 테두리, 포커스 링은 `Highlight`. SDK는 애니메이션/트랜지션을 쓰지 않으므로 `prefers-reduced-motion`에서도 동작이 같습니다.
- 산점도: 요약(시리즈별 점 수 · x/y 범위), 데이터 테이블(점마다 x · y · 시리즈, 데이터 순서), 키보드(←/→ = 시리즈 안에서 x 순서로 다음 점, ↑/↓ = 시리즈 전환, Home/End = 가장 작은 / 큰 x)를 지원합니다.
- 한계: 줌으로 화면 밖에 있는 점은 읽어 주기만 하고 hover는 지웁니다. 스크린리더 browse 모드에서는 화살표 키를 리더가 가져가므로 focus/forms 모드로 전환해야 합니다.

#### 이미지 내보내기 (`chart-export.ts`)
```ts
const blob = await sdk.toImage({ format: 'png', pixelRatio: 2 });       // Blob (기본: png, 현재 캔버스 배율)
const url = await sdk.toDataURL({ format: 'jpeg', quality: 0.9, background: '#fff' });
await sdk.downloadImage('chart.webp', { background: 'transparent' });   // 확장자로 형식 결정
```
- 캔버스를 다시 렌더링하고 같은 태스크 안에서 2D 캔버스로 `drawImage` 합니다 (WebGPU 캔버스는 프레임이 present된 뒤 내용이 사라짐). 읽은 결과가 전부 투명이면 다음 `requestAnimationFrame`에서 최대 2번 재시도 후 오류.
- `pixelRatio`가 현재와 다르면 캔버스 backing store를 잠시 그 크기로 바꿔(`resize`) 렌더링한 뒤 복원합니다 (한 변 최대 8192px).
- `background`: `'theme'`(기본, 테마 surface) / CSS 색 (불투명이면 GPU clear color로 렌더) / `'transparent'` (검정·흰 배경으로 두 번 렌더해 정확한 알파 복원; 반투명 CSS 색은 그 아래에 깔림). JPEG는 알파가 없어 투명 부분이 검정이 됩니다.
- DOM 오버레이(제목, 범례 스와치·이름·숨김 상태, 축 눈금, 축 제목, 주석 라벨 등)는 오버레이 루트를 일반적으로 순회해 레이아웃된 위치·계산된 폰트/색/투명도/취소선/회전(`rotate(-90deg)`)으로 `fillText` 합니다. 내보내지 않을 요소는 `data-charturbo-export="false"`. `overlay: false`면 캔버스만.
- 한계: 툴팁(오버레이 밖)은 포함하지 않습니다. 오버레이 안 SVG / 이미지 / 테두리 / 그림자는 그리지 않고, 여러 줄로 줄바꿈된 텍스트는 한 줄로 그립니다. `setPixelRatio`로 덮어쓴 배율은 고해상도 내보내기 후 캔버스 기준으로 다시 계산됩니다.

#### React / Vue 컴포넌트 (`charturbo/react`, `charturbo/vue`)
코어(`charturbo`)는 React / Vue를 import하지 않습니다. 래퍼는 별도 엔트리이며 `react`·`react-dom`(>=18) / `vue`(>=3.3)는 선택적 peer 의존성입니다.

```tsx
// React
import { useMemo, useRef } from 'react';
import { CharturboChart, type CharturboChartHandle } from 'charturbo/react';

function CpuChart({ values, dark }: { values: Float32Array; dark: boolean }) {
  const chart = useRef<CharturboChartHandle>(null);
  // data / options는 identity로 비교: 바뀔 때만 다시 렌더링되도록 메모이즈
  const data = useMemo(() => [{ name: 'cpu', values }], [values]);
  const options = useMemo(() => ({ title: 'CPU', legend: false }), []);
  return (
    <CharturboChart
      ref={chart}
      type="line"                    // 'line' | 'area' | 'bar' | 'scatter' | 'candlestick' | 'histogram' | 'heatmap' | 'box' | 'pie' | 'combo' | 'radar' | 'gauge' | 'funnel' | 'waterfall' | 'treemap' | 'sunburst' | 'sankey' | 'sparkline'
      data={data}
      options={options}
      theme={dark ? 'dark' : 'light'} // 바뀌면 setTheme만 호출 (데이터 재전송 없음)
      syncGroup="dash"               // 같은 키의 차트끼리 크로스헤어 · 줌/팬 동기화
      style={{ height: 320 }}        // 컨테이너 크기 = 캔버스 크기 (autoResize)
      onRangeChange={(r) => console.log(r.xMin, r.xMax)}
      onHover={(e) => {}}
      onSelect={(sel) => {}}
      onReady={(sdk) => sdk.setXRange(0, 100)}
      onError={(e) => {}}            // CharturboInitError: WebGPU / WebGL2 없음 등
    />
  );
}
// 명령형 API: chart.current?.sdk?.downloadImage('cpu.png') (sdk는 준비 전 / 언마운트 후 null)

// 훅: 캔버스를 직접 배치할 때 (부모는 position: relative)
const { canvasRef, sdk, error } = useCharturboChart({ type: 'bar', data: items });
return <div style={{ position: 'relative', height: 240 }}><canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} /></div>;
```

```vue
<!-- Vue 3 -->
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { CharturboChart, type CharturboChartInstance } from 'charturbo/vue';

const data = shallowRef([{ name: 'cpu', values: new Float32Array(10_000) }]);
const options = { title: 'CPU' }; // 템플릿 인라인 객체는 부모 렌더마다 새 참조 → 상수 / shallowRef로
const chart = ref<CharturboChartInstance | null>(null);
function update(values: Float32Array) {
  data.value = [{ name: 'cpu', values }]; // 새 배열로 교체해야 다시 렌더링 (얕은 watch)
}
</script>

<template>
  <CharturboChart
    ref="chart"
    type="line"
    :data="data"
    :options="options"
    theme="light"
    sync-group="dash"
    style="height: 320px"
    @range-change="(r) => console.log(r.xMin, r.xMax)"
    @ready="(sdk) => sdk.setXRange(0, 100)"
  />
  <!-- chart?.sdk?.setXRange(0, 100) -->
</template>
```
- 수명 주기: 마운트 시 엔진 1회 생성(`Charturbo.create`, 비동기), 언마운트 시 `dispose()`. 생성 완료 전에 언마운트되면 도착한 엔진을 바로 해제하고 콜백은 호출하지 않습니다. React StrictMode의 마운트 → 언마운트 → 마운트에서도 엔진은 하나만 만들어집니다 (생성을 마이크로태스크 하나 늦춰 첫 바인딩은 시작 전에 폐기).
- 갱신 규칙: `type` / `data` / `options`의 **참조**가 바뀔 때만 `render*Chart`를 한 번 호출합니다 (깊은 비교 없음 → React는 `useMemo` / state, Vue는 `shallowRef` + 교체). `theme` → `setTheme`만, `syncGroup` → 키·플래그가 바뀔 때 `setSync`, `interactions` 참조 변경 → `enableNodeInteractions` 재바인딩 (`false` = 정적 차트, 기본은 툴팁 · 줌/팬 + `autoRender: true`). `createOptions`(`locale`, `autoResize` 등)는 마운트 시 한 번만 읽습니다. 준비 전에 바뀐 props는 준비 직후 최신 값으로 한 번만 적용됩니다.
- `type: 'bar'`는 `data`가 배열이면 `renderBarChart`, `{ categories, series }`면 `renderGroupedBarChart`입니다.
- 이벤트: React `onHover` / `onClick` / `onSelect` / `onRangeChange` / `onLegendToggle` / `onThemeChange` / `onResize` (인라인 함수 가능: 최신 콜백을 호출하며 재구독하지 않음), Vue `@hover` / `@click` / `@select` / `@range-change` / `@legend-toggle` / `@theme-change` / `@resize` / `@ready` / `@error`.
- 크기: 래퍼 `<div>`(`position: relative`, 오버레이 라벨 · 범례가 붙는 곳)에 `className` / `style`로 크기를 주면 캔버스가 100%로 따라가고 SDK `autoResize`가 `ResizeObserver`로 backing 크기를 맞춥니다.
- SSR: import 시 `window` / `document`에 접근하지 않고, 엔진은 클라이언트 마운트(`useEffect` / `onMounted`)에서만 만듭니다. 서버는 `<div><canvas></div>` 마크업만 렌더링합니다.

#### 공유 GPU 디바이스 · 스파크라인 (`charturbo-device.ts`, `chart-sparkline.ts`)
```ts
import { CharturboDevice, Charturbo } from 'charturbo';

const device = await CharturboDevice.create();               // { backend: 'auto' | 'webgpu' | 'webgl2' }
for (const row of rows) {
  const sdk = await Charturbo.create(row.canvas, { device });   // 어댑터/디바이스 요청·파이프라인 컴파일 없음
  sdk.renderSparkline(row.values, {
    type: 'line',            // 'line' | 'area' | 'bar' | 'winloss'
    color: '#3987e5', lineWidth: 1.5,
    showLast: true, showMinMax: true, band: [80, 120],   // 마커·밴드는 엔진(Rust) 마크
    label: row.name,         // aria-label: "Revenue: trend up 12% from 100 to 112, min 95, max 120"
    // tooltip: true         // 기본 off (툴팁 DOM·포인터 리스너 없음)
  });
  sdk.render();
}
device.engineCount;  // 살아 있는 엔진 수
device.dispose();    // 핸들 해제 (남은 엔진은 계속 동작, 모두 dispose되면 GPU 디바이스 해제)
```
- **왜 필요한가**: `Charturbo.create(canvas)`는 캔버스마다 adapter/device를 요청하고 모든 파이프라인을 컴파일합니다. 브라우저는 WebGL 컨텍스트를 ~16개로 제한하므로 차트 100개 페이지는 실패합니다. `CharturboDevice`는 instance/adapter/device/queue 하나와 파이프라인(서피스 포맷별 캐시 1세트)을 공유하고, 엔진마다 서피스 설정·깊이 텍스처·uniform·인스턴스 버퍼만 가집니다(공유 엔진은 버퍼를 16개 요소로 시작해 필요할 때 키움).
- **WebGPU**: 캔버스마다 `GPUCanvasContext`를 공유 디바이스로 구성 → N 캔버스 = N 서피스 + 디바이스 1개.
- **WebGL2 폴백**: GL 컨텍스트는 자기 캔버스에만 present할 수 있으므로, 디바이스가 숨은 공유 캔버스 하나에 각 엔진을 렌더(크기가 다르면 그 엔진 크기로 재구성)한 뒤 같은 태스크에서 엔진 캔버스의 2D 컨텍스트로 `drawImage` 복사합니다 → WebGL 컨텍스트 1개로 캔버스 수 제한 없음. 엔진 캔버스는 `2d` 컨텍스트를 쓰므로 이미 `webgl2`/`webgpu` 컨텍스트가 있는 캔버스는 안 됩니다(`CharturboInitError('no-webgpu')`). 크기가 제각각인 캔버스가 섞이면 프레임마다 공유 캔버스 재구성 비용이 듭니다.
- 기존 `Charturbo.create(canvas)` 동작은 그대로입니다. `device` 경로의 그래프 기본값은 노드/엣지 0개입니다. 모듈 초기화는 `Charturbo.create`와 같은 Promise를 공유합니다(동시 호출해도 한 번만 instantiate).
- **스파크라인**: 축·그리드·범례·제목·오버레이 DOM·줌 없음, 패딩 2px(마커가 있으면 반지름 + 1), y 도메인은 nice 없이 데이터에 딱 맞춤. last/min/max 마커·기준 밴드·win/loss 0선은 Rust 주석 레이어로 GPU에만 그리고, 데이터 갱신(`setSeriesData`) 시 엔진이 다시 계산합니다. 추세 요약(first/last/min/max/변화율)도 엔진(`chart_sparkline_summary`)이 계산합니다. 캔버스에는 `role="img"` + `aria-label`만 붙고 설명/라이브 영역 DOM·tabindex는 만들지 않습니다(`getChartSummary()`도 같은 문장). `width`/`height`를 주지 않으면 캔버스 CSS 크기에 맞추고, 리사이즈로 비율이 바뀌면 다시 맞춥니다.
- win/loss: 값의 부호로 같은 높이의 위/아래 막대(이김 = palette[0], 짐 = palette[1], 0 = 빈칸), 0선 표시, 라벨 `"Results: 7 wins, 3 losses, last: win"`.
- **성능 메모**: 헤드리스 Chrome에서 120×30 스파크라인 100개 = WebGPU 165ms / WebGL2 717ms(생성+첫 렌더), 200개 = WebGPU 234ms, 파이프라인 1세트, 오버레이 DOM 0개. 엔진당 CPU 메모리 ~67KB(`tests/sparkline_memory.rs`, 카운팅 할당자), GPU 초기 할당 ~73KB(240×60 backing, 깊이 텍스처 57KB 포함; `engine_gpu_bytes`) vs 기본 엔진 ~813KB.

#### 애니메이션 (옵트인, `chart-animation.ts`, `chart/animation.rs`)
```ts
const sdk = await Charturbo.create(canvas, { animation: { duration: 400, easing: 'ease-out' } }); // 기본 off
sdk.setAnimation(true);                                   // 이후 차트 전체 (true = 400ms ease-out, false = off)
sdk.renderBarChart(items, { animation: false });          // 차트별 덮어쓰기 (line/area/bar/grouped/scatter/pie/box/candle)
sdk.setSeriesData(0, next); sdk.render();                 // update: y 값이 보간됨
sdk.isAnimating(); sdk.finishAnimation();                 // 진행 여부 / 즉시 마지막 프레임
```
- **enter**: 선·영역·캔들은 시저(clip) 사각형으로 왼쪽→오른쪽 reveal(지오메트리 변경 없음), 막대는 0 기준선에서 자람(누적 막대는 스택 전체가 함께), 산점도·파이는 fade + scale, 그 밖의 마크(박스 등)는 fade. 이후 추가될 차트 종류는 기본으로 막대 grow + 나머지 fade.
- **update**: `setSeriesData`, 또는 같은 종류·같은 모양(staged 인스턴스 수가 같은 레이어)으로 다시 렌더한 차트 → 엔진이 이전 프레임의 staged 인스턴스(선 정점 = y 값, 막대 사각형 = 높이, 산점도 중심)를 원소별 보간, 파이는 조각 각도를 보간해 다시 테셀레이션. 모양이 바뀐 레이어는 바로 최종 값(snap), 종류가 다르면 enter. 축·눈금은 새 도메인으로 즉시 이동합니다.
- **비용**: 보간은 Rust에서 staged(LOD 이후) 마크에만 O(visible)로 수행 → 1M 포인트 선도 M4로 줄어든 수천 개 정점만 보간. staged 마크가 50k(`MAX_ANIMATED_MARKS`)를 넘으면(예: 1M 산점도) 애니메이션 생략. rAF는 애니메이션 중에만 돌고(`chart_animation_tick(now)` → `render()`), 끝나면 루프 없음. rAF가 없거나 탭이 숨겨져 있으면 즉시 마지막 프레임.
- `prefers-reduced-motion: reduce`면 꺼짐. 기본 off라 시각 회귀 픽스처는 결정적입니다. 이미지/SVG/PDF 내보내기는 항상 최종 프레임.

#### SVG · PDF · 클립보드 내보내기 (`chart-svg.ts`, `chart-pdf.ts`, `chart/svg.rs`)
```ts
const svg = sdk.exportChartSVG({ maxMarks: 200_000, background: 'theme' });  // 동기, 문자열
sdk.downloadChartSVG('chart.svg');
await sdk.downloadChartPDF('chart.pdf');      // 1페이지 PDF (래스터: toImage PNG 임베드)
const blob = await sdk.toPDF();
const ok = await sdk.copyChartImage();        // ClipboardItem PNG, 미지원/거부 시 false
```
- **벡터 SVG**: 엔진이 마지막 프레임의 staged GPU 인스턴스를 CSS px 좌표로 씁니다 — 같은 스타일의 연속 선분은 `<path>` 폴리라인 하나(점선은 `stroke-dasharray`/`dashoffset`), 채움 삼각형은 색별 `<path>`, 막대는 데이터 끝이 둥근 `<path>`(간격 trim 포함), 마커·점은 `<circle>`(사각/마름모/삼각은 `<path>`), 주석·브러시·네비게이터 포함, hover 오버레이 제외. 줌 중에는 캔버스와 같은 plot `clipPath`.
- **텍스트**: 오버레이 DOM(제목·범례·눈금·축 제목·라벨)을 PNG 내보내기와 같은 방식으로 걸어 `<text>`(계산된 font-family/size/weight/style, 색, 회전, 말줄임)와 `<rect>`(범례 견본·라벨 칩)로 씁니다.
- **대용량**: LOD 결과만 쓰므로 1M 선도 화면 픽셀 수준 크기. 점은 plot 밖을 컬링하고 `maxMarks`(기본 200k)를 넘으면 균등하게 솎아내며 콘솔 경고.
- 지원: line / area / bar(2D) / scatter / pie / box / candlestick / combo / radar / gauge / funnel / waterfall / treemap / sunburst / sankey는 벡터, heatmap은 plot 영역을 PNG `<image>`로(셀은 GPU 텍스처) 나머지는 벡터, 3D/2.5D 뷰와 SVG 작성기가 없는 종류는 캔버스 전체 PNG `<image>` + 벡터 텍스트(콘솔 경고). 새 종류는 `ChartState::svg_support`에 arm을 추가하면 벡터로 전환됩니다.
- **PDF**: 의존성 없이 직접 쓰는 최소 PDF(카탈로그/페이지/이미지 XObject/xref). 페이지 = 차트 CSS 크기(96dpi → pt), 이미지는 합성 PNG의 RGB를 `CompressionStream('deflate')`로 FlateDecode(없으면 무압축). 벡터 PDF는 아직 없음 → 벡터가 필요하면 SVG.

#### Y축 줌 · 박스 줌 · 줌 기록 (`chart-zoom.ts`, `chart/zoom.rs`)
```ts
sdk.enableNodeInteractions(canvas, {
  zoom: 'x',          // 휠 축: 'x'(기본) | 'y' | 'xy'. Shift + 휠은 항상 y
  zoomMode: 'pan',    // 'pan'(기본: 드래그 = 팬, Ctrl/⌘ + 드래그 = 박스 줌) | 'box'(드래그 = 박스 줌, Alt + 드래그 = 팬)
});
sdk.zoomChartY(0.5, 0);                   // y 줌 (anchor NDC y)
sdk.setYRange(55, 95);                    // 선/영역: y 도메인 고정(핀)
sdk.zoomChartBox(-0.4, 0.5, 0.3, -0.3);   // NDC 사각형으로 x + y 줌
sdk.undoZoom(); sdk.redoZoom();           // Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z / Ctrl + Y (캔버스 포커스)
sdk.zoomHistory;                          // { undo, redo, max: 50 }
```
- 선/영역 차트의 수동 y 줌은 데이터 단위의 y 창(축별 scale 공간)을 **고정**합니다: autoscale(`all`/`visible`/`none`)·데이터 갱신·스트리밍이 y를 바꾸지 않고, 눈금은 창 안의 nice step, 기준선은 창의 바닥, 선은 plot 경계에서 정확히 잘립니다. `resetChartZoom()`(더블클릭)이 핀을 풀고 autoscale로 돌아갑니다. 이중 y축은 같은 화면 띠로 함께 줌. 산점도는 y 창(`window_y`)만 줌.
- 박스 줌: 드래그 중 브러시 레이어로 점선 사각형을 그리고, 놓으면 plot에 클램프한 데이터 범위로 x + y 줌(4px 미만은 클릭). Escape는 진행 중인 박스를 취소. 브러시 선택이 있으면 박스 줌이 그것을 지웁니다. 콤보 차트는 y 도메인이 고정이라 x 휠 줌 · 팬 · 줌 기록(실행 취소 / 다시 실행)만 지원하고 박스 줌과 y 줌은 꺼져 있습니다.
- 기록: 제스처마다(휠 연속 입력 400ms 묶음, 드래그 팬, 박스) 시작 전 상태를 한 번 기록(최대 50, 엔진 측), 새 제스처는 redo를 지움. 더블클릭 리셋은 기록도 비웁니다. 프로그램 호출(`setXRange` 등)은 기록하지 않음(`pushZoomHistory()`로 직접 기록 가능), 새 차트는 빈 기록.
- `'rangechange'`(`getYRange()`)가 선/영역의 y 범위(현재 y 도메인, autoscale 또는 줌)도 포함합니다.

### 2. 1536차원 임베딩 3D 프로젝션 & 유사도 검색
```ts
const dim = 1536; // e.g. OpenAI text-embedding-3
const count = 1000;
const flatVectors = new Float32Array(count * dim);

// 고차원 임베딩 로드 (3D 자동 투영 + Cosine k-NN 생성)
sdk.loadEmbeddings(flatVectors, {
  dimensions: dim,
  kNeighbors: 4,
  similarityThreshold: 0.2,
  projection: 'pca', // 'pca-umap'(기본) | 'pca' | 'random-projection'
});

// 코사인 유사도 Top 5 검색
const topMatches = sdk.queryCosineSimilar(0, 5);
console.log('Top 5 유사 항목:', topMatches);
```

### 3. 3D 그래프 네트워크 및 노드 인터랙션
```ts
const sdk = await Charturbo.create(canvas, {
  seed: 42,
  nodeCount: 2000,
  edgeCount: 4000,
  clusterCount: 8,
});

// 노드 비즈니스 메타데이터 등록
sdk.setSingleNodeMetadata(0, {
  label: 'API-Gateway-01',
  category: 'Ingress',
  description: '서울 리전 메인 게이트웨이',
  attributes: { latencyMs: 1.8, rps: 4200, status: 'Healthy' },
});

// 마우스 오버 툴팁 + 클릭 시 노드 상세 데이터 & 이웃 하이라이트
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: true,
  highlightNeighborsOnClick: 1,
  focusOnDoubleClick: true,
  autoRender: true,
  onNodeClick: (details) => {
    if (details) {
      console.log('선택된 노드:', details.label, '속성:', details.metadata);
    }
  },
  // 내장 카메라 조작 (기본값: 모두 켜짐)
  cameraControls: { orbit: true, pan: true, zoom: true },
});

sdk.applyLayout('cluster-sphere', 85);
sdk.fitToView();
sdk.render();

// 카메라 상태 · 포커스
sdk.focusNode(42);                    // 노드로 이동 + 개요 거리의 40 %까지 접근
sdk.focusNode(42, { distance: 60 });  // 거리 지정 (`false` = 거리 유지)
const cam = sdk.getCameraState();     // { target, eye, distance, yaw, pitch, fovY, aspect } | null
```

- **내장 카메라 조작 (`cameraControls`, `camera-controls.ts`)**: 그래프 · 포인트 클라우드 · 3D 장면(차트가 없을 때)에서 마우스 왼쪽 드래그 = 궤도 회전, Shift + 드래그 · 오른쪽 · 가운데 드래그 = 팬(포인터 아래 내용이 따라옴), 휠 = 줌(현재 거리에 비례, 페이지 스크롤 없음). 드래그 중에는 포인터 캡처로 캔버스 밖에서 놓아도 드래그가 끝나고, 5 px 이내로 놓으면 클릭(노드 선택)으로 처리됩니다. `{ orbit: false }` = 왼쪽 드래그가 팬(2D식 탐색), `{ pan: false }` / `{ zoom: false }` = 해당 조작만 끔, `cameraControls: false` = 내장 카메라 조작 전부 끔(직접 카메라를 다루는 호스트용). 같은 스위치가 터치 제스처의 카메라 이동(드래그 회전 · 두 손가락 팬 · 핀치 줌)에도 적용됩니다. 차트의 휠 · 드래그 탐색은 그대로이며, 오른쪽 드래그 팬을 위해 그래프 뷰에서는 캔버스 컨텍스트 메뉴가 열리지 않습니다. 직접 포인터 핸들러를 가진 호스트는 `sdk.handlesCameraControls()`가 true일 때 자기 카메라 처리를 건너뛰면 됩니다. `enableNodeInteractions`가 반환한 함수(또는 `dispose()`)가 리스너를 모두 해제합니다.
- **프레이밍**: `fitToView()`는 현재 방향에서 모든 노드가 가로 · 세로 중 더 빡빡한 FOV 기준으로 뷰를 채우도록(여백 10 %) 거리를 정합니다(넓은 캔버스도 꽉 참). `focusNode` / 더블클릭 포커스는 대상을 옮기고 개요 거리(마지막 `fitToView` / `setCameraPose`)의 40 %까지 즉시 다가갑니다(이미 더 가까우면 유지). `getCameraState()`와 거리 기반 줌 · 팬 · 포커스 거리는 엔진의 `camera_state` 바인딩이 필요하며, 없는 빌드에서는 `null` / 고정 이득 / 대상만 이동으로 동작합니다.
- **기본 툴팁 (`graph-tooltip.ts`)**: 라벨 · `#id`, 카테고리 · 클러스터, 연결 차수, 이웃 수, 좌표, 태그, 속성(최대 6개)을 테마 텍스트 색으로 표시합니다. 라벨 · 카테고리 · 태그 · 속성 키/값 등 데이터에서 온 문자열은 모두 HTML 이스케이프되어 텍스트로만 렌더링됩니다(`<img onerror=…>` 같은 라벨도 실행되지 않음). 고정 문구는 SDK / 차트 로캘을 따릅니다(`ko*` = 한국어, 그 외 = 영어 기본), 숫자는 해당 로캘 형식. 차트 기본 툴팁도 시리즈 이름 · x 라벨 · 속성 · 축 제목 · 형식화된 값(`tooltip.valueFormatter` 반환값 포함, HTML이 아닌 텍스트로 표시)을 이스케이프합니다.
- **커스텀 툴팁**: `formatTooltip` / `formatChartTooltip`이 반환한 HTML은 그대로 `innerHTML`에 들어가므로, 데이터 문자열은 내보낸 `escapeHtml`로 감싸세요: ``formatTooltip: (d) => `<b>${escapeHtml(d.label)}</b>` ``.
