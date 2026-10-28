# 생키

`renderSankey`는 노드 사이의 흐름을 값에 비례하는 폭의 리본으로 그리고, 노드를 열로 배치합니다. 예산, 에너지 수지, 사용자 여정처럼 방향이 있고 순환이 없는 흐름에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const link = (source: string, target: string, value: number) => ({ source, target, value });
sdk.renderSankey(
  {
    nodes: ['석탄', '가스', '태양광', '전력', '열', '가정', '산업'].map((id) => ({ id })),
    links: [
      link('석탄', '전력', 30), link('석탄', '열', 12),
      link('가스', '전력', 22), link('가스', '열', 18),
      link('태양광', '전력', 14),
      link('전력', '가정', 36), link('전력', '산업', 30),
      link('열', '가정', 18), link('열', '산업', 12),
    ],
  },
  { title: '에너지 (TWh)', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderSankey(data: SankeyChartData, options?: SankeyChartOptions): { nodeCount: number; linkCount: number }
```

## 데이터 형식

```ts
interface SankeyChartData {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
}

interface SankeyNodeInput {
  id: string | number;
  name?: string;        // 표시 이름 (기본: id)
  color?: ColorInput;
  group?: string;       // 색 그룹 (처음 나온 순서로 팔레트 배정; 범례에 그룹을 나열)
  column?: number;      // 최소 열 (0 = 왼쪽)
}

interface SankeyLinkInput {
  source: string | number; // 노드 id
  target: string | number; // 노드 id
  value: number;           // 유한하고 0 이상
}
```

- 노드 값은 유입과 유출 중 큰 값입니다.
- `column`은 최솟값입니다. 노드는 항상 모든 출발 노드보다 오른쪽에 놓이고, 사용된 열만 남깁니다.
- 다음 입력은 예외를 던집니다.
  - 중복된 노드 id, 또는 알 수 없는 id를 가리키는 링크(`Sankey link 3 has an unknown source "X"`)
  - 음수이거나 유한하지 않은 링크 값
  - 자기 자신으로 가는 링크, 또는 순환을 이루는 링크(`Sankey links form a cycle: "A" -> "B" -> "A"`)
  - 양 끝 노드에 모두 `column`을 명시했는데 같은 열이나 앞쪽 열로 가는 링크

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `nodeWidth` | `number` | `12` | 노드 막대 폭(CSS px). |
| `nodePadding` | `number` | `10` | 같은 열 노드 사이의 세로 간격(CSS px). |
| `iterations` | `number` | `32` | 레이아웃 이완 반복 횟수. |
| `align` | `'justify' \| 'left' \| 'right' \| 'center'` | `'justify'` | `column`이 없는 노드의 열 배정. `'justify'`는 도착 노드(sink)를 마지막 열에 놓습니다. |
| `linkColor` | `'source' \| 'target' \| 'neutral'` | `'source'` | 리본 색. |
| `linkOpacity` | `number` | `0.5` | 리본 불투명도. |
| `colors` | `ColorInput[]` | 테마 팔레트 | 고정 순서의 범주형 팔레트. |
| `labels` | `boolean` | `true` | 막대 옆 노드 라벨. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 라벨, 툴팁, 접근성의 값 형식. [숫자·날짜 형식](../guide/number-format) 참고. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 그룹 2개 이상이면 표시 | 노드 그룹을 나열합니다. 정적이라 토글이나 강조가 없습니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

## 레이아웃

레이아웃은 d3-sankey 방식을 따르며 엔진(Rust)에서 계산합니다.

1. 열: 출발 노드로부터의 최장 경로를 기준으로 하고, `align`이나 명시적 `column`으로 조정합니다.
2. 노드 높이는 값에 비례하고, 가장 빽빽한 열이 들어가도록 배율을 정합니다.
3. `iterations`회 이완: 노드를 이웃의 가중 위치 쪽으로 옮기고(오른쪽 → 왼쪽, 왼쪽 → 오른쪽), 열마다 충돌을 해소합니다. 마지막 회차 이후 같은 열의 노드는 겹치지 않습니다.

링크는 양 끝에서 수평 접선을 갖는 3차 베지어 리본입니다. 반투명으로, 두꺼운 것부터 그려서 얇은 흐름이 위에 보입니다.

## 색과 라벨

- 노드 색: `group`이 있으면 그룹별, 아니면 노드 수가 팔레트 이하일 때 노드별, 그 밖에는 열별입니다(팔레트를 넘는 노드는 회색).
- 라벨은 이름과 값을 표시합니다. 왼쪽 절반의 노드는 오른쪽에, 나머지는 왼쪽에 놓습니다. 같은 열에서 두 라벨이 줄 간격보다 가까우면 큰 노드의 라벨을 남깁니다.

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다. hover는 노드를 먼저 찾고, 그다음 리본을 위에서부터 찾습니다. hover한 노드나 링크에 연결된 흐름만 밝게 표시합니다. 드릴다운은 없습니다. 브러시, 줌, 커서 동기화는 비활성입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'sankey'
// ctx.flow = { kind: 'link', source, target, value, percentOfSource }
//          | { kind: 'node', source, value, inflow, outflow }   // 노드: `source`에 노드 이름
```

데이터 포인트 id: 노드는 노드 인덱스, 링크는 노드 수 + 링크 인덱스.

## 참고 사항

- 이완 1회 비용은 O(N + L log L)이라 허브 노드가 있어도 부담이 적습니다.
- 접근성: 요약(노드 · 열 · 링크 수, 가장 큰 흐름), 데이터 표(링크마다 출발, 도착, 값, 출발 대비 %), 좌우 화살표로 링크 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [트리맵 · 선버스트](./treemap-sunburst)
- [퍼널](./funnel)
- [툴팁과 hover](../guide/tooltips)
- [스타일과 테마](../guide/styling)
