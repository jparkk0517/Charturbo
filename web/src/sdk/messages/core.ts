/** Built-in strings of charturbo.ts default tooltips / node details, graph-tooltip.ts, chart-scientific3d.ts, chart-heatmap.ts, chart-pie.ts, chart-pdf.ts. */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Default label of a graph node without metadata */
  nodeName: (id: string) => `Node #${id}`,
  /** Default category of a graph node: its layout cluster */
  clusterName: (id: string) => `Cluster ${id}`,
  /** Node details category of a line / band / error bar / impulse sample; `kind` is a `common.kind` name */
  seriesCategory: (kind: string, name: string) => `${kind} Series: ${name}`,
  /** Node details description of a line sample at a numeric / time x */
  lineSampleAtX: (name: string, x: string) => `Sample data point of ${name} at x = ${x}.`,
  /** Node details description of a line sample by 1-based position */
  lineSampleAt: (name: string, position: string) => `Sample data point ${position} of ${name}.`,
  /** Node details description of a grouped / stacked bar */
  groupedBarDescription: (name: string, category: string) => `${name} series value for ${category}.`,
  /** Node details description of a single-series bar */
  barDescription: (label: string) => `Value of ${label} and its share of the total.`,
  /** Default category of single-series bars (2D / 3D) */
  barCategory2d: '2D Bar / Histogram',
  barCategory3d: '3D Matrix Column',
  /** Node details label of a candle / OHLC bar */
  candleLabel: (x: string) => `Candle · ${x}`,
  /** Marks a box plot outlier in node details */
  outlier: 'outlier',
  /** Candlestick / OHLC series name */
  price: 'Price',
  /** Histogram value names (density / count mode) */
  density: 'Density',
  count: 'Count',
  /** Single-bar tooltip rows (`shareOfTotal` / `peakRatio` attributes) */
  shareOfTotal: 'Share of total',
  peakRatio: 'Share of peak',
  /** Line x label prefix without x values (`T+12`) */
  stepPrefix: 'T',
  /** Tooltip: aggregated candles / OHLC bars behind one bucket */
  candles: (n: number, count: string) => `${count} ${plural(n, 'candle', 'candles')}`,
  ohlcBars: (n: number, count: string) => `${count} ${plural(n, 'bar', 'bars')}`,
  /** Tooltip: impulse baseline next to the value */
  baseline: (value: string) => `baseline ${value}`,
  /** `aria-label` of the chart legend */
  legend: 'Chart legend',
  /** Graph node tooltip rows */
  cluster: 'Cluster',
  degree: 'Degree',
  neighbors: 'Neighbors',
  nodePosition: 'Position',
  /** Graph node tooltip: shown when a click highlights the node's neighbors */
  clickHint: 'Click to highlight neighbors',
  /** Heatmap colorbar `aria-label`; `mid`: diverging midpoint */
  colorScale: (title: string, lo: string, hi: string, mid?: string) =>
    `${title} color scale from ${lo} to ${hi}${mid !== undefined ? `, midpoint ${mid}` : ''}`,
  /** Default PDF document title */
  pdfTitle: 'Chart',
  /** Default name of the `index`-th ring of a multi-ring pie (1-based) */
  ringName: (index: number) => `Ring ${index}`,
  /** Default text of the loading indicator (`showLoading`) */
  loading: 'Loading…',
  /** Legend pager buttons */
  prevLegendPage: 'Previous legend page',
  nextLegendPage: 'Next legend page',
  /** Scatter trendlines: model name (`order` only for polynomials) */
  trendKind: (type: 'linear' | 'exponential' | 'logarithmic' | 'polynomial', order: string) =>
    type === 'polynomial' ? `polynomial (order ${order})` : type,
  r2Unavailable: 'R² n/a',
  /** `; 2 points with y ≤ 0 skipped` (`points` from common.points, `domain` like `y ≤ 0`) */
  trendSkipped: (points: string, domain: string) => `; ${points} with ${domain} skipped`,
  /** Legend text of a model without a fit */
  trendNoFit: (type: string, points: string, skipped: string) => `no ${type} fit (${points}${skipped})`,
  /** Subject of the accessible trendline sentence */
  trendHead: (series: string, hidden: boolean, kind: string) => `${series}${hidden ? ' (hidden)' : ''} ${kind} trend line`,
  trendNotEnough: (head: string, points: string, skipped: string) => `${head}: not enough points to fit (${points}${skipped}).`,
  trendFitted: (head: string, expression: string, r2: string, points: string, skipped: string) =>
    `${head}: ${expression}, ${r2}, fitted to ${points}${skipped}.`,
  /** 3D chart kind names (summary, data table caption) */
  pointCloud3d: '3D point cloud',
  surface3d: '3D surface',
  samples: (n: number, count: string) => `${count} ${plural(n, 'sample', 'samples')}`,
  /** 3D chart summary; `samples` / `series` are already counted phrases */
  scientificSummary: (kind: string, samples: string, series: string, title?: string) =>
    `${title ? `${title}. ` : ''}${kind}, ${samples}, ${series}.`,
  scientificDescription: 'Y-up coordinates. Nonfinite samples are gaps.',
  scientificHelp:
    'Drag to orbit, right-drag to pan, wheel to zoom. Arrow keys navigate samples; Home/End move to the first/last sample.',
  /** Keyboard announcement of a 3D sample */
  point3d: (name: string, x: string, y: string, z: string) => `${name}, X ${x}, Y ${y}, Z ${z}.`,
};

export type CoreMessages = typeof en;

const ko: CoreMessages = {
  nodeName: (id) => `노드 #${id}`,
  clusterName: (id) => `클러스터 ${id}`,
  seriesCategory: (kind, name) => `${kind} 시리즈: ${name}`,
  lineSampleAtX: (name, x) => `${name} 시계열의 x = ${x} 샘플 데이터 포인트입니다.`,
  lineSampleAt: (name, position) => `${name} 시계열의 ${position}번째 샘플 데이터 포인트입니다.`,
  groupedBarDescription: (name, category) => `${category} 항목의 ${name} 시리즈 값입니다.`,
  barDescription: (label) => `${label} 항목의 수치와 전체 대비 비중입니다.`,
  barCategory2d: '2D 막대 / 히스토그램',
  barCategory3d: '3D 매트릭스 막대',
  candleLabel: (x) => `캔들 · ${x}`,
  outlier: '이상값',
  price: '가격',
  density: '밀도',
  count: '개수',
  shareOfTotal: '전체 대비 비중',
  peakRatio: '최댓값 대비 비율',
  stepPrefix: 'T',
  candles: (_n, count) => `캔들 ${count}개`,
  ohlcBars: (_n, count) => `봉 ${count}개`,
  baseline: (value) => `기준선 ${value}`,
  legend: '차트 범례',
  cluster: '클러스터',
  degree: '연결 차수',
  neighbors: '이웃 노드',
  nodePosition: '좌표',
  clickHint: '클릭하면 이웃 노드를 강조합니다',
  colorScale: (title, lo, hi, mid) => `${title} 색상 척도, ${lo}~${hi}${mid !== undefined ? `, 중간값 ${mid}` : ''}`,
  pdfTitle: '차트',
  ringName: (index) => `링 ${index}`,
  loading: '로딩 중…',
  prevLegendPage: '이전 범례 페이지',
  nextLegendPage: '다음 범례 페이지',
  trendKind: (type, order) =>
    ({ linear: '선형', exponential: '지수', logarithmic: '로그', polynomial: `${order}차 다항식` })[type],
  r2Unavailable: 'R² 없음',
  trendSkipped: (points, domain) => `; ${domain}인 ${points} 제외`,
  trendNoFit: (type, points, skipped) => `${type} 회귀 불가(${points}${skipped})`,
  trendHead: (series, hidden, kind) => `${series}${hidden ? '(숨김)' : ''} ${kind} 추세선`,
  trendNotEnough: (head, points, skipped) => `${head}: 회귀에 필요한 점이 부족합니다(${points}${skipped}).`,
  trendFitted: (head, expression, r2, points, skipped) => `${head}: ${expression}, ${r2}, ${points}로 회귀${skipped}.`,
  pointCloud3d: '3D 포인트 클라우드',
  surface3d: '3D 곡면',
  samples: (_n, count) => `샘플 ${count}개`,
  scientificSummary: (kind, samples, series, title) => `${title ? `${title}. ` : ''}${kind}, ${samples}, ${series}.`,
  scientificDescription: 'Y축이 위를 향하는 좌표계입니다. 유한하지 않은 샘플은 빈 곳으로 남습니다.',
  scientificHelp:
    '드래그하면 회전하고, 오른쪽 버튼으로 드래그하면 이동하며, 휠로 확대·축소합니다. 화살표 키로 샘플 사이를 이동하고, Home/End 키로 첫 샘플과 마지막 샘플로 이동합니다.',
  point3d: (name, x, y, z) => `${name}, X ${x}, Y ${y}, Z ${z}.`,
};

const zh: CoreMessages = {
  nodeName: (id) => `节点 #${id}`,
  clusterName: (id) => `簇 ${id}`,
  seriesCategory: (kind, name) => `${kind}系列：${name}`,
  lineSampleAtX: (name, x) => `${name} 在 x = ${x} 处的样本数据点。`,
  lineSampleAt: (name, position) => `${name} 的第 ${position} 个样本数据点。`,
  groupedBarDescription: (name, category) => `${category} 中 ${name} 系列的数值。`,
  barDescription: (label) => `${label} 的数值及其占总计的比例。`,
  barCategory2d: '2D 柱状图 / 直方图',
  barCategory3d: '3D 矩阵柱',
  candleLabel: (x) => `K 线 · ${x}`,
  outlier: '异常值',
  price: '价格',
  density: '密度',
  count: '计数',
  shareOfTotal: '占总计比例',
  peakRatio: '占峰值比例',
  stepPrefix: 'T',
  candles: (_n, count) => `${count} 根 K 线`,
  ohlcBars: (_n, count) => `${count} 根 OHLC 柱`,
  baseline: (value) => `基线 ${value}`,
  legend: '图表图例',
  cluster: '簇',
  degree: '度',
  neighbors: '邻居节点',
  nodePosition: '坐标',
  clickHint: '点击以高亮邻居节点',
  colorScale: (title, lo, hi, mid) => `${title}色阶，从 ${lo} 到 ${hi}${mid !== undefined ? `，中点 ${mid}` : ''}`,
  pdfTitle: '图表',
  ringName: (index) => `环 ${index}`,
  loading: '加载中…',
  prevLegendPage: '上一页图例',
  nextLegendPage: '下一页图例',
  trendKind: (type, order) =>
    ({ linear: '线性', exponential: '指数', logarithmic: '对数', polynomial: `${order} 次多项式` })[type],
  r2Unavailable: 'R² 不可用',
  trendSkipped: (points, domain) => `；已排除 ${domain} 的 ${points}`,
  trendNoFit: (type, points, skipped) => `无法进行${type}拟合（${points}${skipped}）`,
  trendHead: (series, hidden, kind) => `${series}${hidden ? '（已隐藏）' : ''}${kind}趋势线`,
  trendNotEnough: (head, points, skipped) => `${head}：数据点不足，无法拟合（${points}${skipped}）。`,
  trendFitted: (head, expression, r2, points, skipped) => `${head}：${expression}，${r2}，基于 ${points}拟合${skipped}。`,
  pointCloud3d: '3D 点云',
  surface3d: '3D 曲面',
  samples: (_n, count) => `${count} 个样本`,
  scientificSummary: (kind, samples, series, title) => `${title ? `${title}。` : ''}${kind}，${samples}，${series}。`,
  scientificDescription: 'Y 轴朝上的坐标系。非有限样本显示为空缺。',
  scientificHelp: '拖动可旋转视角，右键拖动可平移，滚轮可缩放。方向键在样本间移动；Home/End 键跳到第一个/最后一个样本。',
  point3d: (name, x, y, z) => `${name}，X ${x}，Y ${y}，Z ${z}。`,
};

export const CORE_MESSAGES = { en, ko, 'zh-CN': zh } as const;
