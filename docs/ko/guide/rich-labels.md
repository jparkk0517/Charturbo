# 리치 텍스트 라벨

ECharts `label.rich`처럼 라벨 하나에 여러 크기, 굵기, 색, 작은 배지를 섞을 수 있습니다. 라벨 함수가 템플릿을 돌려주고, `rich`가 스타일 이름을 텍스트 스타일에 연결합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/bar.html)

## 템플릿 문법

```ts
'{value|42.5}{unit|k}\n{up|+12%}'
```

- `{name|text}`는 `text`를 `rich[name]` 스타일로 그립니다. 없는 이름이면 일반 텍스트로 그립니다.
- `\n`은 새 줄을 시작합니다.
- `\{`, `\}`, `\\`는 문자 그대로입니다.
- 구간은 중첩되지 않습니다. `name|` 접두사나 닫는 `}`가 없는 `{`는 일반 텍스트이므로 `{value}`는 입력한 그대로 남습니다.

## 지원 차트

| 차트 | 텍스트 함수 | 컨텍스트 |
|---|---|---|
| 막대 / 그룹 막대 | `labels.format` + `labels.rich` | `(value, { category, series, seriesName, categoryLabel, ... })` |
| 파이 / 도넛 | `label.formatter` + `label.rich` | `{ name, value, percent, index, ring? }` |
| 트리맵, 선버스트 | `label.formatter` + `label.rich` | `{ name, value, depth }` |
| 생키 | `label.formatter` + `label.rich` | `{ name, value, column }` |
| 퍼널 | `label.formatter` + `label.rich` | `{ stage, value, percentOfFirst, percentOfPrevious, index }` |

```ts
sdk.renderBarChart(items, {
  labels: {
    format: (v, c) => `{value|${v.toFixed(1)}}{unit|k}\n{badge|${growth[c.category]}%}`,
    rich: {
      value: { fontSize: 15, fontWeight: 'bold' },
      unit: { fontSize: 10, color: '#8a94a6' },
      badge: { color: '#fff', backgroundColor: '#1a9e5c', padding: [1, 5], borderRadius: 7, fontSize: 10 },
    },
  },
});

sdk.renderPieChart(data, {
  labels: 'outside',
  label: {
    formatter: (c) => `{name|${c.name}}\n{pct|${c.percent.toFixed(1)}%}`,
    rich: { name: { fontWeight: 600 }, pct: { fontSize: 13, color: '#3d7eff' } },
  },
});
```

## 스타일 옵션

| 옵션 | 의미 |
|---|---|
| `color` | 글자 색 |
| `fontSize`, `fontWeight`, `fontStyle`, `fontFamily` | 구간의 글꼴 |
| `backgroundColor`, `padding`, `borderRadius` | 구간 뒤의 상자. `padding`은 `v`, `[세로, 가로]`, `[위, 오른쪽, 아래, 왼쪽]` |
| `lineHeight` | 구간의 줄 상자 높이 |
| `align` | 구간이 시작하는 줄의 정렬 `'left' \| 'center' \| 'right'` |

스타일이 없는 텍스트는 차트의 기본 라벨 글꼴과 색을 씁니다.

## 배치와 내보내기

- **배치는 측정한 텍스트를 씁니다.** 막대의 안쪽 맞춤 검사와 `'auto'` 겹침 숨김, 파이의 지시선 간격과 옆 여백, 퍼널의 라벨 공간이 모두 스타일이 적용된 줄의 크기를 씁니다.
- **트리맵.** 셀 라벨은 셀 밖으로 나가지 않게 잘립니다. 헤더 띠에는 템플릿의 첫 줄만 표시합니다.
- **내보내기.** PNG, SVG, PDF 내보내기가 각 구간을 자기 글꼴, 색, 상자로 그립니다.
- **접근성.** 스크린 리더에는 스타일 이름 없는 일반 텍스트가 전달됩니다.
- **안전한 DOM.** 텍스트는 HTML이 아니라 `textContent`로만 넣습니다.
- **검증.** 잘못된 `rich` 옵션(알 수 없는 색, 음수 크기, 잘못된 `padding` 형태, 알 수 없는 `align`)은 현재 차트를 바꾸기 전에 예외를 던집니다.

`rich`가 없는 막대 라벨과 `label`이 없는 다른 차트의 라벨은 이전과 똑같습니다.
