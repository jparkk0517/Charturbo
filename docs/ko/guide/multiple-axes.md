# 다중 축과 축 끊김

선 차트와 콤보 차트는 y축을 세 개 이상 표시할 수 있습니다. 값 축에서는 데이터가 없는 구간을 접을 수 있습니다(축 끊김).

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## y축 세 개 이상

각 시리즈는 `yAxisIndex`로 축을 고릅니다. 값은 다음과 같습니다.

- `0`: `axes.y`(왼쪽)
- `1`: `axes.y2`(오른쪽)
- `2..`: `axes.extraY[k - 2]`

`yAxisIndex`는 `yAxis: 'left' | 'right'`보다 우선합니다.

```ts
sdk.renderLineChart(
  [
    { name: 'Temperature', x, values: temp },
    { name: 'Rain', x, values: rain, yAxis: 'right' },
    { name: 'Pressure', x, values: pressure, yAxisIndex: 2, color: '#c2410c' },
  ],
  {
    axes: {
      y: { title: '기온 (°C)' },
      y2: { title: '강수량 (mm)', min: 0 },
      extraY: [{ title: '기압 (hPa)', color: '#c2410c', format: (v) => v.toFixed(0) }],
    },
  }
);
```

추가 축마다 다음 옵션을 따로 가집니다.

- `min` / `max`, `autoscale`
- `scale`(`'linear'` / `'log'`)
- `format`, `title`, `tickCount`, `breaks`
- 배치 옵션(아래 표)

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `position` | `'right'` | 플롯의 어느 쪽에 둘지. 같은 쪽에 이미 있는 축 바깥으로 쌓입니다 |
| `offset` | `0` | 같은 쪽 이전 축과의 추가 간격(CSS px) |
| `color` | 테마 | 레이블·제목·축선 색 |
| `show` | `true` | `false`면 레이블만 숨기고 축 스케일은 유지 |

- **여백:** 추가 레이블 영역과 제목에 맞춰 자동으로 늘어납니다.
- **확대:** x 확대·이동은 모든 시리즈에 적용됩니다. y축은 각각 따로 자동 스케일됩니다.
- **격자선:** 왼쪽 축을 따릅니다.
- **툴팁:** 각 값을 해당 축의 `format`으로 표시합니다.
- **개수 제한:** 추가 축은 최대 6개입니다(y축 합계 8개).
- **오류:** 축이 없는 `yAxisIndex`는 현재 차트를 지우기 전에 오류를 던집니다.

콤보 차트도 같은 옵션을 받습니다(`ComboChartOptions.axes.extraY`의 `min`, `max`, `nice`, `position`, `offset`, `color`). 막대 시리즈는 모두 첫 막대 시리즈의 축을 공유합니다.

```ts
sdk.renderComboChart(
  {
    categories: weeks,
    series: [
      { name: 'Volume', type: 'bar', values: volume },
      { name: 'Price', type: 'line', yAxis: 'right', values: price },
      { name: 'RSI', type: 'line', yAxisIndex: 2, values: rsi },
    ],
  },
  { axes: { extraY: [{ title: 'RSI', position: 'left', min: 0, max: 100, nice: false }] } }
);
```

축이 많으면 서로 무관한 스케일을 비교하게 만들기 쉽습니다. 시리즈 사이에 관계가 없다면 차트를 나누는 편이 낫습니다.

## 축 끊김

`breaks`는 값 구간을 작은 간격으로 접습니다. 접힌 자리는 축과 플롯 전체에 지그재그 선으로 표시됩니다.

```ts
sdk.renderBarChart(items, {
  axes: { y: { breaks: [{ start: 40, end: 430, gap: '8%' }] } },
});
```

| 필드 | 의미 |
|---|---|
| `start`, `end` | 접을 값 구간(`start < end`) |
| `gap` | 구간이 남기는 폭. 데이터 단위, 또는 축의 남은 데이터 범위에 대한 `'<n>%'`. 기본 `'2%'` |

지원 범위는 다음과 같습니다.

| 차트 | 축 |
|---|---|
| 선 | `axes.y`, `axes.y2`, `axes.extraY[i]` |
| 영역 | `axes.y` |
| 콤보 | `axes.y`, `axes.y2`, `axes.extraY[i]` |
| 막대(단일, 그룹·누적·백분율) | 값 축(`axes.y`, 가로 막대는 `axes.x`) |
| 산점도 | `axes.x`, `axes.y` |

- **엔진:** 구간별 매핑은 Rust 스케일에 있습니다. 지오메트리, 눈금, 호버, 브러시 선택, 확대가 모두 이 매핑을 씁니다.
- **눈금:** 접힌 구간을 건너뜁니다.
- **끊김 안의 데이터:** 간격 위치에 그려집니다. 툴팁·데이터 표·CSV에는 실제 값이 그대로 나옵니다.
- **내보내기:** PNG·SVG 내보내기에도 지그재그 표시가 포함됩니다.
- **스크린 리더:** 설명에 모든 끊김이 나열됩니다.

규칙은 다음과 같습니다. 현재 차트를 지우기 전에 검사합니다.

- 축당 최대 8개, 겹치거나 맞닿는 구간 불가
- 선형 스케일만 가능: `log` 축의 끊김은 오류. 끊김이 있는 축의 `setAxisScale(axis, { scale: 'log' })`도 오류
- 막대 오차 막대와 끊김은 함께 쓸 수 없음
- 그림 막대와 선·영역 차트의 x축은 끊김을 거부

## 접근성

스크린 리더 설명은 차트 로캘로 다음을 알려 줍니다.

- 각 추가 축과 그 축의 시리즈("추가 Y축(Pressure): Pressure.")
- 각 끊김("Y축: 40~430 구간 생략.")
