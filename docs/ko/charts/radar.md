# 레이더

`renderRadarChart`는 레이더(스파이더) 차트를 그립니다. 3개 이상의 축 위에 시리즈마다 닫힌 다각형 하나를 그립니다. 몇 개 항목을 같은 속성 집합으로 비교할 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderRadarChart(
  {
    axes: ['속도', '주행거리', '비용', '승차감', '안전'],
    series: [
      { name: '모델 A', values: [82, 64, null, 71, 90] }, // null = 결측
      { name: '모델 B', values: [55, 88, 70, 62, 74], color: '#d95926' },
    ],
  },
  { title: '차량 비교', max: 100, rings: 4, format: '.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderRadarChart(data: RadarChartData, options?: RadarChartOptions): { axisCount: number; seriesCount: number }
```

## 데이터 형식

```ts
interface RadarChartData {
  axes: string[];          // 축 이름, startAngle부터 시계 방향; 3개 이상
  series: RadarSeries[];   // 시리즈 1~8개
}

interface RadarSeries {
  name: string;
  values: ArrayLike<number | null>;  // 축마다 하나; 유한하고 0 이상, null / NaN = 결측
  color?: ColorInput;                // 기본: 시리즈의 테마 팔레트 슬롯
}
```

- 각 시리즈는 축마다 정확히 값 하나를 가져야 하고, 시리즈는 1~8개여야 합니다. 아니면 `RangeError`를 던집니다.
- 음수나 무한대 값은 예외를 던집니다. 결측 값(`null` / `NaN`)이 있는 축에서는 다각형이 중심을 지나고 마커를 그리지 않습니다.
- 시리즈 색은 테마 팔레트를 고정 순서로 씁니다(순환하지 않음).

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `max` | `number \| (number \| null \| undefined)[]` | 데이터의 nice 최댓값 | 모든 축이 공유하는 반지름 최댓값, 또는 축별 최댓값(`null` = 공유 최댓값). 링 라벨은 공유 눈금일 때만 표시합니다. |
| `rings` | `number` | `4` | 목표 링 개수(nice 간격). |
| `fillOpacity` | `number` | `0.2` | 다각형 채우기 불투명도. `0` = 외곽선만. |
| `strokeWidth` | `number` | `2` | 다각형 선 두께(CSS px). |
| `markers` | `boolean \| number` | `true`(반지름 3.5px) | 꼭짓점 마커: `true`, `false`, 또는 반지름(CSS px). |
| `startAngle` | `number` | `0` | 첫 축의 각도(12시 방향에서 시계 방향, 도). |
| `grid` | `'polygon' \| 'circle'` | `'polygon'` | 동심 그리드 모양. |
| `showGrid` | `boolean` | `true` | 링과 스포크 표시. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 링, 툴팁, 접근성의 값 형식(형식 문자열, `Intl` 옵션, 함수). [숫자·날짜 형식](../guide/number-format) 참고. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이면 표시 | `{ show, toggle, emphasize }`. 클릭하면 시리즈를 토글하고, hover하면 강조합니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다.

- hover하면 포인터 각도에 가장 가까운 축을 고르고, 그 축의 보이는 시리즈를 모두 반환합니다. 가장 가까운 꼭짓점이 primary 항목입니다. 해당 스포크가 강조되고 마커가 커집니다.
- 범례를 클릭하면 시리즈가 숨겨지고, 범례 hover는 나머지를 흐리게 하고 강조한 시리즈를 맨 위에 그립니다.
- 브러시, 줌, 팬은 비활성입니다.
- 데이터 포인트 id는 `series * axes + axis`입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'radar'
// ctx.index = 축 인덱스
// ctx.items = 그 축의 보이는 모든 시리즈
// ctx.radar = { axis, max }
```

## 참고 사항

- nice 반지름 눈금, 축별 최댓값, 다각형 · 그리드 · 마커 형상, hit 테스트, 라벨 앵커는 엔진(Rust)에서 계산합니다. 선과 마커는 GPU에서 CSS px 크기로 그립니다.
- 축별 최댓값을 쓰면 링 값 라벨은 생략합니다.
- 접근성: 요약(시리즈별 최고 축), 데이터 표(축 × 시리즈), 좌우 화살표 = 축 이동, 상하 화살표 = 시리즈 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [게이지](./gauge)
- [파이 · 도넛](./pie)
- [툴팁과 hover](../guide/tooltips)
- [숫자·날짜 형식](../guide/number-format)
