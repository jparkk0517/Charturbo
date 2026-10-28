# 변경 기록 · 마이그레이션

이 페이지는 Charturbo 버전이 어떻게 바뀌는지 설명하고, 업그레이드할 때 손봐야 하는 깨지는 변경을 정리합니다. 전체 변경 목록은 [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)에 있습니다.

## 버전 정책 (0.x)

1.0.0 전까지 Charturbo는 [SemVer](https://semver.org/lang/ko/) 0.x 관례를 따릅니다.

| 변경 | 올리는 자리 | 예 |
|---|---|---|
| 공개 API의 호환되지 않는 변경: 이름 변경·제거, 시그니처, 기본값, 이벤트 페이로드, 내보내는 타입. 의도한 렌더링 변경. 지원 브라우저 / Node / peer 범위 축소 | **minor** | 0.1.x → 0.2.0 |
| 하위 호환 기능 추가: 새 차트 종류, 옵션, 메서드, 내보내는 타입 | **minor** | 0.1.x → 0.2.0 |
| 버그 수정, 성능 개선, 문서, 렌더링이 바뀌지 않는 내부 변경 | **patch** | 0.1.0 → 0.1.1 |

- minor 하나에 기능 추가와 깨지는 변경이 함께 들어갈 수 있습니다. 깨지는 변경은 CHANGELOG에 마이그레이션 방법과 함께 적습니다.
- npm 기본 범위 `^0.1.0`(`>=0.1.0 <0.2.0`)은 patch만 받습니다. minor로 올리기 전에 CHANGELOG를 읽으세요.
- 폐기 예정 API는 JSDoc `@deprecated`로 표시하고, 최소 한 번의 minor 동안 유지한 뒤 제거합니다.
- 공개 API는 `charturbo`, `charturbo/inline`, `charturbo/react`, `charturbo/vue`가 내보내는 것입니다. WebAssembly 바인딩(`WasmCharturboEngineBackend`의 `snake_case` 메서드)과 내부 경로(`dist-lib/sdk/*`)는 공개 API가 아닙니다.
- 프리릴리스는 `0.2.0-rc.1` 같은 버전과 npm `next` 태그를 씁니다.

## 현재 상태

0.1.0이 첫 릴리스이며 아직 배포되지 않았습니다. 아래 변경은 미배포(Unreleased) 구간에 있으며, 이전 스냅샷을 소스에서 빌드해 썼다면 해당됩니다.

## 깨지는 변경

### Charturbo로 이름 변경

제품 이름이 바뀌었습니다. 이전 이름을 바꾸세요.

| 이전 | 이후 |
|---|---|
| 패키지 `viz-engine-sdk` | `charturbo` |
| `viz-engine-sdk/inline`, `/react`, `/vue` | `charturbo/inline`, `charturbo/react`, `charturbo/vue` |
| `VizEngineSDK` | `Charturbo` |
| `VizDevice` | `CharturboDevice` |
| `VizInitError` | `CharturboInitError` |
| `VIZ_THEMES` | `CHARTURBO_THEMES` |
| 그 밖의 `Viz*` 타입(`VizTheme`, `VizEventMap`, `VizCreateOptions`, ...) | `Charturbo*`(`CharturboTheme`, `CharturboEventMap`, `CharturboCreateOptions`, ...) |
| React / Vue `VizChart`, `useVizChart` | `CharturboChart`, `useCharturboChart` |
| WebAssembly 파일 `viz_core_bg.wasm` | `charturbo_core_bg.wasm` |
| UMD 파일 `viz-engine-sdk.umd.cjs`, 전역 `VizEngineSDK` | `charturbo.umd.cjs`, 전역 `Charturbo` |
| CSS 클래스 `viz-sdk-*` | `charturbo-sdk-*` |
| 내보내기 제외 속성 `data-viz-export="false"` | `data-charturbo-export="false"` |

```ts
// 이전
import { VizEngineSDK } from 'viz-engine-sdk';
const sdk = await VizEngineSDK.create(canvas);

// 이후
import { Charturbo } from 'charturbo';
const sdk = await Charturbo.create(canvas);
```

오버레이 클래스를 대상으로 하는 스타일시트와, `.wasm` 파일 이름이 들어간 `setWasmSource` 경로나 복사 단계도 고치세요.

### `stepPhysicsAsync`가 제출 시점에 resolve됨

GPU 그래프 스텝이 이제 레이아웃을 GPU에 둡니다. CHANGELOG의 Unreleased 항목을 참고하세요.

| 이전 | 이후 |
|---|---|
| GPU 결과를 읽어 와 적용한 뒤 promise가 resolve됨 | 스텝을 제출하면 promise가 resolve됨. CPU의 위치 사본은 한두 프레임 늦음 |
| GPU 스텝 중 데이터나 힘 설정을 바꾸면 그 결과가 거부됨 | CPU 편집(`moveNode`, `pinNode`, 스타일, `loadDataset`, `stepPhysics`)이 순서대로 적용됨 |

스텝 직후에 노드를 피킹하거나, 내보내거나, 노드 상세를 읽거나, `isSleeping()`을 확인한다면 먼저 위치를 기다리세요.

```ts
await sdk.stepPhysicsAsync(0.016);
await sdk.syncPhysicsPositions(); // 위치가 최신이어야 할 때만
const id = sdk.pickNodeAtNdc(x, y);
```

각 `stepPhysicsAsync`는 여전히 끝나길 기다린 뒤 다음을 시작해야 합니다. 겹쳐 호출하면 `A physics step is already pending`을 던집니다.

### 내장 문구와 숫자가 로캘을 따름

내장 UI 문구(접근성 요약, 데이터 표와 CSV 머리글, 기본 툴팁, 범례·브레드크럼·컬러바 라벨, 기본 시리즈 이름, PDF 제목)가 이제 로캘에 따라 영어, 한국어, 간체 중국어로 표시됩니다. 이에 따라 일부 영어 출력도 바뀌었습니다.

| 이전 | 이후 |
|---|---|
| 숫자를 `en-US`로 형식화 | 차트 로캘로 형식화. 로캘이 없으면 페이지 언어(`<html lang>`), 그다음 브라우저 언어 |
| 산점도 기본 시리즈 이름을 0부터 셈 | 1부터 셈(`Series 1`) |
| 콤보·선·막대 점의 `getNodeDetails().metadata.description`이 항상 한국어 | 로캘을 따름 |
| 박스 플롯 백분위 수염 `1th` 등 일부 영어 문구 | `1st`. OHLC 키보드 도움말, 데이터 표 제목, 파이 기타 항목 툴팁, 콤보 설명 수정 |

페이지 언어와 상관없이 영어 문구와 `en-US` 숫자를 유지하려면 로캘을 명시하세요.

```ts
const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
```

요약, CSV 머리글, 툴팁 문구를 비교하는 테스트나 스냅샷은 기준값을 새로 만들어야 할 수 있습니다. [다국어 지원](./i18n)을 보세요.

## 폐기 예정 옵션

다음 옵션은 아직 받지만 효과가 없거나 대체 옵션으로 연결됩니다. 코드를 손볼 때 제거하세요.

| 옵션 | 상태 |
|---|---|
| `LineSeriesDescriptor.zOffset` | 무시됨. 시리즈 깊이는 엔진이 배치 |
| `LineSeriesDescriptor.pointSize` | `marker: { size }`를 쓰세요(`marker`가 없으면 그쪽으로 연결됨) |
| `BarChartItemDescriptor.row`, `col` | 무시됨. 3D 배치는 엔진이 계산 |
| `ScatterChartData.z` | 무시됨. 산점도는 2D |
| `ScatterChartOptions.viewMode` | `'2d'`만 지원 |

## 함께 보기

- [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)
- [배포 절차](../contributing/releasing)
- [설치와 번들러](./installation)
