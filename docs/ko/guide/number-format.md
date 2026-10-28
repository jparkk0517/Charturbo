# 숫자·날짜 형식

축 눈금 라벨, 막대 데이터 라벨, 툴팁 값은 형식을 받습니다. 함수, d3-format 스타일 스펙 문자열, `Intl.NumberFormatOptions` 객체 중 하나입니다. 기본 라벨과 시간 라벨은 차트 로캘과 시간대를 따릅니다.

## 기본 사용법

```ts
import { Charturbo, createFormatter, formatNumber } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
sdk.renderLineChart(series, {
  axes: {
    x: { format: ',d' },
    y: { format: '.2s' },
    y2: { format: { style: 'percent' } },
  },
});
sdk.enableNodeInteractions(canvas, { tooltip: { valueFormatter: '$,.2f' } });
sdk.render();

formatNumber(1234.5, '$,.2f');                               // "$1,234.50"
formatNumber(1234.5, '$,.2f', 'de-DE', { currency: 'EUR' }); // "1.234,50 €"
const fmt = createFormatter('bytes', { locale: 'ko-KR' });   // (v) => string, 재사용
fmt(1536);                                                   // "1.5 KB"
```

## 형식이 적용되는 곳

| 옵션 | 받는 값 |
|---|---|
| `axes.x.format`, `axes.y.format`, `axes.y2.format` | 함수, 스펙 문자열, `Intl.NumberFormatOptions` |
| 막대 `labels.format` | `(value, ctx) => string`, 스펙 문자열, `Intl.NumberFormatOptions` |
| `enableNodeInteractions({ tooltip: { valueFormatter } })` | `(v) => string`, 스펙 문자열, `Intl.NumberFormatOptions` |
| 파이 `format`, 히트맵 컬러바 `format` | 함수만 |

스펙 문자열은 차트 로캘로 `Intl.NumberFormat`을 한 번 만들어 캐시합니다. `setLocale` 후에는 눈금을 새 로캘로 다시 그립니다.

## 스펙 문법

`[sign][$][,][.precision][~][type]`

| 스펙 | 예 (en-US) | 설명 |
|---|---|---|
| `'.2f'`, `',.0f'` | `1234.57`, `1,234,568` | 고정 소수점. `,`는 천 단위 구분 |
| `'d'`, `',d'` | `4`, `12,345` | 정수 (반올림) |
| `'.1%'` | `12.3%` | 퍼센트 (× 100) |
| `'.2s'` | `1.5k`, `1.2M`, `1.2m` | SI 접두어 (유효 숫자, 반올림 시 다음 접두어로 올림) |
| `'.2e'` | `1.23e+4` | 지수 |
| `'$,.2f'` | `$1,234.50` | 통화 (`Intl` `style: 'currency'`, 코드는 `currency` 옵션, 기본 `USD`) |
| `'compact'`, `'.1compact'` | `1.5K`, `2M` | `Intl` compact 표기 |
| `'bytes'`, `'.2bytes'` | `1.5 KB`, `1.50 KB` | 1024 단위 (B, KB, MB, GB, TB, PB, EB) |
| `'+.1f'` | `+1.3`, `-2.0`, `0.0` | 양수 · 음수 부호 (0은 부호 없음) |

- `sign`: `+`는 양수와 음수에 부호를 붙이고, `-`(기본)는 음수에만 붙입니다.
- `$`는 타입 없음, `f`, `d`, `compact`와만 쓸 수 있습니다.
- `.precision`은 `f`, `%`, `e`, `compact`, `bytes`에서는 소수 자릿수, `s`와 타입 없음에서는 유효 숫자입니다.
- `~`는 뒤쪽의 의미 없는 0을 지웁니다(`'.3~s'`는 `1.5k`).
- 정밀도를 생략하면 d3-format처럼 6입니다(`d`: 0, `compact`: `Intl` 기본, `bytes`: 1). 타입이 없으면 로캘 기본 숫자 형식을 씁니다.
- 잘못된 스펙은 차트를 렌더할 때 `TypeError`를 던집니다.

## 헬퍼 함수

| 함수 | 설명 |
|---|---|
| `formatNumber(value, spec, locale?, { currency? })` | 값 하나를 형식화 |
| `createFormatter(spec, options?)` | 재사용할 `(value) => string`을 반환. `options`는 로캘 문자열 또는 `{ locale, currency }`. 함수 `spec`은 그대로 반환 |

## 로캘

기본 라벨과 툴팁 값의 로캘은 다음 순서로 정해집니다.

1. 차트의 `locale` 옵션 (선, 영역, 캔들스틱 등 이 옵션을 받는 차트)
2. SDK 로캘: `Charturbo.create(canvas, { locale })` 또는 `sdk.setLocale(locale)`
3. 런타임(브라우저) 로캘

```ts
const sdk = await Charturbo.create(canvas, { locale: 'ko-KR' });
sdk.setLocale('de-DE'); // 활성 차트의 눈금 라벨과 툴팁 숫자를 다시 형식화
sdk.getLocale();        // 'de-DE'
sdk.setLocale(undefined); // 런타임 로캘로 복귀
```

내장 UI 텍스트(접근성 요약, 데이터 테이블 헤더, 툴팁 필드 라벨, 내보내기 / 범례 / 범위 선택기 텍스트)도 같은 로캘을 따릅니다. en, ko, zh-CN을 포함하며, 모르는 로캘은 영어로, `undefined`는 브라우저 언어를 씁니다. [다국어 지원](./i18n)을 참고하세요.

## 날짜·시간 라벨 {#date-and-time-labels}

`'time'` x축의 기본 눈금 라벨은 눈금이 놓인 달력 경계(`ChartTimeGranularity`)에 따라 정해지며, 차트 로캘과 시간대로 `Intl.DateTimeFormat`을 써서 형식화합니다.

| granularity | 라벨 |
|---|---|
| `'millisecond'` | `HH:mm:ss.SSS` |
| `'second'` | `HH:mm:ss` |
| `'minute'`, `'hour'` | `HH:mm` |
| `'day'` | `MMM d` |
| `'month'` | `MMM` |
| `'year'` | `yyyy` |

툴팁은 전체 날짜와 시각을 보여 줍니다(현지 자정이면 날짜만, 밀리초는 있을 때만).

바꾸려면 함수를 주세요. 눈금은 granularity를 받고, 툴팁은 granularity 없이 호출합니다.

```ts
import { formatChartTime } from 'charturbo';

sdk.renderLineChart(series, {
  axes: {
    x: {
      type: 'time',
      format: (ms, granularity) =>
        granularity === 'day' ? new Date(ms).toISOString().slice(5, 10) : formatChartTime(ms, granularity, 'en-GB', 'UTC'),
    },
  },
});

formatChartTime(Date.UTC(2026, 0, 1, 9), 'hour', 'ko-KR', 'Asia/Seoul'); // 값 하나의 기본 라벨
```

`formatChartTime(ms, granularity?, locale?, timeZone = 'UTC')`는 순수 함수입니다. 시간대 기본값은 차트 시간대가 아니라 `'UTC'`입니다. 시간대는 [데이터와 축](./data-and-axes#time-zones)에서 설명합니다.

::: warning 주의
시간 축에 스펙 문자열을 주면 epoch 밀리초를 일반 숫자로 형식화합니다. 날짜 라벨에는 함수나 기본 형식을 쓰세요.
:::

## 함께 보기

- [데이터와 축](./data-and-axes)
- [툴팁과 hover](./tooltips)
- [다국어 지원](./i18n)
- [막대](../charts/bar): 데이터 라벨
