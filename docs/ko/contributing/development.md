# 개발 환경

Charturbo를 소스에서 빌드하고, 라이브러리 패키지 · API 문서 · 예제 사이트 · 문서 사이트를 만들고, GPU 시각 회귀 테스트를 실행하는 방법입니다.

## 1. Rust WASM 패키지 컴파일
```bash
wasm-pack build crates/charturbo-core --target web --out-dir ../../web/src/wasm-pkg
```

## 2. 순수 NPM 라이브러리 빌드 (`dist-lib/`)
예시 쇼케이스 및 벤치마크 UI를 완전히 제외한 순수 SDK 번들과 `.d.ts` 타입 정의만 `web/dist-lib/`에 패키징합니다.
출력:
- `charturbo.js`(ES) + `charturbo_core_bg.wasm`(별도 파일, `new URL('./charturbo_core_bg.wasm', import.meta.url)`로 로드 → Vite · webpack 5(검증됨), Rollup / Parcel 에셋 플러그인이 에셋으로 처리)
- `inline.js`(`charturbo/inline`, WASM base64 내장 — esbuild처럼 에셋 처리가 없는 환경), `charturbo.umd.cjs`(UMD, WASM 내장: `<script>` 태그 · CommonJS `require`)
- 프레임워크 엔트리 `react.js` · `vue.js`(코어 청크를 import, `react` / `vue`는 external)
- 타입: `index.d.ts`(+ CJS용 `index.d.cts` / `inline.d.cts`), `react/` · `vue/` · `sdk/` 선언. `scripts/finalize-dts.mjs`가 상대 경로에 `.js` 확장자를 붙여 `moduleResolution: node16 / nodenext`에서도 타입이 풀립니다.
- WASM 위치를 바꾸려면 첫 `create()` 전에 `setWasmSource(url | Response | bytes | WebAssembly.Module)`.
```bash
cd web
npm run build:lib
```

## 3. NPM 배포
```bash
cd web
npm login
npm publish --access public
```
배포 전 `npm pack --dry-run`을 실행하면 `dist-lib/*`, `README.md`, `CHANGELOG.md`, `LICENSE`만 패키지에 포함되는 것을 확인할 수 있습니다. `prepack`이 `build:lib`를 다시 실행합니다. 버전 정책과 전체 체크리스트는 [배포 절차](./releasing), 변경 이력은 [`web/CHANGELOG.md`](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)를 참고하세요.

## API 문서 · 예제 사이트
```bash
cd web
npm run docs            # TypeDoc → docs/public/api/ (src/index.ts, react, vue 엔트리)
npm run examples:dev    # 예제 사이트 개발 서버 (web/examples/, 차트 종류별 페이지 + 소스)
npm run site:dev        # 사이트 전체를 http://localhost:5310/에서: 예제 + /docs/ 아래 이 문서 (폰에서 보려면 `-- --host`)
npm run examples:build  # 정적 빌드 → web/examples-dist/
```

## 문서 사이트
이 문서 사이트는 `docs/`에 있는 [VitePress](https://vitepress.dev/) 프로젝트입니다. 영어는 `docs/`, 한국어는 `docs/ko/`, 중국어 간체는 `docs/zh/` 아래에 같은 경로로 둡니다.
```bash
cd docs
npm install
npm run dev             # VitePress 개발 서버, 문서만 (http://localhost:5173/docs/)
npm run build           # 정적 빌드 → docs/.vitepress/dist/
npm run preview         # 빌드 결과 미리 보기
npm run check           # 로캘 대응 검사: 모든 페이지가 en / ko / zh에 모두 있어야 함
```
- `npm run check`(`docs/scripts/check-docs.mjs`)는 `docs/.vitepress/config.mts`의 사이드바와 `guide/` · `charts/` · `contributing/` 아래 페이지를 모아, 세 로캘 중 하나라도 빠진 페이지나 사이드바에 없는 페이지가 있으면 exit 1로 실패합니다.
- 새 페이지를 추가할 때는 `config.mts`의 사이드바 표에 slug와 로캘별 제목을 넣고, 세 로캘 파일을 모두 만듭니다.
- API 레퍼런스(영어)는 `cd web && npm run docs`가 TypeDoc 결과를 `docs/public/api/`에 쓰고, 사이트가 `/api/`로 그대로 제공합니다. `docs/public/api/`는 git에서 제외됩니다.

## 4. GPU 시각 회귀 테스트 (`npm run test:visual`)
실제 헤드리스 Chrome에서 픽스처 차트를 GPU로 렌더링하고 스크린샷을 기준 이미지와 비교합니다. `npm test`(vitest)와는 별도 스크립트입니다.
```bash
cd web
npm run test:visual                           # 비교 (실패 시 exit 1)
npm run test:visual -- --update               # 기준 이미지 다시 쓰기 (의도한 렌더링 변경 후)
npm run test:visual -- --backend=webgpu --filter=pie   # 백엔드 / 픽스처 이름 일부로 좁히기
npm run test:visual -- --canvas-only          # 글꼴이 다른 머신: DOM 텍스트가 들어간 full 샷 생략
npm run test:visual -- --repeat=3             # 같은 프로세스에서 3회 반복 (flake 확인)
npm run test:visual -- --param=color:#ff00ff  # 픽스처 파라미터 (일부러 깨뜨려 실패 확인; --update와 함께 쓸 수 없음)
```
- 구성: `web/e2e/index.html` + `main.ts` + `fixtures.ts`(픽스처 페이지, Vite가 서빙), `run-visual.mjs`(러너), `lib/image.mjs`(의존성 없는 PNG 디코드/인코드 `node:zlib` + 픽셀 diff). 러너가 빈 포트에 자체 Vite 서버를 띄우고, 고유 `--user-data-dir` · `--remote-debugging-port`로 Chrome(`--headless=new --enable-unsafe-webgpu`, macOS는 `--use-angle=metal`)을 실행해 DevTools Protocol로 픽스처마다 페이지를 새로 엽니다.
- 백엔드: `webgpu` 패스와 `webgl2` 강제 패스(페이지가 엔진 시작 전에 `navigator.gpu`를 숨겨 wgpu가 GL 백엔드로 폴백 — WebGPU가 없는 브라우저와 같은 경로). 실제 백엔드는 캔버스 컨텍스트로 확인하고 다르면 오류입니다.
- 픽스처(27): 1M 포인트 선(M4 LOD), 선 다크/라이트 테마, 누적 영역, 그룹 막대, 산점도, 캔들스틱, 히스토그램(20만 샘플), 히트맵, 박스 · 바이올린, 파이 · 도넛, 콤보, 레이더 · 게이지 · 퍼널 · 워터폴, 트리맵 · 선버스트 · 생키, 세로축 줌(`line-yzoom`) · 박스 줌(`box-zoom`), 공유 `CharturboDevice` 위 스파크라인 24개 그리드, hover(`hoverAtX` → crosshair + 마커), 네비게이터(줌 창), 브러시 사각형(`selectChartRange` xy).
- 샷 2종: `canvas` = DOM 오버레이(제목 · 눈금 · 범례 · 컬러바 · 파이 라벨)를 `visibility: hidden`으로 숨기고 캔버스 영역만 잘라낸 것 (글꼴과 무관, 주 검증 대상), `full` = 라벨 포함 카드 전체 (같은 머신 · 같은 글꼴에서만 안정 — 다른 OS / CI에서는 `--canvas-only`).
- 기준 이미지: `web/e2e/baselines/<webgpu|webgl2>/<fixture>.<canvas|full>.png` (108개). 결과: `web/e2e/out/report.html`(기준 / 실제 / diff 나란히), `report.json`, `*.actual.png`, `*.diff.png` (`e2e/out/`은 git 제외).
- 비교: 픽셀마다 RGBA 채널 최대 차이가 임계값(canvas 24, full 32 / 255)을 넘으면 다른 픽셀, 다른 픽셀 비율이 0.2%를 넘거나 크기가 바뀌면 실패. diff 이미지: 빨강 = 임계값 초과, 노랑 = 임계값 이하 차이, 회색 = 동일.
- 결정성: 시드 고정 PRNG(mulberry32), 고정 캔버스 크기(480×300, 스파크라인 140×32), DPR 1(`deviceScaleFactor: 1`, `--force-device-scale-factor=1`), `--force-color-profile=srgb`, `autoResize: false`, 로캘 `en-US`, 시간 축은 고정 UTC 날짜, 명시적 padding(눈금 라벨 폭이 플롯 위치를 바꾸지 않음), `prefers-reduced-motion: reduce` / `prefers-color-scheme: light` 에뮬레이션. SDK는 애니메이션이 없어 `render()` 한 번 + 3 프레임 대기 후 캡처합니다. 같은 머신에서 연속 3회 실행 시 모든 샷이 픽셀 단위로 동일했습니다(diff 0).
- 기준 이미지는 GPU · 드라이버 · Chrome 버전에 묶입니다: 다른 머신에서 실패하면 report로 차이를 확인한 뒤 그 머신에서 `--update`로 다시 만드세요.
- Chrome이 없거나(`CHROME_PATH` / `--chrome=<path>`로 지정 가능, 지정한 경로가 없으면 그대로 SKIPPED) 사용할 수 있는 GPU 백엔드가 없으면 `SKIPPED`를 출력하고 exit 0, `--strict`면 exit 1. 사용할 수 없는 백엔드 하나만 건너뛰고 나머지는 실행합니다(`--strict`면 백엔드 하나라도 없으면 실패). 하네스 자체 오류(일치하는 픽스처 없는 `--filter`, Chrome 연결 끊김 등)는 exit 2.

## 함께 보기
- [배포 절차](./releasing)
- [벤치마크 방법](./benchmarks)
