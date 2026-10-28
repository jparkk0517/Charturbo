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
renderPieChart(data: PieChartData, options?: PieChartOptions): { sliceCount: number }
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

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | 바깥 반지름 대비 구멍 반지름 비율. `0` = 파이, 최대 `0.95`. |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'`이면 큰 조각부터 놓습니다. "Other"는 항상 마지막입니다. |
| `maxSlices` | `number \| false` | `8` | "Other"를 포함해 표시할 조각 수. 나머지 작은 조각은 "Other"로 접습니다. `0` / `false`면 접지 않습니다. |
| `startAngle` | `number` | `0` | 첫 조각이 시작하는 각도(12시 방향에서 시계 방향, 도). |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | 조각 진행 방향. |
| `colors` | `(ColorInput \| null \| undefined)[]` | 테마 팔레트 | 입력 값별 색. 비어 있는 항목은 표시 순서대로 테마 팔레트를 씁니다. |
| `otherColor` | `ColorInput` | 테마 중립색 | "Other" 조각 색. |
| `otherLabel` | `string` | `'기타'` (로캘별) | 접힌 조각의 이름. |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`: 지시선과 함께 이름 + 퍼센트. `'percent'`: 조각 안에 퍼센트. |
| `labelMinAngle` | `number` | `6` | 이 각도(도)보다 좁은 조각은 라벨 없이 범례와 툴팁에만 나타납니다. |
| `centerLabel` | `boolean \| string` | 도넛이면 `true` | 도넛 중앙 텍스트: 보이는 합계(hover 중에는 해당 조각). `true`는 캡션을 `Total`로, 문자열은 캡션을 그 값으로 바꾸고, `false`는 숨깁니다. |
| `format` | `(value: number) => string` | 로케일 숫자 | 라벨, 툴팁, 중앙 텍스트의 값 형식. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 조각 2개 이상이면 표시 | `{ show, toggle, emphasize }`. 클릭하면 조각을 숨기고, hover하면 강조합니다. |
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
