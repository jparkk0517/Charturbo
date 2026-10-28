# FAQ · 문제 해결

설정할 때 자주 생기는 문제와 답입니다. 항목마다 증상, 원인, 해결 방법을 적었습니다.

## `Charturbo.create`가 reject됨

`create`는 `CharturboInitError`를 던집니다. `error.reason`을 확인하세요.

| `reason` | 원인 | 해결 |
|---|---|---|
| `'no-webgpu'` | WebGPU와 WebGL2가 모두 없거나 캔버스 서피스를 만들 수 없음 | 대체 화면을 보여 주세요. 만들기 전에 `Charturbo.isSupported()`로 확인하세요. 공유 WebGL2 디바이스에서는 아직 컨텍스트가 없는 캔버스를 쓰세요 |
| `'adapter'` | 알맞은 GPU 어댑터가 없음 | 대개 GPU 드라이버가 차단되었거나 없는 경우입니다. WebGPU가 없는 브라우저에서 WebGPU 전용 빌드를 쓸 때도 이 값입니다 |
| `'device'` | 어댑터가 디바이스 생성을 거부함 | 나중에 다시 시도하거나 대체 화면을 보여 주세요 |
| `'wasm'` | WebAssembly 모듈을 불러오지 못함 | [WebAssembly 모듈을 불러오지 못함](#wasm-load)을 보세요 |

```ts
try {
  sdk = await Charturbo.create(canvas);
} catch (e) {
  if (e instanceof CharturboInitError) showFallback(e.reason);
  else throw e;
}
```

## WebGPU가 쓰이지 않음

기본 빌드는 WebGPU 어댑터가 없으면 알리지 않고 WebGL2로 전환합니다. 흔한 이유:

- 페이지가 보안 컨텍스트가 아닙니다. WebGPU는 HTTPS와 `localhost`에서만 노출됩니다.
- 브라우저에 아직 WebGPU가 없습니다. WebGPU는 Chrome / Edge 113+ 또는 Safari 26+가 필요합니다.
- 브라우저가 GPU나 드라이버를 차단 목록에 올렸습니다.

공유 디바이스가 어떤 백엔드를 쓰는지는 `CharturboDevice.backend`(`'webgpu'` 또는 `'webgl2'`)로 확인합니다. WebGL2에서도 모든 기능이 동작하지만 `stepPhysicsAsync`는 CPU에서 실행되고 WebAssembly 메모리 최대치가 더 큽니다.

## WebAssembly 모듈을 불러오지 못함 {#wasm-load}

`charturbo` 엔트리는 JavaScript 청크 옆 URL에서 `charturbo_core_bg.wasm`을 fetch합니다. 오류는 reason이 `'wasm'`인 `CharturboInitError`이며, 메시지는 `Failed to load the WebAssembly module:`로 시작합니다.

| 증상 | 원인 | 해결 |
|---|---|---|
| 메시지에 `failed to fetch Wasm: 404` 포함 | 번들러가 `.wasm` 파일을 내보내지 않았거나 서버가 서빙하지 않음 | Vite나 webpack 5를 쓰거나, 복사 단계와 `setWasmSource(url)`를 추가하거나, `charturbo/inline`으로 바꾸세요 |
| 서버가 `does not serve Wasm with application/wasm MIME type`이라는 콘솔 경고 | `Content-Type`이 잘못됨 | `.wasm`을 `application/wasm`으로 서빙하세요. 로드는 되지만 더 느립니다 |
| 콘솔에 CSP 위반이 찍힌 뒤 로드 실패 | `script-src`가 WebAssembly 컴파일을 막거나 `connect-src`가 fetch를 막음 | [Content Security Policy](./installation#content-security-policy)를 보세요 |
| `Response` source로 첫 오류가 난 뒤 재시도도 실패 | `Response`는 한 번만 읽을 수 있음 | 다시 시도하기 전에 `setWasmSource`를 다시 호출하세요 |

`setWasmSource`는 모듈이 로드된 뒤에는 무시되므로 첫 `create()` 전에 호출하세요.

## 캔버스가 비어 있음

다음 순서로 확인하세요.

1. **`render()`를 호출하지 않았습니다.** `render*` 메서드는 차트를 기술만 하고, 그리는 것은 `render()`입니다. 바꿀 때마다 호출하거나, 상호작용 갱신에는 `enableNodeInteractions(canvas, { autoRender: true })`를 쓰세요.
2. **캔버스에 크기가 없습니다.** `autoResize`(기본값)에서는 픽셀 크기가 CSS 크기를 따릅니다. 높이가 0인 컨테이너 안의 캔버스는 1 px로 남습니다. 캔버스나 컨테이너에 높이를 주세요.
3. **`autoResize: false`인데 크기를 정하지 않았습니다.** `canvas.width` / `height`를 직접 정하고 `sdk.resize(width, height)`와 `sdk.render()`를 호출하세요.
4. **차트 호출이 예외를 던졌습니다.** `render*` 메서드는 입력을 검증하고 `Error`를 던집니다(예: ``renderLineChart: give `x` for every series or none``). 콘솔을 확인하세요.
5. **캔버스를 직접 읽었습니다.** WebGPU 캔버스는 프레임이 present된 뒤 내용이 사라지므로 `canvas.toDataURL()`이 빈 이미지를 반환할 수 있습니다. 대신 `sdk.toImage()`, `sdk.toDataURL()`, `sdk.exportChartSVG()`를 쓰세요. [내보내기](./export)를 보세요.

## 라벨, 범례, 제목 위치가 어긋남

오버레이 DOM은 캔버스의 부모 요소에 붙고, 캔버스 위치를 기준으로 `position: absolute`로 배치됩니다. 부모에 `position: relative`(또는 다른 positioned 값)를 주어 위치 기준이 부모가 되게 하세요.

## HiDPI 화면에서 차트가 흐림

`autoResize`에서는 backing store가 CSS 크기 × 기기 픽셀 비율이며, 브라우저 확대나 모니터 이동 뒤에도 그렇습니다. 흐리다면 대개 `autoResize: false`인데 `canvas.width` / `height`를 CSS 크기로 둔 경우입니다. `window.devicePixelRatio`를 곱하고 `sdk.resize()`를 호출하세요. backing store는 한 변 최대 8192 px입니다. `setPixelRatio(ratio)`로 선과 마커에 쓰는 비율을 덮어쓸 수 있습니다.

## 한 페이지에 차트가 많으면 실패함

`Charturbo.create(canvas)`는 각자 GPU 디바이스를 만들고, 브라우저는 살아 있는 WebGL 컨텍스트를 16개 안팎으로 제한합니다. WebGL2 폴백에서 차트가 수십 개인 페이지는 컨텍스트가 부족해집니다. `CharturboDevice`를 하나 만들어 모든 차트에 넘기세요. [공유 GPU 디바이스](./shared-device)를 보세요.

## 줌이나 hover가 화면에 반영되지 않음

`enableNodeInteractions`는 뷰를 바꾸지만 `autoRender: true`일 때만 그립니다(기본값 `false`). 이 옵션을 켜거나 직접 만든 루프에서 `sdk.render()`를 호출하세요. React와 Vue 컴포넌트는 기본으로 `autoRender: true`를 씁니다.

## SSR 중 `window is not defined` 등의 오류

서버에서 Charturbo를 import하는 것은 안전합니다. 어떤 엔트리도 import 시점에 `window`나 `document`에 접근하지 않습니다. 오류는 서버에서 `Charturbo.create`를 호출해서 생깁니다. 엔진은 클라이언트 전용 훅(`useEffect`, `onMounted`)에서 만들거나, 서버에서는 컨테이너 마크업만 렌더링하는 React / Vue 컴포넌트를 쓰세요.

## 커스텀 툴팁에 HTML이 그대로 보이거나 스크립트가 실행됨

`formatTooltip`과 `formatChartTooltip`이 반환한 HTML은 그대로 삽입됩니다. 데이터 문자열은 export된 `escapeHtml`로 이스케이프하세요.

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatTooltip: (d) => `<b>${escapeHtml(d.label)}</b>`,
});
```

내장 툴팁은 데이터에서 온 문자열을 이미 모두 이스케이프합니다.

## `stepPhysicsAsync` 뒤 물리 위치가 최신이 아님

`stepPhysicsAsync`는 GPU 스텝을 제출하면 resolve됩니다. 피킹, 내보내기, 노드 상세, `isSleeping()`이 쓰는 CPU 사본은 한두 프레임 늦습니다. 최신 위치가 필요하면 먼저 `await sdk.syncPhysicsPositions()`를 하세요. 각 `stepPhysicsAsync`는 끝나길 기다린 뒤 다음 스텝을 시작하세요. 대기 중에 다시 호출하면 `A physics step is already pending`을 던집니다.

## 함께 보기

- [설치와 번들러](./installation)
- [핵심 개념](./core-concepts)
- [성능](./performance)
