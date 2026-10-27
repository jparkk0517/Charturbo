# Charturbo 개발 인수인계

## 목표와 작업 방식

- ChartGPU의 모든 차트·주요 기능을 지원하고 이를 넘어서는 제품을 만든다.
- `chartgpu.io`처럼 완성도 높은 공식 사이트와 실제 움직이는 차트 데모를 제공한다.
- **TDD 필수:** 실패 테스트 → 최소 구현 → 리팩터링 순서로 진행한다.
- 동등성 기준은 ChartGPU v0.4.0. ChartGPU API의 무수정 호환성을 약속하지 않는다.
- 각 구현 단위 완료와 전체 목표 완료를 구분한다. 전체 동등성은 아직 완료되지 않았다.

## 완료한 단계

1. **Area 스트리밍:** Rust → WASM → SDK 연결. overlap 시리즈별 갱신, stacked/percent 원자적 batch append (`appendAreaData`). FIFO·ID·원시 값 readback·viewport·compaction 검증. percent tooltip·가시성 복원 clipping·resize 상태 보존 수정.
2. **제품 랜딩:** 기존 Vite examples에 랜딩과 실제 streaming area hero 구현. lazy loading, Play/Pause, reduced motion, 화면 밖·숨겨진 탭 정지, GPU 실패 preview, cleanup. 기존 갤러리는 `gallery.html`.
3. **독립 OHLC:** `renderOhlcChart`, WASM `set_ohlc_chart`, Rust `CandleMode::Ohlc`. 선분·doji·gap·거래량·스타일·LOD·hover·SVG, React/Vue·접근성·CSV 및 5만 bar 예제. 확대 구간 마지막 bar의 End 키 tooltip 누락 수정.
4. **독립 Band:** `renderBandChart`, WASM/Rust `set_band_series`, React/Vue `type="band"`. 교차 보존·fill-only·paired gap·connectNulls·dual-edge LOD·범위 기반 hover/XY brush·경계 marker·키보드·CSV·SVG·10만 쌍 및 교차 예제.
5. **독립 ErrorBar·Impulse:** `renderErrorBarChart`·`renderImpulseChart`, WASM/Rust setter, React/Vue dispatch. 독립 줄기·캡·마커, 절대/상대/비대칭·단측 오차, 수평 경계 X-domain·확대 유지, baseline, 실제 geometry hover·XY brush·키보드·CSV·SVG·예제 3개. SDK/native/프레임워크 실패 테스트부터 구현했다.
6. **PointCloud3D·Surface3D 기본 경로:** 독립 `Scientific3D` native chart, depth-test/write fills·billboards, XYZ cloud·Y-up row-major surface·hole·colormap·wireframe·lighting. SDK 공개 API·React/Vue·원본 XYZ 접근성/CSV·ray-hit 툴팁·SVG raster fallback·예제 3개. TDD로 투명 표면 hit 제거, resize orbit 보존, 외곽 축 라벨까지 검증했다. 아래 후속 계약은 아직 남아 있다.

## 다음 작업

1. **3D 후속 계약:** 로컬 `web/node_modules/chartgpu/dist/config/types.d.ts`와 비교해 cloud append·surface 부분 갱신/streaming을 TDD로 구현한다. 현재 공개 render API는 전체 교체다.
2. 3D axes 범위·aspect, orthographic, contours, 투명 geometry 깊이 정렬/합성 및 대용량 hit-test 가속을 진행한다. 현재 각 축 독립 정규화·전체 점/셀 순회다.
3. 관련 SDK·React/Vue·접근성·export·예제 및 실제 WebGPU/WebGL2 회귀를 검증한다.
4. 이후 Density·주석 편집·차트 간 연결 분석을 진행한다. 기존 구현 범위를 먼저 확인한다.
5. 전체 기능 동등성 검증·성능 비교·공식 사이트 콘텐츠 완성과 배포를 진행한다.

ChartGPU 필수 13종: line, area, bar, scatter, pie, candlestick, ohlc, heatmap, band, errorBar, impulse, pointCloud3d, surface3d.

## 유지할 계약

- Area overlap은 시리즈별 갱신, stacked/percent는 모든 시리즈를 렌더 순서대로 원자적 batch append. `appendAreaData(chunks, options)`의 각 chunk는 `{ values, x? }`, 반환값은 유지된 길이 배열.
- OHLC는 candle 엔진·metadata·selection 코드 3을 공유하되 공개 tooltip/selection은 `'ohlc'`. style `[9]=lineWidth`, `[10]=tickWidth`, `[16]=1`; 기존 16-slot style은 candlestick.
- Band는 `lower`·`upper` 두 채널이 한 논리 시리즈. 교차 시 원래 채널 순서 보존. 반환값 `{ totalPoints, seriesCount }`.
- Band 경계 두께 기본값 각각 0, fill opacity 0.25. 유효하지 않은 쌍은 gap이며 `connectNulls`로 연결 가능.
- Band 전체 교체는 `renderBandChart`에 두 경계를 함께 전달. `setSeriesData`·`appendSeriesData` 단일 채널 갱신 거부.
- Band 내부는 `LineChartMeta.kind='line'`, `standaloneBand: true`, SDK `chartMode='band'`. 엔진 selection 코드 0을 공개 `'band'`로 보정.
- Band `items[].band`는 원본 경계, 공통 `items[].value`는 내부 선택용 중간값. CSV는 경계만 출력.
- 기존 보조 line band는 경계를 정렬하지만 독립 Band는 순서를 보존. native `edge_widths: Some(...)`이 독립 모드이며 midpoint stroke를 그리지 않는다.
- Band의 모든 sampling 옵션·채널별 색상·paired streaming 동등성까지 완료한 것은 아니다.
- ErrorBar·Impulse 내부는 `LineChartMeta.kind='line'`과 `sparse`, 공개 tooltip/selection은 `'errorBar'`·`'impulse'`. 선 M4 LOD나 샘플 사이 연결 없이 독립 geometry를 생성한다.
- ErrorBar는 `values`와 절대 `low/high`, 대칭 `error`, 비대칭 `errorLow/errorHigh` 중 하나를 받으며 배열 길이를 엄격히 검증한다. 역전 경계는 정렬하고 사용하지 않는 단측 경계의 결측은 허용한다.
- ChartGPU v0.4.0처럼 수평 ErrorBar의 상대 오차·단측 줄기 기준도 `values`다. 일반 수평 구간은 절대 경계와 `errorMode: 'both'`를 사용한다.
- 두 sparse 차트는 전체 render API로 갱신한다. SDK/native 단일 채널 set/append는 거부한다.
- Sparse hover는 실제 활성 줄기·캡·마커에서 가장 가까운 한 샘플을 반환한다. line의 shared index-hover와 같지 않으며 현재 모든 샘플을 검사한다.
- Sparse XY brush는 데이터 단위 줄기/경계 교차를 검사하며 CSS 캡 폭은 포함하지 않는다. 전체 ChartGPU 동등성·대용량 성능 검증 완료를 의미하지 않는다.
- 3D는 `Scientific3DMeta.kind='scientific3d'`, 공개 mode는 `'pointCloud3d'|'surface3d'`. raw Float32 XYZ와 각 축 `[-60,60]` 렌더 좌표를 분리하며 실제 단위 종횡비는 보존하지 않는다.
- Cloud size는 CSS px 지름, surface 높이는 `y[row * columns + column]`. 비유한 꼭짓점이 있는 셀은 전체 hole. wireframe은 셀 내부의 ray hit를 허용한다.
- WASM `set_chart_3d(xyz, colors, offsets, styles, shapes)`에서 offsets는 terminal sentinel 포함, styles는 시리즈별 size/lighting/wireframe, shapes는 columns/rows (cloud=0/0). 최대 400만 샘플.
- `chart_3d_hit`는 raw XYZ·cell column/row다. 포인터는 보간된 surface 교차점, 키보드는 원본 정점을 사용한다. SVG는 raster fallback. brush·sync는 연결하지 않았다.
- 투명도 0은 렌더·선택에서 제외한다. 반투명 geometry는 depth-write하지만 정렬하지 않으므로 정확한 다중 투명면 합성은 미완료다. 전체 ChartGPU 기능 동등성 완료로 표시하지 않는다.

## 주요 파일

- `crates/charturbo-core/src/chart/scientific3d.rs`, `scientific3d_tests.rs`: 3D geometry·axes·picking·native 회귀
- `crates/charturbo-core/src/lib_scientific3d.rs`, `renderer/wgpu_backend.rs`: WASM packed contract·전용 depth pipeline
- `web/src/sdk/chart-scientific3d.ts`, `web/src/__tests__/scientific3d.test.ts`: 타입·검증·metadata·tooltip·접근성
- `web/examples/src/demos/scientific3d/`: cloud·surface·wireframe 예제
- `crates/charturbo-core/src/chart/sparse.rs`: ErrorBar·Impulse geometry·hover·brush·setter
- `crates/charturbo-core/src/chart/linestyle.rs`: Band geometry·LOD, sparse extent·렌더 분기·native 회귀 테스트
- `crates/charturbo-core/src/chart/line.rs`, `brush.rs`: Band 범위 hit-test·선택·marker
- `crates/charturbo-core/src/lib_linestyle.rs`: WASM Band·ErrorBar·Impulse binding
- `crates/charturbo-core/src/chart/bar_style.rs`, `candle.rs`, `area.rs`, `svg.rs`: 다음 작업 참고
- `web/src/sdk/chart-band.ts`: Band 타입·입력 검증·인코딩
- `web/src/sdk/chart-sparse.ts`: ErrorBar·Impulse 타입·입력 검증·인코딩·tooltip helper
- `web/src/sdk/charturbo.ts`: 공개 API·backend 계약·metadata·tooltip·selection
- `web/src/sdk/chart-a11y.ts`, `chart-binding.ts`: 접근성·CSV·React/Vue dispatch
- `web/src/__tests__/`: SDK·접근성·React/Vue 테스트
- `web/examples/src/demos/line/06-band.ts`, `07-band-crossing.ts`: Band 예제
- `web/examples/src/demos/line/08-error-bars.ts`, `09-error-horizontal.ts`, `10-impulse.ts`: 신규 sparse 예제
- `web/e2e/fixtures.ts`, `run-visual.mjs`, `baselines/`: 양 backend 시각 회귀
- `docs/GUIDE.md`, `web/CHANGELOG.md`: 기능 문서·변경 이력

## 마지막 검증 결과

아래는 3D 기본 경로 완료 시 결과다.

- TS: 49파일 / 453테스트 통과.
- Rust: 단위 401통과 / 1 ignored, 통합 1통과.
- 타입 검사·기본/WebGPU 전용 WASM·라이브러리·examples 빌드 및 `git diff --check` 성공.
- `npm run test:visual -- --strict --filter=scientific3d`: fixture 3종 × WebGPU/WebGL2 × canvas/full = 12개 모두 픽셀 차이 0%. 실제 렌더 검토 후 신규 3D baseline만 생성했다.
- 공통 fill shader 변경 관련 기존 `--filter=area` 회귀 4개도 픽셀 차이 0%.
- 실제 3D 예제 3개, 접근성 이름·End 키 XYZ tooltip, 390px 모바일, CSV·SVG embedded PNG·PNG·PDF를 확인했다. 브라우저 runtime exception 없음.
- 이전 sparse 12개·Band 4개 시각 회귀는 각 단계에서 통과했으며 이번에는 3D·Area fixture를 검증했다.

대표 명령 (npm 명령은 `web/`에서):

```sh
cargo test -p charturbo-core
npm test
npx tsc --noEmit
npm run wasm:build
npm run wasm:webgpu
npm run build:lib
npm run build:lib:webgpu
npm run examples:build
npm run test:visual -- --strict --filter=scientific3d
```

## 작업 트리·실행 환경 주의점

- 리브랜딩·ErrorBar·Impulse까지 `27a30d6`으로 `origin/main`에 푸시했다. 이번 3D 단계는 별도 후속 커밋으로 저장한다. 새 채팅은 `git status`·`git log`로 최종 커밋/푸시 상태를 확인한다.
- 이전 데모 서버 주소: `http://127.0.0.1:5310/`. 새 채팅에서는 실행 여부 확인 필요.
- Band 데모: `/line.html#06-band`, `/line.html#07-band-crossing`.
- ErrorBar·Impulse 데모: `/line.html#08-error-bars`, `/line.html#09-error-horizontal`, `/line.html#10-impulse`.
- 3D 데모: `/scientific3d.html`.
- Paseo 브라우저 호스트 timeout은 headless Chrome CDP로 우회했다.
- 임시 브라우저 검증 스크립트: `/private/var/folders/9r/d6q96w4117zcz3_hkrc1zyrw0000gn/T/opencode/check-charturbo-scientific3d.mjs` (이전 sparse·band 스크립트도 참고 가능).
- 마지막 스크린샷: 같은 임시 디렉터리의 `scientific3d-qmG1XD/`. 임시 파일은 영구 보존을 보장하지 않는다.

## 새 채팅 시작 문구

> `docs/HANDOFF.md`를 읽고 Charturbo 개발을 이어가자. PointCloud3D·Surface3D 기본 경로는 구현했으며 다음 작업은 3D streaming·부분 갱신 계약이다. 기존 변경을 보존하고 TDD로 실패 테스트부터 구현해서 SDK·React/Vue·접근성·예제와 양 GPU backend 검증까지 진행해줘.
