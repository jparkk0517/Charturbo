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
| `transition` | `boolean` | `false` | 짝을 이루는 종류(막대 ↔ 파이, 트리맵 ↔ 선버스트)의 다음 차트로 모핑합니다. [전환](#전환)을 보세요. |

잘못된 값은 호출한 자리에서 예외를 던집니다: `animation: duration must be a finite number >= 0 (got …)` 또는 `animation: unknown easing '…'`.

세 곳에서 설정할 수 있고, 더 구체적인 설정이 우선합니다.

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // SDK 전체, 생성 시
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // SDK 전체, 나중에
sdk.renderBarChart(items, { animation: false });               // 이 차트만
```

- `setAnimation`은 현재 차트와 이후에 렌더링하는 모든 차트에 적용됩니다.
- 차트별 `animation` 옵션은 선, 영역, 막대, 그룹 막대, 산점도, 캔들스틱, OHLC, 파이, 박스 플롯, 트리맵, 선버스트 차트에 있습니다. 밴드, 오차 막대, 임펄스 차트에는 없습니다.

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

## 막대 레이스

`renderBarChart`(가로 또는 세로)의 `realtimeSort`는 렌더링할 때마다 막대를 값이 큰 순서로 정렬합니다. 애니메이션이 켜져 있으면 각 막대는 인덱스가 아니라 이전 차트에서 같은 *라벨*이 있던 자리에서 트윈되므로, 연도별로 다시 렌더링하면 레이스가 됩니다.

```ts
const draw = (year: number) => {
  sdk.renderBarChart(rows(year), {
    title: `Users, ${year}`,
    orientation: 'horizontal',
    labels: true,
    realtimeSort: { max: 8 },                     // 상위 8개만 유지
    animation: { duration: 900, easing: 'linear' },
  });
  sdk.render();
};
setInterval(() => draw(++year), 1000);
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `realtimeSort` | `boolean \| { max?, valueAnimation? }` | 꺼짐 | `true`면 모든 막대를 정렬합니다. |
| `realtimeSort.max` | `number` | 전체 | 가장 큰 N개 막대만 남깁니다(1 이상의 정수). |
| `realtimeSort.valueAnimation` | `boolean` | `true` | 값 라벨이 같은 라벨의 이전 값에서 카운트업됩니다. |

- 막대는 라벨로 짝지어집니다. 새로 들어온 라벨은 마지막 막대 다음 자리에서 미끄러져 들어오며 페이드인하고, 빠진 라벨은 그 자리로 미끄러져 나가며 페이드아웃합니다.
- 카테고리 라벨과 값 라벨은 막대와 함께 움직입니다. 값 축은 새 도메인으로 즉시 이동합니다.
- 키 기준 트윈은 2D 막대 차트에서 동작하며, `viewMode: '3d'`에서는 정렬과 개수 제한만 적용됩니다. `realtimeSort`가 없으면 막대는 이전처럼 데이터 순서를 유지하고 인덱스로 트윈됩니다.

## 선 레이스

`renderLineChart`의 `endLabel`은 각 선 끝에 시리즈 이름과 마지막 값을 담은 라벨을 붙입니다. 왼쪽에서 오른쪽으로 드러나는 동안 라벨은 드러나는 앞쪽 끝을 따라가므로, `duration`을 길게 주면 선들이 레이스를 합니다.

```ts
sdk.renderLineChart(series, {
  legend: false,
  endLabel: true,                                  // 또는 { format: (value, name) => `${name}: ${value}` }
  animation: { duration: 4000, easing: 'linear' },
});
```

- 기본 텍스트는 `이름 값`이며 값은 y축 형식을 따릅니다. 라벨이 들어가도록 오른쪽 여백이 늘어납니다.
- 2D 선 차트에만 적용됩니다. 영역 차트에는 `endLabel`이 없습니다.

## 전환

애니메이션 설정에 `transition: true`가 있으면, 같은 데이터를 짝이 되는 종류로 다시 렌더링할 때 enter 애니메이션 대신 마크 단위로 모핑합니다.

```ts
const animation = { duration: 800, transition: true };
sdk.renderBarChart(labels.map((label, i) => ({ label, value: values[i] })), { animation });
sdk.render();
sdk.renderPieChart({ labels, values }, { animation }); // 각 막대가 자기 조각으로 모핑
sdk.render();
```

| 시작 ↔ 끝 | 마크를 짝짓는 기준 |
|---|---|
| 막대 ↔ 파이 | 카테고리 라벨 = 조각 라벨. |
| 트리맵 ↔ 선버스트 | 노드 경로(루트부터의 이름). |

- 각 마크는 24개 점으로 된 안쪽 변과 바깥쪽 변을 가진 폴리곤이 됩니다(막대: 기준선 → 값 끝, 조각이나 호: 안쪽 호 → 바깥쪽 호, 트리맵 셀: 아래 → 위). 사각형과 고리 부채꼴이 같은 형태를 공유하므로 엔진은 Rust에서 두 변을 점별로 보간하기만 합니다. 프레임마다 리샘플링, 대응점 탐색, 재삼각분할이 없고 모든 프레임이 올바른 도형입니다.
- 짝이 없는 마크는 제자리에서 페이드인 또는 페이드아웃합니다.
- 모핑 중에는 마크에 둥근 모서리와 안티앨리어싱 외곽선이 없고, 데이터 라벨과 축은 이미 최종 레이아웃에 있습니다.
- 마크가 2,000개를 넘는 차트는 모핑하지 않고 enter 애니메이션을 재생합니다.
- 그 밖의 종류 변경과 `transition: false`(기본값)는 이전과 같습니다.

### 레이스와 전환 중에

- 호버, 클릭, 툴팁은 움직이는 마크가 아니라 최종 레이아웃으로 히트 테스트합니다.
- 접근성(스크린 리더 요약과 데이터 표)은 최종 데이터를 설명합니다. 카운트업 라벨은 화면 표시용입니다.
- `prefers-reduced-motion: reduce`이면 트윈, 카운트업, 모핑이 꺼지고 차트는 정렬된 최종 상태를 보여 줍니다.

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
