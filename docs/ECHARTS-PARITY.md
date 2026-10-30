# ECharts 예제 대응 체크리스트

기준: [ECharts 예제](https://echarts.apache.org/examples/en/index.html) 2D 296개 + GL 59개 (2026-10-28 `apache/echarts-examples` `chart-list-data*.js`).
범위: 2D 일반 차트와 기존 차트의 옵션 공백. 지도·geo, GL(globe·lines3D·flowGL), custom series, matrix 좌표계, dataset/transform API는 제외.
우선순위: 이 문서의 1단계를 `HANDOFF.md`의 3D 후속 작업보다 먼저 진행한다.

## 항목 완료 기준

HANDOFF의 계약을 따른다.

1. 실패 테스트 → 최소 구현 → 리팩터링 (TDD)
2. Rust → WASM → SDK 연결
3. hover/툴팁, 접근성(요약·표·키보드), CSV·SVG 내보내기, React/Vue `type`
4. ECharts 예제에 대응하는 데모 + WebGPU·WebGL2 화면 baseline
5. `GUIDE.md`, `CHANGELOG.md` 갱신

## 1단계: 기존 차트 옵션 (약 1.5주)

- [x] 파이 (ECharts pie 14)
  - [x] rose(nightingale): 넓이 비례(표준)로 구현, ECharts 선형 대응은 미채택
  - [x] padAngle: 기존 2px 간격 위에 각도 간격 추가
  - [x] `endAngle`(반 도넛): 범위 bbox에 맞춰 화면을 잡음
  - [x] 모서리 둥글게: CSS px 단위, d3-shape `cornerRadius` 작도
  - [x] 중첩 링: 독립 고리 API, 이름 그룹으로 색 · 범례 공유
- [x] 생키: 세로 방향(orient), levels 스타일, 그라데이션 링크 (sankey 7)
- [x] 범례: 위치 지정, 넘침 시 스크롤/페이지
- [x] 산점도: 심볼 모양, 파동 효과(effectScatter), jitter (데이터 단위, ggplot2 방식; 픽셀 단위 · beeswarm 겹침 회피는 미구현)
- [x] 선·막대: 구간 색칠(piecewise), 회귀선(최소제곱), 막대 배경, 라벨 회전

## 2A단계: 기존 엔진 재사용 새 차트 (약 2주)

- [x] 캘린더 히트맵 (calendar 8): 연 · 월 · 기간 · 여러 캘린더, 가로/세로, `firstDay`, 월 경계선 (음력 · 캘린더 위 파이/그래프 조합은 제외; 중간에 시작하는 범위에서 다음 달 라벨이 빠질 수 있음)
- [x] ThemeRiver: wiggle 기준선 (Byron & Wattenberg 2008, d3 `stackOffsetWiggle`) (themeRiver 2), silhouette · zero, `insideOut` 순서, 띠 위에서만 호버
- [x] Tree: Buchheim tidy tree, 4방향, 방사형, 꺾은선 연결 (tree 7), 펼치기/접기 · `initialTreeDepth` (팬/줌 · 레벨별 스타일은 미구현)
- [x] 2D 그래프: z 고정 force, 원형 배치, 직교 좌표 위 그래프 (graph 11), `renderGraph`. force는 3D 물리 시뮬레이터 재사용, 범주 범례 · 인접 강조 · 화살표 · curveness (노드 드래그 · 자기 루프 · 엣지 호버 · force 진행 애니메이션은 미구현)

## 2B단계: 새 도형 차트 (약 2주)

- [x] 평행 좌표 + 축 브러시 (parallel 4), `renderParallelChart`. 축별 구간 여러 개(합집합) · 축 간 교집합, 브러시는 행 플래그만 갱신(10만 행 × 8축에서 CPU 1.1ms), colorBy 색상맵, 세로 방향 · smooth (GPU 프레임 시간은 미측정)
- [x] Chord: d3-chord 배치 (chord 4), `renderChordChart`. `chordDirected` + 화살표 리본, gradient 리본, 범례 토글 시 재배치 tween, 리본 정점 상한(256×256에서 약 36MB) (호버 중 tween은 최종 배치로 hit-test)
- [x] PictorialBar: 심볼 반복·자르기 (pictorialBar 8), `renderPictorialBarChart`. 막대 차트 확장, 내장 도형 9종 + `path://` (`image://` · `symbolKeepAspect` · `barGap: '-100%'` 겹치기는 미구현)

## 3단계: 축·좌표계·전환 (약 3~4주)

- [x] 극좌표계: polar bar/line/누적, 극좌표 히트맵, `renderPolarChart`. 범주 · 값 각도 / 반지름 축, `startAngle` · `clockwise` · `innerRadius`, roundCap, smooth · area, 산점, 범례 토글 트윈. 남은 것: 극좌표 위 캔들스틱 · 박스 · effectScatter, 여러 극좌표계, 축 줌, 다시 렌더링 트윈, 시작 스포크 위 반지름 라벨 겹침
- [x] 축 끊김(axis break): `breaks: [{ start, end, gap? }]` (line y / y2 / extraY, area y, combo, bar · grouped bar 값 축, scatter x / y), 지그재그 표시 · 눈금 건너뛰기 · SVG. 남은 것: 시간 축 · line x축 · waterfall · pictorial 끊김, 오차 막대와 함께 쓰기
- [x] 다중 축: y축 3개 이상 (`yAxisIndex`, `axes.extraY`, 최대 8축, position · offset · color). 남은 것: x축 여러 개, area 다중 y, 주석은 y / y2에만 연결, 안 쓰는 extraY도 여백을 차지
- [x] Bar/Line Race: 정렬 애니메이션 (`realtimeSort` · `max` · `valueAnimation` 카운트업, 선 `endLabel`). 남은 것: 중간 프레임 baseline(결정적 시계 없음, Rust 단위 테스트로 검증)
- [x] 전환 애니메이션: 막대↔파이, 트리맵↔선버스트 (`animation.transition`, 24점 폴리곤 모핑). 남은 것: 모핑 중 둥근 모서리 · AA, 다른 차트 쌍

## 4단계: 인터랙션·기타 (약 1주)

- [x] 점 드래그, 클릭으로 점 추가: `enableNodeInteractions(canvas, { editable })`, `setChartEditable` · `getSeriesData`, `pointDrag` · `pointDragEnd` · `pointAdd` 이벤트, Escape 취소, Shift + 화살표 키보드 이동(line · scatter). 남은 것: 막대 · 파이 편집, 누적 · percent · band · 추가 y축 선 편집, 드래그 중 scatter 도메인 확장
- [x] 로딩 표시: `showLoading` / `hideLoading` / `isLoading`, 스피너 · 마스크 · `aria-busy` · polite 알림, React/Vue `loading` prop. 렌더링으로는 숨기지 않는다
- [x] 패턴 채우기(decal): `decal: true | DecalOptions`, 심볼 6종, GPU 두 번째 패스(화면 공간 고정), 범례 견본 · SVG `<pattern>`. bar(grouped · stacked · percent) · pie · area · treemap · sunburst · funnel. 남은 것: 3D · pictorial · 파이 "Other" 조각 · 트리맵 헤더, overlap area에서 패턴이 위 시리즈를 비쳐 보임
- [x] 리치 텍스트 라벨, 워터마크: `{name|text}` 템플릿 + `rich` 스타일(크기 · 굵기 · 색 · 배지), 배치 · 내보내기 반영; `setWatermark` / `getWatermark` 텍스트 · 이미지 타일, `export` 옵션, React/Vue `watermark` prop. 남은 것: 트리맵 헤더는 첫 줄만, 워터마크 내보내기 visual fixture 없음, SVG는 이미지를 URL로 링크
