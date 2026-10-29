# 변경 이력 (Changelog)

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전은
[유의적 버전(SemVer)](https://semver.org/lang/ko/)의 0.x 규칙을 따릅니다 (`docs/ko/contributing/releasing.md` 참고).

## [Unreleased]

### 추가 — 캘린더 히트맵

- `renderCalendarHeatmap(data, options)`: `[날짜, 값][]`를 하루 한 셀로 주 단위 배치합니다(ECharts `calendar`). 날짜는 `'YYYY-MM-DD'`(적힌 그대로) 또는 에포크 ms / `Date`(차트 시간대 기준 날짜, `timeZone` 옵션 → `setTimeZone`).
- `range`(연도 · 월 · `[시작, 끝]`) / `ranges`(여러 캘린더), `orient`(가로 · 세로), `cellSize`, `cellGap`, `firstDay`, 요일 · 월 · 연도 레이블(로캘을 따르며 `names`로 교체), 월 경계선 `splitLine`, 데이터 없는 날 `emptyColor`.
- 색은 히트맵 색상 맵(`colorScale`, `color`, `reverse`, `min` / `max` / `center`)과 컬러바를 재사용합니다. 레이아웃 · 경계선 · 레이블 위치 · 히트 테스트는 Rust(`chart/calendar.rs`)에서 계산하고, SVG 보내기는 벡터입니다.
- 툴팁(날짜 · 값, 빈 날은 `No data`), `ctx.calendar`, `getNodeDetails`, 접근성 요약 · 데이터 표 · CSV(데이터가 있는 날), 키보드(하루 · 한 주 · Page Up / Down 한 달), 영어 · 한국어 · 중국어 문구, React / Vue `type="calendar"`. 예제 `heatmap/02-calendar`, fixture `calendar` · `calendar-vertical`, 문서 `charts/calendar`.

### 변경 (호환성 깨짐) — 그래프 레이아웃 GPU 상주

- `stepPhysicsAsync`가 GPU에 상주하는 배치를 진행합니다. 위치·속도는 GPU 버퍼에 남고, CPU는 자신의 배치 편집만 올리며 비동기 readback을 1~2 프레임 뒤에 반영합니다. 자동 sleep 판정은 매 스텝 GPU에서 셉니다. GPU 상주 중에는 절두체 컬링을 생략합니다.
- `stepPhysicsAsync`는 readback 후가 아니라 제출 시점에 resolve하며, GPU 작업 중 CPU 편집은 거부되지 않고 순서대로 적용됩니다. 피킹·내보내기처럼 현재 위치가 필요하면 새 `syncPhysicsPositions()`를 await하세요.

### 추가 — 내장 문구 다국어(영어 · 한국어 · 중국어 간체)

- 접근성 요약·키보드 도움말·스크린 리더 안내, 데이터 표 제목·머리글·CSV 머리글, 기본 툴팁, 범례·브레드크럼·컬러바 라벨, 기본 시리즈·값 이름, PDF 기본 제목이 차트 로캘을 따릅니다. 로캘 순서: 차트 `locale` → SDK 로캘(`create({ locale })`·`setLocale`) → `<html lang>` → `navigator.language`. `ko*`는 한국어, `zh*`는 중국어 간체, 그 외는 영어입니다.
- `registerMessages(locale, messages)`로 문구를 덮어쓰거나 언어를 추가하고, `getMessages`·`resolveLanguage`·`CHARTURBO_LANGUAGES`·`CharturboMessages` 타입으로 조회합니다.
- `setLocale`이 접근성 문구, 범례 `aria-label`, 컬러바, 비즈니스·계층 차트의 기본 이름(범례·상태·루트·기타)까지 바로 갱신합니다. 다른 차트의 기본 시리즈 이름은 다음 렌더링부터 바뀝니다.
- PDF 제목의 비ASCII 문자를 UTF-16으로 기록해 한국어·중국어 제목이 사라지지 않습니다.
- 문서 사이트(VitePress, `docs/`)를 3개 언어로 추가했고, 예제 사이트에 언어 선택을 추가했습니다.

### 변경 — 영어 출력

- 숫자가 `en-US` 고정이 아니라 차트 로캘로 형식화됩니다(로캘이 없으면 페이지·브라우저 언어).
- 산점도 기본 시리즈 이름이 0부터가 아니라 1부터 셉니다(`Series 1`).
- 박스 플롯 백분위 수염 서수(`1th` → `1st`), OHLC 키보드 도움말과 데이터 표 제목(`OHLC chart data`), 파이 기타 항목 툴팁(`and 2 more`), 콤보 설명(`bars stacked to 100%`)을 고쳤습니다.
- 콤보·선·막대 점의 `getNodeDetails().metadata.description`이 항상 한국어였던 문제를 고쳐 로캘을 따릅니다.

### 추가 — 선 구간 색칠 · 막대 배경 · 라벨 회전 · 회귀선 (병렬 구현)

- 선 · 영역 `pieces` / `piecesBy`(ECharts piecewise `visualMap`): 값 구간마다 색. 경계를 지나는 지점에서 선분을 잘라 색이 경계값에서 정확히 바뀌고, 영역은 경계 띠로 잘라 채웁니다. 예제 `line/12-pieces`, fixture `line-pieces` · `area-pieces`.
- 막대 `background`(ECharts `showBackground`): 값 축 전체 길이의 배경 트랙. 기본은 테마 `baseline` × 0.2 알파. 예제 `bar/04-background`, fixture `bar-background` · `bar-background-horizontal`.
- 막대 값 라벨 `labels.rotate`, x축 라벨 `axes.x.labelRotate`: 회전된 상자로 배치 · 충돌 판정 · 솎기를 하고 아래 여백이 늘어납니다. 회전한 카테고리 이름은 줄이지 않습니다. 예제 `bar/05-label-rotation`, fixture `bar-label-rotation`.
- 산점도 `trendline`(ECharts ecStat): 선형 · 지수(y 가중 로그 최소제곱) · 로그 · 다항식(2~6차, Givens QR) 회귀선과 R², 범례 수식, `getScatterTrendlines()`. 예제 `scatter/06-trendline`, fixture `scatter-trendline`.
- WASM 추가: `set_line_series_pieces`, `chart_line_piece_color`, `set_chart_bar_background`, `set_bar_label_boxes`, `set_bar_axis_label_rotation`, `set_chart_scatter_trendlines`, `chart_scatter_trend_fits`. 기존 시그니처는 그대로이며 SDK와 WASM을 함께 재빌드해야 합니다.

### 수정

- 배경 트랙 수가 다른 막대 차트로 바뀔 때 업데이트 애니메이션이 트랙과 막대를 짝지어 보간하던 문제: 트랙 수가 다르면 등장 애니메이션으로 그립니다.
- 단일 시리즈 막대 · 폭포 차트에서 `legend.position` / `overflow`가 무시되던 문제.

### 추가 — 산점도 지터

- `ScatterChartOptions.jitter: { x, y, seed }`: ggplot2 `geom_jitter`처럼 데이터 단위 균등 오프셋으로 겹친 점을 흩뜨립니다. 점마다 고정(PCG 해시)이라 다시 그려도 같고, hover · 브러시가 흩뜨린 위치를 따르며 툴팁 · 표는 원래 값입니다.
- WASM `set_chart_scatter_jitter(x, y, seed)`를 추가했습니다.
- 예제 `scatter/05-jitter`, WebGPU/WebGL2 fixture `scatter-jitter`를 추가했습니다.

### 추가 — 산점도 파동 효과

- `ScatterChartOptions.ripple`(ECharts `effectScatter`): 선택한 시리즈의 점 뒤로 커지며 사라지는 고리(`period` · `scale` · `count` · `fill`). 점 셰이더가 그리고 매 프레임 점 uniform의 시간만 갱신합니다.
- 파동이 보일 때만 도는 프레임 루프(`chart-effect.ts`)를 추가했습니다. 차트가 바뀌면 스스로 멈추고, `prefers-reduced-motion`이면 정지 프레임입니다. `sdk.setEffectTime(seconds | null)`로 특정 시점에 고정할 수 있습니다.
- WASM `set_chart_scatter_ripple` · `set_chart_effect_time`을 추가했고 점 uniform이 1072 → 1088바이트가 되었습니다(`effect`). SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `scatter/04-ripple`, WebGPU/WebGL2 fixture `scatter-ripple`(1초 시점 고정)을 추가했습니다.

### 추가 — 산점도 심볼 모양

- `ScatterChartOptions.symbol` · `seriesSymbols`: 시리즈마다 원 · 사각형 · 마름모 · 삼각형 점. 모양은 점 인스턴스의 시리즈 슬롯 칸에 함께 실려 업로드 크기가 같고, 원은 이전과 같은 픽셀입니다.
- hover 마커 · SVG 내보내기 · 범례 견본이 같은 모양을 씁니다.
- WASM `set_chart_scatter_shapes(shapes)`를 추가했습니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `scatter/03-symbols`, WebGPU/WebGL2 fixture `scatter-symbols`를 추가했습니다.

### 추가 — 범례 위치 · 페이지 넘김

- `legend.position: 'top' | 'bottom' | 'left' | 'right'`: 범례를 플롯의 원하는 쪽에 두고 그쪽 여백을 잡습니다. 왼쪽 · 오른쪽은 가장 긴 이름에 맞춘 세로 열입니다.
- `legend.overflow: 'scroll'`(기본): 한 줄(또는 한 열)에 들어가지 않는 항목은 ‹ n / m › 버튼으로 넘깁니다. 예전에는 줄바꿈된 범례가 플롯을 덮었습니다. `'wrap'`은 예전 동작입니다. 페이지 밖 항목은 `display: none`이라 포커스 · 내보내기에서 빠집니다.
- 예제 `line/11-legend-paged`, WebGPU/WebGL2 fixture `legend-right-paged` · `legend-bottom-paged`를 추가했습니다.

### 추가 — 생키 세로 방향 · 그라데이션 링크 · 단계 스타일

- `SankeyChartOptions.orient: 'vertical'`: 같은 d3-sankey 배치를 흐름 좌표에서 계산하고 화면에서 x · y를 바꿉니다. hit test · 키보드 · 노드 사각형 · 라벨(막대 아래/위, 가운데 정렬)이 모두 따라갑니다.
- `linkColor: 'gradient'`: 리본이 출발 노드 색에서 도착 노드 색으로 바뀝니다.
- `levels: [{ column, color?, linkOpacity? }]`: 열마다 노드 색과 나가는 링크의 불투명도를 정합니다.
- WASM `set_sankey_chart`의 `options`에 `orient` · `label_width_px`를 추가하고, 마지막 인자 `levels`(단계마다 6개 값)를 추가했습니다. 라벨 flags ±2는 세로 배치(아래/위)입니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `hierarchy/04-sankey-vertical`, WebGPU/WebGL2 fixture `sankey-vertical-gradient`를 추가했습니다.

### 추가 — 파이 다중 고리 (중첩 파이)

- `renderPieChart({ rings: [...] })`로 여러 고리를 그립니다. 퍼센트 · 각도 · "Other" 접기 · 라벨 방식은 고리별로 계산하며, 같은 이름의 조각은 고리를 넘어 색 · 범례 항목 · 강조를 공유합니다. React/Vue `type="pie"`도 같은 데이터를 받습니다.
- 툴팁(`ctx.slice.ring`) · 데이터 표 · 키보드 안내에 고리 이름을 붙입니다. 요약은 고리 수를 말하고 합계는 생략합니다.
- WASM `set_pie_chart`에 마지막 인자 `rings`(고리마다 6개 값) · `groups`(값마다 그룹 id)를 추가했고, `chart_pie_slices`는 조각마다 9개 값(마지막이 고리)을 돌려줍니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `pie/06-nested`, WebGPU/WebGL2 fixture `pie-rings`를 추가했습니다.

### 추가 — 파이 둥근 모서리

- `PieChartOptions.cornerRadius`(CSS px)를 추가했습니다. 모서리 원은 안쪽으로 민 가장자리와 호에 접하며(d3-shape 작도), 얇은 조각·고리에서는 겹치지 않도록 줄어듭니다. 파이 중심은 뾰족하게 유지합니다.
- 길이가 다른 두 경계선을 꼭짓점 손실 없이 잇는 삼각 분할을 추가했습니다. 기존 뾰족한 경로는 바뀌지 않았습니다(기존 pie·donut·sunburst·gauge 화면 차이 0%).
- WASM `set_pie_chart`에 마지막 인자 `corner_radius_px`를 추가했습니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `pie/05-pad-angle`을 `pie/05-rounded`(둥근 모서리 + 각도 간격)로 바꾸고, WebGPU/WebGL2 fixture `pie-rounded`를 추가했습니다.

### 추가 — 파이 조각 각도 간격

- `PieChartOptions.padAngle`(도, 기본 0, 최대 45)을 추가했습니다. 기존 2px 간격 위에 각도 간격을 더하며, 각도 · 퍼센트 · hit test는 바뀌지 않습니다.
- WASM `set_pie_chart`에 마지막 인자 `pad_angle_deg`를 추가했습니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `pie/05-pad-angle`, WebGPU/WebGL2 fixture `pie-pad-angle`를 추가했습니다.

### 추가 — 파이 부분 원 (반 도넛)

- `PieChartOptions.endAngle`을 추가했습니다. 조각이 `startAngle`~`endAngle` 범위를 `direction` 방향으로 나눠 가지며, 화면은 범위의 bbox에 맞춰 잡습니다. 생략하면 기존처럼 한 바퀴입니다.
- WASM `set_pie_chart`에 마지막 인자 `end_angle_deg`(NaN = 한 바퀴)를 추가했습니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `pie/04-half-donut`, WebGPU/WebGL2 fixture `pie-half-donut`를 추가했습니다.

### 추가 — 파이 나이팅게일 로즈

- `PieChartOptions.rose: 'radius' | 'area'`를 추가했습니다. 조각 넓이(도넛은 고리 넓이)가 값에 비례하도록 반지름을 정합니다. `'area'`는 같은 각도, `'radius'`는 비율 각도입니다. 퍼센트는 합계 대비 비율로 유지합니다.
- hit test · 키보드 위치 · 안쪽 라벨 · 바깥 지시선 시작점이 조각마다의 반지름을 따릅니다. 로즈는 도넛 중앙 라벨이 기본으로 꺼집니다.
- WASM `set_pie_chart`에 마지막 인자 `rose`(0 없음 · 1 radius · 2 area)를 추가했습니다. SDK와 WASM을 함께 재빌드해야 합니다.
- 예제 `pie/03-rose`, WebGPU/WebGL2 fixture `pie-rose`를 추가했습니다.

### 추가 — Surface3D 등고선

- `Surface3DSeries.contours`(`show`·`levels`·`color`·`width`·`opacity`)를 ChartGPU v0.4.0 기본값·의미와 맞춰 추가했습니다. 개수 levels는 색상 범위 안쪽을 균등 분할하며 스트리밍 갱신마다 다시 계산합니다.
- 렌더링하는 삼각형 위에서 등고선을 생성해 hole·고정 축·aspect·직교 투영과 일관됩니다. 깊이 테스트하는 1px hairline 전용 파이프라인을 쓰고, 3D 면에 표준 polygon offset을 적용해 같은 평면 선의 깨짐을 없앴습니다.
- WASM `set_chart_3d`·`update_chart_3d_series`에 packed contours 인자를 추가했습니다 (시리즈마다 `[levelCount, r, g, b, a, ...levels]`). SDK와 WASM을 함께 재빌드해야 합니다.
- React/Vue 전달 검증, 재생 제어 예제, 원근·직교 WebGPU/WebGL2 fixture를 추가했습니다. 테스트 alias가 공백이 있는 경로에서도 동작하도록 수정했습니다.

### 추가 — 3D 축 범위 · 비율 · 직교 투영

- `axes3d.x/y/z`의 고정 범위·이름·눈금 수·표시 여부, `aspect: 'cube'|'data'|[x,y,z]`를 제공합니다. 데이터 단위·사용자 비율을 geometry·격자·라벨·피킹에 일관되게 적용하며 고정 범위는 스트리밍에도 유지됩니다.
- `camera.type: 'orthographic'`·`orthoSize`, 평행 광선 피킹·줌·resize 상태 유지와 `getCameraState()`의 투영 정보를 추가했습니다. 다른 차트로 전환할 때 perspective로 복원합니다.
- 0 눈금의 부동소수점 잔차와 작은/큰 수의 긴 라벨을 수정하고, React/Vue 옵션 전달·비교 데모·양 GPU 직교 fixture를 추가했습니다.
- TypeScript 자체 패키지 참조를 소스에 연결해 빌드 산출물이 없는 CI의 타입 검사를 수정했습니다.

### 추가 — 3D 스트리밍 · 표면 갱신

- `appendPointCloud3D`로 XYZ·scalar 색상 청크 추가와 `maxPoints` FIFO를 지원합니다.
- `updateSurface3D`로 높이 전체 교체, column-major 열·row-major 행 추가, 고정 창 스크롤 또는 그리드 확장을 지원합니다.
- 검증 후 원자적으로 반영하며 카메라·스타일·범례 상태를 유지합니다. ID·축 범위·색상·피킹·접근성·CSV를 갱신하고 오래된 툴팁을 해제합니다.
- React/Vue SDK ref 사용 검증과 재생 제어가 있는 예제 2개, 기존 이미지와 스트리밍 결과의 WebGPU/WebGL2 동등성 fixture를 추가했습니다. 현재는 유지 데이터 복사·geometry 재생성 경로이며 부분 GPU 업로드 최적화는 후속 범위입니다.

### 추가 — PointCloud3D · Surface3D 기본 경로

- `renderPointCloud3D`·`renderSurface3D`, React/Vue `type="pointCloud3d"`·`type="surface3d"`를 추가했습니다.
- XYZ billboard와 Y-up row-major surface를 전용 깊이 처리로 렌더링합니다. scalar 색상, grid hole, wireframe, 조명, 시리즈 가시성·강조, orbit/pan/zoom을 지원합니다.
- 원본 XYZ 툴팁·키보드·CSV, surface ray intersection, SVG raster fallback, 예제 3개와 WebGPU/WebGL2 fixture를 연결했습니다. 투명도 0 표면의 선택·렌더와 resize 시 카메라 초기화를 수정했습니다.
- 전체 교체 API에 더해 위 스트리밍·축·투영 API를 제공합니다. 정확한 투명면 합성 등은 후속 범위입니다. 자세한 계약은 `docs/ko/charts/scientific-3d.md`를 참조하세요.

### 추가 — 독립 ErrorBar · Impulse

- `renderErrorBarChart`·`renderImpulseChart`, React/Vue `type="errorBar"`·`type="impulse"`를 추가했습니다.
- 절대/상대/비대칭 오차, 수평/수직, 단측 경계, CSS px/퍼센트 캡, 캡·연결선·마커 표시, baseline과 0길이 impulse를 지원합니다. 독립 샘플은 선 LOD로 생략하지 않습니다.
- 실제 줄기/캡 hover, 데이터 구간 brush, 키보드 접근성·CSV·벡터 SVG, 세 가지 예제와 양 GPU backend fixture를 연결했습니다.
- 전체 채널 교체로 갱신하며 단일 채널 streaming은 거부합니다. 작은 resize에서 CSS 캡 길이를 유지하고 수평 경계를 포함한 X축 범위·줌 한계를 재계산합니다.

### 추가 — 독립 Band 차트

- `renderBandChart(series, options)`와 React/Vue `type="band"`: 두 경계만으로 범위 채우기, 경계별 선 두께, 경계 교차 보존, 결측 쌍의 gap/연결을 지원합니다.
- 두 경계의 극값과 픽셀 버킷 내부 결측을 보존하는 네이티브 LOD, 범위 기반 hover/brush, 줌·팬·시간축·오른쪽 축·범례·벡터 SVG를 연결했습니다.
- 키보드 툴팁·접근성 요약·두 경계 CSV, 10만 쌍·교차 곡선 예제와 WebGPU/WebGL2 시각 회귀 fixture를 추가했습니다.
- 데이터 교체는 두 경계를 함께 `renderBandChart`로 전달합니다. 단일 채널 스트리밍 API는 독립 Band에서 거부합니다.

### 추가 — 독립 OHLC 차트

- `renderOhlcChart(data, options)`와 React/Vue `type="ohlc"`를 추가했습니다. 고가–저가 세로선과 왼쪽 시가·오른쪽 종가 틱을 그리고 `{ barCount }`를 반환합니다.
- `lineWidth`·`tickWidth`, 거래량 패널, 시간축·줌·팬, 픽셀 컬럼 OHLC 집계, 브러시 선택, 키보드 접근성·CSV·벡터 SVG를 지원합니다.
- 툴팁·선택의 종류는 `'ohlc'`이며 잘못된 배열 길이·시간축과 미지원 backend는 기존 차트를 지우기 전에 거부합니다.
- 금융 차트 예제에 5만 개 OHLC bar 데모를 추가했습니다.
- 확대 구간 경계의 부동소수점 오차로 마지막 금융 샘플의 키보드 툴팁이 누락되는 문제를 수정했습니다.

### 추가 — Area 스트리밍 · 제품 랜딩

- overlap 영역의 시리즈별 교체·추가와 `appendAreaData(chunks, options)` 원자적 batch append를 지원합니다. 누적·100% 누적 영역은 정렬 검증 후 함께 갱신하며 FIFO·줌·가시성을 보존합니다.
- 스트리밍 후 percent 툴팁의 오래된 값 참조와 숨긴 시리즈를 다시 표시할 때 누적 영역이 잘리는 문제를 수정했습니다.
- 정적 제품 랜딩과 실제 SDK 스트리밍 hero를 추가했습니다. 지연 로딩, Play/Pause, reduced motion, 화면 밖·숨겨진 탭 정지, GPU 실패 시 정적 preview를 지원합니다.
- 기존 갤러리는 `gallery.html`로 이동하고 area 스트리밍 실행 예제를 추가했습니다.

### 변경 — Charturbo 리브랜딩

- 제품명을 **Charturbo**, npm 패키지명을 `charturbo`로 변경합니다.
- 코어 API는 `import { Charturbo } from 'charturbo'`와 `Charturbo.create(canvas)`를 사용합니다.
- 기존 `Viz*` 타입·보조 API는 `Charturbo*`로, `VIZ_THEMES`는 `CHARTURBO_THEMES`로 변경합니다.
  React·Vue는 `charturbo/react`, `charturbo/vue`의 `CharturboChart`와 `useCharturboChart`를 사용합니다.
- Rust 크레이트와 WASM 파일은 `charturbo-core`, `charturbo_core_bg.wasm`으로 변경합니다.
- 문서·데모·벤치마크 표시명을 통일합니다. 원본 측정의 `viz`·`vizgpu` 식별자는 기록 연결을 위해 유지합니다.

### 수정 — 데모 공통 테마 선택

- 갤러리와 모든 예제 페이지의 상단에 Dark / Light / Midnight / Paper 선택을 표시합니다.
- 페이지와 실제 차트에 함께 적용하고 페이지 이동·새로고침 후에도 유지합니다.
  React·Vue·스파크라인과 3D Scene 디자인 패널도 같은 테마를 사용합니다.

### 추가·개선 — 그래프 물리

- CPU Barnes-Hut 탐색에서 질량 중심 캐시와 스택 없는 DFS 레코드를 사용합니다.
- `supportsGpuPhysics()`와 `stepPhysicsAsync()`를 추가했습니다. WebGPU 반발력 + CPU 스프링·적분·공간 인덱스의 선택적 하이브리드 경로이며, WebGL2에서는 CPU로 폴백합니다.
- 비동기 완료 후 좌표 조회·피킹이 갱신된 위치를 사용합니다. 중복 비동기 호출과 데이터/힘 설정 변경으로 오래된 결과, dispose 후 결과 적용을 거부합니다.
- Apple M1에서 100k 노드 물리 시간 310.30→41.87 ms, FPS 3.5→19.6을 측정했습니다(GPU 왕복 포함). 자세한 조건은 `docs/ko/contributing/benchmarks.md`를 참고하세요.
- cosmos 벤치마크의 프레임당 중복 물리 실행을 수정하고, 대시보드에는 시나리오별 CPU·하이브리드 GPU 중 FPS가 높은 모드를 Charturbo 한 항목으로 표시합니다(동률이면 물리 시간이 짧은 모드).

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

첫 공개 릴리스입니다. Rust(`crates/charturbo-core`)가 데이터 처리 · 레이아웃 · LOD · hit-test를 맡고,
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
- 로그 · 반전 축, 이중 y축, 대시보드 커서 · 줌 동기화(`Charturbo.connect`, `sync` 옵션).
- 이벤트 API(`sdk.on` / `off`: `hover`, `click`, `select`, `rangechange`, `legendtoggle`, `themechange`,
  `resize`, `drill`).
- 터치 · 펜 제스처(핀치 줌, 관성 팬, 탭 툴팁, 길게 눌러 스크럽).

### 추가 — 표시 · 접근성 · 내보내기

- 테마(`dark` / `light` / 사용자 `CharturboTheme`), 색각 이상 검증 팔레트, CSS 색 문자열 입력(`ColorInput`).
- d3-format 스타일 숫자 형식(`'.2s'`, `'$,.2f'`, `'compact'`, `'bytes'` 등)과 `Intl` 옵션, 로캘 · 시간대(IANA,
  기본 `'local'`) 지원.
- 접근성: 자동 요약 `aria-label`, 시각적으로 숨긴 긴 설명, 데이터 테이블 / CSV, 모든 차트 종류의 키보드 탐색,
  고대비 모드.
- PNG / JPEG / WebP 이미지(`toImage`, DOM 라벨 포함), 벡터 SVG(`exportChartSVG`), 1페이지 PDF(`toPDF`),
  클립보드 복사.
- 옵트인 애니메이션(enter / update 트윈, Rust에서 staged 마크만 보간, `prefers-reduced-motion` 존중).

### 추가 — 플랫폼 · 패키징

- `Charturbo.create`의 타입 있는 초기화 오류(`CharturboInitError`: `no-webgpu` / `adapter` / `device` / `wasm`),
  `isSupported`, 캔버스 자동 리사이즈(DPR 변경 포함).
- 공유 GPU 디바이스(`CharturboDevice`): 차트 수십~수백 개 페이지(WebGL 컨텍스트 한도 회피).
- React / Vue 컴포넌트(`charturbo/react`, `charturbo/vue`: `CharturboChart`, `useCharturboChart`), SSR에서 import 안전.
- 3D 그래프 · 임베딩: Barnes-Hut 포스 레이아웃, 고차원 임베딩 투영(PCA / JL) + 코사인 k-NN, 노드 검색 · 최단 경로,
  범용 3D 도형 · 강체 물리.
- 배포 형식: ES 모듈(WASM을 별도 `charturbo_core_bg.wasm` 파일로, 번들러가 에셋으로 처리) ·
  `charturbo/inline`(WASM base64 내장) · UMD(`<script>` 태그, WASM 내장, `require`) · `.d.ts`
  (`moduleResolution` `bundler` / `node16` / `nodenext` / `node10` 및 CJS `.d.cts`).
- `setWasmSource(url | Response | bytes | WebAssembly.Module)`: CDN 등 다른 위치에서 WASM 로드.
- TypeDoc API 문서(`npm run docs`), 예제 사이트(`npm run examples:dev` / `examples:build`).

[Unreleased]: TODO: <repository URL>/compare/v0.1.0...HEAD
[0.1.0]: TODO: <repository URL>/releases/tag/v0.1.0
