# 트리

`renderTree`는 계층을 노드-링크 다이어그램으로 그립니다. d3 `tree()`의 tidy tree 레이아웃을 직교(왼쪽→오른쪽, 오른쪽→왼쪽, 위→아래, 아래→위) 또는 방사형으로 배치합니다. 부모 노드는 클릭이나 키보드로 펼치고 접으며, 트리는 트윈과 함께 다시 배치됩니다. 값보다 구조가 중요한 조직도, 파일 트리, 분류 체계, 의사결정 트리에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html#05-tree)

## 기본 사용법

```ts
import { Charturbo, type TreeChartNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { animation: { duration: 450 } });

const tree: TreeChartNode = {
  name: 'charturbo',
  children: [
    { name: 'core', children: [{ name: 'chart' }, { name: 'scene' }, { name: 'graph' }] },
    { name: 'sdk', children: [{ name: 'charturbo.ts' }, { name: 'messages', collapsed: true, children: [{ name: 'en' }, { name: 'ko' }] }] },
    { name: 'react' },
  ],
};
sdk.renderTree(tree, { title: 'Package layout', initialTreeDepth: 2 });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderTree(data: TreeChartData, options?: TreeChartOptions): { nodeCount: number }
setTreeNodeExpanded(target: number | string, expanded: boolean): boolean
toggleTreeNode(target: number | string): boolean
```

## 데이터 형식

입력은 [트리맵 · 선버스트](./treemap-sunburst)와 같은 형태입니다. 중첩된 루트 하나 또는 평면 행 배열입니다.

```ts
type TreeChartData = TreeChartNode | TreeChartFlatNode[];

interface TreeChartNode {
  name: string;
  value?: number;            // 선택, 그대로 표시 (부모가 자식 합을 갖지 않음)
  children?: TreeChartNode[];
  color?: ColorInput;
  collapsed?: boolean;       // 접힌 채 시작 (false: 펼친 채 시작); initialTreeDepth보다 우선
}

interface TreeChartFlatNode {
  id: string | number;
  parent?: string | number | null; // 다른 행의 id (없음 / null = 루트)
  name?: string;                   // 표시 이름 (기본: id)
  value?: number;
  color?: ColorInput;
  collapsed?: boolean;
}
```

- 자식은 입력 순서를 유지합니다(값으로 정렬하지 않음).
- 루트가 여러 개인 평면 행은 `rootLabel`(기본 `'전체'`, 로캘별) 이름의 합성 루트 아래에 놓입니다.
- 순환이 있으면 순환에 속한 노드 이름을 담은 오류를 던집니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `layout` | `'orthogonal' \| 'radial'` | `'orthogonal'` | `'radial'`: 루트를 가운데, 말단을 가장자리에 둡니다. |
| `orient` | `'LR' \| 'RL' \| 'TB' \| 'BT'` | `'LR'` | 직교 레이아웃에서 루트 → 말단 방향. |
| `edgeShape` | `'curve' \| 'polyline'` | `'curve'` | 3차 베지어 또는 꺾은선 간선. 방사형은 항상 곡선입니다. |
| `initialTreeDepth` | `number` | `2` | 처음에 펼칠 단계 수(루트 = 0, `-1` = 전부). 노드의 `collapsed`가 우선합니다. |
| `expandAndCollapse` | `boolean` | `true` | 클릭, Enter, Space로 부모를 펼치고 접습니다. |
| `symbol` | `'emptyCircle' \| 'circle' \| 'rect' \| 'diamond' \| 'triangle' \| 'none'` | `'emptyCircle'` | 노드 기호. `'emptyCircle'`이면 접힌 부모는 채워집니다. |
| `symbolSize` | `number` | `7` | 기호 지름(CSS px). |
| `lineWidth` | `number` | `1.5` | 간선 두께(CSS px). |
| `curvature` | `number` | `0.5` | 베지어 제어점 오프셋, 0–1. |
| `colorBy` | `'single' \| 'group'` | `'single'` | `'group'`: 최상위 가지마다 팔레트 색 하나. |
| `colors` | `ColorInput[]` | 테마 팔레트 | `colorBy: 'group'`의 팔레트. |
| `labels` | `boolean` | `true` | 노드 이름. |
| `format` | `ChartValueFormat` | 로캘 숫자 | 툴팁과 접근성의 값 텍스트. |
| `valueLabel` | `string` | `'값'`(로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `rootLabel` | `string` | `'전체'`(로캘별) | 루트가 여러 개인 평면 행의 합성 루트 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근 가능한 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

## 레이아웃

- 엔진(Rust)이 Walker / Buchheim tidy tree를 O(n)으로 계산합니다. d3 간격 규칙(형제 1, 사촌 2, 방사형에서는 깊이로 나눔)을 따릅니다.
- 펼친 노드만 레이아웃에 참여하므로 가지를 접으면 나머지 트리가 촘촘해집니다.
- 트리는 플롯에 맞춰집니다. 바깥쪽에 루트와 말단 라벨 자리를 남깁니다(방사형 반지름은 가장 긴 말단 라벨만큼 줄어듭니다).
- 라벨: 직교 레이아웃에서 말단은 루트 반대쪽, 부모는 루트 쪽에 이름을 둡니다. TB / BT의 말단 라벨은 세로로 씁니다. 방사형 라벨은 바깥쪽으로 회전하고, 왼쪽 절반에서는 글자가 뒤집히지 않게 반대로 돌립니다. 이웃과 겹치는 라벨은 생략합니다.

```ts
sdk.renderTree(rows, { layout: 'radial', colorBy: 'group', initialTreeDepth: -1 });
sdk.renderTree(tree, { orient: 'TB', edgeShape: 'polyline', symbol: 'rect' });
```

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html#06-tree-radial)

## 펼치기와 접기

- 부모를 클릭하면 펼침 상태가 바뀝니다(말단은 반응하지 않음). `animation`이 켜져 있으면 노드와 간선이 이전 레이아웃에서 새 레이아웃으로 트윈되고, 접히는 가지는 부모 쪽으로 모입니다.
- `setTreeNodeExpanded(target, expanded)`와 `toggleTreeNode(target)`은 노드 인덱스, 평면 행 `id`, 노드 이름을 받습니다. 바뀐 것이 없으면(말단, 숨은 노드, 트리 아님) `false`를 반환합니다. 호출 뒤 `render()`를 부르세요. 포인터와 키보드 토글은 스스로 렌더링합니다.
- 토글마다 `'treeToggle'`을 발생시킵니다.

```ts
sdk.on('treeToggle', (e) => console.log(e.name, e.expanded, e.path));
// e: { node: number; id?: string | number; name: string; path: string[]; expanded: boolean }
```

React와 Vue: `<CharturboChart type="tree" data={...} options={...} onTreeToggle={...} />` (Vue: `@tree-toggle`).

## 상호작용

`enableNodeInteractions(canvas)`로 켭니다. 호버하면 노드를 강조하고 경로, 이름, 값을 보여 줍니다. 브러시, 줌, 커서 동기화는 꺼지며 팬과 줌은 없습니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'tree'
// ctx.xLabel = 'Root › A › a1'
// ctx.hierarchy = { node, name, path, value, depth, ... }   // 값이 없으면 value는 NaN
```

## 참고 사항

- 접근성: 요약(노드·단계 수, 표시 중인 노드, 루트의 자식), 데이터 표(경로, 값, 깊이, 상태). 키보드: 위 / 아래는 형제, 오른쪽은 펼친 노드의 첫 자식, 왼쪽은 부모, Home / End, Enter나 Space로 펼치기 / 접기. [접근성](../guide/accessibility) 참고.
- CSV와 SVG 내보내기에 트리가 포함됩니다. 라벨 폭은 추정값(11px 글자당 약 6.8px)이라 아주 긴 이름은 `…`로 줄입니다.

## 함께 보기

- [트리맵 · 선버스트](./treemap-sunburst)
- [생키](./sankey)
- [툴팁과 hover](../guide/tooltips)
