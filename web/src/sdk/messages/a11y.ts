/**
 * Built-in strings of chart-a11y.ts (summaries, descriptions, keyboard help, live announcements,
 * data tables). Numbers, ranges and labels arrive already formatted in the chart locale; `n`
 * arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Full chart names that open a summary */
  chart: {
    line: 'Line chart',
    area: 'Area chart',
    stackedArea: 'Stacked area chart',
    percentArea: 'Percent stacked area chart',
    themeRiver: 'ThemeRiver chart',
    band: 'Band chart',
    errorBar: 'Error bar chart',
    impulse: 'Impulse chart',
    candlestick: 'Candlestick chart',
    ohlc: 'OHLC chart',
    scatter: 'Scatter chart',
    bar: 'Bar chart',
    groupedBar: 'Grouped bar chart',
    stackedBar: 'Stacked bar chart',
    percentBar: 'Percent stacked bar chart',
    pictorialBar: 'Pictorial bar chart',
    heatmap: 'Heatmap',
    pie: 'Pie chart',
    donut: 'Donut chart',
  },
  /** Multi-series bar layout inside a description sentence */
  barMode: { grouped: 'grouped', stacked: 'stacked', percent: 'percent stacked' },
  /** Overall direction of a line series (first vs last value) */
  trend: { rising: 'rising', falling: 'falling', flat: 'flat' },
  /** Error bar direction in announcements */
  direction: { vertical: 'vertical', horizontal: 'horizontal' },

  /** One sentence: leading clauses, then detail clauses */
  sentence: (head: string[], details: string[] = []) =>
    `${head.join(', ')}${details.length ? `; ${details.join('; ')}` : ''}.`,
  /** Chart title before a summary */
  titled: (title: string, text: string) => `${title}. ${text}`,
  /** Joins whole sentences (description, announcement + position) */
  join: (sentences: string[]) => sentences.join(' '),
  /** `text (note)`, e.g. a hidden series or empty cell count */
  paren: (text: string, note: string) => `${text} (${note})`,
  /** `label: text.` */
  labelled: (label: string, text: string) => `${label}: ${text}.`,
  /** Row and column label of a heatmap cell */
  cell: (row: string, col: string) => `${row}, ${col}`,

  rows: (n: number, count: string) => `${count} ${plural(n, 'row', 'rows')}`,
  columns: (n: number, count: string) => `${count} ${plural(n, 'column', 'columns')}`,
  emptyCells: (n: number, count: string) => `${count} ${plural(n, 'empty cell', 'empty cells')}`,
  slices: (n: number, count: string) => `${count} ${plural(n, 'slice', 'slices')}`,
  /** Ring count of a multi-ring (nested) pie */
  rings: (n: number, count: string) => `${count} ${plural(n, 'ring', 'rings')}`,
  candles: (n: number, count: string) => `${count} ${plural(n, 'candle', 'candles')}`,
  /** OHLC bars */
  bars: (n: number, count: string) => `${count} ${plural(n, 'bar', 'bars')}`,
  values: (n: number, count: string) => `${count} ${plural(n, 'value', 'values')}`,
  hiddenCount: (count: string) => `${count} hidden`,

  /** Rows × columns of a heatmap */
  gridSize: (rows: string, cols: string) => `${rows} × ${cols}`,
  /** Value range of a heatmap */
  valueRange: (range: string) => `values ${range}`,
  noValues: 'no values',
  total: (value: string) => `total ${value}`,
  seriesRange: (name: string, range: string) => `${name} ranges ${range}`,
  seriesNoData: (name: string) => `${name} has no data`,
  /** Scatter x / y extents */
  scatterRange: (x: string, y: string) => `x ranges ${x}, y ranges ${y}`,
  /** Single-series bar extremes with their categories */
  barRange: (min: string, minLabel: string, max: string, maxLabel: string) =>
    `values range ${min} (${minLabel}) to ${max} (${maxLabel})`,

  /** `axis` is `common.xAxis` / `common.yAxis` */
  axisTitle: (axis: string, title: string) => `${axis}: ${title}.`,
  /** Axis with optional title and value span */
  axisRange: (axis: string, title?: string, from?: string, to?: string) =>
    `${axis}${title ? ` (${title})` : ''}${from !== undefined ? ` from ${from} to ${to}` : ''}.`,
  /** Axis break ranges (`ranges`: already joined `common.range` texts) */
  axisBreaks: (axis: string, title: string | undefined, ranges: string) => `${axis}${title ? ` (${title})` : ''} skips ${ranges}.`,
  /** Extra y axis (`axes.extraY`) with the series names on it */
  extraAxis: (title: string | undefined, names: string) => `Additional y axis${title ? ` (${title})` : ''}: ${names}.`,
  heatmapRows: (rows: string, title?: string, from?: string, to?: string) =>
    `Rows${title ? ` (${title})` : ''}: ${rows}${from !== undefined ? ` from ${from} to ${to}` : ''}.`,
  heatmapColumns: (cols: string, title?: string, from?: string, to?: string) =>
    `Columns${title ? ` (${title})` : ''}: ${cols}${from !== undefined ? ` from ${from} to ${to}` : ''}.`,
  heatmapExtremes: (label: string, min: string, minCell: string, max: string, maxCell: string) =>
    `${label}: minimum ${min} at ${minCell}, maximum ${max} at ${maxCell}.`,
  /** Pie slice line: value and share (or `common.hidden`) */
  sliceLine: (name: string, value: string, share: string) => `${name}: ${value} (${share}).`,
  /** The "Other" slice and the slices it folds */
  otherCombines: (name: string, members: string) => `${name} combines ${members}.`,
  /** Standalone band series: range of each edge (or `common.noData`) */
  bandEdges: (name: string, first: string, second: string) => `${name}: first edge ${first}, second edge ${second}.`,
  lineStats: (name: string, values: string, min: string, minAt: string, max: string, maxAt: string, mean: string, first: string, last: string, trend: string) =>
    `${name}: ${values}, minimum ${min} at ${minAt}, maximum ${max} at ${maxAt}, ` +
    `average ${mean}; starts at ${first} and ends at ${last} (${trend} overall).`,
  /** Highest / lowest category of a bar series (`name` may be the category count) */
  barStats: (name: string, maxLabel: string, max: string, minLabel: string, min: string, mean: string) =>
    `${name}: highest ${maxLabel} ${max}, lowest ${minLabel} ${min}, average ${mean}.`,
  /** Category count and multi-series bar layout */
  barLayout: (categories: string, mode: string) => `${categories}, ${mode}.`,

  /** Keyboard help per chart kind */
  keyboard: {
    default:
      'Keyboard: focus the chart, then use Left and Right arrows to move between data points, ' +
      'Page Up and Page Down to jump 10 points, Home and End for the first and last point, ' +
      'Up and Down arrows to switch series, and Escape to clear.',
    bar:
      'Keyboard: focus the chart, then use Left and Right arrows to move between data points, ' +
      'Page Up and Page Down to jump 10 points, Home and End for the first and last point, ' +
      'and Escape to clear.',
    categories:
      'Keyboard: focus the chart, then use Left and Right arrows to move between categories, ' +
      'Page Up and Page Down to jump 10 categories, Home and End for the first and last category, ' +
      'Up and Down arrows to switch series, and Escape to clear.',
    scatter:
      'Keyboard: focus the chart, then use Left and Right arrows to move between points of a series ' +
      'in x order, Page Up and Page Down to jump 10 points, Home and End for the smallest and largest x, ' +
      'Up and Down arrows to switch series, and Escape to clear.',
    candle:
      'Keyboard: focus the chart, then use Left and Right arrows to move between candles, ' +
      'Page Up and Page Down to jump 10 candles, Home and End for the first and last candle, ' +
      'and Escape to clear.',
    ohlc:
      'Keyboard: focus the chart, then use Left and Right arrows to move between bars, ' +
      'Page Up and Page Down to jump 10 bars, Home and End for the first and last bar, ' +
      'and Escape to clear.',
    pie:
      'Keyboard: focus the chart, then use Left and Right arrows to move between slices, ' +
      'Home and End for the first and last slice, and Escape to clear.',
    heatmap:
      'Keyboard: focus the chart, then use Left and Right arrows to move between columns, ' +
      'Up and Down arrows to move between rows, Page Up and Page Down to jump 10 columns, ' +
      'Home and End for the first and last column, and Escape to clear.',
  },

  /** Live announcement of a pie slice (share already has its `%`) */
  slicePoint: (name: string, value: string, share: string) => `${name}, ${value}, ${share}.`,
  /** Live announcement of a candle; `volume` only when the chart has volumes */
  ohlcPoint: (x: string, open: string, high: string, low: string, close: string, volume?: string) =>
    `${x}, open ${open}, high ${high}, low ${low}, close ${close}${volume !== undefined ? `, volume ${volume}` : ''}.`,
  errorBarPoint: (x: string, name: string, value: string, low: string, high: string, direction: string) =>
    `${x}, ${name}: ${value}, low ${low}, high ${high}, ${direction}.`,
  impulsePoint: (x: string, name: string, value: string, baseline: string) => `${x}, ${name}: ${value}, baseline ${baseline}.`,
  bandPoint: (x: string, name: string, first: string, second: string) => `${x}, ${name}: first edge ${first}, second edge ${second}.`,
  /** Single-series bar */
  barPoint: (x: string, value: string) => `${x}, ${value}.`,
  /** Multi-series bar / line / area */
  seriesPoint: (x: string, name: string, value: string) => `${x}, ${name} ${value}.`,
  /** Stack total after a stacked point */
  totalPoint: (value: string) => `Total ${value}.`,
  /** `xName` / `yName`: axis titles, else `x` / `y` */
  scatterPoint: (name: string, xName: string, x: string, yName: string, y: string) => `${name}: ${xName} ${x}, ${yName} ${y}.`,

  /** Pie table / CSV column of the slice name */
  sliceHeader: 'Slice',
  /** Pie table / CSV column of the share */
  percentHeader: 'Percent',
  /** Table / CSV columns of error bars, impulse baselines and range bands */
  lowColumn: (name: string) => `${name} low`,
  highColumn: (name: string) => `${name} high`,
  baselineColumn: (name: string) => `${name} baseline`,
  lowerColumn: (name: string) => `${name} lower`,
  upperColumn: (name: string) => `${name} upper`,
  /** Data table caption without a chart title (`kind`: `common.kind` name) */
  tableCaption: (kind: string) => `${kind} chart data`,
  /** `aria-label` of the data table region */
  tableLabel: (caption: string) => `Data table: ${caption}`,
  sampledRows: (shown: string, total: string) => `${shown} of ${total} rows`,
  sampledColumns: (shown: string, total: string) => `${shown} of ${total} columns`,
  /** Note under a downsampled table (`parts`: `sampledRows` / `sampledColumns`) */
  sampledNote: (parts: string[]) =>
    `Showing ${parts.join(' and ')} (evenly sampled, first and last included). Export CSV for the full data.`,
};

export type A11yMessages = typeof en;

const ko: A11yMessages = {
  chart: {
    line: '선 차트',
    area: '영역 차트',
    stackedArea: '누적 영역 차트',
    percentArea: '100% 누적 영역 차트',
    themeRiver: '테마 리버 차트',
    band: '밴드 차트',
    errorBar: '오차 막대 차트',
    impulse: '임펄스 차트',
    candlestick: '캔들스틱 차트',
    ohlc: 'OHLC 차트',
    scatter: '산점도',
    bar: '막대 차트',
    groupedBar: '묶은 막대 차트',
    stackedBar: '누적 막대 차트',
    percentBar: '100% 누적 막대 차트',
    pictorialBar: '픽토리얼 막대 차트',
    heatmap: '히트맵',
    pie: '파이 차트',
    donut: '도넛 차트',
  },
  barMode: { grouped: '묶은 막대', stacked: '누적 막대', percent: '100% 누적 막대' },
  trend: { rising: '상승', falling: '하락', flat: '보합' },
  direction: { vertical: '세로 방향', horizontal: '가로 방향' },

  sentence: (head, details = []) => `${head.join(', ')}${details.length ? `; ${details.join('; ')}` : ''}.`,
  titled: (title, text) => `${title}. ${text}`,
  join: (sentences) => sentences.join(' '),
  paren: (text, note) => `${text}(${note})`,
  labelled: (label, text) => `${label}: ${text}.`,
  cell: (row, col) => `${row}, ${col}`,

  rows: (_n, count) => `${count}행`,
  columns: (_n, count) => `${count}열`,
  emptyCells: (_n, count) => `빈 셀 ${count}개`,
  slices: (_n, count) => `조각 ${count}개`,
  rings: (_n, count) => `링 ${count}개`,
  candles: (_n, count) => `캔들 ${count}개`,
  bars: (_n, count) => `봉 ${count}개`,
  values: (_n, count) => `값 ${count}개`,
  hiddenCount: (count) => `숨김 ${count}개`,

  gridSize: (rows, cols) => `${rows} × ${cols}`,
  valueRange: (range) => `값 ${range}`,
  noValues: '값 없음',
  total: (value) => `합계 ${value}`,
  seriesRange: (name, range) => `${name} 범위 ${range}`,
  seriesNoData: (name) => `${name} 데이터 없음`,
  scatterRange: (x, y) => `x 범위 ${x}, y 범위 ${y}`,
  barRange: (min, minLabel, max, maxLabel) => `값 범위 ${min}(${minLabel})~${max}(${maxLabel})`,

  axisTitle: (axis, title) => `${axis}: ${title}.`,
  axisRange: (axis, title, from, to) =>
    `${axis}${title ? `(${title})` : ''}${from !== undefined ? `: ${from}~${to}` : ''}.`,
  axisBreaks: (axis, title, ranges) => `${axis}${title ? `(${title})` : ''}: ${ranges} 구간 생략.`,
  extraAxis: (title, names) => `추가 Y축${title ? `(${title})` : ''}: ${names}.`,
  heatmapRows: (rows, title, from, to) => `행${title ? `(${title})` : ''}: ${rows}${from !== undefined ? `, ${from}~${to}` : ''}.`,
  heatmapColumns: (cols, title, from, to) => `열${title ? `(${title})` : ''}: ${cols}${from !== undefined ? `, ${from}~${to}` : ''}.`,
  heatmapExtremes: (label, min, minCell, max, maxCell) => `${label}: 최솟값 ${min}(${minCell}), 최댓값 ${max}(${maxCell}).`,
  sliceLine: (name, value, share) => `${name}: ${value}(${share}).`,
  otherCombines: (name, members) => `${name}: ${members} 포함.`,
  bandEdges: (name, first, second) => `${name}: 첫째 경계 ${first}, 둘째 경계 ${second}.`,
  lineStats: (name, values, min, minAt, max, maxAt, mean, first, last, trend) =>
    `${name}: ${values}, 최솟값 ${min}(${minAt}), 최댓값 ${max}(${maxAt}), 평균 ${mean}; 시작 ${first}, 끝 ${last}(전체 ${trend}).`,
  barStats: (name, maxLabel, max, minLabel, min, mean) => `${name}: 최고 ${maxLabel} ${max}, 최저 ${minLabel} ${min}, 평균 ${mean}.`,
  barLayout: (categories, mode) => `${categories}, ${mode}.`,

  keyboard: {
    default:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 데이터 포인트를 이동합니다. ' +
      'Page Up·Page Down은 10개씩 건너뛰고, Home·End는 첫 포인트와 마지막 포인트로 이동합니다. ' +
      '위·아래 화살표는 시리즈를 전환하고, Esc는 선택을 해제합니다.',
    bar:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 데이터 포인트를 이동합니다. ' +
      'Page Up·Page Down은 10개씩 건너뛰고, Home·End는 첫 포인트와 마지막 포인트로 이동합니다. ' +
      'Esc는 선택을 해제합니다.',
    categories:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 항목을 이동합니다. ' +
      'Page Up·Page Down은 10개 항목씩 건너뛰고, Home·End는 첫 항목과 마지막 항목으로 이동합니다. ' +
      '위·아래 화살표는 시리즈를 전환하고, Esc는 선택을 해제합니다.',
    scatter:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 한 시리즈의 포인트를 x 순서대로 이동합니다. ' +
      'Page Up·Page Down은 10개씩 건너뛰고, Home·End는 x가 가장 작은 포인트와 가장 큰 포인트로 이동합니다. ' +
      '위·아래 화살표는 시리즈를 전환하고, Esc는 선택을 해제합니다.',
    candle:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 캔들을 이동합니다. ' +
      'Page Up·Page Down은 10개씩 건너뛰고, Home·End는 첫 캔들과 마지막 캔들로 이동합니다. ' +
      'Esc는 선택을 해제합니다.',
    ohlc:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 봉을 이동합니다. ' +
      'Page Up·Page Down은 10개씩 건너뛰고, Home·End는 첫 봉과 마지막 봉으로 이동합니다. ' +
      'Esc는 선택을 해제합니다.',
    pie:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 조각을 이동합니다. ' +
      'Home·End는 첫 조각과 마지막 조각으로 이동하고, Esc는 선택을 해제합니다.',
    heatmap:
      '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 열을, 위·아래 화살표로 행을 이동합니다. ' +
      'Page Up·Page Down은 10열씩 건너뛰고, Home·End는 첫 열과 마지막 열로 이동합니다. ' +
      'Esc는 선택을 해제합니다.',
  },

  slicePoint: (name, value, share) => `${name}, ${value}, ${share}.`,
  ohlcPoint: (x, open, high, low, close, volume) =>
    `${x}, 시가 ${open}, 고가 ${high}, 저가 ${low}, 종가 ${close}${volume !== undefined ? `, 거래량 ${volume}` : ''}.`,
  errorBarPoint: (x, name, value, low, high, direction) => `${x}, ${name}: ${value}, 하한 ${low}, 상한 ${high}, ${direction}.`,
  impulsePoint: (x, name, value, baseline) => `${x}, ${name}: ${value}, 기준선 ${baseline}.`,
  bandPoint: (x, name, first, second) => `${x}, ${name}: 첫째 경계 ${first}, 둘째 경계 ${second}.`,
  barPoint: (x, value) => `${x}, ${value}.`,
  seriesPoint: (x, name, value) => `${x}, ${name} ${value}.`,
  totalPoint: (value) => `합계 ${value}.`,
  scatterPoint: (name, xName, x, yName, y) => `${name}: ${xName} ${x}, ${yName} ${y}.`,

  sliceHeader: '조각',
  percentHeader: '비율',
  lowColumn: (name) => `${name} 하한`,
  highColumn: (name) => `${name} 상한`,
  baselineColumn: (name) => `${name} 기준선`,
  lowerColumn: (name) => `${name} 하단`,
  upperColumn: (name) => `${name} 상단`,
  tableCaption: (kind) => `${kind} 차트 데이터`,
  tableLabel: (caption) => `데이터 표: ${caption}`,
  sampledRows: (shown, total) => `전체 ${total}행 중 ${shown}행`,
  sampledColumns: (shown, total) => `전체 ${total}열 중 ${shown}열`,
  sampledNote: (parts) =>
    `${parts.join(', ')}만 표시합니다(처음과 끝을 포함해 고르게 추출). 전체 데이터는 CSV로 내보내 확인할 수 있습니다.`,
};

const zh: A11yMessages = {
  chart: {
    line: '折线图',
    area: '面积图',
    stackedArea: '堆叠面积图',
    percentArea: '百分比堆叠面积图',
    themeRiver: '主题河流图',
    band: '带状图',
    errorBar: '误差棒图',
    impulse: '脉冲图',
    candlestick: 'K 线图',
    ohlc: 'OHLC 图',
    scatter: '散点图',
    bar: '柱状图',
    groupedBar: '分组柱状图',
    stackedBar: '堆叠柱状图',
    percentBar: '百分比堆叠柱状图',
    pictorialBar: '象形柱图',
    heatmap: '热力图',
    pie: '饼图',
    donut: '环形图',
  },
  barMode: { grouped: '分组', stacked: '堆叠', percent: '百分比堆叠' },
  trend: { rising: '上升', falling: '下降', flat: '持平' },
  direction: { vertical: '垂直方向', horizontal: '水平方向' },

  sentence: (head, details = []) => `${head.join('，')}${details.length ? `；${details.join('；')}` : ''}。`,
  titled: (title, text) => `${title}。${text}`,
  join: (sentences) => sentences.join(''),
  paren: (text, note) => `${text}（${note}）`,
  labelled: (label, text) => `${label}：${text}。`,
  cell: (row, col) => `${row}，${col}`,

  rows: (_n, count) => `${count} 行`,
  columns: (_n, count) => `${count} 列`,
  emptyCells: (_n, count) => `${count} 个空单元格`,
  slices: (_n, count) => `${count} 个扇区`,
  rings: (_n, count) => `${count} 个环`,
  candles: (_n, count) => `${count} 根 K 线`,
  bars: (_n, count) => `${count} 根柱线`,
  values: (_n, count) => `${count} 个值`,
  hiddenCount: (count) => `${count} 个已隐藏`,

  gridSize: (rows, cols) => `${rows} × ${cols}`,
  valueRange: (range) => `数值 ${range}`,
  noValues: '无数值',
  total: (value) => `合计 ${value}`,
  seriesRange: (name, range) => `${name} 范围 ${range}`,
  seriesNoData: (name) => `${name} 无数据`,
  scatterRange: (x, y) => `x 范围 ${x}，y 范围 ${y}`,
  barRange: (min, minLabel, max, maxLabel) => `数值范围 ${min}（${minLabel}）至 ${max}（${maxLabel}）`,

  axisTitle: (axis, title) => `${axis}：${title}。`,
  axisRange: (axis, title, from, to) =>
    `${axis}${title ? `（${title}）` : ''}${from !== undefined ? `：${from} 至 ${to}` : ''}。`,
  axisBreaks: (axis, title, ranges) => `${axis}${title ? `（${title}）` : ''}：省略 ${ranges} 区间。`,
  extraAxis: (title, names) => `附加 Y 轴${title ? `（${title}）` : ''}：${names}。`,
  heatmapRows: (rows, title, from, to) => `行${title ? `（${title}）` : ''}：${rows}${from !== undefined ? `，${from} 至 ${to}` : ''}。`,
  heatmapColumns: (cols, title, from, to) => `列${title ? `（${title}）` : ''}：${cols}${from !== undefined ? `，${from} 至 ${to}` : ''}。`,
  heatmapExtremes: (label, min, minCell, max, maxCell) => `${label}：最小值 ${min}（${minCell}），最大值 ${max}（${maxCell}）。`,
  sliceLine: (name, value, share) => `${name}：${value}（${share}）。`,
  otherCombines: (name, members) => `${name}包含${members}。`,
  bandEdges: (name, first, second) => `${name}：第一边界 ${first}，第二边界 ${second}。`,
  lineStats: (name, values, min, minAt, max, maxAt, mean, first, last, trend) =>
    `${name}：${values}，最小值 ${min}（${minAt}），最大值 ${max}（${maxAt}），平均值 ${mean}；起始 ${first}，结束 ${last}（整体${trend}）。`,
  barStats: (name, maxLabel, max, minLabel, min, mean) => `${name}：最高 ${maxLabel} ${max}，最低 ${minLabel} ${min}，平均值 ${mean}。`,
  barLayout: (categories, mode) => `${categories}，${mode}。`,

  keyboard: {
    default:
      '键盘：聚焦图表后，使用左右方向键在数据点之间移动，Page Up 和 Page Down 每次跳过 10 个数据点，' +
      'Home 和 End 跳到第一个和最后一个数据点，上下方向键切换系列，Esc 键清除选择。',
    bar:
      '键盘：聚焦图表后，使用左右方向键在数据点之间移动，Page Up 和 Page Down 每次跳过 10 个数据点，' +
      'Home 和 End 跳到第一个和最后一个数据点，Esc 键清除选择。',
    categories:
      '键盘：聚焦图表后，使用左右方向键在类别之间移动，Page Up 和 Page Down 每次跳过 10 个类别，' +
      'Home 和 End 跳到第一个和最后一个类别，上下方向键切换系列，Esc 键清除选择。',
    scatter:
      '键盘：聚焦图表后，使用左右方向键按 x 顺序在同一系列的数据点之间移动，Page Up 和 Page Down 每次跳过 10 个数据点，' +
      'Home 和 End 跳到 x 最小和最大的数据点，上下方向键切换系列，Esc 键清除选择。',
    candle:
      '键盘：聚焦图表后，使用左右方向键在 K 线之间移动，Page Up 和 Page Down 每次跳过 10 根 K 线，' +
      'Home 和 End 跳到第一根和最后一根 K 线，Esc 键清除选择。',
    ohlc:
      '键盘：聚焦图表后，使用左右方向键在柱线之间移动，Page Up 和 Page Down 每次跳过 10 根柱线，' +
      'Home 和 End 跳到第一根和最后一根柱线，Esc 键清除选择。',
    pie: '键盘：聚焦图表后，使用左右方向键在扇区之间移动，Home 和 End 跳到第一个和最后一个扇区，Esc 键清除选择。',
    heatmap:
      '键盘：聚焦图表后，使用左右方向键在列之间移动，上下方向键在行之间移动，Page Up 和 Page Down 每次跳过 10 列，' +
      'Home 和 End 跳到第一列和最后一列，Esc 键清除选择。',
  },

  slicePoint: (name, value, share) => `${name}，${value}，${share}。`,
  ohlcPoint: (x, open, high, low, close, volume) =>
    `${x}，开盘 ${open}，最高 ${high}，最低 ${low}，收盘 ${close}${volume !== undefined ? `，成交量 ${volume}` : ''}。`,
  errorBarPoint: (x, name, value, low, high, direction) => `${x}，${name}：${value}，下限 ${low}，上限 ${high}，${direction}。`,
  impulsePoint: (x, name, value, baseline) => `${x}，${name}：${value}，基线 ${baseline}。`,
  bandPoint: (x, name, first, second) => `${x}，${name}：第一边界 ${first}，第二边界 ${second}。`,
  barPoint: (x, value) => `${x}，${value}。`,
  seriesPoint: (x, name, value) => `${x}，${name} ${value}。`,
  totalPoint: (value) => `合计 ${value}。`,
  scatterPoint: (name, xName, x, yName, y) => `${name}：${xName} ${x}，${yName} ${y}。`,

  sliceHeader: '扇区',
  percentHeader: '占比',
  lowColumn: (name) => `${name} 下限`,
  highColumn: (name) => `${name} 上限`,
  baselineColumn: (name) => `${name} 基线`,
  lowerColumn: (name) => `${name} 下边界`,
  upperColumn: (name) => `${name} 上边界`,
  tableCaption: (kind) => `${kind}数据`,
  tableLabel: (caption) => `数据表：${caption}`,
  sampledRows: (shown, total) => `${total} 行中的 ${shown} 行`,
  sampledColumns: (shown, total) => `${total} 列中的 ${shown} 列`,
  sampledNote: (parts) => `显示 ${parts.join('、')}（均匀抽样，包含首尾）。导出 CSV 可查看完整数据。`,
};

export const A11Y_MESSAGES = { en, ko, 'zh-CN': zh } as const;
