# 3D 네트워크 그래프

Charturbo는 대규모 3D 노드-링크 그래프를 렌더링하고, Rust로 작성한 Barnes-Hut 힘 시뮬레이션(O(N log N) 옥트리)으로 배치합니다. 노드가 수천에서 수십만 개인 서비스 맵, 의존성 그래프 같은 네트워크에 사용하며, hover 툴팁·이웃 강조·최단 경로·검색이 내장되어 있습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/graph.html)

## 기본 사용법

```ts
import { Charturbo, type RawGraphData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 0: 기본 시드 그래프 대신 빈 상태로 시작
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const graph: RawGraphData = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), // 노드 3개
  edges: new Uint32Array([0, 1, 1, 2]),                       // 0-1, 1-2
};
sdk.loadDataset(graph);
sdk.setNodeMetadata([
  { label: 'gateway', category: 'Ingress' },
  { label: 'auth', category: 'Service' },
  { label: 'db', category: 'Storage' },
]);

// hover 툴팁, 클릭 = 1-hop 이웃, 더블클릭 = 포커스, 드래그 / 휠 = 카메라
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });

sdk.setAutoSleep(true); // 배치가 안정되면 시뮬레이션 중지
sdk.warmup(40);         // 첫 프레임 전에 배치를 어느 정도 안정화
sdk.fitToView();

const tick = () => {
  if (!sdk.isSleeping()) {
    sdk.stepPhysics();
    sdk.render();
  }
  requestAnimationFrame(tick);
};
tick();
```

`detach()`(또는 `sdk.dispose()`)는 리스너와 툴팁을 제거합니다.

## 데이터 형식

`loadDataset(data: RawGraphData)`는 객체로 변환하지 않고 평탄한 TypedArray를 그대로 받습니다.

| 필드 | 타입 | 길이 | 설명 |
| --- | --- | --- | --- |
| `positions` | `Float32Array` | `3 * N` | `[x0, y0, z0, x1, y1, z1, ...]` 초기 좌표 |
| `masses` | `Float32Array` | `N` | 선택, 기본 `1.0` |
| `colors` | `Float32Array` | `4 * N` | 선택, `[0, 1]` 범위 RGBA |
| `clusters` | `Uint16Array` | `N` | 선택, 클러스터 ID |
| `edges` | `Uint32Array` | `2 * E` | 양 끝 인덱스 쌍 `[src0, dst0, src1, dst1, ...]` |
| `edgeWeights` | `Float32Array` | `E` | 선택, 기본 `1.0` |

노드 ID는 이 배열의 인덱스입니다. 데이터셋을 불러오면 캔버스의 차트는 사라집니다.

### 시드 합성 그래프

`loadDataset`을 호출하지 않으면 `Charturbo.create`가 아래 옵션으로 클러스터가 있는 무작위 그래프를 만듭니다. 빈 상태로 시작하려면 `nodeCount: 0, edgeCount: 0`을 넘기세요.

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `seed` | `number` | `42` | 난수 시드 |
| `nodeCount` | `number` | `1000` | 노드 수 |
| `edgeCount` | `number` | `2000` | 엣지 수 |
| `clusterCount` | `number` | `8` | 클러스터 수 |

나중에 `sdk.reloadSeededDataset(seed, nodeCount, edgeCount, clusterCount)`로 다시 만들 수 있습니다. `sdk.generateDefaultMetadata(prefix?)`는 모든 노드에 데모용 라벨·카테고리·태그·속성을 채웁니다(기본 prefix `'Service-Node'`).

## 옵션

### `enableNodeInteractions(canvas, options?)`

그래프와 3D 뷰에 적용되는 옵션입니다(`NodeInteractionOptions`. 차트 전용 옵션은 [상호작용](../guide/interactions)에서 다룹니다).

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `builtInTooltip` | `boolean` | `true` | hover 시 떠 있는 HTML 툴팁 |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` 또는 `document.body` | 툴팁을 붙일 위치 |
| `highlightNeighborsOnClick` | `number` | `1` | 클릭 시 강조할 hop 수. `0`이면 끔 |
| `focusOnDoubleClick` | `boolean` | `true` | 더블클릭 시 카메라를 노드로 이동 |
| `autoRender` | `boolean` | `false` | hover / 클릭 / 카메라 변경 시 `render()` 호출 |
| `formatTooltip` | `(details: NodeDetails) => string` | | 사용자 툴팁 HTML |
| `tooltipClassName` | `string` | | 추가 CSS 클래스 (기본 클래스 `charturbo-sdk-node-tooltip`) |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | | 기본 스타일 위에 병합할 인라인 스타일 |
| `touch` | `false \| TouchInteractionOptions` | 모두 켬 | 터치 / 펜: 드래그 회전, 핀치 줌, 두 손가락 드래그 팬, 탭 선택, 더블탭 포커스 |
| `cameraControls` | `false \| CameraControlOptions` | 모두 켬 | 마우스 카메라 조작, [카메라](#camera) 참고 |
| `onNodeHover` | `(details, pointer) => void` | | hover 노드가 바뀔 때 (없으면 `null`) |
| `onNodeClick` | `(details, event) => void` | | 노드 클릭 시. 빈 곳을 클릭하면 `null` |

### 힘 옵션

`setForceOptions(options: Partial<ForceOptions>)`는 현재 값에 병합합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `repulsionStrength` | `number` | `25.0` | 노드 간 반발력 |
| `springStiffness` | `number` | `0.08` | 엣지 스프링 강성 |
| `springRestLength` | `number` | `8.0` | 엣지 스프링 자연 길이 |
| `centerGravity` | `number` | `0.03` | 원점으로 당기는 힘 |
| `damping` | `number` | `0.88` | 단계마다 적용하는 속도 감쇠 |
| `theta` | `number` | `0.75` | Barnes-Hut opening angle (클수록 빠르고 덜 정확) |

## 힘 시뮬레이션

| 메서드 | 설명 |
| --- | --- |
| `stepPhysics(dt = 0.016)` | 동기 CPU 단계 1회. 운동 에너지를 반환 |
| `warmup(ticks = 60, dt = 0.016)` | 여러 단계를 한 번에 실행 |
| `setAutoSleep(enabled, sleepThreshold = 0.05)` | 고정되지 않은 노드당 평균 운동 에너지가 임계값보다 낮은 단계가 30번 연속되면 시뮬레이션을 멈춤. 기본은 꺼짐 |
| `isSleeping()` / `wakeUp()` | 정지 상태 확인 / 해제 |
| `exportPositions()` / `importPositions(positions)` | 배치를 평탄한 `Float32Array`로 저장 / 복원 |
| `pinNode(id, pinned)` | 노드를 제자리에 고정 |
| `moveNode(id, x, y, z)` | 노드 이동 |
| `setNodeStyle(id, { color?, mass?, clusterId? })` | 노드 하나의 색·질량·클러스터 변경 |

이 메서드들은 렌더링하지 않습니다. 호출 후 `render()`를 부르거나 `autoRender`를 쓰세요.

### GPU 상주 배치

WebGPU에서 `stepPhysicsAsync`는 배치를 GPU에 둡니다. 위치와 속도는 GPU 버퍼에 남고, GPU가 매 단계 Barnes-Hut 옥트리를 만들고 반발력·스프링·적분·자동 정지 판정을 적용합니다.

```ts
if (sdk.supportsGpuPhysics()) console.log('GPU 배치 사용 가능');

const loop = async () => {
  if (!sdk.isSleeping()) {
    await sdk.stepPhysicsAsync(0.016); // 제출 시점에 resolve
    sdk.render();
  }
  requestAnimationFrame(loop);
};
loop();

// 위치가 최신이어야 하는 선택·내보내기 전에
await sdk.syncPhysicsPositions();
const positions = sdk.exportPositions();
```

- `stepPhysicsAsync(dt)`는 단계를 제출하면 resolve하며, 가장 최근에 읽어 온 배치의 운동 에너지를 반환합니다. 렌더링은 하지 않습니다.
- CPU 사본(선택, `exportPositions`, 노드 상세, `isSleeping()`이 사용)은 GPU보다 한두 프레임 늦습니다. `await syncPhysicsPositions()`는 제출한 모든 단계를 CPU 사본에 반영합니다. CPU 물리에서는 아무 일도 하지 않습니다.
- CPU 편집(`moveNode`, `pinNode`, `setNodeStyle`, `loadDataset`, `stepPhysics`)은 호출 순서대로 적용됩니다. 편집한 노드만 업로드하고(전체 편집 후에는 배치 전체), 대기 중인 CPU 노드 편집이 GPU 상태보다 우선합니다.
- 다음 단계를 시작하기 전에 이전 단계를 await하세요. 대기 중에 다시 호출하면 `A physics step is already pending` 오류가 납니다.
- WebGL2와 이전 backend에서 `stepPhysicsAsync`는 CPU 물리로 대체됩니다. 동기 `stepPhysics()`는 항상 CPU입니다.
- 배치가 GPU에 상주하는 동안 절두체 컬링(`setFrustumCulling`)은 적용하지 않습니다.

::: warning 주의
GPU 상주 변경 이후 `stepPhysicsAsync`는 readback 이후가 아니라 제출 시점에 resolve하며, GPU 작업 중의 CPU 편집은 단계를 거부하지 않고 순서대로 적용됩니다. 최신 위치가 필요한 곳에서는 `syncPhysicsPositions()`를 await하세요.
:::

## 배치 프리셋

`applyLayout(mode, spaceRadius = 85)`는 모든 노드를 즉시 배치합니다.

| `mode` | 배치 |
| --- | --- |
| `'cluster-sphere'` | 클러스터를 구 위에 묶어 배치 |
| `'radial-shells'` | 동심 껍질 |
| `'helix'` | 나선 |
| `'grid-3d'` | 3D 격자 |

프리셋은 정적입니다. 시뮬레이션으로 다시 넘기려면 `wakeUp()`을 호출하고 `stepPhysics()`를 계속 호출하세요.

```ts
sdk.applyLayout('cluster-sphere', 85);
sdk.fitToView();
sdk.render();
```

## 노드 메타데이터와 툴팁

```ts
sdk.setSingleNodeMetadata(0, {
  label: 'API-Gateway-01',
  category: 'Ingress',
  description: '서울 리전 메인 게이트웨이',
  tags: ['critical'],
  attributes: { latencyMs: 1.8, rps: 4200, status: 'Healthy' },
});
```

- `setNodeMetadata(metadata)`는 메타데이터 전체를 교체합니다. 노드 ID를 인덱스로 하는 배열, `Map<number, NodeMetadata>`, `Record<number, NodeMetadata>`를 받습니다.
- `setSingleNodeMetadata(id, metadata)`는 노드 하나에 병합합니다. `getNodeMetadata(id)`는 그 값을 반환하며, 없으면 `{ label: 'Node #<id>' }`를 반환합니다.
- `NodeMetadata`: `label`, `category`, `description`, `tags: string[]`, `attributes: Record<string, string | number | boolean>`.

`getNodeDetails(id)`는 `NodeDetails`를 반환합니다(`onNodeHover`, `onNodeClick`, `formatTooltip`에도 전달됨).

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | `number` | 노드 ID |
| `label` | `string` | 메타데이터 라벨 또는 `Node #<id>` |
| `position` | `[x, y, z]` | 현재 위치 |
| `mass` | `number` | 질량 |
| `clusterId` | `number` | 클러스터 |
| `color` | `RgbaTuple` | 색 |
| `degree` | `number` | 연결된 엣지 수 |
| `selected` / `pinned` | `boolean` | 상태 플래그 |
| `neighbors` | `number[]` | 인접 노드 ID |
| `metadata` | `NodeMetadata` | 메타데이터. `category` 기본값은 `Cluster <id>` |

### 기본 툴팁

내장 툴팁은 라벨과 `#id`, 카테고리와 클러스터, 연결 차수, 이웃 수, 좌표, 태그, 속성(최대 6개)을 테마 텍스트 색으로 보여 줍니다. 데이터에서 온 문자열(라벨, 카테고리, 태그, 속성 키와 값)은 모두 HTML 이스케이프되므로 `<img onerror=…>` 같은 라벨도 텍스트로 표시됩니다. 고정 문구는 SDK / 차트 로캘을 따르고([다국어 지원](../guide/i18n) 참고), 숫자는 그 로캘 형식을 씁니다.

`setNodeHoverStyle({ enabled?, scale?, color? })`는 hover 표시를 바꿉니다. 기본은 hover한 노드를 1.6배 키우고 자기 색을 밝게 합니다.

### 사용자 툴팁

`formatTooltip`이 반환한 HTML은 그대로 `innerHTML`에 들어갑니다. 데이터 문자열은 내보낸 `escapeHtml`로 감싸세요.

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  formatTooltip: (d) =>
    `<b>${escapeHtml(d.label)}</b><div>${escapeHtml(d.metadata.category ?? '')} · ${d.degree} links</div>`,
});
```

## 선택 · 경로 · 검색

| 메서드 | 반환 | 설명 |
| --- | --- | --- |
| `highlightNeighbors(id, hops = 1)` | `Uint32Array` | 노드와 `hops`까지의 이웃을 선택 (`0` = 노드만) |
| `highlightShortestPath(start, end)` | `Uint32Array` | 무방향 BFS 최단 경로를 강조. 연결되지 않으면 빈 배열 |
| `selectCluster(clusterId)` | `Uint32Array` | 클러스터 선택 |
| `boxSelect(minX, minY, maxX, maxY)` | `Uint32Array` | NDC 사각형 안의 노드 |
| `queryRadius(x, y, z, radius, maxResults = 100)` | `Uint32Array` | 구 안의 노드 |
| `pickNodeAtNdc(ndcX, ndcY)` | `number \| null` | NDC 지점 아래의 노드 |
| `clearSelection()` | | 선택 해제 |
| `searchNodes(query, limit = 25)` | `NodeDetails[]` | 숫자 ID(`42` 또는 `#42`)를 먼저 찾고, 이어서 라벨·카테고리·설명·태그를 대소문자 구분 없이 부분 일치로 찾음 |
| `projectNodeToScreen(id, w, h)` | `{ x, y, ndcZ } \| null` | 캔버스 픽셀 위치. 카메라 뒤면 `null` |
| `projectNodesToScreen(ids, w, h)` | `Float32Array` | WebAssembly 호출 한 번으로 `[x0, y0, x1, y1, ...]`. 카메라 뒤면 `NaN` |

```ts
const path = sdk.highlightShortestPath(0, 1999);
console.log(`${path.length - 1} hops`);

for (const node of sdk.searchNodes('vector db', 4)) {
  sdk.focusNode(node.id);
  sdk.highlightNeighbors(node.id, 1);
}
sdk.render();
```

## 카메라 {#camera}

내장 카메라 조작(`cameraControls`)은 2D 차트가 표시되지 않은 그래프, 포인트 클라우드, 3D 장면 뷰에 적용됩니다.

| 입력 | 동작 |
| --- | --- |
| 왼쪽 드래그 | 궤도 회전 |
| Shift + 드래그, 오른쪽 드래그, 가운데 드래그 | 팬 (포인터 아래 내용이 따라옴) |
| 휠 | 현재 거리에 비례한 줌. 페이지는 스크롤되지 않음 |
| 더블클릭 | 노드로 포커스 (`focusOnDoubleClick`) |

- 드래그 중에는 포인터를 캡처하므로 캔버스 밖에서 놓아도 드래그가 끝납니다. 누른 위치에서 5 px 이내에서 놓으면 클릭으로 처리합니다.
- `{ orbit: false }`는 왼쪽 드래그를 팬으로 바꿉니다(2D식 탐색). `{ pan: false }` / `{ zoom: false }`는 해당 동작만 끕니다. `cameraControls: false`는 내장 카메라 이동을 모두 끕니다(카메라를 직접 다루는 호스트용). 같은 스위치가 터치 제스처에도 적용됩니다.
- 오른쪽 드래그 팬을 위해 그래프 뷰에서는 캔버스 컨텍스트 메뉴가 열리지 않습니다.
- 자체 포인터 핸들러가 있는 호스트는 `sdk.handlesCameraControls()`가 `true`인 동안 카메라 처리를 건너뛰면 됩니다.

```ts
sdk.fitToView();                      // 현재 방향에서 모든 노드를 화면에 맞춤 (여백 10 %)
sdk.focusNode(42);                    // 노드로 이동하고 개요 거리의 40 %까지 접근
sdk.focusNode(42, { distance: 60 });  // 거리 지정 (`false` = 거리 유지)
const cam = sdk.getCameraState();     // { projection, target, eye, distance, yaw, pitch, fovY, aspect } | null
sdk.setCameraPose([0, 50, 160], [0, 0, 0]); // eye, target
```

- `fitToView()`는 가로·세로 FOV 중 더 빡빡한 쪽 기준으로 모든 노드가 화면을 채우는 거리를 정하므로 넓은 캔버스도 꽉 찹니다. `focusNode`가 쓰는 개요 거리도 이때 정해집니다.
- `focusNode`와 더블클릭 포커스는 대상을 옮기고 개요 거리(마지막 `fitToView` / `setCameraPose`)의 40 %까지 다가갑니다. 현재보다 멀어지지는 않습니다. 이동은 즉시 일어납니다. 알 수 없는 ID면 `false`를 반환합니다.
- 코드로 조작: `rotateCamera(deltaYaw, deltaPitch)`, `panCamera(deltaRight, deltaUp)`, `zoomCamera(delta)`.

## 참고

- 절두체 컬링은 기본으로 꺼져 있습니다. `setFrustumCulling(true)`는 CPU 배치에서 컬링을 켭니다.
- `getCameraState()`, 거리 기반 줌 / 팬, 포커스 거리는 엔진의 `camera_state` 바인딩이 필요합니다. 없는 빌드에서는 각각 `null` 반환, 고정 이득, 대상만 이동으로 동작합니다.
- `setGraphVisible(false)`는 그래프를 숨기고 그 시뮬레이션도 멈춥니다. 캔버스에 [3D 장면](./scene-3d)만 표시할 때 사용합니다.

## 함께 보기

- [임베딩 · 유사도](./embeddings)
- [3D 장면 · 물리](./scene-3d)
- [툴팁과 hover](../guide/tooltips)
- [성능](../guide/performance)
