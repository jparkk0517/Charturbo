# 코드 다이어그램

`renderChordChart`는 그룹 사이의 흐름을 원으로 그립니다. 그룹마다 전체 흐름 크기의 바깥 호를 두고, 두 그룹을 잇는 리본의 양 끝 폭은 각 방향의 흐름입니다. 레이아웃은 d3 `chord()`(`directed`이면 `chordDirected()`)와 같습니다. 인구 이동, 무역, 팀 간 이관처럼 정사각 "출발 → 도착" 행렬에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html#07-chord)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderChordChart(
  {
    names: ['Black', 'Blond', 'Brown', 'Red'],
    matrix: [
      [11975, 5871, 8916, 2868],
      [1951, 10048, 2060, 6171],
      [8010, 16145, 8090, 8045],
      [1013, 990, 940, 6907],
    ],
  },
  { title: 'Hair color preferences', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderChordChart(data: ChordChartData, options?: ChordChartOptions): { groupCount: number; chordCount: number }
```

## 데이터 형식

```ts
type ChordChartData =
  | { matrix: ArrayLike<ArrayLike<number>>; names?: string[] }
  | { nodes: (string | ChordNode)[]; links: ChordLink[] };

interface ChordNode { name: string; color?: ColorInput }
interface ChordLink { source: string | number; target: string | number; value: number }
```

- `matrix[i][j]`는 그룹 `i`에서 그룹 `j`로 가는 흐름입니다. 행렬은 정사각이고 그룹은 1~256개입니다. 값은 유한한 `>= 0`이어야 하며 하나 이상은 0보다 커야 합니다. 대각선(자기 자신으로 가는 흐름)은 자기 리본으로 그립니다.
- `names`는 행마다 이름 하나입니다. 없으면 `그룹 1`, `그룹 2`, …(차트 로캘)입니다.
- ECharts 형식 `nodes` / `links`: 링크는 출발과 도착을 노드 이름이나 인덱스로 가리킵니다. 같은 링크가 반복되면 더합니다. 없는 노드나 중복 노드는 예외를 던집니다.
- 입력은 현재 차트를 바꾸기 전에 검증합니다. 예외가 나면 이전 차트가 그대로 남습니다.

## 방향 코드

기본(d3 `chord()`)에서는 두 그룹이 리본 하나를 함께 씁니다. 양 끝 폭은 두 방향의 흐름이고, 큰 방향이 출발입니다. `directed: true`는 d3 `chordDirected()`를 써서 방향마다 리본을 하나씩 두고 도착 쪽에 화살표 끝을 그립니다.

```ts
sdk.renderChordChart(
  {
    nodes: ['Asia', 'Europe', 'Africa'],
    links: [
      { source: 'Asia', target: 'Europe', value: 14 },
      { source: 'Europe', target: 'Asia', value: 4 },
      { source: 'Africa', target: 'Europe', value: 9 },
    ],
  },
  { directed: true, ribbonColor: 'gradient', labelRotate: true }
);
```

[라이브 예제](https://jparkk0517.github.io/Charturbo/hierarchy.html#08-chord-directed)

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `padAngle` | `number` | `3` | 그룹 사이 간격(도). `n * padAngle`은 360보다 작아야 합니다. |
| `startAngle` | `number` | `0` | 첫 그룹이 시작하는 각도. 12시에서 시계 방향 도 단위. |
| `clockwise` | `boolean` | `true` | 그룹을 시계 방향으로 놓습니다. |
| `sortGroups` | `'none' \| 'ascending' \| 'descending'` | `'none'` | 합계 기준 그룹 순서. |
| `sortSubgroups` | `ChordSortOrder` | `'none'` | 각 그룹 호 위 리본 순서(값 기준). |
| `sortChords` | `ChordSortOrder` | `'none'` | 리본 그리기 순서(두 값의 합 기준). |
| `directed` | `boolean` | `false` | 방향마다 리본 하나, 화살표 끝 포함. |
| `ribbonColor` | `'source' \| 'target' \| 'gradient' \| 'neutral'` | `'source'` | 리본 색: 출발 그룹, 도착 그룹, 출발→도착 그라데이션, 테마 중립색. |
| `ribbonOpacity` | `number` | `0.6` | 리본 불투명도, 0~1. |
| `arcWidth` | `number` | `14` | 그룹 호 두께(CSS px). |
| `labels` | `boolean` | `true` | 원 바깥의 그룹 이름. |
| `labelRotate` | `boolean` | `false` | 이름을 수평 대신 반지름 방향으로 놓습니다. |
| `colors` | `(ColorInput \| undefined)[]` | | 그룹별 색. 없으면 노드 `color`, 그다음 팔레트. |
| `palette` | `ColorInput[]` | 테마 팔레트 | 자기 색이 없는 그룹의 색. |
| `legend` | `boolean \| ChartLegendOptions` | 그룹 2개 이상이면 표시 | 그룹 범례. 호버하면 그룹 강조, 클릭하면 숨김. |
| `valueLabel` | `string` | `'Value'`(로캘 적용) | 툴팁과 데이터 표에 쓰는 값 이름. |
| `format` | `ChartValueFormat` | 로캘 숫자 | 툴팁과 접근성의 값 텍스트. [숫자 · 날짜 형식](../guide/number-format) 참고. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근 가능한 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

잘못된 옵션은 예외를 던집니다: 음수이거나 너무 큰 `padAngle`, 유한하지 않은 `startAngle`, 0~1 밖의 `ribbonOpacity`, 1보다 작은 `arcWidth`, 알 수 없는 정렬값이나 `ribbonColor`.

## 상호작용

`enableNodeInteractions(canvas)`로 켭니다.

- 그룹 호에 마우스를 올리면 그 그룹의 리본을 강조하고 나머지를 흐리게 하며 그룹 합계를 보여 줍니다.
- 리본에 마우스를 올리면 `출발 → 도착` 흐름과, 있으면 반대 방향 흐름을 보여 줍니다.
- 범례에 마우스를 올리면 그룹을 강조합니다. 클릭하면 그룹을 숨기고 원을 다시 배치합니다. `animation`이 켜져 있으면 호와 리본이 새 레이아웃으로 트윈됩니다.
- 브러시, 줌, 팬은 꺼집니다.

데이터 포인트 id: 그룹 `i`는 `i`, `s`에서 `t`로 가는 리본은 `n + s * n + t`입니다.

툴팁 컨텍스트([툴팁과 호버](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'chord'
// ctx.chord = { kind: 'group' | 'ribbon', source, target, sourceName, targetName, value, reverse? }
// 그룹: source === target, value = 합계. 리본: value = 출발 → 도착, reverse = 도착 → 출발
```

## 참고 사항

- 레이아웃, 호, 리본, 화살표 끝, 히트 테스트, 강조, 라벨 위치는 엔진(Rust)에서 계산합니다. 호와 리본은 벡터 마크라서 `exportChartSVG`가 SVG 경로로 씁니다.
- 접근성: 요약(그룹 수, 코드 수, 가장 큰 흐름). 데이터 표와 `exportChartCSV`는 흐름 행렬(행 = 출발, 열 = 도착)입니다. 키보드: 왼쪽 / 오른쪽은 그룹 사이 또는 코드 사이 이동, 아래는 그룹에서 첫 코드로, 위는 코드에서 출발 그룹으로, Home / End는 처음 / 마지막 항목, Esc는 해제. [접근성](../guide/accessibility) 참고.
- 라벨 폭은 추정값(11px 글자당 약 6.8px)이라 아주 긴 이름은 `…`로 줄입니다.
- React / Vue: `type="chord"`.

## 함께 보기

- [생키](./sankey)
- [트리](./tree)
- [툴팁과 호버](../guide/tooltips)
