# 워터폴

`renderWaterfallChart`는 누적 합계를 떠 있는 막대로 그립니다. 각 변화 막대는 직전 합계가 끝난 곳에서 시작하고, 소계 / 합계 막대는 0에서 시작합니다. 현금 흐름이나 손익 브리지처럼 시작 값이 어떻게 끝 값이 되는지 설명할 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderWaterfallChart(
  {
    labels: ['1분기 시작', '매출', '서비스', '환불', '상반기', '비용', '세금'],
    values: [400, 180, 90, -60, null, -220, -45], // null = 계산된 소계
    totals: [4],                                  // "상반기" 소계의 인덱스
  },
  { title: '현금 흐름', total: '기말', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderWaterfallChart(data: WaterfallChartData, options?: WaterfallChartOptions): { itemCount: number }
```

`itemCount`에는 `options.total`로 덧붙인 막대도 포함됩니다.

## 데이터 형식

```ts
interface WaterfallChartData {
  labels: string[];                         // 값마다 범주 하나
  values: (number | null)[] | Float64Array; // 변화량(유한); 합계 항목은 null 가능
  totals?: number[] | boolean[];            // 소계 / 합계 항목: 인덱스, 또는 값마다 플래그
}
```

- `labels`와 `values`의 길이가 같아야 합니다. 아니면 `RangeError`를 던집니다.
- 변화 항목은 유한해야 합니다(아니면 예외). 양수는 증가, 음수는 감소입니다.
- 합계 항목(`totals`에 있는 항목)은 0에서 누적 합계까지의 막대입니다. 값은 무시되므로 보통 `null`을 넣습니다. 누적 합계를 바꾸지 않습니다.
- `options.total`은 마지막 합계 막대를 덧붙입니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `total` | `boolean \| string` | | 마지막 합계 막대 추가: `true`(이름 `'Total'`) 또는 그 이름. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'`이면 범주를 왼쪽 축에 세로로 놓습니다. |
| `connectors` | `boolean` | `true` | 각 막대 끝 높이에서 다음 막대까지 이어지는 점선. |
| `colors` | `{ increase?, decrease?, total?, connector? }` | 아래 참고 | 종류별 `ColorInput`. 기본: 팔레트 첫째 · 둘째 색, 합계와 연결선은 테마 중립 기준선 색. |
| `names` | `{ increase?, decrease?, total? }` | `증가` / `감소` / `합계` (로캘별) | 범례와 툴팁에 쓰는 종류 이름. |
| `labels` | `boolean \| 'auto' \| Omit<BarLabelOptions, 'format'>` | `'auto'` | 값 라벨. `'auto'`는 겹치는 라벨을 숨깁니다. 변화량은 부호를 붙이고(`+1,200`, `−300`), 합계는 누적 합계를 보여 줍니다. |
| `cornerRadius` | `number` | `0` | 데이터 끝 모서리 반지름(CSS px). |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | | 막대 차트와 같은 축 옵션. [데이터와 축](../guide/data-and-axes) 참고. |
| `showBackdropGrid` | `boolean` | `true` | 값 그리드선과 기준선. |
| `grid` | `ChartGridStyle` | 테마 | 그리드선 스타일. [스타일과 테마](../guide/styling) 참고. |
| `hover` | `ChartHoverStyle` | 테마 | hover한 막대 강조. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 라벨, 툴팁, 접근성의 값 형식(형식 문자열, `Intl` 옵션, 함수). 축 형식이 없으면 값 축도 이 형식을 씁니다. [숫자·날짜 형식](../guide/number-format) 참고. |
| `valueLabel` | `string` | `'변동'` (로캘별) | 툴팁과 데이터 표에서 변화량의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 종류 2개 이상이면 표시 | 존재하는 종류를 나열합니다. 정적이라 토글이나 강조가 없습니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

`format`을 뺀 `BarLabelOptions`는 `show`, `position`, `color`입니다. [막대](./bar)를 참고하세요.

## 색

증가, 감소, 합계는 팔레트 슬롯과 중립색을 쓰며, 빨강 / 초록에만 의존하지 않습니다. 라벨과 툴팁에는 항상 부호가 붙고(`+180`, `−60`), 합계는 값만 표시합니다.

```ts
sdk.renderWaterfallChart(data, {
  colors: { increase: '#3987e5', decrease: '#d95926', total: '#a3a29c' },
  names: { increase: '이익', decrease: '손실', total: '잔액' },
});
```

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다. hover, 가로 방향, 축, 그리드선, 라벨 충돌 처리는 막대 차트와 같습니다. 브러시, 줌, 팬은 비활성이고, 커서 동기화에서는 막대 차트처럼 x 커서 대상입니다. 데이터 포인트 id는 항목 인덱스입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'waterfall'
// ctx.index = 막대 인덱스
// ctx.waterfall = { kind: 'increase' | 'decrease' | 'total', change, start, end }
// change: 변화량(합계 항목은 누적 합계)
```

## 참고 사항

- 누적 합계는 엔진(Rust)에서 계산하고 2D 막대 차트의 떠 있는 막대로 그립니다. 연결선도 엔진이 그립니다.
- 접근성: 요약(최종 합계, 최대 증가 / 감소), 데이터 표(항목, Change, Running total), 좌우 화살표로 막대 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [막대](./bar)
- [퍼널](./funnel)
- [대시보드 동기화](../guide/dashboard-sync)
- [숫자·날짜 형식](../guide/number-format)
