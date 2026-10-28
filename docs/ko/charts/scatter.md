# 산점도 · 버블

2D 산점도는 점마다 GPU 인스턴스 하나를 그립니다. 점은 한 번만 업로드하므로 1,000,000개 이상의 점에서도 60 FPS를 유지합니다. 점마다 크기를 주면 버블 차트가 됩니다. 두 변수 사이의 관계나 군집의 모양을 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/scatter.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderScatterChart(
  { x: xs, y: ys, clusters: seriesIds },
  {
    title: '세그먼트 분포',
    seriesNames: ['A', 'B', 'C'],
    axes: { x: { title: 'x' }, y: { title: 'y' } },
    pointRadius: 3,
    opacity: 0.85,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 휠: x/y 줌, 드래그: 팬
sdk.render();
```

```ts
renderScatterChart(data: ScatterChartData, options?: ScatterChartOptions): { pointCount: number }
```

데이터 포인트 id = 점 인덱스.

## 데이터 형식 {#data-format}

`ScatterChartData`는 점마다 항목 하나씩 갖는 병렬 배열입니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `x` | `Float32Array \| number[]` | x 좌표. |
| `y` | `Float32Array \| number[]` | y 좌표. |
| `sizes` | `Float32Array \| number[]` | 선택 사항. 점별 반지름(CSS px, 버블 차트). 기본: `pointRadius`. |
| `clusters` | `Uint16Array \| number[]` | 선택 사항. 점별 시리즈 id: 범례 항목, 팔레트 색, 표시 토글에 씁니다. |
| `colors` | `Float32Array \| number[]` | 선택 사항. 점별 RGBA(`4 * N`개 값, 0..1). 시리즈 색보다 우선합니다. |
| `z` | `Float32Array \| number[]` | 지원 중단이며 무시합니다. 차트는 2D입니다. |

시리즈 id는 `seriesNames`와 `seriesColors`의 인덱스입니다.

### 버블 차트

```ts
sdk.renderScatterChart(
  { x: gdp, y: lifeExpectancy, sizes: radiusPx, clusters: region },
  {
    seriesNames: ['아프리카', '아메리카', '아시아', '유럽'],
    opacity: 0.7,
    axes: { x: { title: '1인당 GDP', scale: 'log', format: '$,.0f' }, y: { title: '년' } },
  }
);
```

`sizes`를 주면 기본으로 각 점에 표면 색의 1 px 링이 붙으므로(`pointRing`) 겹친 버블도 알아볼 수 있습니다.

## 옵션 {#options}

`ScatterChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `seriesNames` | `string[]` | `Series <id>` | 각 시리즈 id의 범례와 툴팁 이름. |
| `seriesColors` | `ColorInput[]` | 테마 팔레트, 순환 | 각 시리즈 id의 색. |
| `pointRadius` | `number` | `3` | `sizes`가 없을 때 점 반지름(CSS px). |
| `opacity` | `number` | `0.85` | 채우기 알파 배수. 값을 낮추면 밀도가 드러납니다. |
| `pointRing` | `number` | `sizes`가 있으면 `1`, 없으면 `0` | 각 점 둘레의 표면 색 링(CSS px). |
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | 제목, 형식, `scale: 'log'`, `reverse`, `tickCount`. [데이터와 축](../guide/data-and-axes) 참고. |
| `legend` | `ChartLegendOptions \| boolean` | 시리즈 2개 이상이면 표시 | 토글과 강조가 되는 시리즈 범례. |
| `hover` | `ChartHoverStyle` | `hitRadius: 12` | 산점도는 항상 가장 가까운 점을 고릅니다. |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `verticalGrid` | `boolean` | `true` | x 눈금 위치의 세로 그리드 선. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. |
| `width` | `number` | `168` | 플롯의 월드 너비. |
| `height` | `number` | `94` | 플롯의 월드 높이. |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | 지원 중단: `'2d'`만 지원합니다. |

## 상호작용 {#interactions}

- 휠은 x와 y를 함께 줌하고, 드래그는 팬하고, 더블클릭은 초기화합니다. `zoomChartXY(factor, anchorNdcX?, anchorNdcY?)`, `setXRange`, `setYRange`, `resetChartZoom`으로 코드에서 같은 일을 합니다.
- 줌과 팬은 변환 uniform만 갱신합니다. 점은 데이터나 보이는 시리즈가 바뀔 때만 다시 업로드합니다.
- hover는 엔진의 균일 그리드 해시로 가장 가까운 점을 찾습니다. 기본 12 px 이내, 또는 버블 자신의 반지름 이내입니다. 툴팁은 시리즈, x, y(`ctx.point`)를 보여 줍니다.
- 브러시 선택(`brush: 'xy'`)은 같은 공간 해시로 점을 선택합니다. `selection.ids`에는 보이는 시리즈의 점 id가 들어 있습니다.

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
sdk.on('select', (sel) => console.log(`점 ${sel.count}개 선택됨`));
```

[상호작용](../guide/interactions), [툴팁과 hover](../guide/tooltips) 참고.

## 로그 축 {#log-axes}

`scale: 'log'`는 log10을 쓰고 10의 거듭제곱에 눈금을 둡니다. 로그 축에서 값이 0 이하인 점은 그리지 않습니다.

## 데이터 갱신 {#updating-data}

새 배열로 `renderScatterChart`를 다시 호출합니다. 다시 업로드하지 않고 시리즈 id를 숨기려면 `setSeriesVisible`을 쓰세요.

## 참고 사항 {#notes}

- 산점도는 2D 전용입니다. `z`와 `viewMode: '3d'`는 무시합니다. 3D 점은 [PointCloud3D · Surface3D](./scientific-3d)를 참고하세요.
- 산점도에서는 오차 막대를 지원하지 않습니다.

## 함께 보기 {#see-also}

- [선](./line)
- [히트맵](./heatmap) — 매우 조밀한 데이터를 그리드로
- [상호작용](../guide/interactions)
