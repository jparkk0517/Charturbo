# 시작하기

이 페이지에서는 포인트 100만 개짜리 상호작용 선 차트를 만듭니다. Vite 같은 번들러를 쓴다고 가정합니다. 다른 환경은 [설치와 번들러](./installation)를 보세요.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html)

## 설치

::: warning 주의
`charturbo` 패키지는 아직 npm에 배포되지 않았습니다. 첫 릴리스 전까지는 소스에서 빌드해 tarball을 설치하세요. [소스에서 빌드](./installation#build-from-source)를 보세요.
:::

릴리스 후:

```bash
npm install charturbo
```

## 캔버스 추가

SDK는 `<canvas>`에 그리고, 제목·범례·축 라벨·툴팁용 DOM 요소를 추가합니다. 이 요소들은 캔버스의 부모 요소에 붙고 캔버스 위치를 기준으로 배치되므로, 캔버스를 `position: relative`인 컨테이너로 감싸세요. 캔버스에 CSS 크기를 주면 픽셀 크기는 자동으로 맞춰집니다.

```html
<div class="chart">
  <canvas id="chart"></canvas>
</div>

<style>
  .chart { position: relative; height: 360px; }
  .chart canvas { display: block; width: 100%; height: 100%; }
</style>
```

## 첫 차트 그리기

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector<HTMLCanvasElement>('#chart')!;
const sdk = await Charturbo.create(canvas);

// Float32Array에 담은 샘플 1,000,000개
const values = new Float32Array(1_000_000);
let walk = 0;
for (let i = 0; i < values.length; i++) {
  walk += (Math.random() - 0.5) * 0.4;
  values[i] = walk;
}

sdk.renderLineChart([{ name: '센서 A', values }], {
  title: '텔레메트리',
  axes: { x: { title: '샘플', format: '.2s' }, y: { format: '.1f' } },
});
sdk.render();
```

각 단계에서 일어나는 일:

1. `Charturbo.create(canvas)`가 WebAssembly 모듈을 불러오고(페이지당 한 번) WebGPU로, WebGPU가 없으면 WebGL2로 엔진을 시작합니다.
2. `renderLineChart`가 데이터를 엔진에 넘깁니다. `x`가 없으면 샘플은 인덱스 간격으로 놓입니다.
3. `render()`가 프레임을 그립니다. SDK에는 쉬는 동안 도는 렌더 루프가 없으므로, 무언가를 바꾼 뒤에는 `render()`를 호출하세요.

## 상호작용 추가

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true });
```

툴팁, x축 휠 줌, 드래그 팬, 더블클릭 리셋이 켜집니다. 터치 기기에서는 핀치 줌, 드래그 팬, 탭으로 툴팁 고정, 길게 눌러 스크럽, 더블탭 리셋이 동작합니다. `autoRender: true`는 상호작용마다 `render()`를 호출합니다. 이 옵션이 없으면 프레임을 직접 그려야 합니다.

이 호출은 리스너를 다시 제거하는 함수를 반환합니다. 줌 축, 박스 줌, 브러시 선택, 터치 옵션은 [상호작용](./interactions)을 보세요.

## 데이터 갱신

```ts
// 청크를 추가하고 최신 샘플 100,000개만 유지
sdk.appendSeriesData(0, nextChunk, undefined, { maxPoints: 100_000 });
sdk.render();
```

`setSeriesData(seriesIndex, values, x?)`는 시리즈 하나를 교체하고 스타일과 줌은 유지합니다. [실시간 스트리밍](./streaming)을 보세요.

## 지원하지 않는 브라우저 처리

```ts
import { Charturbo, CharturboInitError } from 'charturbo';

if (!(await Charturbo.isSupported())) {
  showFallback(); // WebGPU 어댑터도 WebGL2도 없음
} else {
  try {
    const sdk = await Charturbo.create(canvas);
    // ...
  } catch (e) {
    if (e instanceof CharturboInitError) console.warn(e.reason); // 'no-webgpu' | 'adapter' | 'device' | 'wasm'
  }
}
```

## 정리

```ts
sdk.dispose(); // 리스너와 오버레이 DOM 제거, 엔진 해제
```

차트가 페이지에서 사라질 때(라우트 변경, 컴포넌트 언마운트) 호출하세요. React와 Vue 컴포넌트는 이 작업을 대신 합니다.

## React · Vue에서 쓰기

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: 'CPU' }} style={{ height: 300 }} />;
```

[React](./react)와 [Vue](./vue)를 보세요.

## 다음 단계

- [핵심 개념](./core-concepts): 엔진 수명 주기, 렌더링, 크기 조정.
- [데이터와 축](./data-and-axes): x 값, 시간 축, 로그 스케일.
- [차트](../charts/line): 차트 종류별 페이지.
- [성능](./performance): 매우 큰 데이터를 다루는 팁.
