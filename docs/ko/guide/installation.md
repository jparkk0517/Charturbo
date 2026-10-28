# 설치와 번들러

Charturbo는 엔트리가 여러 개인 npm 패키지(`charturbo`)로 배포됩니다. 엔트리마다 WebAssembly 엔진 모듈(`charturbo_core_bg.wasm`, 원본 약 2.6 MB / gzip 1.0 MB / brotli 0.77 MB)이 브라우저에 전달되는 방식이 다릅니다. 사용하는 도구에 맞는 엔트리를 고르세요.

## 패키지 상태

::: warning 주의
`charturbo`는 아직 npm에 배포되지 않았습니다. `npm install charturbo`와 CDN URL은 첫 릴리스 후에 동작합니다. 그 전까지는 소스에서 빌드하세요.
:::

### 소스에서 빌드 {#build-from-source}

Node(`^22.12.0 || ^24.0.0 || >=26.0.0`), Rust, `wasm-pack`이 필요합니다. 전체 절차는 [개발 환경](../contributing/development)을 보세요.

```bash
# https://github.com/jparkk0517/Charturbo 를 clone한 디렉터리에서
cd web
npm install
npm run wasm:build    # WebGL2 폴백 포함 엔진 -> src/wasm-pkg
npm run wasm:webgpu   # WebGPU 전용 엔진 -> src/wasm-pkg-webgpu
npm pack              # dist-lib/ 빌드 후 charturbo-<version>.tgz 생성

# 앱에서
npm install /path/to/charturbo-<version>.tgz
```

`npm pack`은 먼저 `build:lib`와 `build:lib:webgpu`를 실행하므로 두 WebAssembly 빌드가 모두 있어야 합니다. 기본 엔트리만 필요하면 `npm run build:lib`가 `web/dist-lib/`에 빌드합니다.

## 엔트리

| 엔트리 | WebAssembly | 사용 환경 |
|---|---|---|
| `charturbo` | 별도 파일, `new URL('./charturbo_core_bg.wasm', import.meta.url)`로 로드 | Vite, webpack 5, 에셋 처리가 있는 Rollup / Parcel: 번들러가 `.wasm`을 에셋으로 내보냄 |
| `charturbo/inline` | base64로 내장 (JS 약 3.9 MB) | esbuild 등 에셋 처리가 없는 환경. 따로 서빙할 파일 없음 |
| `charturbo/umd` | 내장 | `<script>` 태그(전역 `Charturbo`), CommonJS `require` |
| `charturbo/react`, `charturbo/vue` | 기본 엔트리와 공유 | React >= 18 / Vue >= 3.3 (선택적 peer 의존성). ESM 전용 |
| `charturbo/webgpu`, `charturbo/inline-webgpu`, `charturbo/webgpu-umd` | WebGPU 전용 엔진 | [WebGPU 전용 빌드](#webgpu-only-build) 참고 |

모든 엔트리는 같은 API를 내보냅니다. 번들러가 지원하면 `charturbo`를 쓰세요. 바이너리 `.wasm`이 base64 텍스트보다 작고, 내려받는 동안 컴파일됩니다.

## 번들러

### Vite

설정이 필요 없습니다. `import { Charturbo } from 'charturbo'`가 dev와 build에서 모두 동작하며, Vite가 청크 옆에 `charturbo_core_bg.wasm`을 내보냅니다.

### webpack 5

설정이 필요 없습니다. webpack 5는 `new URL('...', import.meta.url)`을 에셋 참조로 처리해 `.wasm` 파일을 내보냅니다.

### esbuild

esbuild는 `new URL(..., import.meta.url)` 에셋을 내보내지 않습니다. 다음 중 하나를 쓰세요.

- `charturbo/inline` (추가 작업 없음)
- `charturbo` + `charturbo_core_bg.wasm`을 서버에 올리는 복사 단계 + 그 위치를 가리키는 `setWasmSource`

```ts
import { setWasmSource, Charturbo } from 'charturbo';

setWasmSource('/assets/charturbo_core_bg.wasm');
const sdk = await Charturbo.create(canvas);
```

이 파일은 `charturbo/charturbo_core_bg.wasm`으로 export되므로 `node_modules/charturbo/dist-lib/charturbo_core_bg.wasm`에서 복사하면 됩니다.

### 번들러 없이 (`<script>` 태그)

UMD 빌드는 모듈을 내장하고 전역 `Charturbo`(네임스페이스 객체이며, 클래스는 `Charturbo.Charturbo`)를 노출합니다. `dist-lib/charturbo.umd.cjs`를 직접 서빙하세요.

```html
<canvas id="chart" style="width: 600px; height: 300px"></canvas>
<script src="/vendor/charturbo.umd.cjs"></script>
<script>
  Charturbo.Charturbo.create(document.querySelector('#chart')).then((sdk) => {
    sdk.renderLineChart([{ name: 'a', values: [1, 3, 2, 5] }]);
    sdk.render();
  });
</script>
```

### TypeScript

타입은 패키지에 포함되어 있습니다. `moduleResolution` `bundler`, `node16` / `nodenext`(ESM과 CJS), `node10`을 지원합니다.

## 다른 위치에서 모듈 불러오기

`setWasmSource(source)`는 WebAssembly 모듈을 불러올 위치를 바꿉니다. CDN, 복사 단계, 엄격한 Content Security Policy에 씁니다.

```ts
import { setWasmSource, Charturbo } from 'charturbo';
import wasmUrl from 'charturbo/charturbo_core_bg.wasm?url'; // Vite

setWasmSource(wasmUrl);
const sdk = await Charturbo.create(canvas);
```

| 받는 값 | 참고 |
|---|---|
| `string`, `URL`, `Request` | fetch로 받음 |
| `Response`, `Promise<Response>` | 한 번만 쓸 수 있음. 로드에 실패하면 다시 시도하기 전에 `setWasmSource`를 다시 호출 |
| `BufferSource` | 모듈 바이트 |
| `WebAssembly.Module` | 이미 컴파일된 모듈 |

- 첫 `Charturbo.create()` 또는 `CharturboDevice.create()` 전에 호출하세요. 모듈이 로드된 뒤에는 무시됩니다.
- 모듈은 페이지당 한 번 로드되며, 동시에 호출한 `create()`는 같은 로드를 공유합니다. 로드에 실패하면 다음 `create()`에서 다시 시도합니다.
- `charturbo/inline`과 UMD 빌드는 모듈을 내장하므로 source가 필요 없습니다.

## Content Security Policy {#content-security-policy}

- WebAssembly를 컴파일하려면 `script-src`에 `'wasm-unsafe-eval'`(또는 `'unsafe-eval'`)이 필요합니다. inline·UMD 빌드를 포함한 모든 엔트리에 해당합니다.
- 모듈을 fetch로 받을 때(`charturbo`, 또는 URL을 준 `setWasmSource`)는 그 출처를 `connect-src`에서 허용해야 합니다. inline 빌드는 fetch하지 않습니다.
- 내장 툴팁은 인라인 `style` 속성이 들어간 HTML 문자열입니다. `style-src`에 `'unsafe-inline'`이 없으면 이 속성이 막혀 툴팁 레이아웃이 깨집니다. 오버레이 라벨은 DOM style API로 스타일을 지정하므로 영향이 없습니다.

## WebGPU 전용 빌드 {#webgpu-only-build}

`charturbo/webgpu`(ES, 별도 `charturbo_core_bg-webgpu.wasm`), `charturbo/inline-webgpu`(ES, 내장), `charturbo/webgpu-umd`(UMD, 내장)에는 WebGL2 폴백 없이 빌드한 엔진이 들어 있습니다. WebGL2 스택이 기본 모듈의 절반 이상이므로 다운로드 크기가 크게 줄어듭니다. API와 타입은 `charturbo`와 같습니다.

WebGPU가 없는 브라우저에서는 이 빌드의 `Charturbo.create`가 `CharturboInitError`로 reject되며, 폴백하지 않습니다. 두 환경을 모두 지원하려면 실행 시점에 빌드를 고르세요.

```ts
// @webgpu/types가 없으면 DOM 타입에 navigator.gpu가 없습니다
const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
const adapter = await gpu?.requestAdapter().catch(() => null);
const { Charturbo } = adapter ? await import('charturbo/webgpu') : await import('charturbo');
const sdk = await Charturbo.create(canvas);
```

`charturbo/react`와 `charturbo/vue`는 기본 빌드를 씁니다.

## 브라우저 지원

| 렌더러 | 브라우저 |
|---|---|
| WebGPU | Chrome / Edge 113+, Safari 26+ |
| WebGL2 (자동 전환) | 그 밖의 최신 브라우저 |

WebGPU는 보안 컨텍스트(HTTPS 또는 `localhost`)에서만 노출됩니다. 일반 HTTP에서는 기본 빌드가 WebGL2를 씁니다. `Charturbo.isSupported()`는 두 렌더러 중 하나라도 쓸 수 있으면 `true`로 resolve됩니다.

## 서버 사이드 렌더링

Node나 SSR 중에 어떤 엔트리를 import해도 안전합니다. import 시점에는 `window`나 `document`에 접근하지 않으며, `charturbo/inline`은 첫 엔진 시작 때에만 내장 모듈을 디코딩합니다. 엔진은 클라이언트에서만, 예를 들어 `useEffect`나 `onMounted`에서 만드세요. React와 Vue 컴포넌트는 이미 그렇게 동작하며 서버에서는 `<div><canvas></div>`만 렌더링합니다.

## 함께 보기

- [시작하기](./getting-started)
- [FAQ · 문제 해결](./faq)
- [개발 환경](../contributing/development)
