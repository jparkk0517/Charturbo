# 콤보

콤보 차트는 막대, 선, 영역 시리즈를 한 플롯에 그립니다. 시리즈는 카테고리 축 또는 x축을 함께 쓰고, 선택적인 오른쪽 y축에 두 번째 단위를 둘 수 있습니다. 매출 막대와 목표 선처럼 함께 봐야 하는 지표에 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/combo.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderComboChart(
  {
    categories: ['1월', '2월', '3월', '4월'],
    series: [
      { name: '온라인', type: 'bar', values: [12, 18, 22, 19] },
      { name: '매장', type: 'bar', values: [8, 9, 7, 11] },
      { name: '목표', type: 'area', values: [18, 22, 26, 28] },
      { name: '마진 %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27],
        marker: true, dash: [5, 3], curve: 'monotone' },
    ],
  },
  {
    barMode: 'stacked',
    title: '매출과 마진',
    axes: { x: { title: '월' }, y: { title: '매출', min: 0 }, y2: { title: '%', format: (v) => `${v}%` } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderComboChart(
  data: ComboChartData,
  options?: ComboChartOptions
): { seriesCount: number; categoryCount: number; pointCount: number }
```

데이터 포인트 id = `series * categories + category`.

## 데이터 형식 {#data-format}

`ComboChartData`:

| 필드 | 타입 | 설명 |
|---|---|---|
| `categories` | `string[]` | 카테고리 x축의 카테고리 라벨. |
| `x` | `Float64Array \| number[] \| Date[]` | 또는 각 카테고리의 숫자 / 시간 x: 엄격하게 증가해야 하며, 시간이면 epoch ms 또는 `Date[]`. |
| `series` | `ComboSeriesDescriptor[]` | 모든 시리즈는 카테고리마다 값 하나를 가집니다. |

`ComboSeriesDescriptor`:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 범례와 툴팁에 쓰는 이름. |
| `type` | `'bar' \| 'line' \| 'area'` | — | `'area'`는 0까지 반투명하게 채운 선입니다. |
| `values` | `Float32Array \| number[]` | — | 카테고리마다 값 하나. `NaN` / `null` = 결측. |
| `yAxis` | `'left' \| 'right'` | `'left'` | `'right'` 시리즈가 하나라도 있으면 오른쪽 y축(`axes.y2`)을 추가합니다. 모든 막대 시리즈는 첫 막대 시리즈의 축을 함께 씁니다. |
| `color` | `ColorInput` | 테마 팔레트 | 시리즈 색. |
| `lineWidth` | `number` | 차트 `lineWidth` | 선 / 영역 시리즈의 선 두께(CSS px). |
| `marker`, `dash`, `curve`, `nulls` | 선 스타일 | — | 선 / 영역 시리즈는 [선 스타일](./line#line-styles)을 받습니다. |

숫자 또는 시간 `x`를 쓰면 막대 슬롯 너비는 가장 작은 x 간격이고(막대는 겹치지 않으며 막대 하나는 그 72%), x 눈금은 선 차트와 같은 숫자 / 달력 눈금입니다.

## 옵션 {#options}

`ComboChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `barMode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | 막대 시리즈의 배치. |
| `axes` | `{ x?: ComboXAxisOptions; y?: ComboYAxisOptions; y2?: ComboYAxisOptions }` | — | 아래 참고. |
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이면 표시 | 클릭하면 토글하고(막대를 다시 쌓음), hover하면 강조합니다. |
| `groupGap` | `number` | `0.28` | 각 카테고리 슬롯에서 막대 그룹 사이에 비우는 비율. |
| `barGap` | `number` | `2` | 그룹 막대 사이 또는 누적 구간 사이 간격(CSS px). |
| `cornerRadius` | `number` | `4` | 막대 끝 둥글기(CSS px). |
| `fillOpacity` | `number` | `0.2` | 영역 시리즈의 채우기 알파 배수. |
| `lineWidth` | `number` | `2` | 선 / 영역 시리즈의 선 두께(CSS px). |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | 선 / 영역 시리즈의 결측 샘플 처리. 시리즈 `nulls`가 우선합니다. |
| `hover` | `ChartHoverStyle` | — | hover 스타일. |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `locale` | `string` | SDK 로케일 | 기본 숫자 / 시간 라벨의 로케일. |
| `timeZone` | `CharturboTimeZone` | SDK 시간대 | 시간 x축의 시간대. |
| `width` | `number` | `168` | 플롯의 월드 너비. |
| `height` | `number` | `86` | 플롯의 월드 높이. |

축 옵션:

| 축 | 필드 | 설명 |
|---|---|---|
| `x` | `ChartAxisOptions` + `type?: 'numeric' \| 'time'` | `type`은 명시적 `x`에 적용합니다: `'numeric'`(기본) 또는 `'time'`(`Date[]`의 기본). |
| `y`, `y2` | `ChartAxisOptions` + `min?`, `max?`, `nice?` | 도메인 끝을 고정합니다. `nice`(기본 `true`)는 데이터에서 구한 끝을 눈금 간격 단위로 넓힙니다. |

## 배치 {#layout}

- 카테고리 `i`는 데이터 x `i`(또는 `x[i]`)에 놓입니다. x 도메인은 양쪽으로 슬롯 절반씩 넓히므로, 선의 점이 막대 슬롯 중심에 정확히 놓입니다.
- 막대 시리즈는 막대 엔진을 씁니다(그룹 / 누적 / 퍼센트, 범례 토글 시 다시 쌓기). 선과 영역 시리즈는 선 엔진을 씁니다(M4 데시메이션, 마커, 대시, 곡선, 결측 처리 방식).
- 그리는 순서: 막대, 영역 채우기(반투명, 0까지), 선, 마커.
- 영역은 쌓지 않습니다. 각 영역은 0까지 채웁니다.

## Y 도메인 {#y-domains}

- 도메인은 고정입니다(자동 스케일 없음). 각 축은 숨긴 시리즈를 포함한 자기 시리즈 전체(누적 막대는 합계)를 덮고, nice 눈금까지 넓힙니다.
- 막대 축과 영역 시리즈는 항상 0을 포함합니다. `nulls: 'zero'`로 채운 0도 도메인에 들어갑니다.
- 끝을 고정하려면 `axes.y` / `axes.y2`의 `min`, `max`, `nice`를 쓰세요. 값은 `getYDomain()`과 `getY2Domain()`으로 읽습니다.
- 모든 시리즈가 오른쪽 축에 있게 되면 왼쪽 축으로 옮깁니다.
- 로그 스케일과 뒤집힌 스케일은 지원하지 않습니다.

::: warning 주의
이중 y축은 관계없는 스케일을 비교하게 만듭니다. 두 범위를 어떻게 고르느냐만으로도 선이 막대와 "교차"하는 것처럼 보일 수 있습니다. 오른쪽 축은 단위가 다를 때만 쓰고, 두 축 모두에 라벨을 분명히 붙이세요. 먼저 같은 x를 공유하는 차트 두 개, 또는 지수화한 단일 축을 고려하세요.
:::

## hover와 범례 {#hover-and-legend}

- hover는 index 모드를 씁니다. 툴팁 하나(`chartType: 'combo'`)가 hover한 카테고리의 보이는 시리즈를 모두 나열합니다. 막대는 색이 진해지고, 선과 영역의 점에는 마커가 붙고, 선 시리즈가 있으면 십자선을 그립니다.
- primary 항목은 포인터에 가장 가까운 막대 구간 또는 선의 점입니다(막대 안의 선 점이 우선). `hover: { mode: 'nearest' }` 또는 `tooltip: { shared: false }`이면 그 항목만 보여 줍니다.
- `hoverAtX`(커서 동기화)는 가장 가까운 카테고리에 맞춥니다.
- 범례 기호: 막대 = 사각형, 선 = 선분, 영역 = 위에 선이 있는 옅은 블록. 토글하면 막대를 다시 쌓거나 다시 묶습니다(도메인은 고정). 강조하면 종류와 관계없이 다른 시리즈를 모두 흐리게 합니다.

[툴팁과 hover](../guide/tooltips), [대시보드 동기화](../guide/dashboard-sync) 참고.

## 줌과 팬 {#zoom-and-pan}

x 줌과 팬은 휠, 드래그, 터치, `setXRange`로 동작합니다. 막대는 줌 창에 따라 넓어지고 플롯 영역에서 잘립니다.

콤보 차트에서 지원하지 않는 기능: 브러시, 내비게이터, 막대 데이터 라벨, 막대 오차 막대, 선 범위 밴드.

## 접근성 {#accessibility}

요약(종류별 시리즈, 이중 축, 범위), 설명(축 제목, 시리즈별 종류 · 축 · 최댓값 · 최솟값 · 평균), 데이터 표와 CSV(행 = 카테고리, 열 = 모든 시리즈), 키보드 탐색(좌우 = 카테고리, 상하 = 시리즈)을 제공합니다. [접근성](../guide/accessibility) 참고.

## 데이터 갱신 {#updating-data}

새 데이터로 `renderComboChart`를 다시 호출합니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="combo" data={{ categories, series }} options={{ barMode: 'grouped' }} />
```

## 함께 보기 {#see-also}

- [막대](./bar)
- [선](./line)
- [영역](./area)
- [데이터와 축](../guide/data-and-axes)
