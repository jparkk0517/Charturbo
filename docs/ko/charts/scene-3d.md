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
| `map` / `mapRepeat` / `mapOffset` / `alphaTest` | | | 텍스처 매핑, [텍스처](#텍스처) 참고 |
| `castShadow` / `receiveShadow` | `boolean` | `true` | 그림자 참여 여부, [그림자](#그림자) 참고 |

### 사용자 메시 (`CustomMeshObjectDescriptor`)

```ts
const torus = sdk.addCustomMesh({
  name: 'torus',
  ...Charturbo.createTorusMesh(8, 2.6, 24, 48), // { positions, normals, uvs, indices }
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
| `uvs` | `Float32Array \| number[]` | | `[u0, v0, ...]` 텍스처 좌표, 꼭짓점당 2개([텍스처](#텍스처) 참고) |
| `scale` | `[x, y, z]` | `[1, 1, 1]` | 배율 |
| `color` | `RgbaTuple` | `[0.85, 0.45, 0.95, 1]` | RGBA |
| `metallic` / `roughness` | `number` | `0.35` / `0.3` | 재질 |
| `mass` / `restitution` | `number` | `2.0` / `0.6` | 물리 |
| `map` / `mapRepeat` / `mapOffset` / `alphaTest` | | | 텍스처 매핑, [텍스처](#텍스처) 참고 |
| `castShadow` / `receiveShadow` | `boolean` | `true` | 그림자 참여 여부, [그림자](#그림자) 참고 |

나머지 필드(`name` 기본 `'MESH_<id>'`, `position`, `rotation`, `emissive`, `bodyType`, `velocity`, `angularVelocity`, `parentId`)는 기본 도형과 같습니다. `Charturbo.createTorusMesh(majorRadius = 8, minorRadius = 2.6, radialSegments = 18, tubularSegments = 32)`는 테스트용 메시를 만듭니다.

### 텍스처

```ts
const wood = await sdk.loadTexture('/img/wood.jpg');            // 가져오기 + 디코딩
const checker = sdk.createDataTexture(2, 2, new Uint8Array([    // RGBA8 원시 텍셀
  255, 255, 255, 255,  60, 60, 60, 255,
   60, 60, 60, 255,  255, 255, 255, 255,
]));

const crate = sdk.addBox({ map: wood, mapRepeat: [2, 2] });
sdk.addPlane({ map: checker, mapRepeat: [16, 16] });
sdk.setObjectMaterial(crate, { map: null });                     // 단색으로 되돌리기
sdk.disposeTexture(wood);
```

| 메서드 | 반환 | 설명 |
| --- | --- | --- |
| `loadTexture(source, { mipmaps?, signal? })` | `Promise<number>` | 이미지를 디코딩해 업로드하고 텍스처 ID로 이행합니다. `source`는 URL 문자열, `URL`, `Blob`, `ImageBitmap`, `HTMLImageElement`, `HTMLCanvasElement`, `OffscreenCanvas`, `ImageData` |
| `createDataTexture(width, height, rgba, { mipmaps? })` | `number` | RGBA8 원시 텍셀을 업로드합니다(스트레이트 알파, 첫 행이 위). `rgba.length`는 `width × height × 4`여야 합니다 |
| `disposeTexture(id)` | `boolean` | 텍스처를 해제합니다. 쓰던 객체는 텍스처 없이 그려집니다 |
| `getTextures()` | `TextureRecord[]` | 이 SDK로 만든 텍스처의 `{ id, width, height, src }`(`src`는 문자열 / `URL` 소스만) |
| `maxTextureSize` | `number` | 텍스처 한 변의 최대 텍셀 수(최대 4096). 엔진이 텍스처를 지원하지 않으면 `0` |

매핑 필드는 `addBox` / `addSphere` / `addCylinder` / `addPlane` / `addPrimitive` / `addCustomMesh`와 `setObjectMaterial`에서 쓸 수 있습니다.

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `map` | `number \| null` | `null` | 텍스처 ID. `null`(또는 `0`)이면 텍스처를 제거합니다 |
| `mapRepeat` | `[u, v]` | `[1, 1]` | 타일링. 텍스처는 반복됩니다 |
| `mapOffset` | `[u, v]` | `[0, 0]` | UV 오프셋 |
| `alphaTest` | `number` | 맵이 있으면 `0.5`, 없으면 `0` | 알파(텍스처 알파 × 색상 알파)가 이 값보다 작은 프래그먼트를 버립니다(컷아웃용) |
| `uvs` | `Float32Array \| number[]` | | 사용자 메시 전용. 꼭짓점당 `u, v` 두 값. 없으면 가장 긴 두 축으로 평면 투영합니다 |

- **UV 규칙.** `u`는 왼쪽에서 오른쪽, `v`는 위에서 아래로 증가합니다(`v = 0`이 이미지의 맨 윗줄). 이미지를 뒤집을 필요가 없습니다. 상자와 평면은 모든 면에 이미지 전체를 보여 주고, 구는 한 바퀴 감싸며, 원기둥은 옆면을 감싸고 뚜껑에는 평면 투영합니다. `createTorusMesh`는 `uvs`를 함께 반환합니다(`addCustomMesh`에 펼쳐 넣으세요).
- **색상.** 텍스처에 `color`가 곱해지므로 기본 흰색은 이미지를 그대로, 다른 색은 색조를 입힙니다. 조명, metallic, roughness는 그대로 적용됩니다. 투명도는 여전히 `color[3]`를 따르고 텍스처 알파는 컷아웃(`alphaTest`)용입니다. 맵이 있으면 알파가 `alphaTest`(기본 0.5)보다 작은 프래그먼트가 버려지므로, `color[3] < 0.5`인 텍스처 객체에는 `alphaTest: 0`을 지정하세요.
- **색 공간.** 텍스처는 렌더러의 감마 공간에서 RGBA8 그대로 샘플링되고 밉 레벨도 그 공간에서 평균하므로, 축소된 텍스처는 선형 광 필터링보다 아주 조금 어둡게 보입니다.
- **한도.** `maxTextureSize`보다 큰 이미지는 비율을 유지해 축소하며, `ImageData`와 `createDataTexture` 데이터는 한도 안에 들어와야 합니다. 엔진당 텍스처 총량은 256 MiB입니다(`texture memory budget exceeded`). 텍스처 ID는 재사용되지 않습니다.
- **오류.** 오염된 이미지(CORS 없는 교차 출처)는 `loadTexture: cross-origin image`로, 중단된 `signal`은 `AbortError`로 거부되며, 텍스처 지원 없이 빌드된 엔진은 `... engine has no texture support`를 던집니다.
- GPU 장치 손실은 복구하지 않습니다. 페이지를 다시 불러오거나 SDK와 텍스처를 다시 만드세요. 선택, 물리, SVG 내보내기, 차트는 텍스처의 영향을 받지 않습니다.

### glTF 모델

```ts
const house = await sdk.loadGltf('/models/house.glb', { rotation: [0, Math.PI / 4, 0], scale: 10 });
console.log(house.objects, house.bounds);   // 객체 ID, 월드 공간 경계
sdk.disposeGltf(house);                      // 객체와 텍스처 제거
```

| 메서드 | 반환 | 설명 |
| --- | --- | --- |
| `loadGltf(source, options?)` | `Promise<GltfLoadResult>` | glTF 2.0 모델(`.gltf` 또는 `.glb`)을 불러옵니다. `source`는 URL 문자열, `URL`, `ArrayBuffer`, `Uint8Array`, `Blob` |
| `disposeGltf(result)` | | 불러오면서 만든 객체와 텍스처를 모두 제거합니다 |

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `position` | `[x, y, z]` | `[0, 0, 0]` | 만든 메시 전체의 객체 위치. 모델 원점이 이 위치에 놓입니다 |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | 객체 회전(라디안 오일러 각, 기본 도형과 같음) |
| `scale` | `number \| [x, y, z]` | `1` | 꼭짓점에 구워 넣습니다(glTF 단위는 미터) |
| `scene` | `number` | 파일의 `scene`, 없으면 `0` | 장면 인덱스 |
| `baseUrl` | `string` | 소스 URL, 없으면 페이지 URL | 상대 버퍼 · 이미지 URI의 기준 |
| `signal` | `AbortSignal` | | 가져오기와 디코딩을 중단합니다. 프로미스는 `AbortError`로 거부됩니다 |

결과는 `{ objects, textures, nodes, bounds }`입니다. `nodes`는 장면의 노드를 깊이 우선 순서의 `{ index, name, objectIds }`로 나열하고, `bounds`는 월드 공간의 `{ min, max }`입니다. 메시 프리미티브 하나가 사용자 메시 객체 하나가 되며, 이름은 노드(또는 메시) 이름이고 메시에 프리미티브가 여럿이면 `#<n>`이 붙습니다.

- **지원.** 외부 또는 `data:` 버퍼 · 이미지를 쓰는 `.gltf`, 바이너리 청크가 있는 `.glb`. 인터리브(`byteStride`), 정규화, 희소(sparse), 버퍼 뷰 없는 접근자를 포함한 모든 접근자 타입. 삼각형, 삼각형 스트립 · 팬(점과 선은 경고 후 건너뜀). 노드 계층(TRS 또는 `matrix`)은 꼭짓점에 구워 넣으며, 법선은 역전치 행렬로 변환하고 거울상 노드는 감기 순서를 뒤집습니다. 법선이 없으면 부드러운 법선을 계산합니다. 확장 `KHR_texture_transform`, `KHR_mesh_quantization`, `KHR_materials_emissive_strength`.
- **재질.** `baseColorFactor`는 선형에서 렌더러의 감마 공간으로 변환합니다. `baseColorTexture`는 `map`이 되고(`TEXCOORD_0`만, `KHR_texture_transform`의 offset과 scale은 `mapOffset` / `mapRepeat`), `metallicFactor`와 `roughnessFactor`는 glTF처럼 기본 1입니다. `emissiveFactor`(× 발광 강도)는 `emissiveColor`가 되고, 그 가장 큰 성분은 클래식 셰이딩용 `emissive`가 됩니다. 금속성-거칠기 · 법선 · 차폐 · 발광 텍스처는 [재질 맵](#material-maps)이 됩니다(`TEXCOORD_0`만, 한 재질의 텍스처는 uv 변환 하나를 공유하며 나머지는 경고 후 무시). `alphaMode: 'MASK'`는 `alphaTest`를 `alphaCutoff`(기본 0.5)로, `'BLEND'`는 색상 알파를 유지하고, `'OPAQUE'`는 색상 알파를 1로 고정합니다. 여러 재질이 쓰는 이미지는 한 번만 디코딩합니다.
- **무시.** 샘플러(텍스처는 항상 반복 · 선형 필터링). 경고와 함께 무시: 텍스처 변환 회전, `TEXCOORD_1` 이상의 텍스처, 스킨(바인드 포즈로 그림), 모프 타깃, 애니메이션, 카메라, 그 밖의 확장. `extensionsRequired`에 지원하지 않는 확장이 있으면 `loadGltf: extension X is required but not supported`로 거부합니다.
- **한도.** 한 번에 불러오는 모델은 꼭짓점 `GLTF_MAX_VERTICES`(8,388,608)개, 인덱스 `GLTF_MAX_INDICES`(67,108,864)개까지입니다. 모든 객체가 지오메트리 버퍼 하나를 공유하므로 큰 모델 여러 개는 GPU 버퍼 한도를 넘을 수 있습니다. 텍스처는 위의 텍스처 한도를 따릅니다.
- **오류.** 오류 메시지는 `loadGltf:`로 시작합니다. 중단을 포함해 실패하면 그때까지 만든 객체와 텍스처를 제거합니다.
- 한 모델의 객체는 모두 모델 원점을 피벗으로 쓰므로, `result.objects`의 각 객체에 같은 `position` / `rotation`으로 `setObjectTransform`을 적용하면 모델 전체가 움직입니다.

### 객체 편집

| 메서드 | 반환 | 설명 |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | 트랜스폼 일부 갱신 |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | 물리로 움직인 결과를 포함한 현재 트랜스폼 |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive?, map?, mapRepeat?, mapOffset?, alphaTest?, ...material maps })` | `boolean` | 재질 일부 갱신 |
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

## 물리 기반 셰이딩

장면 메시는 기본적으로 기존 Blinn-Phong(classic) 모습으로 그려집니다. `setShading({ model: 'pbr' })`로 선택형 물리 기반 셰이딩으로 바꿀 수 있습니다(차트 · 과학 3D · 3D 그래프는 바뀌지 않습니다).

```ts
const sky = await sdk.loadTexture('/env/sky-equirect.jpg'); // 2:1 등장방형, 밉맵 포함
sdk.setShading({
  model: 'pbr',
  toneMapping: 'aces',
  exposure: 1.2,
  environment: { map: sky, intensity: 1 },
});
sdk.addSphere({ position: [0, 10, 0], scale: [20, 20, 20], color: [1, 0.78, 0.35, 1], metallic: 1, roughness: 0.2 });
```

- 금속성-거칠기 모델: GGX 분포, 높이 상관 Smith 가시성, `F0 = mix(0.04, color, metallic)`인 Schlick 프레넬, Lambert 확산 항을 씁니다. `roughness`는 최소 0.045로 제한됩니다. `setLighting`의 방향광 · 점광원과 `emissive`는 그대로 적용되며, `ambientIntensity`는 classic 전용입니다(PBR의 주변광은 환경에서 옵니다).
- 색은 다른 곳과 마찬가지로 sRGB입니다. 셰이더가 색과 텍스처를 선형으로 디코딩해 선형 공간에서 조명하고, `exposure`를 곱한 뒤 톤 매핑(`'aces'` · `'reinhard'` · `'none'`)하여 다시 sRGB로 인코딩합니다.
- 환경: `map`이 없으면 하늘 / 땅 반구(`sky` · `ground`, 0..1 범위 sRGB `[r, g, b]`)가 장면을 비춥니다. `map`(`loadTexture` / `createDataTexture`의 등장방형 텍스처 ID, 맨 윗줄 = 위, 가운데 열이 −z 방향)이 있으면 정반사는 거칠기에 따라 커지는 밉 레벨을, 확산광은 흐린 밉을 샘플링하며, 사전 필터링 맵 대신 해석적 split-sum 근사를 씁니다. 기본값 `mipmaps: true`를 유지하세요. HDR 맵은 사전 필터링됩니다([HDR 환경 맵](#hdr-environment-maps) 참고). 모르거나 해제된 ID는 반구로 대체되고, `disposeTexture`는 이 참조를 지웁니다.
- `setShading`은 현재 설정에 병합되며 잘못된 값이면 `setShading: ...`을 던집니다. `getShading()`은 사본을 반환합니다. `exportScene()`은 설정을 `shading`에(환경 텍스처는 `textures`에) 저장하고, `loadScene`이 이를 복원하며 `loadSceneWithTextures`는 환경 텍스처 ID를 다시 매핑합니다.
- PBR 파이프라인은 처음 쓸 때 컴파일됩니다. WebGPU와 WebGL2를 모두 지원합니다.

| 셰이딩 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `model` | `'classic' \| 'pbr'` | `'classic'` |
| `toneMapping` | `'aces' \| 'reinhard' \| 'none'` | `'aces'` |
| `exposure` | `number` (0..16) | `1` |
| `environment.sky` | `[r, g, b]` | `[0.6, 0.66, 0.76]` |
| `environment.ground` | `[r, g, b]` | `[0.24, 0.22, 0.2]` |
| `environment.intensity` | `number` (0..16) | `1` |
| `environment.map` | `number \| null` | `null` |
| `environment.rotation` | `number` (+y 축 기준 라디안) | `0` |

### HDR 환경 맵 {#hdr-environment-maps}

HDR 환경은 실제 복사휘도로 PBR 메시를 비춥니다. 값이 50인 태양은 1에서 잘리지 않고 매끈한 금속 위에 선명하고 밝은 하이라이트로 남습니다.

```ts
const studio = await sdk.loadEnvironmentHdr('/env/studio.hdr'); // Radiance RGBE, 평면 또는 RLE
sdk.setShading({ model: 'pbr', exposure: 0.8, environment: { map: studio, rotation: Math.PI / 2 } });

// 선형 float로도 만들 수 있습니다: width * height * 3, 맨 윗줄 = 위
const env = sdk.createEnvironmentFromFloat(256, 128, rgb);
```

- `loadEnvironmentHdr(source, { signal })`는 Radiance `.hdr` 파일(`#?RADIANCE` / `#?RGBE`, `FORMAT=32-bit_rle_rgbe`, `-Y h +X w` 또는 `+Y h +X w`)을 담은 URL 문자열 · `URL` · `Blob` · `ArrayBuffer` · 타입 배열을 받습니다. `createEnvironmentFromFloat(width, height, rgb)`는 선형 RGB float를 받습니다. 둘 다 `environment.map`에 쓸 텍스처 ID를 반환하고 최대 4096x2048까지 받습니다. 오류 메시지에는 메서드 이름이 앞에 붙고, 중단된 `signal`은 `AbortError`로 거부됩니다.
- 생성할 때 등장방형 이미지를 최대 너비 1024 텍셀로 줄여 `Rgba16Float`로 저장하고 GPU에서 한 번 사전 필터링합니다. `n`개 밉 중 `i`번째에는 거칠기 `i / (n - 1)`의 GGX 컨볼루션이 들어가므로(텍셀당 중요도 샘플 128개, 가장 작은 밉은 높이 8 텍셀) 거친 반사가 BRDF대로 흐려집니다. 확산광은 맵을 계수 9개짜리 구면 조화 함수로 투영해 계산합니다. 1보다 큰 값은 `exposure`와 톤 매핑까지 유지됩니다(65504를 넘는 값은 잘리고, 음수 · NaN 텍셀은 0이 됩니다).
- 1024x512 맵은 약 5.6 MB를 차지합니다(`getTextures()`에 `hdr: true`로 나오고, 텍스처 예산과 `getRenderStats().gpuBytes`에 집계됩니다). `disposeTexture`로 해제합니다. 사전 필터링은 WebGPU에서 수 밀리초, WebGL2에서 수십 밀리초가 걸립니다. half float 렌더링을 지원하지 않는 WebGL2 장치에서는 단순 박스 필터 밉을 대신 씁니다(거친 반사가 더 흐릿하고 API는 같음).
- 사전 필터링 중 GPU 오류(검증 · 메모리 부족)가 나면 맵을 다시 해제합니다. `loadEnvironmentHdr`는 그 오류로 거부되고, WebGL2에서는 `createEnvironmentFromFloat`가 예외를 던집니다. WebGPU는 이 오류를 비동기로 알리므로 `createEnvironmentFromFloat`가 먼저 ID를 반환하고 나중에 콘솔 경고와 함께 맵을 해제합니다. `await sdk.environmentReady(env)`는 맵이 정상으로 확인되면 이행되고, 실패하면 그 오류로 거부됩니다.
- `environment.rotation`은 모든 환경 맵(HDR · LDR)을 +y 축으로 돌립니다. HDR 텍스처는 `environment.map` 전용이며 객체 `map`으로 쓰면 흰색으로 그려집니다. `exportScene`은 이를 `hdr: true`로 표시하고, `loadSceneWithTextures`는 `src`가 있는 것을 `loadEnvironmentHdr`로 다시 불러옵니다.

### 재질 맵 {#material-maps}

glTF 방식의 텍스처 맵으로 PBR 재질을 텍셀 단위로 조절합니다. `model: 'pbr'`에서만 쓰며(클래식 셰이딩은 무시), 맵이 없는 객체는 이전과 똑같이 그려집니다.

```ts
const normal = await sdk.loadTexture('/tex/bricks-normal.png');
const orm = await sdk.loadTexture('/tex/bricks-mr.png');
sdk.addBox({
  map: bricks,
  metallicRoughnessMap: orm,  // B = 금속성, G = 거칠기
  normalMap: normal,
  normalScale: 1,
  aoMap: orm,                 // R = 차폐 (ORM 하나로 둘 다 사용 가능)
  emissiveMap: windows,
  emissiveColor: [1, 0.6, 0.2],
});
```

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `metallicRoughnessMap` | `number \| null` | `null` | 파랑 채널은 `metallic`, 초록 채널은 `roughness`에 곱함(선형 데이터) |
| `normalMap` | `number \| null` | `null` | 접선 공간 법선 맵, OpenGL / glTF 규약(초록 = 이미지 위쪽) |
| `normalScale` | `number` | `1` | 맵의 x / y 배율(−16..16으로 제한) |
| `aoMap` | `number \| null` | `null` | 빨강 채널의 주변광 차폐(선형). 환경광만 어둡게 함 |
| `aoStrength` | `number` | `1` | 0..1: `1 + aoStrength × (ao − 1)` |
| `emissiveColor` | `[r, g, b]` | `[0, 0, 0]` | 선형 발광색(glTF `emissiveFactor`, 0..1000). 검정이 아니면 PBR의 `color × emissive` 발광을 대신함 |
| `emissiveMap` | `number \| null` | `null` | `emissiveColor`에 곱하는 sRGB 텍스처(`emissiveColor`가 검정이면 효과 없음) |

- 모든 `add*` 메서드, `addCustomMesh`, `setObjectMaterial`에서 쓸 수 있습니다(준 필드만 바뀌고 `null` 또는 `0`은 슬롯을 비움). `getObjectRecord`가 돌려주고, `disposeTexture`는 그 텍스처를 쓰던 슬롯을 모두 비우며, `exportScene`은 맵이 있는 객체에만 필드를 쓰고 텍스처를 `textures`에 넣습니다. `loadScene`은 모르는 ID를 경고와 함께 버리고 `loadSceneWithTextures`는 ID를 다시 매핑합니다.
- 모든 맵은 기본 `map` 유무와 관계없이 객체의 uv와 `mapRepeat` / `mapOffset`을 씁니다.
- 법선 맵의 접선 좌표계는 위치와 uv의 화면 공간 미분으로 구합니다(꼭짓점 접선 없음). 그래서 uv가 뒤집힌 메시를 포함해 모든 메시에서 동작하며, glTF `TANGENT` 속성은 쓰지 않습니다. 그림자는 계속 기하 법선을 씁니다.
- 이미지는 다른 텍스처처럼 RGBA8로 올라가므로 ORM(차폐-거칠기-금속성) 텍스처 하나를 `aoMap`과 `metallicRoughnessMap`에 함께 쓸 수 있습니다.
- `loadGltf`는 `metallicRoughnessTexture`, `normalTexture`(`scale`), `occlusionTexture`(`strength`), `emissiveTexture`(`emissiveFactor` × 발광 강도를 `emissiveColor`로)를 읽습니다.

## 그림자

`setShadows({ enabled: true })`는 `setLighting` 방향광의 섀도 매핑을 켭니다(기본값은 꺼짐이며, 차트 · 과학 3D · 3D 그래프는 그림자를 드리우거나 받지 않습니다):

```ts
sdk.setLighting({ directionalDirection: [0.6, 1, 0.3] }); // 광원 쪽을 향하는 방향
sdk.setShadows({ enabled: true, mapSize: 2048, softness: 1.5 });
sdk.addSphere({ position: [0, 30, 0], castShadow: false }); // 그림자 없음
sdk.addBox({ position: [20, 5, 0], receiveShadow: false }); // 어두워지지 않음
```

- 메인 패스 전에 방향광 시점의 깊이 전용 패스가 `castShadow`인 보이는 불투명 객체를 `Depth32Float` 맵에 그립니다. 광원의 직교 카메라는 그림자를 드리우거나 받는 객체 전체(`bounds: 'auto'`, 카메라가 움직여도 그림자가 떨리지 않도록 텍셀 단위로 맞춤) 또는 고정 구 `bounds: { center, radius }`에 맞춰집니다. 자동 맞춤 장면이 크면 맵이 넓은 영역에 퍼지므로, 큰 장면에서는 관심 영역에 고정 경계를 쓰세요.
- 그림자는 classic과 PBR 모델 모두에서 방향광만 `darkness`만큼 줄입니다(주변광 · 점광원 · 발광 · PBR 환경광은 그대로).
- 가장자리는 `softness` 텍셀 범위의 4 × 4 격자에서 하드웨어 비교 PCF로 필터링됩니다(`softness: 0` = 단일 샘플의 선명한 그림자). `bias`(상수, 표면 기울기에 따라 커짐)와 `normalBias`(받는 면을 법선 방향으로 미는 양)는 섀도 맵 텍셀 단위입니다. 그림자 여드름(acne)이 보이면 올리고, 그림자가 물체에서 떨어져 보이면 낮추세요.
- 반투명 객체(`color` 알파 1 미만)는 그림자를 드리우지 않고, 알파 테스트 텍스처(`alphaTest`)는 그림자에도 같은 구멍을 냅니다. `castShadow` / `receiveShadow`는 기본 도형 · 사용자 메시 · glTF 객체에서 기본값 `true`이며 나중에 `setObjectMaterial`로 바꿀 수 있습니다.
- `setShadows`는 현재 설정에 병합되며 잘못된 값이면 `setShadows: ...`을 던집니다. `getShadows()`는 사본을 반환하며 `mapSize`는 장치의 텍스처 한도로 제한된 값입니다. `exportScene()`은 설정을 `shadows`에, 객체별 플래그를 각 객체에 저장하고 `loadScene`이 이를 복원합니다.
- 맵은 그림자를 켤 때 할당되고(2048² = 16 MiB, `getRenderStats().gpuBytes`에 포함) `mapSize`가 바뀌면 다시 만들며 끄면 해제됩니다. 프레임마다 그림자를 드리우는 객체에 대한 깊이 패스 하나가 추가됩니다. WebGPU와 WebGL2를 모두 지원합니다.

| 그림자 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `mapSize` | `512 \| 1024 \| 2048 \| 4096` | `2048` |
| `bias` | `number` (0..16 텍셀) | `0.5` |
| `normalBias` | `number` (0..16 텍셀) | `1` |
| `softness` | `number` (0..8 텍셀) | `1.5` |
| `darkness` | `number` (0..1) | `1` |
| `bounds` | `'auto' \| { center: [x, y, z]; radius }` | `'auto'` |
| `point` | `ScenePointShadowsDescriptor` | 꺼짐, [점광원 그림자](#point-light-shadows) 참고 |

### 점광원 그림자 {#point-light-shadows}

`setShadows({ point: { enabled: true } })`는 `setLighting` 점광원(`pointPosition`)의 전방향 그림자를 켭니다. 기본값은 꺼짐이며 방향광 설정과 독립적이라 둘 중 하나만 또는 둘 다 켤 수 있습니다:

```ts
sdk.setLighting({ pointPosition: [0, 26, 0], pointIntensity: 1.6 });
sdk.setShadows({ point: { enabled: true, mapSize: 512, softness: 1 } });
sdk.addSphere({ position: [0, 26, 0], scale: [2, 2, 2], emissive: 1, castShadow: false }); // 전구
```

- 메인 패스 전에 광원 위치에서 깊이 전용 패스 6개(90° 큐브 면마다 하나)가 `castShadow`인 불투명 객체를 `Depth32Float` 큐브 맵에 그립니다. 각 면은 `near`와 `far` 사이의 역 Z 원근 깊이를 저장하고, 받는 면은 자기 위치의 같은 깊이를 다시 계산해 하드웨어로 비교하므로 큐브의 면과 이음새가 틈 없이 필터링됩니다.
- 그림자는 classic과 PBR 모델 모두에서 점광원만 `darkness`만큼 줄입니다. 가장자리는 받는 면 거리 기준 `softness` 텍셀 범위의 3 × 3 격자 이중선형 비교 샘플로 필터링됩니다(`softness: 0` = 하드웨어 필터링 샘플 하나). `bias`(표면 기울기에 따라 커짐)와 `normalBias`는 받는 면 거리 기준 텍셀 단위입니다.
- `near`(월드 단위, 기본 `0.5`)보다 광원에 가까운 캐스터(예: 전구)는 무시됩니다. `far: 'auto'`(기본값)는 그림자를 드리우거나 받는 모든 객체의 먼 쪽까지 닿고, 숫자를 주면 고정됩니다(`2 * near` 이상).
- 큐브 맵은 켤 때 할당되고(`6 × mapSize² × 4` 바이트: 256은 1.5 MiB, 512는 6 MiB, 1024는 24 MiB, `getRenderStats().gpuBytes`에 포함) `mapSize`가 바뀌면 다시 만들며 끄면 해제됩니다. 꺼져 있으면 추가 패스가 없고 셰이더도 그대로입니다. 켜면 프레임마다 캐스터를 6번 그리므로 `mapSize: 512`를 권장하며 캐스터 수를 적당히 유지하세요. WebGPU와 WebGL2를 모두 지원합니다.
- `getShadows().point`는 `mapSize`가 장치 한도로 제한된 설정을 반환합니다. `exportScene()` / `loadScene`이 나머지 `shadows`와 함께 저장 · 복원합니다(`point` 없이 저장된 장면은 현재 점광원 설정을 유지).

| 점광원 그림자 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `mapSize` | `256 \| 512 \| 1024` | `512` |
| `bias` | `number` (0..16 텍셀) | `1` |
| `normalBias` | `number` (0..16 텍셀) | `1` |
| `softness` | `number` (0..8 텍셀) | `1` |
| `darkness` | `number` (0..1) | `1` |
| `near` | `number` (0.01..1e6) | `0.5` |
| `far` | `number \| 'auto'` | `'auto'` |

## 안티에일리어싱 {#anti-aliasing}

멀티샘플 안티에일리어싱(MSAA)은 기본적으로 꺼져 있습니다. 생성할 때나 실행 중에 켤 수 있습니다:

```ts
const sdk = await Charturbo.create(canvas, { antialias: true }); // 또는 4
sdk.setAntialias(1); // 끔
sdk.setAntialias(4); // MSAA x4
sdk.getAntialias(); // 적용된 샘플 수: 1 또는 4
```

- 샘플 4개로 켜면 메인 패스가 멀티샘플 색상 · 깊이 타깃에 그린 뒤 캔버스로 resolve합니다. 계단처럼 보이던 메시 윤곽과 교차선(가는 막대, 상자 · 판 모서리)이 매끄러워집니다. 텍스처 내부, 섀도 맵, 오프스크린 패스, DOM 텍스트는 그대로입니다. 2D 차트의 선과 마커는 셰이더에서 이미 안티에일리어싱되므로 거의 달라지지 않습니다.
- `antialias`는 `true` / `4`(샘플 4개) 또는 `false` / `1`(끔)을 받습니다. `setAntialias`는 `1` 또는 `4`만 받고 그 밖의 값에는 `setAntialias: ...` 오류를 던집니다. 장치가 캔버스 형식을 샘플 4개로 그릴 수 없으면 `1`로 남고 콘솔 경고를 남깁니다. `getAntialias()`가 적용된 값을 돌려줍니다.
- 비용: 멀티샘플 타깃은 캔버스 픽셀당 4 × (색상 + 깊이) 바이트를 씁니다(480 × 300 ≈ 4.4 MiB, `getRenderStats().gpuBytes`에 집계). 메인 패스의 채우기 비용도 4배입니다. MSAA를 켤 때 만들고, 크기가 바뀌면 다시 만들고, `setAntialias(1)`에서 해제합니다. 꺼져 있으면 아무것도 할당하지 않고 파이프라인도 그대로입니다.
- 캔버스 내보내기(`toImage`, `toDataURL`)는 resolve된 이미지를 받습니다. WebGPU와 WebGL2 모두 지원합니다. 이 설정은 장면이 아니라 캔버스에 속하므로 `exportScene`에 저장되지 않습니다.

## 후처리 {#post-processing}

블룸과 자동 노출(눈 적응)은 PBR 장면 메시에 쓰는 선택형 HDR 효과입니다. 둘 다 기본적으로 꺼져 있습니다:

```ts
sdk.setShading({ model: 'pbr', toneMapping: 'aces' });
sdk.setPostProcessing({
  bloom: { enabled: true, intensity: 0.8, threshold: 1, knee: 0.5, radius: 0.7 },
  autoExposure: { enabled: true, minEv: -4, maxEv: 4, speedUp: 3, speedDown: 1, compensation: 0 },
});
sdk.addSphere({ position: [0, 10, 0], emissiveColor: [8, 2.4, 0.5] }); // HDR 발광이 번집니다
sdk.getPostProcessing(); // { bloom, autoExposure, supported, active }
```

- 효과를 켜면 메시는 톤 매핑 없이 `Rgba16Float` HDR 타깃에 그려집니다(MSAA를 켜면 멀티샘플 타깃에 그린 뒤 여기로 resolve). 이어서 전체 화면 합성 패스가 노출을 적용하고 블룸을 더하고 톤 매핑(`setShading({ toneMapping })`)한 뒤 배경색 위에 섞어 sRGB로 캔버스에 씁니다. 2D 차트, 노드, 에지, 헬퍼 선은 합성 위에 그대로 그려지므로 반투명 메시 위에도 그려집니다.
- 블룸: 프리필터가 노출 적용 후 `threshold`보다 밝은 부분을 부드러운 `knee`로 남기고(밝은 픽셀을 평균해 작은 반짝임이 깜빡이지 않게 함), 최대 6단계의 절반 크기 밉 체인이 13탭 필터로 줄인 뒤, 텐트 업샘플로 체인을 거슬러 올라가며 더합니다. `radius`는 번짐 폭, `intensity`는 세기입니다. 1을 넘는 발광색, 강한 태양, HDR 환경 맵이 가장 크게 번집니다.
- 자동 노출: 매 프레임 GPU가 메시의 평균 로그 휘도를 측정하고(64 × 64에서 1 × 1로 축소, 배경은 제외) 노출을 EV `log2(평균 / 0.18)`(`minEv..maxEv`로 제한, `compensation` 더함) 쪽으로 맞춥니다. 값은 GPU에만 있습니다(리드백 없음). `setShading({ exposure })`는 결과에 그대로 곱해집니다. `adaptation: 'smooth'`(기본)는 그려진 프레임 기준 초당 `speedUp` / `speedDown` 속도로 움직이므로, 수렴하는 모습을 보려면 애니메이션 루프로 계속 렌더하세요. `adaptation: 'instant'`는 매 프레임 바로 맞춥니다. 켠 뒤 첫 프레임은 항상 바로 맞춥니다.
- PBR 모델이 필요합니다(클래식 셰이딩은 디스플레이 기준이라 그대로이며 `active`는 `false`). 부동소수점 렌더 타깃이 없는 장치(`EXT_color_buffer_float`가 없는 WebGL2)는 후처리를 건너뜁니다. 장면은 전과 같이 그려지고 `getPostProcessing().supported`가 `false`입니다. WebGPU와 확장이 있는 WebGL2 모두 지원합니다.
- 비용: 두 효과가 모두 꺼져 있으면 비용이 없습니다(타깃 · 추가 패스 없음, 파이프라인 그대로). 켜면 HDR 타깃이 픽셀당 8바이트(MSAA x4면 32바이트 + resolve 8바이트), 블룸 밉이 그 약 1/3, 노출 체인이 34 KiB를 쓰며 모두 `getRenderStats().gpuBytes`에 집계됩니다. 켤 때 만들고, 크기나 MSAA가 바뀌면 다시 만들고, 두 효과를 모두 끄면 해제합니다. 헤드리스 Chrome(Apple M1, 1280 × 720, PBR 메시 41개)에서 프레임당 WebGPU는 끔 0.72 ms, 블룸 1.18 ms, 블룸 + 자동 노출 1.36 ms, WebGL2는 1.09 / 1.72 / 1.82 ms였습니다.
- `setPostProcessing`은 현재 설정에 병합하며 잘못된 값에는 `setPostProcessing: ...` 오류를 던집니다. `exportScene()`은 설정을 `postProcessing`에 저장하고 `loadScene`이 복원합니다.

| 블룸 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `intensity` | `number` (0..8) | `0.6` |
| `threshold` | `number` (0..64, 노출 적용 후 선형 밝기) | `1` |
| `knee` | `number` (0..1, threshold 대비 비율) | `0.5` |
| `radius` | `number` (0..1) | `0.7` |

| 자동 노출 옵션 | 타입 | 기본값 |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `minEv` / `maxEv` | `number` (-16..16, `maxEv >= minEv`) | `-4` / `4` |
| `speedUp` / `speedDown` | `number` (초당 0..100) | `3` / `1` |
| `compensation` | `number` (-8..8 EV) | `0` |
| `adaptation` | `'smooth' \| 'instant'` | `'smooth'` |

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

- `raycastObjectAtNdc(ndcX, ndcY)`는 가장 가까이 맞은 객체와 월드 공간 교차점을 반환합니다. 구 · 평면 · 원기둥(옆면과 뚜껑)은 해석적으로, 상자는 상자로, 사용자 메시는 경계 상자 검사 후 삼각형 단위로 교차를 계산합니다. 삼각형 64개 이상인 메시는 첫 피킹 때 만든 삼각형 BVH를 쓰고, 광선이 월드 경계 상자를 지나지 않는 객체는 건너뜁니다.
- `pickObjectAtNdc(ndcX, ndcY)`는 객체 ID만 반환합니다(없으면 `null`).
- `selectObject(id | null)`는 객체를 강조합니다(큰 정적 평면은 외곽선만 표시).

## 저장과 불러오기

`exportScene()`은 직렬화할 수 있는 `SceneDescriptor`(트랜스폼·재질·물리를 포함한 객체, 조명, 셰이딩, 보조 표시, 강체 물리, 그래프 표시 여부)를 반환합니다. `loadScene(descriptor)`는 장면을 비우고 설정을 적용한 뒤 객체를 다시 만들고, 새 ID 목록을 반환합니다.

텍스처는 `clearScene()` / `loadScene()`으로 지워지지 않습니다. `exportScene()`은 객체가 쓰는 텍스처를 `textures`(`{ id, src, width, height }`, 픽셀 데이터 없음)에 나열하고 객체에는 `map` ID를 남깁니다. `loadScene`은 동기 함수라서 아직 살아 있는 텍스처의 `map` ID는 유지하고, 알 수 없는 ID는 `console.warn`과 함께 버립니다. 다른 세션에서 저장한 장면을 복원하려면 `await sdk.loadSceneWithTextures(descriptor)`를 호출하세요. `src`가 있는 텍스처를 다시 불러오고(같은 `src`의 살아 있는 텍스처는 재사용), 객체의 `map` ID를 새 ID로 바꾼 뒤 `loadScene`을 호출합니다. `src`가 없는 텍스처(`createDataTexture`, 캔버스, `ImageData`)는 복원할 수 없어 맵이 버려집니다.

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
