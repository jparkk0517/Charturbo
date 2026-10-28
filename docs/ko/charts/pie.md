# 파이 · 도넛

`renderPieChart`는 파이 차트를, `donut`을 주면 도넛 차트를 그립니다. 하나의 전체를 몇 개의 범주로 나눈 비율을 보여 줄 때 씁니다. 범주가 많거나 그룹 간 비교가 목적이면 막대 차트가 더 읽기 쉽습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/pie.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPieChart(
  { labels: ['검색', '직접', '소셜', '이메일', '광고'], values: [420, 260, 180, 90, 40] },
  { title: '유입 경로', sort: 'desc', donut: 0.6, centerLabel: '방문' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // hover, 툴팁, 범례
sdk.render();
```

시그니처:

```ts
renderPieChart(data: PieChartData | PieRingsData, options?: PieChartOptions): { sliceCount: number }
```

`sliceCount`는 접힌 "Other" 조각을 포함해 화면에 표시되는 조각 수입니다.

## 데이터 형식

```ts
interface PieChartData {
  labels: string[];                  // 값마다 이름 하나
  values: Float64Array | number[];   // 유한하고 0 이상
}
```

- 모든 값은 유한하고 `>= 0`이어야 합니다. 그 밖의 값은 예외를 던집니다.
- 퍼센트는 보이는 조각의 합계를 기준으로 계산합니다.
- 여러 겹의 고리를 그리려면 대신 `{ rings }`를 넘깁니다. [다중 고리](#nested-rings) 참고.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | 바깥 반지름 대비 구멍 반지름 비율. `0` = 파이, 최대 `0.95`. |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'`이면 큰 조각부터 놓습니다. "Other"는 항상 마지막입니다. |
| `maxSlices` | `number \| false` | `8` | "Other"를 포함해 표시할 조각 수. 나머지 작은 조각은 "Other"로 접습니다. `0` / `false`면 접지 않습니다. |
| `startAngle` | `number` | `0` | 첫 조각이 시작하는 각도(12시 방향에서 시계 방향, 도). |
| `endAngle` | `number` | 한 바퀴 | 마지막 조각이 끝나는 각도(12시 방향에서 시계 방향, 도). [모서리, 간격, 부분 원](#corners-gaps-and-partial-circles) 참고. |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | 조각 진행 방향. |
| `padAngle` | `number` | `0` | 조각 사이 각도 간격(도, 최대 45). 2 px 간격 위에 더합니다. |
| `cornerRadius` | `number` | `0` | 모든 조각 모서리를 이 값(CSS px)만큼 둥글게 합니다. |
| `rose` | `'radius' \| 'area'` | 꺼짐 | 나이팅게일 로즈: 조각 반지름이 값을 나타냅니다. [나이팅게일 로즈](#nightingale-rose) 참고. |
| `colors` | `(ColorInput \| null \| undefined)[]` | 테마 팔레트 | 입력 값별 색. 비어 있는 항목은 표시 순서대로 테마 팔레트를 씁니다. `rings`이면 모든 고리의 값을 순서대로 이은 순서입니다. |
| `otherColor` | `ColorInput` | 테마 중립색 | "Other" 조각 색. |
| `otherLabel` | `string` | `'기타'` (로캘별) | 접힌 조각의 이름. |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`: 지시선과 함께 이름 + 퍼센트. `'percent'`: 조각 안에 퍼센트. |
| `labelMinAngle` | `number` | `6` | 이 각도(도)보다 좁은 조각은 라벨 없이 범례와 툴팁에만 나타납니다. |
| `centerLabel` | `boolean \| string` | 도넛이면 `true` (로즈와 다중 고리 파이는 꺼짐) | 도넛 중앙 텍스트: 보이는 합계(hover 중에는 해당 조각). `true`는 캡션을 `Total`로, 문자열은 캡션을 그 값으로 바꾸고, `false`는 숨깁니다. |
| `format` | `(value: number) => string` | 로케일 숫자 | 라벨, 툴팁, 중앙 텍스트의 값 형식. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 조각 2개 이상이면 표시 | `{ show, toggle, emphasize, position, overflow }`. 클릭하면 조각을 숨기고, hover하면 강조합니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px, `top`, `right`, `bottom`, `left`). |
| `animation` | `ChartAnimationInput` | SDK 설정 | 이 차트의 enter / update 애니메이션. [애니메이션](../guide/animation) 참고. |

::: tip 팁
레이더, 게이지, 퍼널, 워터폴과 달리 파이의 `format`은 함수만 받습니다. `'$,.0f'` 같은 형식 문자열을 쓰려면 `createFormatter`로 함수를 만듭니다. [숫자·날짜 형식](../guide/number-format)을 참고하세요.

```ts
import { createFormatter } from 'charturbo';
sdk.renderPieChart(data, { format: createFormatter('$,.0f') });
```
:::

## "Other" 접기

값이 `maxSlices`보다 많으면 가장 작은 값들을 합쳐 `otherLabel` 이름의 조각 하나로 만들고 마지막에 놓습니다. 이 조각의 툴팁은 접힌 이름들을 `ctx.slice.members`로 알려 줍니다.

```ts
sdk.renderPieChart(
  {
    labels: ['검색', '직접', '소셜', '이메일', '광고', '추천', '팟캐스트', '행사', '인쇄', '라디오'],
    values: [420, 260, 180, 90, 40, 32, 18, 12, 6, 4],
  },
  { title: '유입 경로', sort: 'desc', maxSlices: 7, otherLabel: '기타' }
);
```

## 다중 고리 {#nested-rings}

```ts
sdk.renderPieChart(
  {
    rings: [
      { name: '채널', labels: ['Direct', 'Marketing', 'Search engine'], values: [1548, 775, 679], radius: [0, 0.42] },
      {
        name: '유입원',
        labels: ['Baidu', 'Direct', 'Email', 'Google', 'Union ads', 'Bing', 'Video ads', 'Others'],
        values: [1048, 335, 310, 251, 234, 147, 135, 102],
        radius: [0.56, 0.86],
        maxSlices: false,
      },
    ],
  },
  { title: '유입 경로' }
);
```

ECharts의 중첩 파이처럼 `{ rings: PieRingData[] }`는 주어진 순서대로 안쪽부터 바깥으로 여러 고리를 그립니다.

`PieRingData`:

| 필드 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `name` | `string` | `링 1`, `링 2`, … (로캘별) | 툴팁, 데이터 표, 키보드 안내에 쓰는 고리 이름. |
| `labels` | `string[]` | — | 값마다 이름 하나. |
| `values` | `Float64Array \| number[]` | — | 유한하고 `>= 0`인 값. |
| `radius` | `[number, number]` | 균등 분할 | 전체 반지름 대비 `[inner, outer]` 비율, `0 <= inner < outer <= 1`. |
| `label` | `'outside' \| 'percent' \| 'none'` | 안쪽 고리는 `'percent'`, 가장 바깥 고리는 차트 `labels` | 고리의 라벨 방식. |
| `maxSlices` | `number \| false` | 차트 `maxSlices` | 고리의 "Other" 접기. |
| `sort` | `'none' \| 'desc'` | 차트 `sort` | 고리의 조각 순서. |

- 퍼센트(고리 합계 대비), 각도, "Other" 접기, 라벨은 고리마다 따로 계산합니다.
- `radius`를 생략하면 `n`개 중 `k`번째 고리가 `donut`에서 바깥 테두리까지를 n등분한 `k`번째 칸을 쓰고, 이웃 고리와 작은 간격을 둡니다.
- 이름이 같은 조각은 고리를 넘어 색, 범례 항목, 범례 강조를 공유합니다. 범례를 클릭하면 모든 고리에서 그 이름을 숨깁니다.
- hit test는 반지름으로 고리를 찾은 뒤 그 고리 안에서 각도로 조각을 찾습니다.
- 툴팁, 데이터 표, 키보드 안내는 조각을 `고리 · 조각` 이름으로 부릅니다. 도넛 중앙 라벨은 `centerLabel`을 지정하지 않으면 꺼집니다.
- `colors`는 모든 고리의 값을 고리 순서대로 이어 붙인 인덱스를 따릅니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/pie.html#06-nested)

## 모서리, 간격, 부분 원 {#corners-gaps-and-partial-circles}

```ts
sdk.renderPieChart(data, { donut: 0.55, padAngle: 5, cornerRadius: 10 });       // 둥근 모서리, 간격
sdk.renderPieChart(data, { donut: 0.55, startAngle: -90, endAngle: 90 });        // 위쪽 반 도넛
```

- `cornerRadius`(CSS px): 각 모서리 원이 안쪽으로 민 가장자리와 호에 동시에 접합니다. d3-shape `cornerRadius`와 같은 작도입니다. 얇은 조각과 얇은 고리에서는 모서리가 겹치지 않도록 반지름을 줄입니다. 구멍 없는 파이는 중심 꼭짓점이 뾰족하게 남습니다. hit test는 둥글리기 전 모양을 씁니다.
- `padAngle`(도, 최대 45): 2 px 간격 위에 각도 간격을 더합니다. 각도, 퍼센트, hit test는 간격 없는 배치를 씁니다. 간격보다 좁은 조각은 그리지 않지만 범례, 툴팁, 데이터 표에는 남습니다. 보이는 조각이 하나뿐이면 간격 없이 원 전체를 그립니다.
- `endAngle`은 `startAngle`과 같은 나침반 각도를 씁니다. `startAngle: -90, endAngle: 90`이면 위쪽 반 도넛입니다. 조각들은 `direction` 방향으로 이 범위를 나눠 가집니다. 끝이 시작과 같거나 앞서면 한 바퀴이고, 한 바퀴를 넘으면 한 바퀴로 자릅니다(게이지와 같은 규칙). 화면은 범위의 경계 상자에 맞춰 잡으므로 반 도넛이 카드를 채웁니다.

라이브 예제: [반 도넛](https://jparkk0517.github.io/Charturbo/pie.html#04-half-donut), [둥근 모서리](https://jparkk0517.github.io/Charturbo/pie.html#05-rounded).

## 나이팅게일 로즈 {#nightingale-rose}

```ts
sdk.renderPieChart(
  { labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], values: [40, 38, 32, 30, 28, 26, 22, 18] },
  { rose: 'area', donut: 0.2, maxSlices: false }
);
```

`rose`를 주면 조각 반지름이 값을 나타내며, 나이팅게일의 polar area diagram처럼 조각 넓이(도넛이면 고리 넓이)가 값에 비례합니다: `r² = r_in² + v / max · (R² − r_in²)`.

- `'radius'`: 각도는 그대로 비율을 따릅니다. `'area'`: 보이는 조각이 같은 각도를 나눕니다.
- 퍼센트, 툴팁, 데이터 표는 그대로 합계 대비 비율입니다.
- 범례로 조각을 숨기면 남은 최댓값을 기준으로 반지름을 다시 계산합니다.
- hover, 키보드 포커스, 바깥 지시선은 조각마다의 반지름을 따릅니다. 도넛 중앙 라벨은 `centerLabel`을 지정할 때만 표시합니다.
- ECharts는 최솟값 → 안쪽, 최댓값 → 바깥 반지름으로 선형 대응하지만 Charturbo는 그렇게 하지 않습니다. 그러면 가장 작은 조각이 사라지고 넓이가 값을 과장하기 때문입니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/pie.html#03-rose)

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다.

- hover하면 포인터 아래 조각이 바깥으로 6px 이동하고 툴팁이 나타납니다. 도넛에서는 중앙 라벨이 hover한 조각으로 바뀝니다.
- 범례를 클릭하면 조각이 숨겨지고 나머지 조각이 다시 배치되며, 퍼센트는 보이는 합계를 따릅니다. 범례 hover는 조각을 강조합니다.
- 브러시, 줌, 커서 동기화는 파이에서 비활성입니다.
- 데이터 포인트 id는 표시된 조각의 인덱스입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'pie'
// ctx.index = 표시된 조각 인덱스
// ctx.slice = { label, value, percent, members? }  // members: "Other"에 접힌 이름들
```

## 참고 사항

- 값 검증, 접기, 정렬, 각도, 퍼센트, 테셀레이션, hit 테스트, 라벨 배치는 엔진(Rust)에서 계산합니다. DOM은 라벨 텍스트만 배치합니다.
- 조각 사이에 2px 간격을 두고 안티앨리어싱된 가장자리로 그리므로 조각 면적이 정확합니다.
- 접근성: 상위 조각 요약, 데이터 표(조각, 값, 퍼센트), 좌우 화살표로 조각 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [퍼널](./funnel)
- [트리맵 · 선버스트](./treemap-sunburst)
- [툴팁과 hover](../guide/tooltips)
- [스타일과 테마](../guide/styling)
- [애니메이션](../guide/animation)
