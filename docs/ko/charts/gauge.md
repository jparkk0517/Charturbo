# 게이지

`renderGauge`는 `min`과 `max` 사이의 호 위에 값 하나를 그립니다. 임계 구간(밴드)과 바늘 또는 진행 표시를 함께 쓸 수 있습니다. CPU 부하나 SLA 목표처럼 범위가 정해진 실시간 지표 하나를 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/business.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGauge(
  { value: 72 },
  {
    title: 'CPU 부하',
    min: 0,
    max: 100,
    label: 'CPU',
    format: '.0f',
    bands: [
      { from: 0, to: 60, status: 'good' },
      { from: 60, to: 85, status: 'warning' },
      { from: 85, to: 100, status: 'critical', label: '과부하' },
    ],
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderGauge(data: GaugeChartData, options?: GaugeChartOptions): { bandCount: number }
```

## 데이터 형식

```ts
interface GaugeChartData {
  value: number; // NaN = 값 없음; [min, max] 밖의 값은 양 끝에 고정
}
```

범위나 밴드가 잘못되면 예외를 던집니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `min` | `number` | `0` | 범위 시작. |
| `max` | `number` | `100` | 범위 끝. |
| `bands` | `GaugeBandOptions[]` | | 값 단위의 임계 구간. 범위에 맞게 잘리고, 겹치면 나중에 시작하는 밴드가 우선합니다. |
| `indicator` | `'needle' \| 'progress'` | 밴드가 있으면 `'needle'`, 없으면 `'progress'` | 바늘, 또는 값까지 채운 호. |
| `startAngle` | `number` | `-120` | 호 시작 각도(12시 방향에서 시계 방향, 도). |
| `endAngle` | `number` | `120` | 호 끝 각도(12시 방향에서 시계 방향, 도). |
| `thickness` | `number` | `0.2` | 반지름 대비 링 두께 비율. |
| `bandLabels` | `boolean` | 밴드에 `label`이나 `status`가 있으면 `true` | 밴드 옆 라벨. |
| `showMinMax` | `boolean` | `true` | 호 양 끝의 최소 / 최대 라벨. |
| `label` | `string` | | 값 아래 캡션(단위나 지표 이름). |
| `trackColor` | `ColorInput` | 테마 그리드 색 | 채워지지 않은 호의 색. |
| `color` | `ColorInput` | 팔레트 첫 색 | 값이 어떤 밴드에도 속하지 않을 때의 진행 색. |
| `needleColor` | `ColorInput` | 테마 기본 텍스트 색 | 바늘 색. |
| `format` | `ChartValueFormat` | 로케일 숫자 | 값, 최소, 최대 텍스트 형식(형식 문자열, `Intl` 옵션, 함수). [숫자·날짜 형식](../guide/number-format) 참고. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 데이터 표에서 값의 이름. |
| `title` | `string` | | 차트 제목. |
| `description` | `string` | | 캔버스의 접근성 이름. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |

게이지에는 범례가 없습니다.

### 밴드

```ts
interface GaugeBandOptions {
  from: number;
  to: number;
  status?: 'good' | 'warning' | 'serious' | 'critical'; // 예약된 상태 색 + 아이콘 + 라벨
  color?: ColorInput;  // 기본: 상태 색, 없으면 테마 팔레트 슬롯
  label?: string;      // 밴드 옆과 툴팁에 표시(기본: 상태 이름)
}
```

상태 색은 예약되어 있어 테마를 따르지 않습니다. 상태는 항상 아이콘과 라벨을 함께 표시하므로 색만으로 의미를 전달하지 않습니다.

| 상태 | 색 | 아이콘 | 기본 라벨 |
| --- | --- | --- | --- |
| `good` | `#0ca30c` | ✓ | 양호 (로캘별) |
| `warning` | `#fab219` | ▲ | 주의 (로캘별) |
| `serious` | `#ec835a` | ◆ | 심각 (로캘별) |
| `critical` | `#d03b3b` | ✖ | 위험 (로캘별) |

`status` 없이 `color`만 준 밴드는 일반 밴드입니다.

## 값 갱신

```ts
setGaugeValue(value: number): boolean
```

`setGaugeValue`는 현재 게이지를 새 값으로 옮깁니다. 밴드 형상과 라벨 배치는 그대로 두고 바늘(또는 진행 호)과 중앙 값 텍스트만 바꿉니다. 호출 후 `render()`를 부릅니다. 게이지가 없거나 값이 무한대이면 `false`를 반환합니다.

```ts
setInterval(() => {
  sdk.setGaugeValue(Math.random() * 100);
  sdk.render();
}, 1000);
```

값 변경에는 애니메이션이 없습니다.

## 상호작용

`enableNodeInteractions(canvas)`를 호출하면 켜집니다. 링 위를 hover하면 포인터 아래 밴드를, 안쪽을 hover하면 값을 보여 줍니다. 브러시, 줌, 팬은 비활성입니다.

툴팁 컨텍스트([툴팁과 hover](../guide/tooltips) 참고):

```ts
// ctx.chartType === 'gauge'
// ctx.index: 0 = 값, 1 + k = 밴드 k (밴드는 `from` 순으로 정렬)
// ctx.gauge = { value, min, max, band?: { label, from, to, status? } }
```

데이터 포인트 id: `0` = 값, `1 + k` = 그리는 순서의 밴드 `k`.

## 참고 사항

- 호 · 밴드 · 트랙 테셀레이션(밴드 사이 2px 간격, 안티앨리어싱된 가장자리), 밴드 자르기와 정렬, 값이 속한 밴드, 바늘, hit 테스트, 라벨 앵커는 엔진(Rust)에서 계산합니다.
- 접근성: 요약(값, 상태, 범위), 데이터 표(값, 밴드별 From–To), 좌우 화살표로 값에서 밴드들로 이동. [접근성](../guide/accessibility) 참고.

## 함께 보기

- [레이더](./radar)
- [실시간 스트리밍](../guide/streaming)
- [툴팁과 hover](../guide/tooltips)
- [숫자·날짜 형식](../guide/number-format)
