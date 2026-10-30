# 접근성

SDK가 그리는 모든 차트에는 텍스트 요약, 스크린리더용 긴 설명, 데이터 포인트 키보드 탐색이 붙고, 필요하면 접근 가능한 데이터 테이블과 CSV 내보내기를 쓸 수 있습니다. 따로 켤 것은 없습니다. 차트에 `title`을 주고, 자동 요약으로 부족하면 `description`을 줍니다.

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const rps = Float32Array.from({ length: 5_000 }, (_, i) => 100 + Math.sin(i / 300) * 50);
sdk.renderLineChart([{ name: 'AI-Inference-RPS', values: rps }], {
  title: '추론 트래픽',
  description: '배포 후 RPS가 두 배로 증가', // 선택: aria-label로 자동 요약 대신 쓰임
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 키보드로 포커스한 점에도 툴팁 표시
sdk.render();

sdk.getChartSummary(); // "추론 트래픽. ..." (자동 요약)
```

## 캔버스에 붙는 속성

| 속성 / 요소 | 값 |
|---|---|
| `role` | `img` |
| `aria-label` | 자동 요약(차트 종류, 시리즈 · 포인트 수, 값 범위). `description`을 주면 그 문장이 들어가고 요약은 긴 설명으로 옮겨집니다. |
| `aria-describedby` | 시각적으로 숨긴 요소: 축 범위, 시리즈별 최소 / 최대 / 평균 / 추세, 키보드 안내. |
| `tabindex` | 차트가 있는 동안 `0`이라 Tab으로 캔버스에 갈 수 있습니다. |
| 라이브 영역 | 시각적으로 숨긴 `aria-live="polite"` 요소가 포커스된 점을 읽어 줍니다. 예: `"T+120, AI-Inference-RPS 135.9."` |

`sdk.getChartSummary()`는 `aria-label`과 같은 문장을 돌려줍니다. 차트를 없애거나 SDK를 해제하면 캔버스의 원래 속성이 복원됩니다.

## 키보드 탐색

캔버스에 포커스한 뒤:

| 키 | 동작 |
|---|---|
| ← / → | 이전 / 다음 샘플(막대: 카테고리, 산점도: 시리즈 안에서 x 순서로 다음 점, 캔들스틱: 캔들, 파이: 조각, 히트맵: 열) |
| PageUp / PageDown | 10개씩 이동(파이 제외) |
| Home / End | 처음 / 마지막 샘플(산점도: 가장 작은 / 큰 x) |
| ↑ / ↓ | 시리즈 전환, 숨긴 시리즈는 건너뜀(히트맵: 행. 단일 시리즈 막대 · 캔들스틱 · 파이에는 없음) |
| Enter | 트리맵 / 선버스트: 포커스한 노드로 드릴다운 |
| Esc | 포커스 해제(트리맵 / 선버스트: 한 단계 위로) |

Alt, Ctrl, ⌘와 함께 누른 키는 무시하므로 Ctrl + Z 같은 줌 단축키는 그대로 동작합니다.

포커스된 점은 포인터와 같은 엔진 hover(크로스헤어, 마커, 막대 강조)를 씁니다. `enableNodeInteractions`를 켰다면 기본 툴팁(커스텀 `formatChartTooltip` 포함)도 그 점에 뜹니다.

## 데이터 테이블과 CSV

```ts
sdk.showDataTable(document.querySelector('#table')!, { maxRows: 1000 }); // 컨테이너 생략 시 캔버스 컨테이너 바로 뒤에 삽입
sdk.hideDataTable();

const table = sdk.getChartDataTable(); // { columns, rows, totalRows, sampled }, 기본은 전체 데이터
const csv = sdk.exportChartCSV();      // RFC 4180 CSV, 행 구분은 CRLF
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `maxRows` | `number` | `showDataTable`은 `1000`, `getChartDataTable`은 제한 없음 | 더 길면 처음과 끝 행을 포함해 균등하게 샘플링합니다. |
| `maxColumns` | `number` | `showDataTable`은 `50`, `getChartDataTable`은 제한 없음 | 히트맵 전용: 값 열을 같은 방식으로 샘플링합니다. |

- 표에는 `<caption>`(차트 제목)과 `<th scope="col">` / `<th scope="row">` 헤더가 붙습니다. 스크롤 영역은 `role="region"`이고 포커스할 수 있어 키보드로도 스크롤됩니다.
- 샘플링된 표에는 그 사실을 알리는 문구가 붙습니다. `getChartDataTable()`은 `sampled`로 알려 줍니다(히트맵은 `sampledColumns` / `totalColumns`도).
- 열려 있는 표는 차트를 다시 렌더링하거나 테마가 바뀌면 자동으로 갱신됩니다.
- `exportChartCSV()`는 항상 전체 데이터를 씁니다. 스프레드시트가 수식으로 실행할 텍스트 셀(`=`, `+`, `-`, `@`로 시작)에는 앞에 `'`를 붙이고, 숫자는 그대로 씁니다.
- 4096 × 4096 히트맵은 셀이 1,600만 개입니다. `getChartDataTable`에 `maxRows` / `maxColumns`를 주거나 `exportChartCSV()`를 쓰세요.

## 언어

요약, 긴 설명, 키보드 안내, 라이브 안내 문구, 데이터 테이블 헤더는 SDK 로캘을 따릅니다: `Charturbo.create(canvas, { locale })` 또는 `sdk.setLocale(locale)`. 내장 언어는 영어(`en`), 한국어(`ko`), 간체 중국어(`zh-CN`)이고, 그 밖의 로캘은 영어로 대체되며 `undefined`는 브라우저 언어를 씁니다. 숫자와 날짜도 같은 로캘의 `Intl` 형식을 씁니다. [다국어 지원](./i18n)을 참고하세요.

## 고대비와 동작 줄이기

- `forced-colors: active`(Windows 고대비)에서는 범례 견본에 `CanvasText` 테두리가 붙고 시리즈 색이 유지되며(`forced-color-adjust: none`), 숨긴 시리즈는 점선 테두리, 캔버스 포커스 링은 `Highlight` 색입니다. 툴팁과 데이터 테이블 셀에도 `CanvasText` 테두리가 붙습니다.
- 키보드 포커스 링은 현재 글자색의 2 px `:focus-visible` 외곽선입니다.
- 접근성 레이어 자체는 트랜지션을 쓰지 않습니다. 차트 [애니메이션](./animation)은 옵트인이고 `prefers-reduced-motion: reduce`에서는 꺼집니다.

## 패턴 채우기 (decal)

색맹 독자나 흑백 인쇄에서는 색만으로 시리즈를 구분하기 어렵습니다. `decal`(ECharts `aria.decal` / `itemStyle.decal`)은 막대(그룹형 / 누적형 / 백분율, 2D), 파이 / 도넛, 영역, 트리맵, 선버스트, 퍼널 차트의 마크 위에 작은 기호 패턴을 그립니다:

```ts
// 시리즈마다(단일 시리즈 막대는 항목 category마다) 자동 패턴이 하나씩 붙습니다
sdk.renderGroupedBarChart(data, { mode: 'stacked', decal: true });

// 차트 수준 옵션은 자동 패턴 위에 적용되고, 시리즈 / 항목 옵션이 이를 덮어씁니다
sdk.renderGroupedBarChart(
  { categories, series: [{ name: 'A', values: a }, { name: 'B', values: b, decal: { symbol: 'cross', color: '#facc15' } }, { name: 'C', values: c, decal: false }] },
  { decal: { opacity: 0.6 } }
);

// 파이 / 퍼널: 입력 인덱스별 조각 / 단계 덮어쓰기, 트리맵 / 선버스트: 노드의 `decal`
sdk.renderPieChart({ labels, values }, { decal: true, decals: [undefined, { symbol: 'circle' }] });
```

| 옵션 | 기본값 | |
|---|---|---|
| `symbol` | 자동 | `'rect'`, `'circle'`, `'triangle'`, `'diamond'`, `'line'`(줄무늬), `'cross'`, 또는 `'none'` |
| `symbolSize` | 자동(2–7) | 기호 크기(CSS px), 0 < size ≤ 512 (`'line'`은 줄무늬 두께) |
| `spacing` | 자동(8–10) | 타일 크기(CSS px, 기호 중심 사이 거리), 1–1024 |
| `rotation` | 자동 | 도 단위, 화면에서 시계 방향 |
| `color` | `'auto'` | `'auto'`: 밝은 마크에는 검정, 어두운 마크에는 흰색. 또는 임의의 색 |
| `opacity` | 0.45 | 0–1, 색의 알파와 마크의 알파를 곱합니다 |

- 자동 패턴은 서로 다른 기호 / 각도 조합 8가지를 시리즈 순서대로 순환합니다(파이: 조각, 퍼널: 단계, 트리맵 / 선버스트: 최상위 그룹).
- 패턴은 GPU에서 두 번째 패스로 그립니다(텍스처 없음). WebGPU와 WebGL2에서 똑같이 보입니다. 범례 견본에도 패턴이 보이고, SVG 내보내기는 같은 `<pattern>` 정의를 쓰며, 테마를 바꿔도 패턴이 유지됩니다(자동 색은 새 마크 색을 따릅니다). `decal`이 없으면 추가로 그리는 것이 없습니다.
- 패턴은 **화면 공간에 고정**됩니다: 타일이 캔버스 왼쪽 위에서 시작하므로 마크가 움직이거나 확대되거나 애니메이션될 때도 패턴은 제자리에 있습니다(CSS `background-attachment: fixed`와 같음).
- 그리지 않는 곳: 3D 차트, 픽토리얼 막대, 접힌 파이 "기타" 조각, 트리맵 부모 헤더, 선버스트 중심. 겹치는 영역(`mode: 'overlap'`)은 모든 채우기 뒤에 모든 패턴을 그리므로, 겹친 부분에서 아래 시리즈의 패턴이 위 시리즈 위로 보일 수 있습니다.

## 차트별 동작

- **산점도**: 요약에 시리즈별 점 수와 x / y 범위가 들어갑니다. 표는 점마다 한 행(x, y, 시리즈)이고 데이터 순서를 따릅니다.
- **생키**: 요약에 노드 · 열 · 링크 수와 가장 큰 흐름이 들어갑니다. 표는 링크마다 한 행(출발, 도착, 값, 출발 대비 비율)이고 ← / →로 링크를 이동합니다.
- **트리맵 / 선버스트**: 포인터와 마찬가지로 Enter로 포커스한 노드에 드릴다운하고 Esc로 위로 돌아갑니다.
- **스파크라인**: 간소화된 접근성. 캔버스에는 `role="img"`와 추세 문장 `aria-label`(예: `"Revenue: trend up 12% from 100 to 112, min 95, max 120"`)만 붙고 설명, 라이브 영역, `tabindex`는 없습니다. 이름은 `label` 옵션으로 줍니다. [스파크라인](../charts/sparkline)을 참고하세요.

## 한계

- 줌으로 화면 밖에 있는 점은 읽어 주기만 하고 hover는 지웁니다.
- 스크린리더 browse 모드에서는 리더가 화살표 키를 가져갑니다. 차트를 탐색하려면 focus / forms 모드로 전환하세요.

## 함께 보기

- [다국어 지원](./i18n)
- [툴팁과 hover](./tooltips)
- [상호작용](./interactions)
- [내보내기: PNG · SVG · PDF](./export)
