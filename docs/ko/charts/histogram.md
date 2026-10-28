# 히스토그램

히스토그램은 원시 값을 구간(bin)으로 나누고 구간마다 빈틈 없는 막대를 하나씩 그립니다. 엔진이 O(n)으로 구간을 나누므로 1,000,000개 이상의 값도 문제없습니다. 변수 하나의 분포를 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html#03-histogram)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = new Float32Array(500_000).map(() => Math.random() * 100);
const bins = sdk.renderHistogram(values, { bins: 'auto', title: '응답 시간(ms)' });
console.log(`구간 ${bins.binCount}개 (${bins.rule})`);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHistogram(
  values: Float32Array | number[],
  options?: HistogramChartOptions
): HistogramResult
```

데이터 포인트 id는 구간 인덱스입니다.

## 데이터 형식 {#data-format}

`values`는 원시 샘플의 평평한 `Float32Array`(권장) 또는 `number[]`입니다. 유한하지 않은 값과 `range` 밖의 값은 무시합니다.

메서드는 엔진이 계산한 구간을 반환합니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `binCount` | `number` | 구간 수. |
| `edges` | `Float64Array` | 오름차순 구간 경계 `binCount + 1`개. |
| `counts` | `Float64Array` | 구간별 샘플 수. |
| `heights` | `Float64Array` | 막대 높이: 개수, 또는 `density: true`이면 밀도. |
| `total` | `number` | 범위 안의 유한한 값 개수. |
| `rule` | `'freedman-diaconis' \| 'sturges' \| 'fixed'` | 사용한 구간 규칙. |

## 옵션 {#options}

`HistogramChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `bins` | `'auto' \| number` | `'auto'` | `'auto'`: Freedman–Diaconis, IQR이 0이면 Sturges(최대 1000구간). 숫자를 주면 같은 너비 구간을 씁니다(최대 10000). |
| `range` | `[number, number]` | 유한한 데이터 범위 | 구간을 나눌 범위. 밖의 값은 무시합니다. |
| `density` | `boolean` | `false` | 막대 높이를 전체 넓이가 1인 밀도로 표시합니다. |
| `color` | `ColorInput` | 테마 palette[0] | 막대 색. |
| `barGap` | `number` | `1` | 막대 사이 간격(CSS px). |
| `cornerRadius` | `number` | `0` | 막대 윗부분 둥글기(CSS px). |
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `locale` | `string` | SDK 로케일 | 기본 라벨의 로케일. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | x 눈금은 구간 경계에 놓이고 경계 값을 받습니다. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `hover` | `ChartHoverStyle` | — | hover 스타일. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `width` | `number` | `164` | 플롯의 월드 너비. |
| `maxBarHeight` | `number` | `78` | 가장 높은 막대의 월드 높이. |

## hover {#hover}

툴팁 라벨은 구간 범위 `a – b`이고, 개수(`density: true`이면 밀도와 개수)를 함께 보여 줍니다.

## 데이터 갱신 {#updating-data}

새 값으로 `renderHistogram`을 다시 호출합니다. 구간 나누기가 O(n)이므로 큰 배열을 다시 나눠도 비용이 작습니다.

## 참고 사항 {#notes}

- 히스토그램은 항상 세로이고 2D입니다. 줌과 팬이 없고 `animation` 옵션도 없습니다.
- 사분위수가 있는 그룹별 분포는 [박스 플롯 · 바이올린](./box-violin)을 쓰세요.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="histogram" data={values} options={{ bins: 40 }} />
```

## 함께 보기 {#see-also}

- [막대](./bar)
- [박스 플롯 · 바이올린](./box-violin)
