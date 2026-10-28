# 박스 플롯 · 바이올린

박스 플롯은 카테고리마다 원시 샘플의 분포를 요약합니다: 사분위수, 수염, 이상값, 그리고 선택적으로 평균. `violin`을 쓰면 각 그룹을 대신 커널 밀도 모양으로 그립니다. 엔진은 그룹마다 모든 통계를 O(n)으로 계산하고 원시 샘플은 보관하지 않습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/box.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBoxPlot(
  {
    categories: ['월', '화', '수'],
    series: [
      { name: '대조군', values: [monF32, tueF32, wedF32] }, // 카테고리별 원시 샘플
      { name: '처치군', values: [a, b, c] },
    ],
  },
  {
    title: '응답 시간',
    axes: { y: { title: 'ms' } },
    whiskers: 'tukey',
    showOutliers: true,
    showMean: true,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBoxPlot(
  data: BoxPlotData,
  options?: BoxPlotOptions
): { boxCount: number; seriesCount: number; categoryCount: number; sampleCount: number }
```

데이터 포인트 id: 박스 = `series * categories + category`. 이상값 id는 박스 다음에 이어집니다.

## 데이터 형식 {#data-format}

`BoxPlotData`:

| 필드 | 타입 | 설명 |
|---|---|---|
| `categories` | `string[]` | 카테고리(x축) 라벨. |
| `series[].name` | `string` | 시리즈 이름. |
| `series[].values` | `(Float32Array \| number[] \| null \| undefined)[]` | 카테고리마다 원시 샘플 배열 하나. 비어 있거나 없으면 박스를 그리지 않습니다. |
| `series[].color` | `ColorInput` | 기본: 시리즈 순서대로 테마 팔레트. |

시리즈가 여러 개면 그룹 막대처럼 각 카테고리 안에 나란히 배치합니다.

## 옵션 {#options}

`BoxPlotOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `whiskers` | `'tukey' \| 'minmax' \| [number, number]` | `'tukey'` | `'tukey'`: 사분위수에서 `iqrFactor` × IQR 이내의 마지막 샘플. `'minmax'`: 데이터 극값(이상값 없음). `[p0, p1]`: 0–100 백분위수. 예: `[5, 95]`. |
| `iqrFactor` | `number` | `1.5` | Tukey IQR 계수. |
| `showOutliers` | `boolean` | `true` | 이상값을 점으로 표시(박스 모드). |
| `maxOutliers` | `number` | `10000` | 그룹별로 그리는 이상값 수. 넘으면 균등하게 샘플링하며, 개수는 정확하게 유지합니다. |
| `showMean` | `boolean` | `false` | 평균을 속이 빈 점으로 표시. |
| `outline` | `boolean` | `false` | 박스를 채운 막대 대신 외곽선으로 그립니다. |
| `violin` | `boolean \| BoxPlotViolinOptions` | `false` | 박스 대신 바이올린(KDE). |
| `colors` | `ColorInput[]` | 테마 팔레트 | 시리즈 색. |
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `valueLabel` | `string` | `'값'` (로캘별) | 툴팁과 표에서 값의 이름. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 축 제목과 형식. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이면 표시 | 토글과 강조가 되는 시리즈 범례. |
| `groupGap` | `number` | `0.3` | 각 카테고리 슬롯에서 그룹 사이에 비우는 비율. |
| `boxGap` | `number` | `2` | 그룹 안 박스 사이 간격(CSS px). |
| `cornerRadius` | `number` | `4` | 박스 끝 둥글기(CSS px). |
| `whiskerWidth` | `number` | `1.5` | 수염 / 외곽선 두께(CSS px). |
| `outlierRadius` | `number` | `3` | 이상값 점 반지름(CSS px). |
| `hover` | `ChartHoverStyle` | — | hover 스타일. |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. |
| `width` | `number` | `164` | 플롯의 월드 너비. |
| `height` | `number` | `80` | 플롯의 월드 높이. |

## 바이올린 {#violin}

```ts
sdk.renderBoxPlot(data, { violin: { showBox: true, scale: 'area', opacity: 0.3 } });
```

`BoxPlotViolinOptions`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `bandwidth` | `number` | 그룹별 Silverman 규칙 | 데이터 단위의 가우시안 커널 대역폭. |
| `showBox` | `boolean` | `true` | 안쪽 박스(수염 선, IQR 막대, 중앙값 점). `false` = 중앙값 선만. |
| `scale` | `'area' \| 'width'` | `'area'` | `'area'`: 모든 바이올린의 넓이가 같습니다. `'width'`: 각 바이올린이 최대 너비까지 닿습니다. |
| `opacity` | `number` | `0.3` | 바이올린 몸통의 채우기 불투명도. |

KDE는 촘촘한 그리드에 선형 binning한 뒤 128개 점에서 계산합니다. 샘플이 1,000,000개여도 O(n · grid)가 아니라 O(n + grid)입니다. 바이올린은 이상값 점을 그리지 않습니다.

## 통계 {#statistics}

- 사분위수는 정렬이 아니라 선택(`select_nth_unstable`)으로 구하며, numpy의 선형 보간과 결과가 같습니다.
- 한 번 더 순회해 수염 끝, 이상값 개수, 표준편차를 계산합니다.
- `maxOutliers`를 넘는 이상값은 일정하고 결정적인 간격으로 샘플링하며, 최솟값과 최댓값은 남깁니다.

## hover와 범례 {#hover-and-legend}

- 박스에 hover하면 최솟값, Q1, 중앙값, Q3, 최댓값, 평균, 수염, n, 이상값 개수를 보여 줍니다. 이상값에 hover하면 그 값을 보여 줍니다. `ctx.box`에 이 통계가 들어 있습니다.
- 범례(시리즈 2개 이상)는 시리즈를 토글하고 강조합니다. 시리즈가 8개를 넘으면 나머지는 "Other"로 묶습니다.
- 박스 플롯에는 브러시와 줌이 없습니다.

[툴팁과 hover](../guide/tooltips) 참고.

## 접근성 {#accessibility}

차트는 요약, 데이터 표, 카테고리 × 시리즈마다 한 행인 CSV, 키보드 탐색(좌우 = 카테고리, 상하 = 시리즈)을 제공합니다. [접근성](../guide/accessibility) 참고.

## 데이터 갱신 {#updating-data}

새 샘플로 `renderBoxPlot`을 다시 호출합니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="box" data={{ categories, series }} options={{ violin: true }} />
```

## 함께 보기 {#see-also}

- [히스토그램](./histogram)
- [막대](./bar)
