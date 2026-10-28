# 퍼널

`renderFunnelChart`는 값에 따라 폭이 정해지는 순서 있는 단계를 그리고, 단계 사이의 전환율을 함께 보여 줍니다. 방문 → 가입 → 유료 전환처럼 단계별 이탈을 볼 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderFunnelChart(
  { labels: ['방문', '가입', '체험', '유료'], values: [12000, 5400, 2100, 760] },
  { title: '전환 퍼널', conversion: 'both', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderFunnelChart(data: FunnelChartData, options?: FunnelChartOptions): { stageCount: number }
```

## 데이터 형식

```ts
interface FunnelChartData {
  labels: string[];                  // 단계 이름, 첫 단계부터
  values: Float64Array | number[];   // 유한하고 0 이상
}
```

값은 유한하고 `>= 0`이어야 합니다. 그 밖의 값은 예외를 던집니다. 단계 폭은 가장 큰 값을 기준으로 정합니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | 세로: 첫 단계가 위, 라벨은 오른쪽. 가로: 라벨은 단계 아래. |
| `shape` | `'trapezoid' \| 'bar'` | `'trapezoid'` | 사다리꼴은 다음 단계 폭으로 좁아지고(마지막은 직사각형), `'bar'`는 가운데 정렬 막대를 그립니다. |
| `color` | `ColorInput` | 팔레트 첫 색 | 모든 단계에 쓰는 색 하나(시리즈 하나, 색 하나). |
| `colors` | `(ColorInput \| null \| undefined)[]` | | 단계별 색(예: 서수 램프). 비어 있는 항목은 `color`를 씁니다. |
| `minWidth` | `number` | `0.02` | 가장 넓은 단계 대비 가장 좁은 단계의 비율. |
| `conversion` | `'first' \| 'previous' \| 'both' \| 'none'` | `'first'` | 단계 라벨에 표시할 전환율. 툴팁은 항상 둘 다 보여 줍니다. |
| `labels` | `boolean` | `true` | 단계 라벨. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 라벨, 툴팁, 접근성의 값 형식(형식 문자열, `Intl` 옵션, 함수). [숫자·날짜 형식](../guide/number-format) 참고. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). 라벨 자리는 자동으로 확보합니다. |

퍼널에는 범례가 없습니다.

## 전환율

엔진은 단계마다 두 가지 비율을 계산합니다.

- **첫 단계 대비(of first)**: 첫 단계 값에 대한 이 단계 값의 백분율.
- **이전 단계 대비(of previous)**: 이전 단계 값에 대한 이 단계 값의 백분율.

0으로 나눈 비율은 `NaN`(정의되지 않음)입니다. `conversion`으로 라벨에 표시할 비율을 고릅니다.

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다. hover한 단계는 밝아지고, 툴팁은 값과 두 비율을 보여 줍니다. 브러시, 줌, 팬은 비활성입니다. 데이터 포인트 id는 단계 인덱스입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'funnel'
// ctx.index = 단계 인덱스
// ctx.funnel = { stage, value, ofFirst, ofPrevious }  // NaN = 정의되지 않음
```

## 참고 사항

- 값 검증, 단계 폭, 전환율, 테셀레이션(2px 간격, 안티앨리어싱된 가장자리), hit 테스트, 라벨 앵커는 엔진(Rust)에서 계산합니다.
- 접근성: 요약(첫 단계 → 마지막 단계, 최종 전환율), 데이터 표(단계, 값, % of first, % of previous), 좌우 화살표로 단계 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [워터폴](./waterfall)
- [파이 · 도넛](./pie)
- [생키](./sankey)
- [툴팁과 hover](../guide/tooltips)
