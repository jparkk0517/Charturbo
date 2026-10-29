# 픽토리얼 막대

`renderPictorialBarChart`는 막대를 심볼로 그리는 막대 차트(ECharts `pictorialBar`)를 그립니다. 내장 도형이나 SVG 경로를 막대 전체에 늘리거나 막대를 따라 반복하고, 값에서 잘라 낼 수도 있습니다. 나머지는 2D [막대 차트](./bar)와 같습니다. 축, 방향, 그룹형·누적형·백분율 시리즈, 레이블, 호버, 범례, 접근성을 그대로 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html#06-pictorial)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPictorialBarChart(
  [
    { label: '월', value: 72 },
    { label: '화', value: 45 },
    { label: '수', value: 90 },
  ],
  {
    background: true,
    symbol: 'roundRect',
    symbolRepeat: 'fixed',
    symbolClip: true,
    symbolBoundingData: 100,
    symbolSize: ['70%', 10],
    symbolMargin: 2,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

시그니처:

```ts
renderPictorialBarChart(
  data: PictorialBarItem[] | PictorialBarChartData,
  options?: PictorialBarChartOptions
): { barCount: number }
```

## 데이터 형식 {#data-format}

데이터는 막대와 같습니다. 항목 배열(`renderBarChart`)이나 `{ categories, series }`(`renderGroupedBarChart`)를 넘깁니다. 항목과 시리즈에도 아래 심볼 옵션을 줄 수 있습니다. 가장 구체적인 설정이 이깁니다. 항목, 시리즈, 차트 옵션 순입니다.

```ts
sdk.renderPictorialBarChart([
  { label: '좋아요', value: 40, symbol: 'path://M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
  { label: '이탈', value: -20, symbol: 'arrow' },
]);
```

## 옵션 {#options}

`PictorialBarChartOptions`는 모든 [막대 차트 옵션](./bar#options)(2D 전용)에 다음 심볼 옵션을 더합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `symbol` | `'circle' \| 'rect' \| 'roundRect' \| 'square' \| 'triangle' \| 'diamond' \| 'arrow' \| 'pin' \| 'none' \| 'path://…'` | `'circle'` | 도형. `path://`에는 SVG 경로 데이터(`M L H V C S Q T A Z`, 절대·상대 좌표, nonzero 채우기)를 씁니다. 심볼 상자에 맞춰 늘리므로 가로세로 비율은 유지되지 않습니다. |
| `symbolSize` | `number \| '50%' \| [w, h]` | `['100%', '100%']` | 화면상 심볼 크기. 막대를 가로지르는 방향의 퍼센트는 막대 두께 기준입니다. 막대를 따르는 방향은 막대 길이(또는 `symbolBoundingData` 길이) 기준이고, 반복할 때는 막대 두께 기준입니다. |
| `symbolRepeat` | `boolean \| number \| 'fixed'` | `false` | `false`: 심볼 하나. `true`: 막대 길이만큼 반복. 숫자: 그 개수만큼. `'fixed'`: 값과 상관없이 기준 길이에 들어가는 만큼. |
| `symbolMargin` | `number \| '15%'`, `!` 접미사 가능 | `'15%'` | 반복 심볼 양옆의 간격. px 또는 막대 방향 심볼 크기의 퍼센트입니다. 간격을 다시 나눠 전체 길이를 채웁니다. 끝에 `!`(`'10%!'`)를 붙이면 양 끝에도 간격을 둡니다. |
| `symbolClip` | `boolean` | `false` | 데이터 값에서 심볼을 자릅니다. `'fixed'`나 `symbolBoundingData`와 함께 쓰면 "채움 수준" 모양이 됩니다. |
| `symbolPosition` | `'start' \| 'end' \| 'center'` | `'start'` | 심볼 하나 또는 반복 묶음이 막대의 어디에 놓일지. |
| `symbolOffset` | `number \| '50%' \| [x, y]` | `0` | 화면상 이동(오른쪽, 아래). px 또는 심볼 크기의 퍼센트. |
| `symbolRotate` | `number` | `0` | 회전 각도(도). 양수는 반시계 방향입니다. |
| `symbolBoundingData` | `number \| [음수, 양수]` | 없음 | 막대 값 대신 이 값을 기준으로 심볼을 배치합니다. 쌍을 주면 음수 막대는 첫 값, 양수 막대는 둘째 값을 씁니다. |

- 값이 음수인 막대는 반대 방향을 향하고, 심볼도 함께 뒤집힙니다.
- `background`([배경 트랙](./bar#background-tracks) 참고)는 심볼 뒤에 그림자 막대를 그립니다.
- 잘못된 심볼 옵션, `image://` 심볼, `viewMode: '3d'`는 현재 차트를 바꾸기 전에 예외를 던집니다.

## 가로 막대 {#horizontal-bars}

```ts
sdk.renderPictorialBarChart(items, {
  orientation: 'horizontal',
  symbol: 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z',
  symbolRepeat: true,
  symbolClip: true,
  symbolSize: [16, '80%'],
  symbolMargin: '10%',
});
```

이때 "막대를 따르는 방향"은 x축입니다. `symbolSize[0]`은 막대 방향 크기, `symbolSize[1]`은 가로지르는 방향 크기입니다.

## 호버와 애니메이션 {#hover-and-animation}

- 호버와 툴팁은 막대와 같습니다. 호버한 막대의 심볼이 강조되고, 범례는 다른 시리즈를 흐리게 합니다.
- 다시 렌더링하면 심볼이 이전 막대에서 새 막대로 움직이고, 등장 애니메이션은 기준선에서 자라납니다. 반복 심볼은 프레임마다 다시 배치하므로, 자라는 막대는 심볼을 늘이지 않고 개수를 더합니다.

## 접근성과 내보내기 {#accessibility-and-export}

막대 차트의 요약("픽토리얼 막대 차트"), 데이터 표, 키보드 탐색을 그대로 씁니다. CSV 내보내기는 막대 값을 담고, SVG 내보내기는 심볼을 벡터 경로로 씁니다. React와 Vue 컴포넌트는 `type: 'pictorialBar'`에 `data`와 `options`를 받습니다.

## 제한 사항 {#limitations}

- `image://` 심볼은 지원하지 않습니다.
- `symbolKeepAspect`, `symbolPatternSize`, 시리즈 겹치기(`barGap: '-100%'`)는 없습니다.
- 2D 전용입니다. 히스토그램, 폭포 차트, 콤보 차트는 픽토리얼로 그릴 수 없습니다.

## 함께 보기 {#see-also}

- [막대](./bar)
- [히스토그램](./histogram)
