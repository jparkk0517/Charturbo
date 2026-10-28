# 애니메이션

옵트인 방식의 enter / update 애니메이션입니다. 선은 왼쪽에서 오른쪽으로 드러나고, 막대는 기준선에서 자라며, 점과 파이 조각은 fade + scale로 나타나고, 데이터를 갱신하면 새 값으로 보간됩니다. 기본은 꺼져 있습니다. 엔진이 staged GPU 마크를 Rust에서 보간하므로 데이터가 커도 비용이 작습니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/animation.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { animation: { duration: 600, easing: 'ease-out' } });

const categories = ['월', '화', '수', '목', '금', '토', '일'];
const random = () => categories.map(() => 20 + Math.round(Math.random() * 80));
function draw() {
  sdk.renderGroupedBarChart(
    { categories, series: [{ name: '이번 주', values: random() }, { name: '지난주', values: random() }] },
    { title: '일별 주문 수' }
  );
  sdk.render();
}

draw();                                                  // 첫 렌더: 막대가 기준선에서 자람
document.querySelector('button')!.onclick = draw;        // 같은 모양: 막대 높이가 보간됨
```

## 설정

애니메이션 설정은 `true`(400 ms, `'ease-out'`), `false`(끔), 또는 옵션 객체입니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `duration` | `number` | `400` | 길이(ms). 0 이상의 유한한 수여야 하며 `0`이면 꺼집니다. |
| `easing` | `'linear' \| 'ease-out' \| 'ease-in-out' \| 'ease-in'` | `'ease-out'` | 타이밍 곡선. |

잘못된 값은 호출한 자리에서 예외를 던집니다: `animation: duration must be a finite number >= 0 (got …)` 또는 `animation: unknown easing '…'`.

세 곳에서 설정할 수 있고, 더 구체적인 설정이 우선합니다.

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // SDK 전체, 생성 시
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // SDK 전체, 나중에
sdk.renderBarChart(items, { animation: false });               // 이 차트만
```

- `setAnimation`은 현재 차트와 이후에 렌더링하는 모든 차트에 적용됩니다.
- 차트별 `animation` 옵션은 선, 영역, 막대, 그룹 막대, 산점도, 캔들스틱, OHLC, 파이, 박스 플롯 차트에 있습니다. 밴드, 오차 막대, 임펄스 차트에는 없습니다.

## 메서드

| 메서드 | 설명 |
|---|---|
| `setAnimation(animation)` | SDK 전체 설정: `true` / `false` / `{ duration, easing }`. |
| `getAnimation()` | 해석된 SDK 전체 설정(`{ duration, easing }`), 꺼져 있으면 `null`. |
| `isAnimating()` | 차트 애니메이션이 진행 중이면 `true`. |
| `finishAnimation()` | 진행 중인 애니메이션을 마지막 프레임으로 건너뜁니다. 보이려면 `render()`를 호출하세요. |

## Enter

차트를 처음 렌더링하거나 다른 종류로 렌더링할 때:

| 마크 | enter 효과 |
|---|---|
| 선, 영역, 캔들스틱 | 시저(clip) 사각형으로 왼쪽에서 오른쪽으로 드러납니다. 지오메트리는 바뀌지 않습니다. |
| 막대 | 0 기준선에서 자랍니다. 누적 막대는 스택 전체가 함께 자랍니다. |
| 산점도 점, 파이 조각 | fade + scale로 나타납니다. |
| 그 밖의 마크(박스 플롯 등) | fade로 나타납니다. |

## Update

`setSeriesData` 뒤, 또는 같은 종류 · 같은 모양(레이어마다 staged 인스턴스 수가 같음)으로 차트를 다시 렌더링하면 update 애니메이션이 돕니다.

```ts
sdk.setSeriesData(0, next);
sdk.render(); // y 값이 이전 프레임에서 보간됨
```

- 엔진이 이전 프레임의 staged 인스턴스를 원소별로 보간합니다: 선 정점(y 값), 막대 사각형(높이), 산점도 중심. 파이는 조각 각도를 보간해 다시 테셀레이션합니다.
- 모양이 바뀐 레이어는 바로 최종 값으로 바뀌고(snap), 차트 종류가 다르면 enter 애니메이션을 재생합니다.
- 축과 눈금은 새 도메인으로 즉시 이동합니다.

## 비용

- 보간은 LOD로 줄인 뒤의 staged 마크에만 Rust에서 수행합니다: O(visible). 1M 포인트 선도 M4 디시메이션 뒤 남은 수천 개 정점만 보간합니다.
- staged 마크가 50,000개를 넘으면(예: 1M 포인트 산점도) 애니메이션을 생략합니다.
- `requestAnimationFrame`은 애니메이션이 진행 중일 때만 돌고, 유휴 루프는 없습니다. `requestAnimationFrame`이 없거나 탭이 숨겨져 있으면 마지막 프레임을 바로 보여 줍니다.

## 참고

- `prefers-reduced-motion: reduce`이면 애니메이션이 꺼집니다.
- 기본이 꺼짐이라 시각 회귀 픽스처는 결정적입니다.
- 이미지, SVG, PDF [내보내기](./export)는 항상 마지막 프레임을 씁니다.

## 함께 보기

- [실시간 스트리밍](./streaming)
- [내보내기: PNG · SVG · PDF](./export)
- [접근성](./accessibility)
- [성능](./performance)
