# 스파크라인

`renderSparkline`은 축, 그리드, 범례, 제목, 오버레이 DOM이 없는 작은 선 · 영역 · 막대 · 승패(win / loss) 차트를 그립니다. 표나 KPI 행 안에 넣을 때 씁니다. 한 페이지에 많이 넣는다면 공유 GPU 디바이스와 함께 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/sparklines.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!; // 예: 120 × 30 CSS px
const sdk = await Charturbo.create(canvas);

sdk.renderSparkline([100, 104, 98, 107, 112, 109, 115], {
  type: 'line',
  showLast: true,
  showMinMax: true,
  label: '매출',
});
sdk.render();
```

시그니처:

```ts
renderSparkline(data: SparklineData | Float32Array | number[], options?: SparklineOptions): SparklineResult
```

## 데이터 형식

값을 바로 넘기거나, `x`를 함께 담은 객체를 넘깁니다.

```ts
interface SparklineData {
  values: Float32Array | number[]; // NaN = 빈 구간; 승패: 각 값의 부호
  x?: Float64Array | number[] | Date[]; // 선 / 영역만; 선 시리즈 `x`와 같은 규칙
}
```

- `'winloss'`는 각 값의 부호를 읽습니다: `> 0` 승, `< 0` 패, `0` 무승부(빈칸).
- `'bar'`와 `'winloss'`는 `x`를 무시합니다.

## 옵션

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `type` | `'line' \| 'area' \| 'bar' \| 'winloss'` | `'line'` | `'winloss'`는 부호에 따라 같은 높이의 위 / 아래 막대를 그립니다. |
| `color` | `ColorInput` | 팔레트 첫 색 | 시리즈, 막대, 승 막대의 색. |
| `negativeColor` | `ColorInput` | 팔레트 둘째 색 | `'winloss'`의 패 막대 색. |
| `lineWidth` | `number` | `1.5` | 선 두께(CSS px). |
| `showLast` | `boolean` | `false` | 마지막 샘플에 시리즈 색 마커. `'winloss'`는 무시합니다. |
| `showMinMax` | `boolean` | `false` | 최솟값과 최댓값 마커. `'winloss'`는 무시합니다. |
| `markerRadius` | `number` | `2.5` | 마커 반지름(CSS px). |
| `lastColor` | `ColorInput` | 시리즈 색 | 마지막 샘플 마커 색. |
| `minMaxColor` | `ColorInput` | 테마 보조 텍스트 색 | 최소 / 최대 마커 색. |
| `band` | `[number, number]` | | 데이터 단위의 기준 밴드 `[lo, hi]`(예: 목표 범위). 시리즈 아래에 그립니다. |
| `bandColor` | `ColorInput` | 테마 흐린 텍스트 색, 알파 15% | 밴드 색. 알파 값을 그대로 씁니다. |
| `fillOpacity` | `number` | `0.2` | 영역 채우기 알파 배수. |
| `width` | `number` | 캔버스 CSS 크기 − 패딩 | 월드 단위의 플롯 너비. 가로세로 비율만 의미가 있습니다. |
| `height` | `number` | 캔버스 CSS 크기 − 패딩 | 월드 단위의 플롯 높이. |
| `padding` | `number` | `2`(마커가 있으면 마커 반지름 + 1) | 플롯 둘레 여백(CSS px). |
| `tooltip` | `boolean` | `false` | 내장 hover 툴팁. `false`면 툴팁 DOM과 포인터 리스너를 만들지 않습니다. |
| `label` | `string` | `'스파크라인'` (로캘별) | aria-label과 툴팁에 쓰는 이름. 예: `'Revenue'`. |
| `description` | `string` | 생성된 추세 요약 | 캔버스의 접근성 이름. 생성된 요약을 대체합니다. |
| `formatValue` | `(v: number) => string` | 로케일, 소수 최대 2자리 | aria-label과 툴팁 값의 숫자 형식. |

`width`와 `height`를 모두 주지 않으면 플롯이 캔버스 CSS 크기를 따르고, 리사이즈로 비율이 바뀌면 다시 맞춥니다. y 도메인은 nice 반올림 없이 데이터에 딱 맞춥니다.

## 반환 값

```ts
interface SparklineResult {
  pointCount: number;
  summary: SparklineSummary | null; // 엔진이 계산한 데이터 추세
  label: string;                    // 캔버스에 붙인 aria-label
}

interface SparklineSummary {
  count: number;
  first: number; last: number; min: number; max: number;
  firstIndex: number; lastIndex: number; minIndex: number; maxIndex: number;
  changePct: number; // first → last, |first| 대비 % (first가 0이면 NaN)
}
```

## 접근성

캔버스에는 `role="img"`와 `aria-label`만 붙습니다. 설명 DOM, 라이브 영역, `tabindex`는 만들지 않습니다. `getChartSummary()`도 같은 문장을 반환합니다.

- 선 / 영역 / 막대: `"Revenue: trend up 12% from 100 to 112, min 95, max 120"`
- 승패: `"Results: 7 wins, 3 losses, last: win"`

위 예시는 영어 로케일 기준이며, 문장은 차트 로케일을 따릅니다. [다국어 지원](../guide/i18n)을 참고하세요.

## 데이터 갱신

`'line'`과 `'area'` 스파크라인은 `setSeriesData`로 차트를 다시 렌더링하지 않고 데이터를 바꿀 수 있습니다. 마지막 / 최소 / 최대 마커와 추세 요약은 엔진이 다시 계산합니다.

```ts
sdk.setSeriesData(0, nextValues);
sdk.render();
```

`setSeriesData`는 선 차트에서만 동작하므로, `'bar'`와 `'winloss'`는 새 값으로 `renderSparkline`을 다시 호출합니다.

## 한 페이지에 스파크라인 여러 개

`Charturbo.create(canvas)`는 캔버스마다 GPU 디바이스를 요청하고 모든 파이프라인을 컴파일합니다. 또 브라우저는 WebGL 컨텍스트를 약 16개로 제한합니다. 스파크라인이 수십, 수백 개인 표에서는 `CharturboDevice` 하나를 만들어 모든 차트에 넘깁니다.

```ts
import { Charturbo, CharturboDevice } from 'charturbo';

const device = await CharturboDevice.create();
for (const row of rows) {
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'area', band: [95, 105], label: row.name });
  sdk.render();
}
// 정리: 각 sdk를 dispose한 뒤 device.dispose()
```

백엔드, WebGL2 동작, 제한 사항은 [공유 GPU 디바이스](../guide/shared-device)를 참고하세요.

## 참고 사항

- 마지막 / 최소 / 최대 마커, 기준 밴드, 승패 0선은 엔진(Rust) 마크로 GPU에만 그립니다.
- 줌, 팬, 키보드 탐색은 없습니다.
- 승패 막대는 승에 팔레트 첫 색, 패에 둘째 색을 쓰고 0선을 함께 그립니다.
- React / Vue 컴포넌트에서 `type: 'sparkline'`은 기본으로 상호작용을 끕니다. [React](../guide/react), [Vue](../guide/vue) 참고.

## 함께 보기

- [공유 GPU 디바이스](../guide/shared-device)
- [선](./line)
- [영역](./area)
- [실시간 스트리밍](../guide/streaming)
- [접근성](../guide/accessibility)
