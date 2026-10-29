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
- [ ] 2D 그래프: z 고정 force, 원형 배치, 직교 좌표 위 그래프 (graph 11)

## 2B단계: 새 도형 차트 (약 2주)

- [ ] 평행 좌표 + 축 브러시 (parallel 4)
- [ ] Chord: d3-chord 배치 (chord 4)
- [ ] PictorialBar: 심볼 반복·자르기 (pictorialBar 8)

## 3단계: 축·좌표계·전환 (약 3~4주)

- [ ] 극좌표계: polar bar/line/누적, 극좌표 히트맵
- [ ] 축 끊김(axis break)
- [ ] 다중 축: x·y축 3개 이상
- [ ] Bar/Line Race: 정렬 애니메이션
- [ ] 전환 애니메이션: 막대↔파이, 트리맵↔선버스트

## 4단계: 인터랙션·기타 (약 1주)

- [ ] 점 드래그, 클릭으로 점 추가
- [ ] 로딩 표시
- [ ] 패턴 채우기(decal)
- [ ] 리치 텍스트 라벨, 워터마크
