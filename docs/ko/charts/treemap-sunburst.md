# 트리맵 · 선버스트

`renderTreemap`은 계층을 중첩된 사각형(squarified 레이아웃)으로, `renderSunburst`는 깊이마다 링 하나씩으로 그립니다. 둘 다 트리 안의 부분 대 전체 비율을 보여 주고 클릭 드릴다운을 지원합니다. 잎이 많고 면적을 정확히 비교하려면 트리맵을, 깊이 구조가 중요하면 선버스트를 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## 기본 사용법

```ts
import { Charturbo, type HierarchyNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// 잎에 `value`; 부모 값 = 자식 값의 합
const tree: HierarchyNode = {
  name: '매출',
  children: [
    { name: '미주', children: [{ name: '하드웨어', value: 420 }, { name: '소프트웨어', value: 310 }] },
    { name: '유럽', children: [{ name: '하드웨어', value: 260 }, { name: '서비스', value: 180 }] },
  ],
};

sdk.renderTreemap(tree, { title: '매출', format: '$,.0f' });
// 또는: sdk.renderSunburst(tree, { title: '매출', format: '$,.0f' });
sdk.on('drill', (e) => console.log(e.path.join(' › ')));
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderTreemap(data: HierarchyData, options?: TreemapChartOptions): { nodeCount: number }
renderSunburst(data: HierarchyData, options?: SunburstChartOptions): { nodeCount: number }
drillTo(target: number | string): boolean
drillUp(): boolean
```

## 데이터 형식

`HierarchyData`는 중첩된 루트 노드 하나, 또는 평면 행의 배열입니다.

```ts
type HierarchyData = HierarchyNode | HierarchyFlatNode[];

// 중첩 트리
interface HierarchyNode {
  name: string;
  value?: number;              // 잎 값, 유한하고 0 이상 (없으면 0; 부모에서는 무시)
  children?: HierarchyNode[];
  color?: ColorInput;          // 이 노드의 채우기 색 덮어쓰기
}

// 평면 행: `parent`는 다른 행의 `id` (없음 / null = 루트)
interface HierarchyFlatNode {
  id: string | number;
  parent?: string | number | null;
  value?: number;
  name?: string;               // 표시 이름 (기본: id)
  color?: ColorInput;
}
```

```ts
sdk.renderSunburst([
  { id: 'src', name: 'src' },
  { id: 'sdk', parent: 'src', name: 'sdk' },
  { id: 'core', parent: 'sdk', name: 'charturbo.ts', value: 294 },
  { id: 'a11y', parent: 'sdk', name: 'chart-a11y.ts', value: 79 },
  { id: 'vue', parent: 'src', name: 'vue' },
  { id: 'vc', parent: 'vue', name: 'CharturboChart.ts', value: 3.7 },
], { title: '소스 크기 (KB)', format: ',.1f' });
```

- 부모 값은 항상 자식 값의 합입니다. 부모에 준 `value`는 무시합니다.
- 잎 값은 유한하고 `>= 0`이어야 합니다(`NaN`은 0으로 셉니다).
- 평면 행에 루트가 여러 개면 `rootLabel`(기본 `'전체'`, 로캘별) 이름의 가상 루트가 생깁니다.
- 순환이 있으면 순환 경로의 노드 이름을 담은 예외를 던집니다.
- 자식은 큰 값부터 정렬합니다.

## 옵션

두 차트 공통(`HierarchyChartOptions`):

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `colors` | `ColorInput[]` | 테마 팔레트 | 고정 순서의 범주형 팔레트. |
| `colorBy` | `'auto' \| 'group' \| 'value'` | `'auto'` | `'group'`: 최상위 그룹별 팔레트, 팔레트를 넘는 그룹은 중립색 "Other"로 접습니다. `'value'`: 깊이별로 정규화한 값 컬러맵. `'auto'`: 최상위 그룹이 팔레트에 들어가면 그룹, 아니면 값. |
| `colormap` | `'sequential' \| 'viridis' \| 'magma'` | `'sequential'` | `colorBy: 'value'`의 컬러맵. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 라벨, 툴팁, 중앙, 접근성의 값 형식(`'$,.0f'` 같은 형식 문자열, `Intl` 옵션, 함수). [숫자·날짜 형식](../guide/number-format) 참고. |
| `labels` | `boolean` | `true` | 들어갈 자리가 있는 곳에 DOM 라벨 표시. |
| `maxDepth` | `number` | `0`(전부) | 현재 루트 아래로 보여 줄 단계 수. `0` = 전부. |
| `legend` | `ChartLegendOptions \| boolean` | 그룹 색 모드에서 그룹 2개 이상이면 표시 | 최상위 그룹. hover하면 그룹을 강조하고, 토글은 없습니다. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `rootLabel` | `string` | `'전체'` (로캘별) | 루트가 여러 개일 때 그 위에 두는 가상 루트의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

트리맵 전용(`TreemapChartOptions`):

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `innerPadding` | `number` | `2` | 부모가 자식 둘레에 두는 안쪽 여백(CSS px). |
| `headerHeight` | `number` | `20` | 부모의 헤더 띠 높이(CSS px). `0` = 없음. |

`SunburstChartOptions`는 `HierarchyChartOptions`와 같습니다.

## 드릴다운

두 차트 모두 최상위 루트에서 시작해 하위 트리로 드릴다운할 수 있습니다.

- **트리맵**: 셀을 클릭하면 그 셀이 속한, 현재 루트의 자식 그룹으로 들어갑니다.
- **선버스트**: 호를 클릭하면 그 호로 들어가고, 중앙을 클릭하면 위로 올라갑니다.
- 브레드크럼(제목 · 범례 아래)과 Escape 키로 위로 올라갑니다.
- 키보드: Enter는 포커스된 노드로 드릴다운, Escape는 위로.

드릴할 때마다 `'drill'` 이벤트가 발생합니다.

```ts
interface CharturboDrillEvent {
  kind: 'treemap' | 'sunburst';
  node: number;            // 노드 인덱스 (트리 입력: 깊이 우선 순서; 가상 루트는 마지막)
  id?: string | number;    // 평면 입력의 id (트리 입력: undefined)
  name: string;
  path: string[];          // 최상위 루트부터 `node`까지의 이름
}

const off = sdk.on('drill', (e) => console.log(e.kind, e.path.join(' › ')));
```

코드에서는 `drillTo`와 `drillUp`으로 드릴합니다. `drillTo`는 노드 인덱스, 평면 입력의 `id`, 노드 이름(첫 번째 일치) 중 하나를 받습니다. 둘 다 바뀌는 것이 없으면(예: 잎이거나 이미 최상위) `false`를 반환합니다. `'drill'` 이벤트는 발생하지만 렌더링은 하지 않으므로 이어서 `render()`를 호출합니다. 포인터, 키보드, 브레드크럼 드릴은 스스로 렌더링합니다.

```ts
sdk.drillTo('미주');
sdk.render();
sdk.drillUp();
sdk.render();
```

React에서는 `onDrill`, Vue에서는 `@drill`을 씁니다. [React](../guide/react), [Vue](../guide/vue) 참고.

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다.

- 트리맵 hover는 포인터 아래 셀의 외곽선을 그립니다(헤더와 여백은 부모에 속함).
- 선버스트 hover는 경로(조상과 하위 트리)를 강조하고 나머지 호는 표면 쪽으로 흐려집니다. 중앙에는 현재 루트의 값과 이름, hover 중에는 해당 노드와 비율이 나타납니다.
- 브러시, 줌, 커서 동기화는 비활성입니다.
- 데이터 포인트 id는 노드 인덱스입니다(트리 입력: 깊이 우선 순서, 가상 루트는 마지막).

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'treemap' | 'sunburst'
// ctx.index = 노드 인덱스
// ctx.hierarchy = { node, name, path, value, percentOfParent, percentOfTotal, depth, children }
// percentOfParent / percentOfTotal: 0-100, 루트는 NaN; children: 표시되는 자식 수 (0 = 잎)
```

## 참고 사항

- 검증, 순환 검출, 값 집계, 정렬은 엔진(Rust)에서 O(n)으로 처리합니다.
- 트리맵: 자식 평균 면적이 36px² 미만인 부모(또는 `maxDepth` 경계에 있는 부모)는 한 셀로 그리므로, 그리는 양은 데이터 크기가 아니라 화면에 따라 정해집니다. 셀은 디바이스 픽셀에 맞춰 정확히 2px 간격을 둡니다.
- 선버스트: 1px보다 짧은 호는 하위 트리와 함께 생략합니다.
- 라벨은 들어갈 수 있는 셀 / 호에만 큰 것부터 붙입니다(트리맵 최대 600개, 선버스트 최대 300개). 들어가지 않는 이름은 줄임표로 자릅니다.
- 접근성: 요약(노드 수, 합계, 상위 그룹 비율), 데이터 표(노드마다 경로, 값, 부모 대비 %, 전체 대비 %), 키보드 탐색: 좌우 = 형제, 아래 = 첫 자식, 위 = 부모, Enter = 드릴다운, Escape = 위로. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [생키](./sankey)
- [파이 · 도넛](./pie)
- [히트맵](./heatmap) (컬러맵)
- [툴팁과 hover](../guide/tooltips)
