# 로딩 표시와 워터마크

[라이브 예제](https://jparkk0517.github.io/Charturbo/export.html)

## 로딩 표시

`showLoading`은 차트를 마스크, 스피너, 상태 텍스트로 덮습니다(ECharts `showLoading`). `hideLoading`이 이를 없앱니다.

```ts
sdk.showLoading();                                  // 차트 언어의 "로딩 중…"
const data = await fetchData();
sdk.renderLineChart(data);
sdk.render();
sdk.hideLoading();
```

**렌더링으로는 표시가 사라지지 않습니다.** 데이터가 준비되면 `hideLoading`을 호출하세요. 표시 중에 `showLoading`을 다시 호출하면 옵션만 바뀝니다. `isLoading()`으로 표시 여부를 알 수 있습니다.

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `text` | `'Loading…'`(en), `'로딩 중…'`(ko), `'加载中…'`(zh) | 상태 텍스트 |
| `maskColor` | 테마 표면색 80% | 차트를 덮는 마스크 |
| `color` | 팔레트 첫 색 | 스피너 색 |
| `textColor` | 테마 기본 텍스트 색 | 글자 색 |
| `fontSize` | `12` | 글자 크기(CSS px) |
| `spinner` | `true` | `false`면 텍스트만 표시 |
| `delay` | `0` | 마스크가 나타나기까지의 밀리초. 빠른 로딩에서는 깜빡이지 않습니다 |

- **접근성.** 차트 컨테이너에 즉시 `aria-busy="true"`를 설정합니다(숨기면 이전 값으로 돌아갑니다). 텍스트는 polite 라이브 영역으로 알립니다. `prefers-reduced-motion`이면 스피너가 돌지 않습니다.
- **테마와 언어.** 기본 색은 `setTheme`을, 기본 텍스트는 `setLocale`을 따릅니다.
- **내보내기.** PNG, SVG, PDF 내보내기에는 표시가 들어가지 않습니다.
- **검증.** 잘못된 옵션은 예외를 던지고 현재 표시를 유지합니다.

## 워터마크

`setWatermark`는 차트 위에 텍스트나 이미지를 그립니다. 플롯 위, 라벨과 툴팁 아래에 놓입니다. `null`이면 없앱니다.

```ts
sdk.setWatermark({ text: 'CONFIDENTIAL' });                          // 30° 회전, 타일 배치
sdk.setWatermark({ text: 'DRAFT', fontSize: 64, repeat: false });   // 가운데 하나
sdk.setWatermark({ image: '/logo.png', imageWidth: 80, imageHeight: 24, opacity: 0.1 });
sdk.setWatermark(null);
```

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `text` / `image` | — | 둘 중 하나가 필요합니다. `image`는 URL이며 `crossOrigin = 'anonymous'`로 불러옵니다 |
| `imageWidth`, `imageHeight` | `80`, `40` | 이미지 마크 상자(CSS px). 이미지는 비율을 유지한 채 안에 들어갑니다 |
| `opacity` | `0.15` | 0..1 |
| `rotate` | `30` | 각도(도), 양수 = 반시계 방향 |
| `fontSize`, `fontFamily`, `fontWeight` | `14`, 테마 글꼴, `'400'` | 텍스트 글꼴 |
| `color` | 테마 흐린 텍스트 색 | 글자 색 |
| `gap` | `[80, 60]` | 마크 사이 간격(CSS px). 숫자 또는 `[x, y]` |
| `repeat` | `true` | 차트 전체에 타일 배치. 홀수 줄은 마크 반 칸만큼 밀립니다. `false`면 가운데에 하나 |
| `export` | `true` | PNG, SVG, PDF 내보내기에 포함 |

- **차트 단위.** 다른 차트를 렌더링해도 워터마크는 남고, 테마 전환을 따릅니다. `getWatermark()`는 기본값을 채운 현재 옵션을 돌려줍니다.
- **접근성.** 레이어는 `aria-hidden`이며 클릭을 통과시킵니다.
- **이미지.** 불러오지 못한 이미지(또는 CORS 헤더가 없는 이미지)는 그리지 않습니다. CORS 없는 교차 출처 이미지는 이미지 내보내기를 막기 때문에 건너뜁니다. SVG 내보내기는 이미지를 URL로 연결하므로(포함하지 않음) 다른 곳에서 열 SVG에는 절대 URL이나 data URL을 쓰세요.
- **검증.** 잘못된 옵션은 예외를 던지고 현재 워터마크를 유지합니다.

## React와 Vue

`CharturboChart`는 두 기능을 prop으로 받습니다.

```tsx
<CharturboChart type="bar" data={data} loading={isFetching} watermark={{ text: 'DRAFT' }} />
```

```vue
<CharturboChart type="bar" :data="data" :loading="{ text: 'Fetching…' }" :watermark="mark" />
```

`loading`은 `true`, `showLoading` 옵션, 또는 숨길 때 falsy 값입니다. `watermark`는 `setWatermark` 옵션이며 `null`이거나 없으면 워터마크가 없습니다. 둘 다 객체 동일성으로 비교합니다(React에서는 객체 값을 메모이즈하세요).
