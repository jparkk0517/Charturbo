# 내보내기: PNG · SVG · PDF

차트를 DOM 라벨까지 합성한 래스터 이미지(PNG, JPEG, WebP), 엔진 마크로 만든 벡터 SVG, 1페이지 PDF로 저장하거나 클립보드에 복사합니다. 애니메이션이 진행 중이어도 내보내기는 항상 마지막 프레임을 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/export.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '북부', values: [10, 22, 31, 40] },
      { name: '남부', values: [6, 15, 12, 22] },
    ],
  },
  { title: '분기별 매출' }
);
sdk.render();

await sdk.downloadImage('revenue.png', { pixelRatio: 2 }); // 2배 해상도 PNG
sdk.downloadChartSVG('revenue.svg');                      // 벡터 SVG
await sdk.downloadChartPDF('revenue.pdf');                // 1페이지 PDF(래스터)
const copied = await sdk.copyChartImage();                // 클립보드에 PNG, 미지원이면 false
```

## 메서드

| 메서드 | 반환 | 설명 |
|---|---|---|
| `toImage(options?)` | `Promise<Blob>` | 캔버스와 DOM 오버레이를 합친 이미지. |
| `toDataURL(options?)` | `Promise<string>` | `toImage` 결과를 `data:` URL로. |
| `downloadImage(filename = 'chart.png', options?)` | `Promise<void>` | `toImage`를 다운로드합니다. `options.format`이 없으면 확장자(`.jpg` / `.jpeg`, `.webp`, 그 외 PNG)로 형식을 정합니다. |
| `exportChartSVG(options?)` | `string` | 동기식 벡터 SVG 문서. |
| `downloadChartSVG(filename = 'chart.svg', options?)` | `void` | `exportChartSVG()`를 다운로드합니다. |
| `toPDF(options?)` | `Promise<Blob>` | PNG 이미지를 담은 1페이지 PDF. `format` / `quality`를 뺀 이미지 옵션을 받습니다. |
| `downloadChartPDF(filename = 'chart.pdf', options?)` | `Promise<void>` | `toPDF()`를 다운로드합니다. |
| `copyChartImage(options?)` | `Promise<boolean>` | PNG를 클립보드에 복사합니다. `format` / `quality`를 뺀 이미지 옵션을 받습니다. |

## 이미지 옵션

`toImage`, `toDataURL`, `downloadImage`, `toPDF`, `copyChartImage`는 다음 옵션(`ChartImageOptions`)을 받습니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `format` | `'png' \| 'jpeg' \| 'webp'` | `'png'` | 이미지 형식. |
| `quality` | `number` | 브라우저 기본값 | JPEG / WebP 품질, 0–1. |
| `pixelRatio` | `number` | 현재 캔버스 배율 | CSS 픽셀당 출력 픽셀 수. 그 크기로 다시 렌더링합니다(한 변 최대 8192 px). |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | 테마 surface 색, 투명 배경, 또는 임의의 CSS 색. |
| `overlay` | `boolean` | `true` | DOM 오버레이(제목, 범례, 축)를 합성합니다. `false`면 캔버스만. |

### 캡처 방식

- WebGPU 캔버스는 프레임이 present되면 내용이 사라지므로, 내보낼 때마다 캔버스를 다시 렌더링하고 같은 태스크 안에서 2D 캔버스로 복사합니다. 읽은 결과가 전부 투명이면 다음 애니메이션 프레임에서 최대 2번 다시 시도하고, 그래도 실패하면 `toImage: canvas read back blank (GPU frame unavailable)` 오류를 던집니다.
- `pixelRatio`가 현재 배율과 다르면 내보내는 동안 캔버스 backing store 크기를 바꿨다가 복원합니다.
- `background`: 불투명 CSS 색은 GPU clear color로 씁니다. `'transparent'`는 검정과 흰 배경에 두 번 렌더링해 정확한 알파를 복원합니다. 반투명 CSS 색은 차트 아래에 깔립니다. JPEG는 알파가 없어 투명한 부분이 검정이 됩니다.
- DOM 오버레이(제목, 범례 견본 · 이름 · 숨김 상태, 축 눈금, 축 제목, 주석 라벨)는 일반적인 DOM 순회로 레이아웃된 위치에 계산된 폰트, 색, 투명도, 취소선, 회전을 적용해 그립니다. 빼고 싶은 오버레이 요소에는 `data-charturbo-export="false"`를 붙입니다.

## SVG 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `maxMarks` | `number` | `200000` | 쓰는 마크(선분, 채움 삼각형, 막대, 점)의 최대 개수. 넘는 점은 균등하게 솎아 내고 콘솔 경고를 남깁니다. |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | 이미지 옵션과 같습니다. |
| `overlay` | `boolean` | `true` | DOM 오버레이 텍스트(제목, 범례, 축)를 포함합니다. |

## 벡터 SVG

`exportChartSVG()`는 마지막 프레임에서 엔진이 staged한 GPU 인스턴스를 CSS px 좌표로 씁니다.

- 같은 스타일의 연속 선분은 `<path>` 폴리라인 하나가 되고, 점선은 `stroke-dasharray` / `stroke-dashoffset`을 씁니다.
- 채움 삼각형은 색마다 `<path>` 하나, 막대는 데이터 끝이 둥근 `<path>`(간격 trim 포함)가 됩니다.
- 마커와 점은 `<circle>`(사각형 · 마름모 · 삼각형 마커는 `<path>`)이 됩니다.
- 주석, 브러시, 네비게이터는 포함하고 hover 오버레이는 제외합니다. 줌 중에는 캔버스와 같은 plot `clipPath`를 씁니다.
- 오버레이 텍스트는 이미지 내보내기와 같은 순회로 `<text>`(계산된 font family · size · weight · style, 색, 회전, 말줄임)와 `<rect>`(범례 견본, 라벨 칩)로 씁니다.
- 디시메이션(LOD) 결과만 쓰므로 1M 포인트 선도 화면 픽셀 열 수준의 크기가 됩니다. plot 밖의 점은 컬링합니다.

| 차트 | SVG 출력 |
|---|---|
| line, area, bar(2D), scatter, pie, box, candlestick, combo, radar, gauge, funnel, waterfall, treemap, sunburst, sankey | 벡터 |
| heatmap | plot 영역은 PNG `<image>`(셀이 GPU 텍스처), 축 · 범례 · 라벨은 벡터 |
| 3D / 2.5D 뷰, SVG 작성기가 없는 종류 | 캔버스 전체를 PNG `<image>`로 넣고 그 위에 벡터 텍스트, 콘솔 경고 |

## PDF

`toPDF()`는 의존성 없이 최소한의 1페이지 PDF를 직접 씁니다. 페이지 크기는 차트의 CSS 크기(96 dpi를 pt로 환산)이고, 차트 제목이 문서 제목으로 들어갑니다. 이미지는 합성된 PNG 내보내기 결과이며, 브라우저에 `CompressionStream('deflate')`가 있으면 RGB 데이터를 압축하고 없으면 압축하지 않고 넣습니다. PDF는 래스터만 지원하므로 벡터가 필요하면 SVG를 쓰세요.

## 클립보드

`copyChartImage()`는 `ClipboardItem`으로 PNG를 씁니다. 브라우저에 `ClipboardItem` / `navigator.clipboard.write`가 없거나 쓰기를 거부하면(권한, 사용자 제스처 없음) `false`로 끝납니다. 클릭 핸들러 안에서 호출하세요.

## 한계

- 툴팁은 오버레이 밖에 있어 내보내지 않습니다.
- 오버레이 안의 SVG, 이미지, 테두리, 그림자는 그리지 않고, 여러 줄로 줄바꿈된 텍스트는 한 줄로 그립니다.
- `setPixelRatio`로 덮어쓴 배율은 고해상도 내보내기 후 캔버스 기준으로 다시 계산됩니다.
- 내보내는 라벨은 DOM에 있는 그대로이므로 차트 [로캘](./i18n)을 따릅니다.

## 함께 보기

- [접근성](./accessibility)(CSV 내보내기)
- [애니메이션](./animation)
- [스타일과 테마](./styling)
