# 데이터 포인트 편집

선 차트와 산점도에서는 ECharts의 드래그 가능한 포인트처럼, 사용자가 포인트를 드래그해 값을 바꾸고 플롯을 클릭해 포인트를 추가할 수 있습니다. 편집은 기본적으로 꺼져 있습니다. `editable`이 없으면 차트는 이전과 똑같이 동작합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 켜기

```ts
sdk.renderLineChart([{ name: 'Target', values: [42, 48, 55, 51, 63] }]);
sdk.enableNodeInteractions(canvas, { autoRender: true, editable: { dragAxis: 'y', min: 0, max: 100 } });

sdk.on('pointDrag', (e) => console.log(e.series, e.index, e.oldValue.y, '→', e.newValue.y));
sdk.on('pointDragEnd', (e) => {
  if (!e.cancelled) save(sdk.getSeriesData(e.series));
});
```

`editable: true`는 기본값을 씁니다. 나중에 옵션을 바꾸려면 `sdk.setChartEditable(options | false)`를, 현재 옵션을 보려면 `sdk.getChartEditable()`을 씁니다. 옵션은 무엇이든 바꾸기 전에 검사합니다. 잘못된 `dragAxis`나 `min > max`는 예외를 던지고 현재 설정을 그대로 둡니다.

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `drag` | `true` | 기존 포인트의 포인터·키보드 드래그 |
| `dragAxis` | 선 `'y'`, 산점도 `'xy'` | 드래그가 움직이는 축: `'x'`, `'y'`, `'xy'` |
| `min` / `max` | 없음 | 데이터 단위의 y 제한 |
| `xMin` / `xMax` | 없음 | 데이터 단위의 x 제한 |
| `addOnClick` | `false` | 플롯의 빈 곳을 클릭하거나 탭하면 포인트를 추가 |
| `addSeries` | `0` | 새 포인트가 들어갈 시리즈 |
| `series` | 전체 | 이 시리즈만 편집 가능 |
| `hitRadius` | `10` | 포인트 중심에서 잡히는 거리(CSS px) |

## 드래그 동작

- **포인터:** 포인트를 누르면 그 포인트를 잡으므로 팬, 브러시, 박스 줌이 시작되지 않습니다. 움직이지 않은 누름은 일반 클릭입니다. 마우스, 터치, 펜 모두 Pointer Events로 동작합니다.
- **제한:** 값은 보이는 플롯 범위와 `min` / `max` / `xMin` / `xMax` 안에 머뭅니다.
- **선의 x 드래그:** 선 포인트는 시리즈에 `x` 값이 있을 때만 x로 움직입니다. 이웃 포인트를 넘어가지 않으므로 x 순서가 유지됩니다.
- **Escape:** 드래그를 취소하고 이전 값을 되돌립니다. 이때 `pointDragEnd`에 `cancelled: true`가 들어 있습니다.
- **실시간 갱신:** 차트는 데이터 갱신 경로로 다시 그립니다. 장면을 지우지 않으며 줌, 범례, 스타일 상태가 유지됩니다. 선의 y 도메인은 드래그하는 동안 고정되고 놓으면 다시 계산됩니다.

## 클릭으로 추가

`addOnClick`을 켜면 플롯의 빈 곳을 클릭할 때 포인터 아래에 포인트를 추가하고 `pointAdd`를 보냅니다. 기존 포인트 위나 바로 옆의 클릭은 추가가 아닙니다. 선에서는 x 순서대로 끼워 넣으며(`x`가 없으면 가장 가까운 샘플 인덱스), 뒤쪽 인덱스는 하나씩 밀립니다.

```ts
sdk.enableNodeInteractions(canvas, { editable: { addOnClick: true, addSeries: 1 } });
sdk.on('pointAdd', (e) => console.log(`series ${e.series} #${e.index}`, e.value));
```

## 키보드

차트에 포커스를 두고 화살표 키로 포인트로 이동한 뒤:

- **Shift + 화살표**는 포커스된 포인트를 보이는 범위의 1/50만큼 옮깁니다.
- **Alt + 화살표**는 보이는 범위의 1/500만큼 옮깁니다(미세 이동).

위·아래는 y를 바꿉니다. 왼쪽·오른쪽은 `dragAxis`가 허용할 때 x를 바꿉니다. 새 값은 차트의 라이브 영역에서 읽어 주며, 한 번 누를 때마다 `source: 'keyboard'`인 `pointDrag`와 `pointDragEnd`를 보냅니다.

## 이벤트와 데이터

| 이벤트 | 페이로드 |
|---|---|
| `pointDrag` | 움직일 때마다 `{ chartType, series, index, oldValue, newValue, source }` |
| `pointDragEnd` | 위와 같고 `cancelled` 추가 |
| `pointAdd` | `{ chartType, series, index, value }` |

`sdk.getSeriesData(series)`는 편집된 데이터를 `{ x, y }`로 돌려줍니다. 산점도는 그 시리즈의 포인트 인덱스인 `index`도 함께 돌려줍니다. `x` 값이 없는 선 차트의 `x`는 샘플 인덱스입니다.

React: `onPointDrag`, `onPointDragEnd`, `onPointAdd`. Vue: `@point-drag`, `@point-drag-end`, `@point-add`. `editable`은 `interactions`로 전달합니다.

## 제한

- **지원 차트:** 2D 선 차트와 산점도.
- **편집할 수 없는 선 시리즈:** 누적, 100% 누적, 밴드, ThemeRiver, 희소(sparse) 시리즈와 추가 y축(`yAxisIndex` ≥ 2)의 시리즈.
- **산점도:** 현재 도메인 밖의 포인트도 유지됩니다. 도메인은 다음 렌더 전까지 넓어지지 않습니다.
