# Charturbo란?

Charturbo는 GPU로 그리는 웹 차트 라이브러리입니다. 데이터 처리는 WebAssembly로 컴파일한 Rust에서 하고, 렌더링은 WebGPU(없으면 WebGL2로 자동 전환)로 하며, DOM은 제목·범례·축 라벨·툴팁 같은 텍스트만 담당합니다. 포인트가 100만~1000만 개여도 상호작용이 끊기지 않아야 하는 차트를 위해 만들었습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/gallery.html)

## 구조

| 계층 | 실행 위치 | 역할 |
|---|---|---|
| 엔진 (`charturbo-core`) | Rust, WebAssembly로 컴파일 | 픽셀 열 단위 M4 데시메이션, hit-test, 누적 계산, 눈금 배치, 계층·생키 레이아웃, 히스토그램 구간화, 박스 플롯 통계, 그래프 물리 |
| GPU 렌더러 | WebGPU, 또는 같은 `wgpu` 파이프라인의 WebGL2 | 선, 채움, 막대, 인스턴싱한 점, 히트맵 텍스처, crosshair와 hover 표시, 3D 뷰 |
| SDK (`Charturbo`) | TypeScript | 캔버스 크기, 입력 처리, DOM 오버레이(제목, 범례, 축 라벨, 툴팁), 접근성, 내보내기, 이벤트 |

차트는 세 단계를 거칩니다.

1. `render*` 호출(예: `renderLineChart`)이 입력을 검증하고 타입 배열로 엔진에 넘깁니다.
2. 엔진이 현재 화면에 필요한 만큼만 데이터를 줄이고(선 차트는 픽셀 열마다 최소/최대 한 쌍 정도) GPU 인스턴스를 준비합니다.
3. `render()`가 프레임 하나를 그리고 오버레이 DOM을 갱신합니다.

줌과 팬은 보이는 범위에 대해서만 2단계를 다시 실행하므로, 프레임 비용은 데이터 크기보다 캔버스 크기를 따라갑니다.

## WebGPU와 WebGL2

`Charturbo.create(canvas)`는 브라우저가 WebGPU 어댑터를 주면 WebGPU로 엔진을 시작합니다. 아니면 같은 엔진이 WebGL2에서 동작합니다. 백엔드를 고를 필요는 없으며 API와 결과 화면은 같습니다.

| 렌더러 | 브라우저 |
|---|---|
| WebGPU | Chrome / Edge 113+, Safari 26+ |
| WebGL2 (자동 전환) | 그 밖의 최신 브라우저 |

WebGL2 폴백에서 달라지는 점:

- 선택 기능인 GPU 그래프 물리 스텝(`stepPhysicsAsync`)이 CPU에서 실행됩니다.
- 벤치마크에서 산점도·히트맵·다중 시리즈 차트의 WebAssembly 메모리 최대치가 1.6~2.4배 컸습니다. 프레임 시간은 WebGPU와 거의 같았습니다.
- 브라우저는 살아 있는 WebGL 컨텍스트 수를 제한합니다(16개 안팎). 차트가 많은 페이지는 디바이스 하나를 공유하세요. [공유 GPU 디바이스](./shared-device)를 보세요.

WebGL2 스택을 뺀 WebGPU 전용 빌드도 함께 패키징됩니다. [설치와 번들러](./installation#webgpu-only-build)를 보세요.

## 차트 목록

| 그룹 | 차트 |
|---|---|
| 직교 좌표 | [선](../charts/line), [영역](../charts/area), [밴드 · 범위](../charts/band), [오차 막대 · 임펄스](../charts/errorbar-impulse), [막대](../charts/bar), [히스토그램](../charts/histogram), [산점도 · 버블](../charts/scatter), [캔들스틱 · OHLC](../charts/candlestick), [히트맵](../charts/heatmap), [박스 플롯 · 바이올린](../charts/box-violin), [콤보](../charts/combo), [픽토리얼 막대](../charts/pictorial-bar), [평행 좌표](../charts/parallel) |
| 비즈니스 | [파이 · 도넛](../charts/pie), [레이더](../charts/radar), [게이지](../charts/gauge), [퍼널](../charts/funnel), [워터폴](../charts/waterfall), [극좌표](../charts/polar), [스파크라인](../charts/sparkline) |
| 계층 · 흐름 | [트리맵 · 선버스트](../charts/treemap-sunburst), [생키](../charts/sankey), [코드 다이어그램](../charts/chord), [2D 그래프](../charts/graph-2d) |
| 3D | [PointCloud3D · Surface3D](../charts/scientific-3d), [3D 네트워크 그래프](../charts/graph-3d), [임베딩 · 유사도](../charts/embeddings), [3D 장면 · 물리](../charts/scene-3d) |

차트 공통 기능: 실시간 스트리밍, 시간·로그·반전·이중 y축, 휠·드래그·핀치 줌, 범위 내비게이터, 브러시 선택, 대시보드 동기화, 주석, PNG·SVG·PDF 내보내기, 선택형 애니메이션, 데이터 표와 키보드 탐색을 갖춘 접근성 요약, [React](./react) / [Vue](./vue) 컴포넌트.

## 이럴 때 쓰세요

- 크거나 빠르게 바뀌는 데이터: 샘플이 수백만 개인 시계열, 점이 수백만 개까지인 산점도, 센서·시세 스트리밍.
- 서로 연결된 차트가 많은 대시보드(커서·줌 동기화, 스파크라인 수백 개를 위한 공유 GPU 디바이스).
- 노드가 수만 개인 네트워크 그래프와 임베딩 뷰.

## 이럴 때는 맞지 않습니다

- 서버에서 차트 이미지를 렌더링해야 할 때. Node에서 import는 안전하지만 엔진은 브라우저에서만 만들어지며, 서버 렌더러는 없습니다.
- 속도보다 다운로드 크기가 중요한 아주 작은 페이지. 기본 WebAssembly 모듈은 원본 약 2.6 MB / gzip 1.0 MB입니다.
- WebGPU와 WebGL2가 모두 없는 환경. 이때 `Charturbo.create`는 reject됩니다. `Charturbo.isSupported()`로 확인하고 대체 화면을 보여 주세요.
- 지금 당장 안정된 1.x API가 필요한 프로젝트. Charturbo는 0.x이므로 minor 버전에 깨지는 변경이 들어갈 수 있습니다([변경 기록 · 마이그레이션](./migration) 참고). 패키지는 아직 npm에 없습니다([설치](./installation) 참고).

## 함께 보기

- [시작하기](./getting-started)
- [핵심 개념](./core-concepts)
- [성능](./performance)
