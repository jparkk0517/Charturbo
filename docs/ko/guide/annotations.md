# 주석

주석은 2D 차트에 기준값을 표시합니다. 가로선과 세로선, x 구간과 y 구간, 포인트 마커, 자유 텍스트입니다. 데이터 단위로 놓이고, 줌과 팬을 따라가며, 플롯 밖은 잘립니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: '지연 시간' });
sdk.setAnnotations([
  { type: 'hline', y: 250, label: 'SLO 250', dash: true, color: [0.94, 0.35, 0.33, 1], z: 'above' },
  { type: 'xband', from: 6800, to: 7000, label: '장애 구간', opacity: 0.16 },
  { type: 'point', x: 6900, y: 312, width: 6 }, // 마커 반지름 CSS px
  { type: 'text', x: 100, y: 40, text: '배포 v2.3' },
]);
sdk.addAnnotation({ type: 'vline', x: new Date('2026-02-01'), labelPosition: 'start' });
sdk.render();
```

`setAnnotations`는 render 호출 뒤에 부르세요. 새 차트를 렌더하면 주석이 지워집니다.

## 주석 종류

| `type` | 필드 | 그리는 것 |
|---|---|---|
| `'hline'` | `y` | 가로 기준선 |
| `'vline'` | `x` | 세로 기준선 |
| `'yband'` | `from`, `to` | 두 y 값 사이의 가로 구간 |
| `'xband'` | `from`, `to` | 두 x 값 사이의 세로 구간 |
| `'point'` | `x`, `y` | 포인트 마커 |
| `'text'` | `x`, `y`, `text` | 그 지점을 중심으로 한 텍스트 |

구간 끝은 `Infinity`나 `-Infinity`일 수 있습니다. 이때 구간은 플롯 끝까지 닿습니다.

## 좌표

좌표는 활성 차트의 데이터 단위입니다.

- 선 · 영역 차트: x는 샘플 인덱스, 차트에 `x`가 있으면 시리즈 `x` 값(시간 축은 epoch ms 또는 `Date`)입니다. y는 값입니다.
- 막대 차트: x는 카테고리 인덱스입니다(소수 허용). `orientation: 'horizontal'`이면 x가 값, y가 카테고리 인덱스입니다.
- 산점도 차트: x와 y 값.
- 캔들스틱, 콤보, 워터폴 차트는 각자의 축처럼 x와 y를 매핑합니다.

주석은 위 차트들의 2D 뷰에서 동작합니다. 히트맵, 박스 플롯, 파이, 레이더, 게이지, 퍼널, 계층, 3D 차트에는 표시되지 않습니다. 로그 축과 반전 축도 지원합니다.

## 스타일 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `color` | `ColorInput` | 테마 `baseline`(선, 점), 테마 `crosshair`(구간) | 선, 마커, 구간 색 |
| `width` | `number` | 선 `1.5`, 점 `5`, 구간 `0`(테두리 없음) | 선 / 구간 테두리 두께 CSS px, 또는 점 반지름 |
| `dash` | `number \| boolean` | 없음 | 점선 길이 CSS px. `true` = 6 px |
| `opacity` | `number` | 구간 `0.18`, 나머지 `1` | 알파 배율 |
| `label` | `string` | — | DOM 라벨 (작은 알약) |
| `labelPosition` | `'start' \| 'end' \| 'center'` | `'end'` | 선 · 구간을 따라 놓는 라벨 위치. start = 왼쪽 / 아래, end = 오른쪽 / 위 |
| `z` | `'below' \| 'above'` | `'below'` | `'below'`: 그리드선과 함께 시리즈 아래. `'above'`: 시리즈 위, hover 레이어 아래 |
| `yAxis` | `'left' \| 'right'` | `'left'` | 이중 y축 선 차트에서 `y`와 y 구간의 축 |

텍스트 주석은 `text`를 일반 텍스트로 그리고, 나머지 종류는 `label`을 주석 색 테두리가 있는 알약으로 그립니다.

## 주석 관리

```ts
sdk.setAnnotations(list);            // 전체 교체
const i = sdk.addAnnotation(item);   // 추가하고 인덱스 반환
sdk.getAnnotations();                // 현재 목록의 복사본
sdk.clearAnnotations();
sdk.render();
```

- 잘못된 색은 오류를 던지고 현재 목록은 바뀌지 않습니다.
- 기본 색은 테마를 따릅니다. `setTheme`은 `color`를 지정하지 않은 주석의 색을 바꿉니다.

## 이중 y축

오른쪽 축이 있는 선 차트에서 `yAxis: 'right'`를 주면 `y`, `from`, `to`를 그 축 값으로 읽습니다. 오른쪽 축 시리즈가 없으면 왼쪽 축을 씁니다.

```ts
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: '호우 기준' }]);
```

## 참고

- 엔진이 데이터 단위를 화면 좌표로 바꾸고, 마크를 잘라 내고, GPU로 그립니다(구간 삼각형, 선분, 마커). 라벨은 엔진이 알려 준 앵커에 놓이는 DOM 요소이며, 앵커가 움직일 때만 다시 배치됩니다.
- 라벨 요소의 클래스는 `charturbo-sdk-annotation-label`입니다.
- SVG 내보내기에 주석이 포함됩니다.

## 함께 보기

- [데이터와 축](./data-and-axes): 이중 y축, 로그 스케일
- [스타일과 테마](./styling)
- [내보내기: PNG · SVG · PDF](./export)
