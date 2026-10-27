# 변경 이력 (Changelog)

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전은
[유의적 버전(SemVer)](https://semver.org/lang/ko/)의 0.x 규칙을 따릅니다 (`docs/RELEASING.md` 참고).

## [Unreleased]

### 추가·개선 — 그래프 물리

- CPU Barnes-Hut 탐색에서 질량 중심 캐시와 스택 없는 DFS 레코드를 사용합니다.
- `supportsGpuPhysics()`와 `stepPhysicsAsync()`를 추가했습니다. WebGPU 반발력 + CPU 스프링·적분·공간 인덱스의 선택적 하이브리드 경로이며, WebGL2에서는 CPU로 폴백합니다.
- 비동기 완료 후 좌표 조회·피킹이 갱신된 위치를 사용합니다. 중복 비동기 호출과 데이터/힘 설정 변경으로 오래된 결과, dispose 후 결과 적용을 거부합니다.
- Apple M1에서 100k 노드 물리 시간 310.30→41.87 ms, FPS 3.5→19.6을 측정했습니다(GPU 왕복 포함). 자세한 조건은 `docs/BENCHMARKS.md`를 참고하세요.
- cosmos 벤치마크의 프레임당 중복 물리 실행을 수정하고, 대시보드에 CPU와 하이브리드 GPU 결과를 구분해 표시합니다.

### 추가 — 3D 데모 디자인 설정

- 3D Scene 페이지에서 Dark / Light / Midnight / Paper 테마, 팔레트·강조 색상, 재질,
  조명 밝기와 격자·좌표축을 실시간으로 바꿀 수 있습니다.
- 설정은 강체·재질 데모에 함께 적용되며, 물체 추가·장면 Reset·다음 방문에도 유지됩니다.
  디자인 초기화로 기본값을 복원할 수 있습니다.

### 수정 — 3D 강체 회전

- 충돌 접촉점과 관성모멘트로 회전 충격량을 계산해, 비껴 맞은 물체와 기울어진 상자가 자연스럽게 회전합니다.
- 접촉점 마찰로 공의 미끄러짐이 구르기로 전환되며, 움직이는 kinematic 표면의 속도도 반영합니다.
- 다중 접촉점과 서브스텝으로 상자 쌓기를 안정화하고, 월드 좌표계 각속도를 쿼터니언으로 적분합니다.
  `stepPhysics()`의 반환 에너지에는 회전 운동에너지도 포함됩니다.
- 강체 데모는 초기 회전 속도 없이 충돌로 생기는 회전을 보여줍니다. 원기둥과 커스텀 메시의 충돌체는
  여전히 경계 상자 근사이므로, 원기둥의 곡면 구르기는 정확히 표현하지 않습니다.

## [0.1.0] - TODO: 배포일 (YYYY-MM-DD)

첫 공개 릴리스입니다. Rust(`crates/viz-core`)가 데이터 처리 · 레이아웃 · LOD · hit-test를 맡고,
TypeScript SDK는 WebGPU(WebGL2 폴백) 캔버스와 DOM 오버레이(라벨 · 범례 · 툴팁)만 다룹니다.

### 추가 — 차트

- **선 · 영역** (`renderLineChart`, `renderAreaChart`): 픽셀 열 단위 M4 데시메이션(1M+ 포인트, 스파이크 보존),
  일정한 px 두께의 안티앨리어싱 선, 겹침 / 누적 / 100% 누적 영역, 실제 x 값 · 시간 축(달력 눈금),
  마커 · 점선 · 곡선(`monotone` / `step*`) · 결측값 정책(`gap` / `connect` / `zero`) · 오차 범위 밴드.
- **막대** (`renderBarChart`, `renderGroupedBarChart`): 그룹 / 누적 / 100% 누적, 가로 막대, 데이터 라벨
  (Rust 충돌 판정), 오차 막대, 2D / 3D 모드.
- **산점도 · 버블** (`renderScatterChart`): GPU 인스턴싱(1회 업로드), x/y 줌 · 팬, 그리드 해시 hover.
- **캔들스틱** (`renderCandlestickChart`): 거래량 패널, 2px 미만 캔들의 픽셀 열 OHLC 집계.
- **히스토그램** (`renderHistogram`): Rust O(n) 구간화(Freedman–Diaconis / Sturges / 고정).
- **히트맵** (`renderHeatmap`): R32Float 텍스처 + 256색 LUT, 컬러바, 컬러맵 · 도메인 실시간 변경.
- **박스 플롯 · 바이올린** (`renderBoxPlot`): 선택 알고리즘 사분위, Tukey / min·max / 백분위 수염, KDE 바이올린.
- **파이 · 도넛** (`renderPieChart`): "Other" 접기, 바깥 라벨 · 지시선 배치, 중앙 합계 라벨.
- **콤보** (`renderComboChart`): 막대 + 선 + 영역을 한 플롯에, 선택적 오른쪽 y축.
- **레이더 · 게이지 · 퍼널 · 워터폴** (`renderRadarChart`, `renderGauge` / `setGaugeValue`,
  `renderFunnelChart`, `renderWaterfallChart`): 상태 밴드(색 + 아이콘 + 라벨), 전환율, 소계.
- **트리맵 · 선버스트 · 생키** (`renderTreemap`, `renderSunburst`, `renderSankey`): squarified / 방사형 /
  d3-sankey 방식 레이아웃을 Rust에서 계산, 클릭 드릴다운 · 브레드크럼.
- **스파크라인** (`renderSparkline`): line / area / bar / win-loss, 마지막 · 최소 · 최대 마커와 기준 밴드.

### 추가 — 상호작용 · 데이터

- 툴팁(정렬 · 공유 · 클릭 고정 · 값 형식), crosshair / 마커 hover 스타일, 범례 토글 · 강조.
- 휠 / 드래그 / 핀치 줌 · 팬, y축 줌, 박스 줌, 줌 기록(undo / redo), 범위 네비게이터(미니맵).
- 브러시 선택(`'x'` / `'xy'`)과 `select` 이벤트, 주석(기준선 · 구간 · 점 · 텍스트).
- 실시간 스트리밍(`appendSeriesData` + `maxPoints` 슬라이딩 창), y축 autoscale(`all` / `visible` / `none`).
- 로그 · 반전 축, 이중 y축, 대시보드 커서 · 줌 동기화(`VizEngineSDK.connect`, `sync` 옵션).
- 이벤트 API(`sdk.on` / `off`: `hover`, `click`, `select`, `rangechange`, `legendtoggle`, `themechange`,
  `resize`, `drill`).
- 터치 · 펜 제스처(핀치 줌, 관성 팬, 탭 툴팁, 길게 눌러 스크럽).

### 추가 — 표시 · 접근성 · 내보내기

- 테마(`dark` / `light` / 사용자 `VizTheme`), 색각 이상 검증 팔레트, CSS 색 문자열 입력(`ColorInput`).
- d3-format 스타일 숫자 형식(`'.2s'`, `'$,.2f'`, `'compact'`, `'bytes'` 등)과 `Intl` 옵션, 로캘 · 시간대(IANA,
  기본 `'local'`) 지원.
- 접근성: 자동 요약 `aria-label`, 시각적으로 숨긴 긴 설명, 데이터 테이블 / CSV, 모든 차트 종류의 키보드 탐색,
  고대비 모드.
- PNG / JPEG / WebP 이미지(`toImage`, DOM 라벨 포함), 벡터 SVG(`exportChartSVG`), 1페이지 PDF(`toPDF`),
  클립보드 복사.
- 옵트인 애니메이션(enter / update 트윈, Rust에서 staged 마크만 보간, `prefers-reduced-motion` 존중).

### 추가 — 플랫폼 · 패키징

- `VizEngineSDK.create`의 타입 있는 초기화 오류(`VizInitError`: `no-webgpu` / `adapter` / `device` / `wasm`),
  `isSupported`, 캔버스 자동 리사이즈(DPR 변경 포함).
- 공유 GPU 디바이스(`VizDevice`): 차트 수십~수백 개 페이지(WebGL 컨텍스트 한도 회피).
- React / Vue 컴포넌트(`viz-engine-sdk/react`, `viz-engine-sdk/vue`: `VizChart`, `useVizChart`), SSR에서 import 안전.
- 3D 그래프 · 임베딩: Barnes-Hut 포스 레이아웃, 고차원 임베딩 투영(PCA / JL) + 코사인 k-NN, 노드 검색 · 최단 경로,
  범용 3D 도형 · 강체 물리.
- 배포 형식: ES 모듈(WASM을 별도 `viz_core_bg.wasm` 파일로, 번들러가 에셋으로 처리) ·
  `viz-engine-sdk/inline`(WASM base64 내장) · UMD(`<script>` 태그, WASM 내장, `require`) · `.d.ts`
  (`moduleResolution` `bundler` / `node16` / `nodenext` / `node10` 및 CJS `.d.cts`).
- `setWasmSource(url | Response | bytes | WebAssembly.Module)`: CDN 등 다른 위치에서 WASM 로드.
- TypeDoc API 문서(`npm run docs`), 예제 사이트(`npm run examples:dev` / `examples:build`).

[Unreleased]: TODO: <repository URL>/compare/v0.1.0...HEAD
[0.1.0]: TODO: <repository URL>/releases/tag/v0.1.0
