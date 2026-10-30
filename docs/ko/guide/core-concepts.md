# 핵심 개념

이 페이지는 `Charturbo` 인스턴스가 어떻게 동작하는지 설명합니다. 어떻게 만들어지고, 언제 그리고, 캔버스 크기를 어떻게 따라가며, 어떻게 해제되는지 다룹니다. 정적인 차트 하나보다 큰 것을 만들기 전에 한 번 읽어 두세요.

## 캔버스 하나에 SDK 하나

`Charturbo` 인스턴스는 `<canvas>` 하나에 묶인 엔진 하나를 가집니다. 한 번에 뷰 하나만 보여 줍니다. 차트, 3D 그래프나 임베딩 클라우드, 3D 장면 중 하나입니다.

- `render*` 호출(`renderLineChart`, `renderBarChart`, ...)은 그 인스턴스의 현재 차트를 교체합니다.
- 차트 두 개를 나란히 보여 주려면 캔버스 두 개와 인스턴스 두 개를 만드세요.
- 차트가 많은 페이지에서는 `Charturbo.create(canvas, { device })`로 인스턴스들이 GPU 디바이스 하나를 공유하게 하세요. [공유 GPU 디바이스](./shared-device)를 보세요.

## 인스턴스 만들기

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US', autoResize: true });
```

`Charturbo.create(canvas, options?)`는 WebAssembly 모듈을 불러오고(페이지당 한 번), WebGPU 또는 WebGL2로 엔진을 시작한 뒤 인스턴스로 resolve됩니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `autoResize` | `boolean` | `true` | `canvas.width` / `height`를 CSS 크기 × 기기 픽셀 비율로 유지하고, 바뀌면 `resize()` + `render()` 호출 |
| `locale` | `string` | 페이지 언어(`<html lang>`), 그다음 브라우저 언어 | 숫자 / 날짜 라벨, 툴팁 값, 내장 UI 텍스트의 로캘([다국어 지원](./i18n) 참고) |
| `timeZone` | `CharturboTimeZone` | `'local'` | 시간 축, 라벨, 툴팁의 시간대: `'local'`, `'UTC'` 또는 IANA 이름 |
| `sync` | `ChartSyncMemberOptions` | 없음 | 커서 / 줌 동기화 그룹에 참여([대시보드 동기화](./dashboard-sync) 참고) |
| `animation` | `ChartAnimationInput` | 꺼짐 | enter / update 애니메이션([애니메이션](./animation) 참고) |
| `antialias` | `boolean \| 1 \| 4` | 꺼짐 | 메인 패스 MSAA x4(`true` = `4`, [안티에일리어싱](../charts/scene-3d#anti-aliasing) 참고) |
| `device` | `CharturboDevice` | 없음 | 공유 GPU 디바이스: 어댑터 / 디바이스 요청 없음, 파이프라인 캐시 |
| `seed` | `number` | `42` | 생성되는 시작 그래프의 시드 |
| `nodeCount` | `number` | `1000` (`device` 사용 시 `0`) | 생성되는 시작 그래프의 노드 수 |
| `edgeCount` | `number` | `2000` (`device` 사용 시 `0`) | 생성되는 시작 그래프의 엣지 수 |
| `clusterCount` | `number` | `8` (`device` 사용 시 `1`) | 생성되는 시작 그래프의 군집 수 |

마지막 네 옵션은 그래프 뷰에만 의미가 있습니다. 엔진은 시드로 만든 무작위 그래프를 가지고 시작하며, 차트를 렌더링하거나 직접 데이터를 불러오기(`loadDataset`, `loadEmbeddings`) 전까지 이 그래프를 보여 줍니다. 차트만 쓰는 앱은 무시해도 됩니다.

`create`는 실패 원인을 `reason`에 담은 `CharturboInitError`로 reject됩니다.

| `reason` | 의미 |
|---|---|
| `'no-webgpu'` | WebGPU와 WebGL2가 모두 없거나 캔버스 서피스를 만들 수 없음 |
| `'adapter'` | 알맞은 GPU 어댑터가 없음 |
| `'device'` | 어댑터가 디바이스 생성을 거부함 |
| `'wasm'` | WebAssembly 모듈을 불러오지 못함 |

`Charturbo.isSupported()`로 WebGPU 어댑터나 WebGL2를 쓸 수 있는지 미리 확인할 수 있습니다. 그래도 디바이스 단계의 오류로 `create`가 실패할 수 있습니다.

## 렌더링

SDK는 차트를 *기술하는 일*과 프레임을 *그리는 일*을 나눕니다.

- `render*` 메서드와 setter(`setSeriesData`, `setTheme`, `setXRange`, ...)는 엔진 상태를 바꿉니다.
- `render()`는 프레임 하나를 그리고 오버레이 DOM을 갱신합니다.

쉬는 동안 도는 렌더 루프는 없습니다. 무언가를 바꾼 뒤에는 `render()`를 호출하세요.

```ts
sdk.renderLineChart(series, { title: '처리량' });
sdk.render();

sdk.appendSeriesData(0, chunk);
sdk.render();
```

다음 경우에는 SDK가 `render()`를 대신 호출합니다.

| 계기 | 시점 |
|---|---|
| `autoResize` | 캔버스 픽셀 크기가 바뀐 뒤 |
| `enableNodeInteractions(canvas, { autoRender: true })` | hover, 줌, 팬, 범례 클릭 등 상호작용 뒤(`autoRender` 기본값은 `false`) |
| 애니메이션 | enter / update 애니메이션이 도는 동안 매 프레임, 끝나면 멈춤 |
| React / Vue 컴포넌트 | prop이 바뀐 뒤. 상호작용은 기본으로 `autoRender: true` 사용 |

그래프 물리(`stepPhysics`, `stepPhysicsAsync`)는 스스로 렌더링하지 않습니다. 직접 만든 `requestAnimationFrame` 루프에서 스텝마다 `render()`를 호출하세요.

## 차트 교체와 갱신

`render*` 메서드를 다시 호출하면 차트가 교체됩니다. 오버레이 DOM을 다시 만들고, 주석을 초기화하며, 줌 기록은 비어 있는 상태로 시작합니다. 각 `render*` 메서드는 작은 요약을 반환합니다. 예를 들어 선 차트는 `{ totalPoints, seriesCount }`입니다.

차트를 교체하지 않고(스타일과 줌을 유지하며) 데이터만 바꾸려면 그 차트 종류의 갱신 메서드를 쓰세요. 선·영역 차트라면 `setSeriesData`, `appendSeriesData`, `appendAreaData`입니다. [실시간 스트리밍](./streaming)과 차트별 페이지를 보세요.

`loadDataset`과 `loadEmbeddings`는 인스턴스를 차트에서 그래프 뷰로 바꾸고 차트 오버레이를 제거합니다.

## 크기와 픽셀 비율

`autoResize: true`(기본값)이면 SDK가 캔버스를 관찰합니다.

- 브라우저가 지원하면 `device-pixel-content-box`로 `ResizeObserver`를 쓰고, 아니면 CSS 크기 × `devicePixelRatio`를 씁니다. CSS 크기는 그대로인 브라우저 확대·모니터 변경은 `matchMedia` 쿼리로 잡습니다.
- `canvas.width` / `height`를 설정하고 `resize(width, height)`와 `render()`를 호출합니다. 크기는 한 변 최대 8192 px로 제한됩니다(비율 유지).
- CSS 크기가 없는 캔버스는 리사이즈할 때마다 커질 수 있습니다. 처음 그런 일이 생기면 SDK가 CSS 크기를 고정합니다.

앱이 캔버스 크기를 직접 관리한다면 끄고 크기를 알려 주세요.

```ts
const sdk = await Charturbo.create(canvas, { autoResize: false });

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  sdk.resize(canvas.width, canvas.height);
  sdk.render();
}
```

`resize(width, height)`는 물리 픽셀 단위이며 `'resize'` 이벤트를 발생시킵니다. 엔진은 `resize()` 때 캔버스로부터 선 두께용 픽셀 비율을 계산합니다. `setPixelRatio(ratio)`로 덮어쓸 수 있습니다.

오버레이(제목, 범례, 축 라벨)는 캔버스의 부모 요소에 붙고 캔버스 위치를 기준으로 배치됩니다. 캔버스를 `position: relative`인 컨테이너 안에 두세요.

## 수명 주기

```ts
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
// ...
detach();      // 이 리스너와 툴팁만 제거
sdk.dispose(); // 전부 해제
```

`dispose()`는 다음을 합니다.

- 동기화 그룹에서 나가고 자동 리사이즈 관찰을 멈춥니다.
- 진행 중인 애니메이션을 멈추고 모든 이벤트 핸들러를 제거합니다.
- 모든 `enableNodeInteractions` 바인딩을 해제합니다.
- 오버레이 DOM과 접근성 요소를 제거합니다.
- WebAssembly 엔진을 해제합니다.

두 번 호출해도 안전합니다. 해제한 뒤에는 인스턴스를 쓰지 마세요. `stepPhysicsAsync` 같은 메서드는 `Engine is disposed`를 던집니다. React와 Vue 컴포넌트는 언마운트할 때 엔진을 해제합니다.

## 테마

기본 테마는 `'dark'`입니다. `setTheme`은 `'dark'`, `'light'` 또는 테마 객체를 받습니다. `getTheme()`은 현재 테마를 반환하고, `CHARTURBO_THEMES`에 내장 테마가 있습니다.

```ts
sdk.setTheme('light');
sdk.setTheme({ ...sdk.getTheme(), name: 'brand', palette: ['#3182f6', '#14b8a6', '#f59e0b'] });
sdk.render();
```

`setTheme`은 배경, 텍스트, 격자, 툴팁과 테마를 따르는 차트 스타일을 바꿉니다. 시리즈에 직접 지정한 색은 `render*` 메서드를 다시 호출할 때까지 유지됩니다. [스타일과 테마](./styling)를 보세요.

## 이벤트

`sdk.on(event, handler)`는 구독하고 구독 해제 함수를 반환합니다. `sdk.off(event, handler)`도 쓸 수 있습니다.

| 이벤트 | 페이로드 | 발생 시점 |
|---|---|---|
| `hover` | `CharturboHoverEvent` | hover 대상이 바뀜(`enableNodeInteractions` 필요) |
| `click` | `CharturboClickEvent` | 드래그 없는 클릭 또는 탭(`enableNodeInteractions` 필요) |
| `rangechange` | `CharturboRange` | 보이는 범위가 바뀜(줌, 팬, 리셋, `setXRange`). 프레임당 최대 1회 |
| `legendtoggle` | `{ series, visible }` | 시리즈를 보이거나 숨김 |
| `select` | `CharturboSelection` | 브러시 선택을 확정하거나 해제 |
| `drill` | `CharturboDrillEvent` | 트리맵 / 선버스트에서 드릴다운하거나 위로 이동 |
| `themechange` | `CharturboTheme` | 테마가 바뀜 |
| `resize` | `{ width, height }` | 렌더 대상 크기가 바뀜(물리 px) |

```ts
const off = sdk.on('rangechange', ({ xMin, xMax }) => console.log(xMin, xMax));
off();
```

## 로캘과 시간대

`locale`(create 옵션 또는 `sdk.setLocale`)은 `Intl` 숫자·날짜 형식과 내장 UI 텍스트의 언어를 정합니다. 내장 UI 텍스트는 접근성 요약, 데이터 표 머리글, 툴팁 필드 라벨, 내보내기·범례 문구입니다. 영어, 한국어, 간체 중국어가 내장되어 있고, 그 밖의 로캘은 영어로 대체됩니다. 로캘이 없으면 페이지 언어(`<html lang>`), 그다음 브라우저 언어를 따릅니다. 차트마다 자체 `locale` 옵션으로 덮어쓸 수 있습니다. `timeZone`(또는 `sdk.setTimeZone`)은 시간 축의 시간대를 정합니다. [다국어 지원](./i18n)과 [숫자·날짜 형식](./number-format)을 보세요.

## 함께 보기

- [시작하기](./getting-started)
- [상호작용](./interactions)
- [성능](./performance)
