# 공유 GPU 디바이스

`CharturboDevice`를 쓰면 여러 차트가 GPU 어댑터, 디바이스, 컴파일된 파이프라인 한 벌을 함께 씁니다. 대시보드나 스파크라인 표처럼 차트가 수십~수백 개인 페이지에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/sparklines.html)

## 왜 필요한가

`Charturbo.create(canvas)`는 캔버스마다 어댑터와 디바이스를 따로 요청하고 모든 파이프라인을 컴파일합니다. 브라우저는 살아 있는 WebGL 컨텍스트를 16개 안팎으로 제한하므로, WebGL2 폴백에서는 차트 100개 페이지가 실패합니다.

`CharturboDevice`는 instance, adapter, device, queue 하나와 서피스 포맷별로 캐시하는 파이프라인 한 벌을 가집니다. 그 위의 엔진은 서피스 설정, 깊이 텍스처, uniform, 인스턴스 버퍼만 가지며, 이 버퍼는 16개 요소로 시작해 필요할 때 커집니다.

## 기본 사용법

```ts
import { CharturboDevice, Charturbo } from 'charturbo';

const device = await CharturboDevice.create(); // { backend: 'auto' | 'webgpu' | 'webgl2' }
const charts: Charturbo[] = [];

for (const row of rows) {
  // 어댑터 / 디바이스 요청 없음, 파이프라인 컴파일 없음
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'line', showLast: true, showMinMax: true, label: row.name });
  sdk.render();
  charts.push(sdk);
}

device.engineCount; // 이 디바이스에서 살아 있는 엔진 수

// 정리
for (const sdk of charts) sdk.dispose();
device.dispose();
```

`device`와 함께 써도 `Charturbo.create`의 다른 옵션(`locale`, `autoResize`, `timeZone`, `sync`, `animation`)은 똑같이 동작합니다.

## API

`CharturboDevice.create(options?)`는 `Promise<CharturboDevice>`를 반환합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `backend` | `'auto' \| 'webgpu' \| 'webgl2'` | `'auto'` | `'auto'`: 어댑터가 있으면 WebGPU, 없으면 WebGL2. |

실패하면 `Charturbo.create`와 같은 `CharturboInitError`(`'no-webgpu'`, `'adapter'`, `'device'`, `'wasm'`)를 던집니다.

| 멤버 | 타입 | 설명 |
|---|---|---|
| `backend` | `'webgpu' \| 'webgl2'` | 이 디바이스의 모든 엔진이 쓰는 백엔드. |
| `engineCount` | `number` | 이 디바이스에서 현재 살아 있는 엔진 수(`dispose()` 뒤에는 `0`). |
| `pipelineSets` | `number` | 컴파일된 파이프라인 세트 수: 엔진 수와 무관하게 서피스 포맷마다 하나. |
| `disposed` | `boolean` | `dispose()`가 호출됨. 새 엔진을 만들 수 없음. |
| `dispose()` | `void` | 이 핸들을 해제합니다. |

## 백엔드

- **WebGPU**: 캔버스마다 자기 `GPUCanvasContext`를 공유 디바이스로 구성합니다. 캔버스 N개 = 서피스 N개 + 디바이스 1개.
- **WebGL2 폴백**: GL 컨텍스트는 자기 캔버스에만 present할 수 있습니다. 디바이스가 숨은 공유 캔버스 하나에 각 엔진을 렌더링하고(크기가 다르면 그 엔진 크기로 재구성), 같은 태스크 안에서 2D `drawImage`로 엔진 캔버스에 복사합니다. WebGL 컨텍스트 하나로 캔버스 수에 제한이 없습니다.

::: warning 주의
WebGL2 경로에서 엔진 캔버스는 `2d` 컨텍스트를 씁니다. 새 캔버스를 넘기세요. 이미 `webgl2` 또는 `webgpu` 컨텍스트가 있는 캔버스는 연결할 수 없습니다. 크기가 제각각인 캔버스가 섞이면 프레임마다 공유 캔버스를 재구성하는 비용이 드므로 가능하면 크기를 맞추세요.
:::

## 수명

- 엔진이 디바이스를 살려 둡니다. 마지막 엔진을 해제해도 새 엔진을 위해 디바이스는 남습니다.
- `device.dispose()`는 핸들을 해제합니다. 살아 있는 엔진은 계속 동작하고, 그 엔진들도 모두 해제되면 GPU 디바이스가 해제됩니다. 이후 `Charturbo.create(canvas, { device })` 호출은 `CharturboDevice is disposed` 오류를 던집니다.
- 디바이스에서 만든 엔진의 그래프 기본값은 노드 · 엣지 0개입니다(`device` 없는 `Charturbo.create`는 1000 / 2000).
- 모듈 초기화는 `Charturbo.create`와 같은 Promise를 공유합니다. 동시에 호출해도 WebAssembly는 한 번만 instantiate됩니다.

## React · Vue에서

디바이스는 `createOptions`로 넘깁니다(마운트 시 한 번만 읽음). 스파크라인이면 `interactions={false}`도 넘기세요.

```tsx
<CharturboChart type="sparkline" data={values} options={{ label: '매출' }} createOptions={{ device }} interactions={false} />
```

[React](./react)와 [Vue](./vue)를 참고하세요.

## 성능

헤드리스 Chrome에서 120 × 30 스파크라인으로 측정한 값입니다.

| 경우 | 생성 + 첫 렌더 |
|---|---|
| 스파크라인 100개, WebGPU | 165 ms |
| 스파크라인 100개, WebGL2 | 717 ms |
| 스파크라인 200개, WebGPU | 234 ms |

모든 경우 파이프라인 세트 1개, 오버레이 DOM 0개입니다. 엔진당 CPU 메모리는 약 67 KB, GPU 초기 할당은 약 73 KB(240 × 60 backing store, 깊이 텍스처 57 KB 포함)로, 기본 엔진의 약 813 KB보다 작습니다.

## 함께 보기

- [스파크라인](../charts/sparkline)
- [성능](./performance)
- [설치와 번들러](./installation)
