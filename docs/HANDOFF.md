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
7. **3D 스트리밍·표면 갱신:** `appendPointCloud3D` XYZ/scalar FIFO, `updateSurface3D` replaceY·열/행 append·scroll/grow. 원자적 native 단일 시리즈 갱신으로 orbit·가시성·강조 유지, ID·도메인·색상·hover·접근성·CSV 갱신. SDK/Rust 실패 테스트부터 구현했고 실제 GPU 비교에서 발견한 축 캐시 무효화 누락도 실패 테스트로 재현 후 수정했다. React/Vue ref·테마 변경 검증, 재생 제어 예제 2개, 양 GPU backend 정적/스트리밍 화면 동등성까지 확인했다.
8. **3D 축 범위·aspect·직교 투영:** `axes3d.x/y/z` min/max·name·tickCount·visible, `aspect: 'cube'|'data'|[x,y,z]`, `camera.type`·`orthoSize`. geometry·격자·축·피킹이 같은 매핑을 사용한다. 직교 평행 ray·줌·resize·다른 차트로 전환 시 perspective 복원, 스트리밍 고정 범위 유지, 0 눈금 잔차·모바일 라벨 잘림을 TDD로 검증했다. 비교 데모와 직교 GPU fixture 2종을 추가했다.
9. **정식 링크·CI:** 저장소·README·문서·사이트·패키지 링크와 git origin을 `jparkk0517/Charturbo`로 맞췄다. TypeScript `paths`로 자체 패키지를 소스에 연결해 clean CI가 로컬 dist-lib에 의존하던 문제를 수정했다.
10. **Surface3D contours:** ChartGPU `Surface3DContourOptions`(show·levels·color·width·opacity)와 기본값(12, `#e2e8f0`, 1.5, 0.85)·alpha 가중치 공식을 맞췄다. Rust marching triangles가 렌더 삼각형 위에 isoline을 만들고, 1px hairline 전용 파이프라인(`chart-3d-contours`)이 depth test만 한다. 같은 평면 선의 점선화는 3D fill에 표준 polygon offset을 적용해 해결했다. Rust·SDK·WASM packed·React/Vue·예제 `07-contours`·원근/직교 fixture를 TDD로 진행했다.

11. **ECharts 대응 1단계 (origin에서 진행):** 파이 rose · padAngle · endAngle · 둥근 모서리 · 중첩 링, 세로 생키 · 그라데이션 링크 · levels, 범례 위치 · 페이지, 산점도 심볼 · ripple · jitter · 회귀선, 선 · 면 piecewise, 막대 배경 · 라벨 회전. 영 · 한 · 중 로캘, 문서 사이트(VitePress)와 예제 통합, GPU 상주 그래프 레이아웃. 상세는 `docs/ECHARTS-PARITY.md`와 CHANGELOG.
12. **사이트 디자인 통일 · 라이트 모드:** 공통 토큰 `docs/.vitepress/theme/tokens.css`(`--ct-*`, VitePress `--vp-c-*`에 매핑). 랜딩 · 갤러리 · 예제 · 벤치마크 · 문서가 같은 헤더 · 테마 · 언어 컨트롤을 쓴다. 테마는 첫 페인트 전 boot script(`site-theme.ts`)가 `charturbo-examples-theme` → `vitepress-theme-appearance` → OS 순으로 정한다.
13. **ECharts 대응 2A단계 (그래프 제외):** 캘린더 히트맵 `renderCalendarHeatmap`(`chart/calendar.rs`, `chart-calendar.ts`), ThemeRiver `renderThemeRiverChart`(`chart/theme_river.rs`, area 엔진 재사용, `appendAreaData` 스트리밍), Tree `renderTree` + `setTreeNodeExpanded` / `toggleTreeNode` / `treeToggle` 이벤트(`chart/tidy_tree.rs`, d3 `tree()`와 같은 좌표). 각각 툴팁 · 접근성 · CSV/SVG · React/Vue · 3개 언어 문서 · 양 backend baseline.

14. **ECharts 대응 2A 마무리 · 2B단계:** 2D 그래프 `renderGraph`(`chart/graph2d.rs`, `HierChart::Graph`, force는 `physics::ForceDirectedSimulator`를 z = 0에서 재사용), 평행 좌표 `renderParallelChart` + `setParallelBrush` / `clearParallelBrush` / `parallelBrush` 이벤트(`chart/parallel.rs`, `renderer/parallel.rs`), Chord `renderChordChart`(`chart/chord.rs`, `HierChart::Chord`, d3 `chord()` / `chordDirected()` 수치), PictorialBar `renderPictorialBarChart`(`chart/pictorial.rs`, `BarChart.pictorial`). 각각 툴팁 · 접근성 · CSV/SVG · React/Vue · 3개 언어 문서 · 양 backend baseline.

## 다음 작업

0. ECharts 대응 3단계(극좌표계 · 축 끊김 · 다중 축 · Race · 전환 애니메이션). 순서는 `docs/ECHARTS-PARITY.md`를 따른다.
1. 투명 geometry 깊이 정렬/합성 및 대용량 hit-test·streaming 가속을 진행한다. 현재 전체 점/셀 순회, metadata 복사·변경 시리즈 재전송·전체 geometry 재생성 경로다. 축 nice ticks·독립 box 토글·GPU glyph, 카메라 FOV·near/far·up도 남아 있다.
   등고선 라벨·등고선 대용량 가속(현재 전체 셀 × 범위 내 level 순회, 갱신마다 전체 재생성)도 남아 있다.
2. 관련 SDK·React/Vue·접근성·export·예제 및 실제 WebGPU/WebGL2 회귀를 검증한다.
3. 이후 Density·주석 편집·차트 간 연결 분석을 진행한다. 기존 구현 범위를 먼저 확인한다.
4. 전체 기능 동등성 검증·성능 비교·공식 사이트 콘텐츠 완성과 배포를 진행한다.

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
- 3D는 `Scientific3DMeta.kind='scientific3d'`, 공개 mode는 `'pointCloud3d'|'surface3d'`. raw Float32 XYZ와 렌더 좌표를 분리한다. 기본 cube는 축별 `[-60,60]`; data는 도메인 길이 비율, 튜플은 상대 박스 비율이며 가장 긴 변이 120이다.
- `axes3d` 고정 끝점은 스트리밍에도 유지한다. 범위는 프레임이지 geometry clip이 아니다. 한쪽 고정 끝점이 자동 범위를 벗어나면 자동 쪽을 5% 확장한다. ticks는 균등 간격 2..50(기본 5), invisible이면 native ticks=0. DOM 라벨은 축별 이름과 compact 숫자이며 화면 안 anchor의 라벨은 canvas 안으로 보정한다.
- 직교 카메라의 `orthoSize`는 세로 반높이이며 휠 줌에 따라 변한다. resize·setCameraPose·streaming은 투영 크기를 유지한다. 데이터 전체 교체는 재프레이밍한다. 카메라 좌표는 렌더 공간, target 단독 지정은 거부한다. `camera_state`의 9번째 값은 orthoSize(0=perspective)이며 이전 8개 값은 동일하다.
- Cloud size는 CSS px 지름, surface 높이는 `y[row * columns + column]`. 비유한 꼭짓점이 있는 셀은 전체 hole. wireframe은 셀 내부의 ray hit를 허용한다.
- WASM `set_chart_3d(xyz, colors, offsets, styles, shapes, config)`에서 offsets는 terminal sentinel 포함, styles는 시리즈별 size/lighting/wireframe, shapes는 columns/rows (cloud=0/0). 최대 400만 샘플. config는 Float64 15개: bounds[6](NaN=auto), aspect mode(0=cube/1=data/2=custom), ratios[3], ticks[3], projection(0/1), orthoSize(NaN=auto). SDK와 WASM을 함께 재빌드한다.
- `appendPointCloud3D(index, data, { maxPoints?, colorValues? })`는 유지된 시리즈 길이 반환. maxPoints=0/생략은 무제한, colorValues는 기존 colorBy 모드일 때만 필수. 모든 ID는 현재 순서 기준으로 재계산한다.
- `updateSurface3D(index, update)`는 `{columns, rows, pointCount}` 반환. replaceY=row-major 전체 높이, appendColumns=column-major strips, appendRows=row-major blocks. scrollX/scrollZ 기본 true, 창보다 큰 청크는 최신 창만 유지하고 원점에 전체 추가 개수 × step을 더한다. false면 크기 확장. yMin/yMax 생략은 기존 설정 유지.
- 갱신 입력은 SDK가 소유한 복사본으로 관리한다. 검증 후 WASM `update_chart_3d_series(series, xyz, colors, columns, rows)` 성공 시 metadata commit. Rust가 style·visibility·emphasis와 camera를 유지하며 전체 domain·offset을 재계산한다. `dirty = Dirty::all()`과 **`axes_key = None`을 함께 적용**해야 axis label이 새 범위를 표시한다.
- 새 3D 갱신은 오래된 툴팁/키보드 focus를 해제한다. 카메라 제스처를 끊지 않도록 scene reset hooks와 data hooks를 구분한다. React/Vue는 SDK ref에서 호출하며 data/options prop 참조 변경은 전체 교체다.
- `chart_3d_hit`는 raw XYZ·cell column/row다. 포인터는 보간된 surface 교차점, 키보드는 원본 정점을 사용한다. SVG는 raster fallback. brush·sync는 연결하지 않았다.
- Tree 애니메이션 토글은 레이아웃이 현재 `state_rev`로 배치됐을 때만 tween을 staging한다(`stage_toggle`). 같은 프레임의 두 번째 토글은 tween 없이 전환한다 (새로 보인 노드 위치가 NaN이라서).
- PictorialBar는 `BarChart.pictorial: Option<Pictorial>`. 설정되면 `build_bars`는 배경 트랙만 내고 심볼은 `prepare_pictorial`이 world-space fill 삼각형으로 다시 만든다. WASM 레코드는 막대당 f32 19개, `path://`는 공백을 하나로 정규화한 뒤 Rust에서 파싱 · 삼각분할한다(교차 4096 · 정점 상한).
- Chord 리본은 배치 · 크기가 바뀔 때만 삼각분할(`ChordGeom` 캐시, wpp + rev)하고 호버 · 강조는 색만 다시 칠한다. 리본 분할 수는 화면 길이에 비례(2..48)하고 `MAX_CHORD_FILL_VERTICES`(120만)를 넘으면 함께 줄인다. 리본을 버리지 않는다. 점 id는 그룹 `i`, 리본 `n + s·n + t`.
- 평행 좌표 브러시는 축 안 합집합, 축 간 교집합, 축당 최대 16구간. 브러시 변경은 행 플래그 텍스처만 다시 올린다. 점 id = 행 인덱스(시리즈 순).
- 2D 그래프 force는 동기식으로 안정될 때까지 돌린다(애니메이션 없음). `format`은 `yAxis.format`이 없으면 cartesian y 눈금에도 적용된다.
- ThemeRiver 내부는 area 엔진(`AreaChart.stream`)이며 y autoscale `'visible'`은 SDK가 `'all'`로 바꾼다. 강 바깥 호버는 결과 없음. `nulls` 옵션은 거부한다.
- Contours: SDK가 levels를 원본 Y 높이 목록으로 확정한다. 개수 N이면 색상 domain(`yMin/yMax` 또는 유한 높이 범위) 안쪽 `lo + i/(N+1)·(hi-lo)`, i=1..N이고 lo==hi면 `[lo]`이다. 최종 alpha는 `min(1, opacity·colorA·(0.75+0.15·min(width,4)))`이다. `show` 아니면 전송하지 않지만 다른 필드는 항상 엄격 검증한다. 모든 render/update는 levels를 다시 계산한다.
- WASM `set_chart_3d(..., config, contours)`와 `update_chart_3d_series(..., rows, contours)`의 contours는 시리즈마다 `[count, r, g, b, a, ...levels]`이고 count 0은 없음이다. set은 시리즈 수만큼 레코드를 넣고 빈 배열은 전체 없음이다. update는 해당 시리즈 레코드 1개이며 기존 등고선을 교체한다 (Rust `update_scientific3d_series(..., grid, contours)`의 None은 제거).
- Rust `Scientific3DContours { levels(정렬·중복 제거), color }`는 grid 시리즈에만 허용한다. 삼각형 분할은 fill과 같은 `[0,2,1]`,`[1,2,3]`이다. 정점 y ≥ level이면 inside이며 `lo < level ≤ hi`인 level만 이진 탐색으로 순회한다. 출력은 `ChartState.contours_3d`(ChartFillRaw 쌍, w=0 untagged) → `ChartLayers.contours_3d`이고 fills dirty일 때 업로드한다. 다른 kind·`empty_chart_layers`는 빈 slice로 이전 버퍼를 지운다. 강조 시 alpha×0.2, hidden·hole은 생략, hover 대상이 아니다.
- `chart-3d-fills`에 `DepthBiasState { constant: -1, slope_scale: -1.0 }`(reverse-Z에서 면을 뒤로 미는 glPolygonOffset(1,1))를 적용한다. 화면 공간으로 폭을 넓힌 segment는 선을 가로지르는 depth가 일정해 경사면에 묻히므로 등고선에 쓰지 않는다. 이 bias로 기존 surface baseline 2종에 실루엣 접힘 픽셀 0.003~0.008% 차이가 생겼고 허용 범위 안이라 baseline은 유지했다.
- 투명도 0은 렌더·선택에서 제외한다. 반투명 geometry는 depth-write하지만 정렬하지 않으므로 정확한 다중 투명면 합성은 미완료다. 전체 ChartGPU 기능 동등성 완료로 표시하지 않는다.

## 주요 파일

- `crates/charturbo-core/src/chart/scientific3d.rs`, `scientific3d_tests.rs`: 3D geometry·axes·picking·native 회귀
- `crates/charturbo-core/src/lib_scientific3d.rs`, `renderer/wgpu_backend.rs`: WASM packed contract·전용 depth pipeline
- `web/src/sdk/chart-scientific3d.ts`, `web/src/__tests__/scientific3d.test.ts`: 타입·검증·metadata·tooltip·접근성
- `web/examples/src/demos/scientific3d/`: cloud·surface·wireframe·streaming·`06-axes-projection`·`07-contours` 예제
- `crates/charturbo-core/src/camera/mod.rs`, `lib_camera.rs`: perspective/orthographic projection·ray·줌·상태 readback
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
- `docs/` (VitePress, en · ko · zh), `web/CHANGELOG.md`: 기능 문서·변경 이력

## 마지막 검증 결과

2D 그래프 · 평행 좌표 · Chord · PictorialBar 통합 머지 후 기준 (2026-10-29):

- Rust: 기본 · no-default-features 각각 563 통과 / 2 ignored.
- TS: 69파일 / 615테스트 통과 (Node 22.23), `tsc --noEmit`, `build:lib`, `examples:build` 성공. 문서 `check`(56페이지 × 3언어) · `build` 성공.
- `npm run test:visual -- --strict` 전체 300 통과 (75 fixture × WebGPU · WebGL2 × canvas · full). 기존 baseline 변경 없음. chord 2종은 리본 분할 변경 뒤 0.04~0.07% 차이로 허용 범위 안이다.

이전 2A단계(캘린더 · ThemeRiver · Tree) 결과: Rust 504, TS 65파일 / 578테스트, visual 256 통과.

이전 Surface3D contours 단계의 결과:

- TS: 49파일 / 468테스트 통과 (Node 22). 타입 검사 성공.
- Rust: 기본·no-default-features 각각 단위 415통과 / 1 ignored, 통합 1통과.
- 기본/WebGPU 전용 WASM·라이브러리·examples 빌드 및 `git diff --check` 성공.
- `npm run test:visual -- --strict --filter=scientific3d` 및 `--param=streaming:true`: 각 7 fixture × WebGPU/WebGL2 × canvas/full = 28개 통과. 새 `scientific3d-contours`(data aspect·hole)·`-contours-ortho`(고정 Y·custom aspect) baseline 8개를 추가했고 스트리밍 결과와 픽셀 차이 0%다.
- CDP로 양 backend `07-contours` 재생·일시정지·드래그를 확인했다. runtime exception 없음.

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
npm run test:visual -- --strict --filter=scientific3d --param=streaming:true
```

## 작업 트리·실행 환경 주의점

- 이 Mac에는 rustup stable(1.99.1, `~/.cargo`, PATH 미수정 → `. "$HOME/.cargo/env"`)과 wasm-pack 0.13.1을 설치했다. Node ≥22.19 필요 (undici). 다른 Mac(`/Users/hosuneoo/3d-prototype`)은 기본 Node 22.23이라 바로 실행된다. 병렬 서브에이전트는 git worktree에서 `CARGO_TARGET_DIR`를 공유한다 (디스크 여유 작음).
- 저장소 경로에 공백이 있다. vitest alias는 `fileURLToPath`로 고쳤다. 다른 `URL().pathname` 사용도 같은 문제가 날 수 있다.
- 기존 streaming·링크 정리는 `f36ec39`로 main에 푸시했고 Pages 배포 성공·정식 데모 HTTP 200을 확인했다. 축·aspect·직교 투영 단계도 검증 후 커밋·푸시한다. 새 채팅은 `git status`·`git log`로 최종 상태를 확인한다. 정식 저장소는 `jparkk0517/Charturbo`, 데모는 `https://jparkk0517.github.io/Charturbo/`다.
- 데모 서버 `http://127.0.0.1:5310/`에서 검증했다. 새 채팅에서는 실행 여부 확인 필요.
- Band 데모: `/line.html#06-band`, `/line.html#07-band-crossing`.
- ErrorBar·Impulse 데모: `/line.html#08-error-bars`, `/line.html#09-error-horizontal`, `/line.html#10-impulse`.
- 3D 데모: `/scientific3d.html`.
- Paseo 브라우저 호스트 timeout은 headless Chrome CDP로 우회했다.
- 임시 브라우저 검증 스크립트: `/private/tmp/claude-501/-Users-sun-kist-Desktop-01--hosun-03--code-Charturbo/04a38948-6b51-48c3-8e53-3ec9ec7e0308/scratchpad/cdp/check-contours.mjs <outDir> webgpu|webgl2` (Node 22 내장 WebSocket CDP, 5310 dev server 필요). 임시 파일은 영구 보존을 보장하지 않는다.

## 새 채팅 시작 문구

> `docs/HANDOFF.md`와 `docs/ECHARTS-PARITY.md`를 읽고 Charturbo 개발을 이어가자. ECharts 대응 2A · 2B단계(2D 그래프 · 평행 좌표 · Chord · PictorialBar 포함)까지 구현했으며 다음 작업은 3단계(극좌표계부터)다. 기존 변경을 보존하고 TDD로 실패 테스트부터 구현해서 SDK·React/Vue·접근성·예제와 양 GPU backend 검증까지 진행해줘.
