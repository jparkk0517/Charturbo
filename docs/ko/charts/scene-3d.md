# 3D 장면 · 물리

같은 캔버스에 차트와 그래프 말고도 Three.js 스타일의 작은 3D 장면을 담을 수 있습니다. 기본 도형과 사용자 삼각형 메시에 트랜스폼, 부모-자식 관계, 조명, PBR 스타일 재질, 강체 물리, 광선 선택을 지원합니다. 공간 뷰, 간단한 시뮬레이션, 그래프 주변의 3D 맥락 표현에 사용합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scene.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.setGraphVisible(false);                // 장면만 표시
sdk.setRigidPhysics(true, [0, -40, 0]);    // 중력
sdk.setHelpers({ showGrid: true });

sdk.addPlane({ position: [0, -1, 0], scale: [160, 2, 160] });
sdk.addBox({ position: [0, 40, 0], scale: [10, 10, 10], bodyType: 'dynamic' });
sdk.addSphere({ position: [5, 70, 0], scale: [8, 8, 8], bodyType: 'dynamic', metallic: 0.6 });
sdk.setCameraPose([0, 55, 115], [0, 10, 0]); // eye, target

// 궤도 회전 / 팬 / 줌. 그래프 노드가 없으므로 노드 툴팁은 끔
const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

const tick = () => {
  sdk.stepPhysics(1 / 60); // 강체(그래프가 보이면 그래프 배치도)를 진행
  sdk.render();
  requestAnimationFrame(tick);
};
tick();
```

모든 `add*` 메서드는 새 객체의 숫자 ID를 반환합니다.

## 객체

| 메서드 | 설명 |
| --- | --- |
| `addBox(desc?)` | 상자 |
| `addSphere(desc?)` | 구 |
| `addCylinder(desc?)` | 원기둥 |
| `addPlane(desc?)` | 얇은 판. 기본 `scale: [200, 2, 200]`, `color: [0.16, 0.21, 0.31, 1]` |
| `addPrimitive(desc)` | `shape: 'box' \| 'sphere' \| 'plane' \| 'cylinder'`로 위 도형 중 하나 |
| `addCustomMesh(desc)` | 인덱스 삼각형 메시 |

기본 도형은 단위 크기이므로 `scale`이 곧 월드 단위의 객체 크기입니다.

### 기본 도형 옵션 (`PrimitiveObjectDescriptor`)

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `name` | `string` | `'<SHAPE>_<id>'` | 객체 레코드에 저장되는 이름 |
| `shape` | `PrimitiveShape` | | `addPrimitive`에서만 필수 |
| `position` | `[x, y, z]` | `[0, 0, 0]` | 위치 |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | 오일러 각, 라디안 |
| `scale` | `[x, y, z]` | `[10, 10, 10]` | 크기 |
| `color` | `RgbaTuple` | `[0.35, 0.68, 0.98, 1]` | `[0, 1]` 범위 RGBA |
| `metallic` | `number` | `0.15` | 금속성 |
| `roughness` | `number` | `0.45` | 거칠기 |
| `emissive` | `number` | `0` | 자체 발광 |
| `bodyType` | `'static' \| 'dynamic' \| 'kinematic'` | `'static'` | 강체 종류 |
| `velocity` | `[x, y, z]` | `[0, 0, 0]` | 초기 선속도 |
| `angularVelocity` | `[wx, wy, wz]` | `[0, 0, 0]` | 초기 월드 공간 회전 속도, 초당 라디안 |
| `mass` | `number` | `max(0.2, abs(sx × sy × sz) × 0.01)` | 질량 |
| `restitution` | `number` | `0.55` | 반발 계수 |
| `parentId` | `number \| null` | `null` | 계층 트랜스폼의 부모 객체 |

### 사용자 메시 (`CustomMeshObjectDescriptor`)

```ts
const torus = sdk.addCustomMesh({
  name: 'torus',
  ...Charturbo.createTorusMesh(8, 2.6, 24, 48), // { positions, normals, indices }
  position: [0, 40, -10],
  color: [0.62, 0.5, 0.92, 1],
  metallic: 0.8,
  roughness: 0.2,
});
```

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `positions` | `Float32Array \| number[]` | (필수) | `[x0, y0, z0, ...]` 꼭짓점 위치 |
| `normals` | `Float32Array \| number[]` | | 꼭짓점 법선 |
| `indices` | `Uint32Array \| number[]` | (필수) | 삼각형 꼭짓점 인덱스 |
| `scale` | `[x, y, z]` | `[1, 1, 1]` | 배율 |
| `color` | `RgbaTuple` | `[0.85, 0.45, 0.95, 1]` | RGBA |
| `metallic` / `roughness` | `number` | `0.35` / `0.3` | 재질 |
| `mass` / `restitution` | `number` | `2.0` / `0.6` | 물리 |

나머지 필드(`name` 기본 `'MESH_<id>'`, `position`, `rotation`, `emissive`, `bodyType`, `velocity`, `angularVelocity`, `parentId`)는 기본 도형과 같습니다. `Charturbo.createTorusMesh(majorRadius = 8, minorRadius = 2.6, radialSegments = 18, tubularSegments = 32)`는 테스트용 메시를 만듭니다.

### 객체 편집

| 메서드 | 반환 | 설명 |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | 트랜스폼 일부 갱신 |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | 물리로 움직인 결과를 포함한 현재 트랜스폼 |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive? })` | `boolean` | 재질 일부 갱신 |
| `setObjectPhysics(id, { bodyType?, velocity?, angularVelocity?, mass?, restitution? })` | `boolean` | 물리 속성 일부 갱신 |
| `setObjectParent(id, parentId \| null)` | `boolean` | 부모에 연결 / 분리 |
| `removeObject(id)` | `boolean` | 객체 하나 제거 |
| `clearScene()` | | 모든 객체와 현재 차트 제거 |
| `objectCount()` | `number` | 객체 수 |
| `getObjects()` / `getObjectRecord(id)` | `SceneObjectRecord[]` / `SceneObjectRecord \| null` | 현재 트랜스폼을 포함한 전체 레코드 |

ID를 받는 메서드는 알 수 없는 ID에 `false`(또는 `null`)를 반환합니다.

## 조명과 보조 표시

```ts
sdk.setLighting({ ambientIntensity: 0.3, directionalIntensity: 1, pointPosition: [0, 45, 25] });
sdk.setHelpers({ showGrid: true, gridSize: 160, gridDivisions: 16, showAxes: true });
```

`setLighting`과 `setHelpers`는 현재 값에 병합합니다. `getLighting()` / `getHelpers()`는 전체 설정을 반환합니다.

| 조명 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `ambientIntensity` | `number` | `0.32` |
| `directionalDirection` | `[x, y, z]` | `[0.45, 0.85, 0.55]` |
| `directionalIntensity` | `number` | `0.95` |
| `pointPosition` | `[x, y, z]` | `[0, 45, 25]` |
| `pointIntensity` | `number` | `0.65` |

| 보조 표시 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `showGrid` | `boolean` | `false` |
| `gridSize` | `number` | `200` |
| `gridDivisions` | `number` | `20` |
| `showAxes` | `boolean` | `false` |
| `axesLength` | `number` | `60` |

## 강체 물리

`setRigidPhysics(enabled, gravity?)`는 시뮬레이션을 켜거나 끕니다. 기본은 켜져 있고 중력은 `[0, -40, 0]`입니다. `getRigidPhysics()`는 `{ enabled, gravity }`를 반환합니다.

- `stepPhysics(dt)`가 장면을 진행합니다. `dt`는 0.001..0.05초로 제한하고 최대 1/120초의 하위 단계로 나눕니다. 운동 에너지를 반환합니다.
- `'dynamic'` 강체는 중력을 받아 떨어지고 다른 모든 강체와 충돌합니다. `'kinematic'` 강체는 중력 없이 자기 `velocity`와 `angularVelocity`로 움직입니다. `'static'` 강체는 움직이지 않습니다.
- 중심에서 벗어난 충돌은 회전을 만들고, 마찰 때문에 구가 굴러갑니다. 상자는 방향이 있는 접촉 매니폴드를 쓰고, 원기둥은 상자로 충돌하며, 사용자 메시는 경계 상자를 씁니다.
- 자식 객체(`parentId`)는 부모를 따라가며 따로 시뮬레이션하지 않습니다.

## 선택

```ts
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: false,
  focusOnDoubleClick: false,
  onNodeClick: (_node, e) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const hit = sdk.raycastObjectAtNdc(ndcX, ndcY); // { objectId, point } | null
    sdk.selectObject(hit?.objectId ?? null);         // 맞은 객체에 외곽선 표시
  },
});
```

- `raycastObjectAtNdc(ndcX, ndcY)`는 가장 가까이 맞은 객체와 월드 공간 교차점을 반환합니다. 구와 평면은 해석적으로, 상자와 원기둥은 상자로, 사용자 메시는 경계 상자 검사 후 삼각형 단위로 교차를 계산합니다.
- `pickObjectAtNdc(ndcX, ndcY)`는 객체 ID만 반환합니다(없으면 `null`).
- `selectObject(id | null)`는 객체를 강조합니다(큰 정적 평면은 외곽선만 표시).

## 저장과 불러오기

`exportScene()`은 직렬화할 수 있는 `SceneDescriptor`(트랜스폼·재질·물리를 포함한 객체, 조명, 보조 표시, 강체 물리, 그래프 표시 여부)를 반환합니다. `loadScene(descriptor)`는 장면을 비우고 설정을 적용한 뒤 객체를 다시 만들고, 새 ID 목록을 반환합니다.

```ts
sdk.loadScene({
  lighting: { ambientIntensity: 0.3, directionalDirection: [0.4, 0.9, 0.5], directionalIntensity: 1, pointIntensity: 0.5 },
  helpers: { showGrid: true, gridSize: 160, gridDivisions: 16 },
  rigidPhysics: { enabled: true, gravity: [0, -40, 0] },
  graphVisible: false,
  objects: [
    { kind: 'primitive', name: 'floor', shape: 'plane', position: [0, -1, 0], scale: [160, 2, 160], roughness: 0.9 },
    { kind: 'primitive', name: 'step', shape: 'box', position: [-25, 5, 0], scale: [30, 10, 30] },
  ],
});

const saved = JSON.stringify(sdk.exportScene());
```

## 카메라

장면은 [3D 그래프](./graph-3d#camera)와 같은 orbit 카메라를 씁니다. 마우스·터치 조작, `setCameraPose(eye, target)`, `rotateCamera`, `panCamera`, `zoomCamera`, `getCameraState()`를 그대로 사용할 수 있습니다. 1인칭 이동에는 `moveCameraLocal(forward, right, up)`과 `rotateCameraLook(deltaYaw, deltaPitch)`를 사용하세요.

## 참고

- `nodeCount: 0, edgeCount: 0`을 넘기지 않으면 `Charturbo.create`가 노드 1000개짜리 그래프를 만듭니다. 캔버스에 장면만 보여 줄 때는 `setGraphVisible(false)`를 호출하세요. 그래프와 장면을 한 캔버스에 함께 표시할 수도 있습니다.
- 차트를 렌더링하면(`render*Chart`) 캔버스가 차트 모드가 되며, 내장 카메라 조작은 차트가 없을 때만 적용됩니다.

## 함께 보기

- [3D 네트워크 그래프](./graph-3d)
- [상호작용](../guide/interactions)
- [성능](../guide/performance)
