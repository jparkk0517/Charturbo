# 2D 그래프

`renderGraph`는 ECharts `graph` 시리즈처럼 노드와 링크로 이루어진 네트워크를 평면에 그립니다. 노드는 힘 기반 레이아웃, 원 위, 지정한 위치, 직교 좌표축 위에 놓을 수 있습니다. 범주는 노드 색을 정하고 범례를 채웁니다. 관계도, 의존성 그래프, 작은 소셜 네트워크에 쓰세요. 수천 노드 규모의 3D 네트워크(궤도 카메라)는 [3D 네트워크 그래프](./graph-3d)를 보세요.

[라이브 예제](https://jparkk0517.github.io/Charturbo/graph.html#04-graph-force-2d)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGraph(
  {
    nodes: [
      { id: 'api', name: 'API', value: 12, category: 'Service' },
      { id: 'db', name: 'Database', value: 30, category: 'Storage' },
      { id: 'web', name: 'Web', value: 8, category: 'Service' },
    ],
    links: [
      { source: 'web', target: 'api' },
      { source: 'api', target: 'db', lineWidth: 3 },
    ],
  },
  { title: 'Services', layout: 'force', symbolSize: [10, 24], edgeSymbol: 'arrow' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderGraph(data: GraphChartData, options?: GraphChartOptions): { nodeCount: number; linkCount: number }
```

## 데이터 형식

```ts
interface GraphChartData {
  nodes: GraphNodeInput[];
  links?: GraphLinkInput[];
  edges?: GraphLinkInput[];             // links의 별칭(ECharts)
  categories?: (GraphCategoryInput | string)[];
}

interface GraphNodeInput {
  id?: string | number;   // 링크 키(기본값: 이름, 그다음 인덱스)
  name?: string;
  value?: number;         // 툴팁, 원형 구간 크기, symbolSize [min, max]
  x?: number | string;    // layout 'none' / 'cartesian'(필수); force: 시작 위치
  y?: number;
  category?: number | string; // categories의 인덱스 또는 범주 이름
  symbolSize?: number;    // CSS px 지름(옵션보다 우선)
  fixed?: boolean;        // force: x / y에 고정
  color?: ColorInput;
}

interface GraphLinkInput {
  source: string | number; // 노드 id, 이름, 인덱스
  target: string | number;
  value?: number;
  lineWidth?: number;      // CSS px(기본값: lineWidth 옵션)
}

interface GraphCategoryInput { name: string; color?: ColorInput }
```

- 링크 끝은 `id`, `name`, 노드 인덱스 순서로 찾습니다.
- `categories`에 없는 범주 이름은 목록 끝에 추가됩니다. `categories` 없이 숫자 범주만 쓰면 기본 이름(`범주 1`, …, 언어별)이 붙습니다.
- 잘못된 입력은 현재 차트를 바꾸기 전에 오류를 던지므로, 실패한 호출 뒤에도 기존 차트가 그대로 남습니다. 오류 메시지에는 노드나 링크가 나옵니다: 빈 노드 목록, 알 수 없는 링크 끝, 범위를 벗어난 범주, 유한하지 않은 값, `layout: 'none'` / `'cartesian'`에서 빠진 `x` / `y`, 축 범주에 없는 `x` 이름.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `layout` | `'force' \| 'circular' \| 'none' \| 'cartesian'` | `'force'` | 노드 배치 방식(레이아웃 참고). |
| `force` | `{ repulsion?, edgeLength?, gravity?, iterations? }` | `50, 30, 0.1, 300` | 힘 기반 레이아웃 매개변수. |
| `rotateLabel` | `boolean` | `false` | 원형: 레이블이 반지름 방향으로 바깥을 향합니다. |
| `symbol` | `'circle' \| 'rect' \| 'diamond' \| 'triangle'` | `'circle'` | 노드 기호. |
| `symbolSize` | `number \| [min, max]` | `10` | CSS px 지름, 또는 `value`에 비례한 선형 크기. |
| `lineWidth` | `number` | `1` | 엣지 두께(CSS px). |
| `curveness` | `number` | `0` | 엣지 휨(0 = 직선). |
| `edgeSymbol` | `'none' \| 'arrow'` | `'none'` | `'arrow'`: 도착 노드에 화살촉. |
| `edgeSymbolSize` | `number` | `8` | 화살표 길이(CSS px). |
| `edgeColor` | `'neutral' \| 'source' \| 'target'` | `'neutral'` | 엣지 색: 중립 회색, 또는 출발 / 도착 노드 색. |
| `edgeOpacity` | `number` | `1`(neutral), `0.6`(source / target) | 엣지 불투명도, 0–1. |
| `xAxis` | `{ min?, max?, title?, format?, categories? }` | | 직교 좌표 x축. `categories`를 주면 범주 축입니다. |
| `yAxis` | `{ min?, max?, title?, format? }` | | 직교 좌표 y축. |
| `legend` | `ChartLegendOptions \| boolean` | 범주가 있으면 표시 | 범주 범례: 클릭하면 범주를 숨기고, 호버하면 강조합니다. |
| `colors` | `ColorInput[]` | 테마 팔레트 | 범주 팔레트. 범주의 `color`가 해당 칸보다 우선합니다. |
| `labels` | `boolean` | `true` | 노드 이름(겹치는 레이블은 생략, 최대 1,500개). |
| `format` | `ChartValueFormat` | 로캘 숫자 | 툴팁과 접근성의 값 텍스트. `yAxis.format`이 없으면 직교 좌표 y축 눈금에도 씁니다. |
| `valueLabel` | `string` | `'값'`(언어별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근 가능한 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

## 레이아웃

- `force`: [3D 네트워크 그래프](./graph-3d)의 Barnes-Hut 힘 시뮬레이션을 Rust에서 평면으로 안정될 때까지 돌린 뒤 플롯에 맞춥니다. 시작 배치는 결정적인 나선이라 같은 데이터는 같은 그림이 됩니다. `fixed: true`와 `x` / `y`가 있는 노드는 제자리에 머뭅니다.
- `circular`: 입력 순서대로 노드를 원 위에 둡니다. 모든 값이 0 이상이고 합이 0보다 크면 노드마다 값에 비례한 구간을 받고(값이 0이면 구간 없음), 그렇지 않으면 같은 간격입니다. `rotateLabel`은 레이블을 바깥쪽으로 돌립니다.
- `none`: 지정한 `x` / `y`(화면 좌표처럼 y가 아래로)를 플롯에 맞춥니다.
- `cartesian`: 지정한 `x` / `y`를 격자선이 있는 차트 축 위에 둡니다(y가 위로). `xAxis.categories`를 주면 x가 범주 축이 되고, 노드는 `x`를 범주 이름이나 인덱스로 줍니다.

```ts
sdk.renderGraph(data, { layout: 'circular', rotateLabel: true, curveness: 0.3, edgeColor: 'source' });
sdk.renderGraph(data, { layout: 'cartesian', xAxis: { categories: ['Q1', 'Q2', 'Q3', 'Q4'] }, yAxis: { min: 0 } });
```

[원형 예제](https://jparkk0517.github.io/Charturbo/graph.html#05-graph-circular) · [직교 좌표 예제](https://jparkk0517.github.io/Charturbo/graph.html#06-graph-cartesian)

## 상호작용

`enableNodeInteractions(canvas)`로 켭니다. 노드에 호버하면 그 노드와 링크, 이웃을 강조하고 나머지는 흐려집니다. 범례는 범주를 숨기거나 강조합니다(코드에서는 `setSeriesVisible(k, visible)`). 숨긴 노드에 닿는 링크도 숨겨집니다. 브러시, 확대/축소, 이동은 꺼져 있습니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'graph'
// ctx.hierarchy = { node, name, path: [category, name], value, children: <연결 수> }
// ctx.details.metadata.attributes = { name, category, value, links }
```

React와 Vue: `<CharturboChart type="graph" data={...} options={...} />`.

## 참고 사항

- 접근성: 요약(노드·범주·링크 수, 연결이 가장 많은 노드), 데이터 표(노드, 범주, 값, 연결, 연결 대상). 키보드: 위 / 아래는 입력 순서로 노드 이동, 오른쪽 / 왼쪽은 다음 / 이전 연결 노드로 이동, Home / End. [접근성](../guide/accessibility) 참고.
- CSV와 SVG 내보내기에 그래프가 포함됩니다.
- 아직 지원하지 않음: 노드 드래그(대신 `fixed`로 고정), 자기 루프, 엣지 호버, 애니메이션되는 힘 안정화.

## 함께 보기

- [3D 네트워크 그래프](./graph-3d)
- [트리](./tree)
- [생키](./sankey)
