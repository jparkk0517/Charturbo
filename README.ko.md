# Charturbo

[English](README.md) · **한국어** · [简体中文](README.zh-CN.md)

**Rust + WebGPU로 만든 대용량 웹 차트 라이브러리.** 100만~1000만 포인트를 60 FPS로 줌·팬합니다.
WebGPU가 없는 브라우저에서는 WebGL2로 자동 전환됩니다.

[![CI](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml/badge.svg)](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[▶ 라이브 데모](https://jparkk0517.github.io/Charturbo/)** · [문서](https://jparkk0517.github.io/Charturbo/docs/ko/) · [벤치마크](docs/ko/contributing/benchmarks.md) · [변경 기록](web/CHANGELOG.md)

<p align="center">
  <a href="https://jparkk0517.github.io/Charturbo/"><img src="docs/assets/demo/hero.png" alt="선, 산점도, 캔들스틱, 3D 네트워크 그래프, 생키, 비즈니스 차트 예제" width="880"></a>
</p>

## 왜 Charturbo인가

- **큰 데이터에서 빠름**: 데이터 축약(M4), 마우스 위치 판정, 누적 계산, 눈금 배치를 전부 Rust(WebAssembly)에서 하고 GPU로 그립니다. DOM은 라벨·범례·툴팁만 담당합니다.
- **차트 18종**: 선, 영역, 막대, 산점도, 캔들스틱, 히스토그램, 히트맵, 박스·바이올린, 파이, 콤보, 레이더, 게이지, 퍼널, 워터폴, 트리맵, 선버스트, 생키, 스파크라인
- **실사용 기능**: 실시간 스트리밍, 시간 축, 로그 축, 휠·드래그·핀치 줌, 범위 내비게이터, 브러시 선택, 대시보드 동기화, PNG·SVG·PDF 내보내기
- **접근성 · 다국어**: 모든 차트에 자동 요약, 데이터 표, 키보드 탐색. 내장 문구는 영어·한국어·중국어 간체로 표시
- **React · Vue 컴포넌트** 제공, TypeScript 타입 포함
- **디자인 설정**: 라이트/다크·커스텀 테마, 시리즈 색상·팔레트, 글꼴, 격자·툴팁, 막대 모서리·데이터 라벨 ([직접 바꿔 보기](https://jparkk0517.github.io/Charturbo/benchmarks.html))
- **3D**: 대규모 네트워크 그래프(Barnes-Hut 물리 배치, 최단 경로, 검색), 고차원 임베딩 3D 투영과 유사도 검색, 강체 물리가 있는 3D 장면 ([예제](https://jparkk0517.github.io/Charturbo/graph.html))

## 성능

**[▶ 인터랙티브 성능 비교 · 테마/색상 바꾸기](https://jparkk0517.github.io/Charturbo/benchmarks.html)**

아래 그래프는 **Charturbo로 렌더링하고 `exportChartSVG()`로 내보낸 이미지**입니다. 비교 페이지에서는 시나리오 선택, 툴팁, 4개 테마, 강조 색상·팔레트·글꼴·모서리·수치 표시 변경과 SVG 다운로드를 지원합니다.

같은 시드 데이터로 uPlot, ECharts, Chart.js, Plotly, ChartGPU, SciChart, Highcharts와 비교합니다. Apple M1의 단일 환경 측정이며, 초기화 비용은 TTFF에서 제외합니다. ChartGPU 산점도는 x축만 이동하므로 다른 라이브러리와 작업량이 다릅니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-ttff-dark.svg">
  <img src="docs/assets/bench-ttff-light.svg" alt="Charturbo로 그린 첫 프레임 시간 비교. 선 1M·10M, 산점도 1M, 막대 10k. 실패와 미지원은 별도 표기." width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-fps-dark.svg">
  <img src="docs/assets/bench-fps-light.svg" alt="Charturbo로 그린 줌·팬 및 막대 hover 중 FPS 비교. 60 Hz 환경, 개별 수치는 연결된 비교 페이지의 표 참조." width="880">
</picture>

그래프는 **작업 조건별로** 읽어야 합니다. Charturbo는 시나리오별 CPU·GPU 측정 중 FPS가 높은 모드 하나로 표시하며, 모든 지표는 선택된 같은 실행의 값입니다(동률이면 물리 시간이 짧은 모드). Charturbo·three.js는 같은 3D Barnes-Hut 힘 모델입니다. 이 그래프 수치는 이전 hybrid GPU 모드(GPU 반발력 + CPU 적분·공간 인덱스)로 측정했으며 물리 시간에 GPU 왕복을 포함합니다. deck.gl은 물리 없는 렌더, cosmos.gl은 2D GPU 레이아웃, 3d-force-graph는 다른 d3-force-3d 힘 모델입니다. 이들의 FPS를 동일 작업의 종합 순위로 해석하지 않습니다. 시간 초과는 해당 어댑터·설정에서의 결과입니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-graph-dark.svg">
  <img src="docs/assets/bench-graph-light.svg" alt="노드 10k·100k의 FPS, 물리 시간, 첫 프레임 시간. Charturbo는 최고 FPS 모드, GPU 물리는 GPU 왕복 포함, deck.gl은 렌더만, cosmos.gl은 2D로 작업 조건이 다름." width="880">
</picture>

Apple M1 측정에서 하이브리드 GPU 물리는 10k 노드 **60 FPS**, 100k 노드 **19.6 FPS**였습니다(CPU: 43.8 / 3.5 FPS). 지금의 `stepPhysicsAsync`는 배치 전체를 GPU에 상주시키며 아직 다시 측정하지 않았습니다. `await sdk.stepPhysicsAsync(0.016)` 후 `sdk.render()`로 사용하고, 피킹·내보내기 전에는 `await sdk.syncPhysicsPositions()`를 호출합니다. WebGL2에서는 CPU로 폴백합니다. 동기 `stepPhysics()`는 CPU 경로입니다.

측정 방법, 각 라이브러리 설정, 전체 표와 한계는 [벤치마크 방법](docs/ko/contributing/benchmarks.md)에 있습니다. 직접 돌려 보려면 `cd web && npm run bench`.

README 이미지 재생성: `cd web && npm run bench:charts` (Chrome 필요). 비교 페이지는 `npm run examples:dev` 후 `/benchmarks.html`에서 실행할 수 있습니다.

## 설치

> npm 배포 전입니다. 지금은 [소스에서 빌드](docs/ko/contributing/development.md)해서 쓰세요.

```bash
npm install charturbo
```

Vite, webpack 5 등 번들러는 wasm 파일을 자동으로 처리합니다. 번들러 없이 `<script>`로 쓰거나 esbuild를 쓰는 경우는 [설치와 번들러](docs/ko/guide/installation.md)를 보세요.

## 빠른 시작

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// 100만 포인트 선 그래프
const values = Float32Array.from({ length: 1_000_000 }, (_, i) => Math.sin(i / 5000) * 40 + Math.random() * 4);
sdk.renderLineChart([{ name: '센서 A', values }], { title: '실시간 텔레메트리' });

// 툴팁, 휠 줌, 드래그 이동
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

React:

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: '사용률' }} style={{ height: 300 }} />;
```

차트 종류별 예제와 소스는 [라이브 데모](https://jparkk0517.github.io/Charturbo/)에서 볼 수 있습니다.

## 브라우저 지원

| 렌더러 | 브라우저 |
|---|---|
| WebGPU | Chrome · Edge 113+, Safari 26+ |
| WebGL2 (자동 전환) | 그 외 최신 브라우저 |

## 문서

[문서 사이트](https://jparkk0517.github.io/Charturbo/docs/ko/)는 영어·한국어·중국어 간체로 제공합니다. 저장소에서 바로 읽으려면 [docs/ko/](docs/ko/)를 보세요.

- [시작하기](docs/ko/guide/getting-started.md) · [설치와 번들러](docs/ko/guide/installation.md) · [핵심 개념](docs/ko/guide/core-concepts.md)
- [차트 매뉴얼](docs/ko/charts/line.md): 차트별 옵션, 데이터 형식, 상호작용
- [다국어 지원](docs/ko/guide/i18n.md): 내장 문구(접근성, 툴팁, 데이터 표)를 영어·한국어·중국어로 표시
- API 레퍼런스: `cd web && npm run docs` (TypeDoc → `docs/public/api/`, 영문)
- [벤치마크](docs/ko/contributing/benchmarks.md) · [개발 · 빌드 · 테스트](docs/ko/contributing/development.md) · [배포 절차](docs/ko/contributing/releasing.md)

## 라이선스

[MIT](LICENSE)
