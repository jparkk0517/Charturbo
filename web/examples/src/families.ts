import { docsHref, lang, languageControl, t } from './i18n';
import { themeControl } from './theme';

/** Pages of the examples site (one HTML page per family, demos in src/demos/<id>/). */
export interface Family {
  id: string;
  title: string;
  description: string;
}

const FAMILIES_EN: Family[] = [
  { id: 'scientific3d', title: 'PointCloud3D · Surface3D', description: 'XYZ clouds and Y-up height grids with fixed axes, data aspect, orthographic projection, scalar colors, holes, height contours and live streaming.' },
  { id: 'line', title: 'Line · Area · Band · ErrorBar · Impulse', description: '1M-point lines, stacked areas, standalone bands, scientific error bars, event stems and live streaming.' },
  { id: 'bar', title: 'Bar · Horizontal · Labels · Pictorial', description: 'Grouped / stacked / percent bars, horizontal bars with data labels and error bars, histograms, pictorial bars.' },
  { id: 'scatter', title: 'Scatter · Brush', description: '60k-point scatter with rectangle brush selection, bubble chart with per-point sizes.' },
  { id: 'candlestick', title: 'Candlestick · OHLC · Navigator', description: 'Candles and independent OHLC bars with volume and pixel-column aggregation, range navigator under a long time series.' },
  { id: 'heatmap', title: 'Heatmap', description: 'GPU texture heatmap with color bar and switchable color scales, plus calendar heatmaps.' },
  { id: 'box', title: 'Box plot · Violin', description: 'Per-group statistics in O(n), Tukey whiskers, outliers, KDE violins.' },
  { id: 'pie', title: 'Pie · Donut · Rose', description: 'Pie with outside labels and leader lines, donut with center total, Nightingale rose, half donut, rounded corners, nested rings.' },
  { id: 'combo', title: 'Combo', description: 'Stacked bars, area and a dashed line on a right axis in one plot.' },
  { id: 'business', title: 'Radar · Gauge · Funnel · Waterfall', description: 'Business charts: radar, live gauge with status bands, conversion funnel, waterfall with subtotals.' },
  { id: 'hierarchy', title: 'Treemap · Sunburst · Sankey · Tree', description: 'Hierarchies with click drill-down, energy flows and collapsible tidy trees.' },
  { id: 'graph', title: '3D Graph · 2D Graph · Network', description: 'Force-directed 3D networks up to 20k nodes (Barnes-Hut): metadata tooltips, neighbor highlight, layout presets, shortest paths, search. 2D graphs: force, circular and cartesian layouts with category legends.' },
  { id: 'embeddings', title: 'Embeddings · Similarity', description: '1536-dim embeddings projected to 3D (PCA / UMAP-style / random projection) with cosine k-NN edges and top-k similarity queries.' },
  { id: 'scene', title: '3D Scene · Physics', description: 'Primitives with PBR-style materials and lighting, rigid-body drops onto a floor, raycast picking.' },
  { id: 'sparklines', title: 'Sparklines grid', description: '24 sparklines on one shared GPU device (CharturboDevice).' },
  { id: 'animation', title: 'Animations', description: 'Opt-in enter and update tweens computed in Rust.' },
  { id: 'export', title: 'SVG · PDF · PNG export', description: 'Vector SVG, one-page PDF and PNG export including the DOM labels.' },
  { id: 'react', title: 'React', description: '<CharturboChart> component from charturbo/react with memoized props.' },
  { id: 'vue', title: 'Vue', description: '<CharturboChart> component from charturbo/vue with shallowRef data.' },
];

/** [title, description] per family; English above is the fallback. */
const FAMILY_TEXT: Record<'ko' | 'zh', Record<string, [string, string]>> = {
  ko: {
    scientific3d: ['PointCloud3D · Surface3D', 'XYZ 점 구름과 Y-up 높이 격자입니다. 고정 축, 데이터 종횡비, 직교 투영, 스칼라 색상, 구멍, 높이 등고선, 실시간 스트리밍을 지원합니다.'],
    line: ['선 · 영역 · 밴드 · 오차 막대 · 임펄스', '100만 포인트 선, 누적 영역, 독립 밴드, 과학용 오차 막대, 이벤트 줄기, 실시간 스트리밍.'],
    bar: ['막대 · 가로 막대 · 레이블 · 픽토리얼', '그룹형·누적형·백분율 막대, 데이터 레이블과 오차 막대가 있는 가로 막대, 히스토그램, 픽토리얼 막대.'],
    scatter: ['산점도 · 브러시', '사각형 브러시 선택이 가능한 6만 포인트 산점도, 포인트별 크기를 지정하는 버블 차트.'],
    candlestick: ['캔들스틱 · OHLC · 내비게이터', '거래량과 픽셀 열 단위 집계를 지원하는 캔들과 독립 OHLC 막대, 긴 시계열 아래의 범위 내비게이터.'],
    heatmap: ['히트맵', '색상 막대와 전환 가능한 색상 스케일을 갖춘 GPU 텍스처 히트맵과 캘린더 히트맵.'],
    box: ['상자 그림 · 바이올린', 'O(n) 그룹별 통계, Tukey 수염, 이상값, KDE 바이올린.'],
    pie: ['파이 · 도넛 · 로즈', '바깥 레이블과 지시선이 있는 파이, 가운데에 합계를 표시하는 도넛, 나이팅게일 로즈, 반 도넛, 둥근 모서리, 중첩 링.'],
    combo: ['콤보', '누적 막대, 영역, 오른쪽 축의 점선을 한 플롯에 그립니다.'],
    business: ['레이더 · 게이지 · 깔때기 · 폭포', '비즈니스 차트: 레이더, 상태 구간이 있는 실시간 게이지, 전환 깔때기, 소계가 있는 폭포 차트.'],
    hierarchy: ['트리맵 · 선버스트 · 생키 · 트리', '클릭 드릴다운이 가능한 계층 구조, 에너지 흐름, 접고 펼치는 트리.'],
    graph: ['3D 그래프 · 2D 그래프 · 네트워크', '최대 2만 노드의 힘 기반 3D 네트워크(Barnes-Hut): 메타데이터 툴팁, 이웃 강조, 레이아웃 프리셋, 최단 경로, 검색. 2D 그래프: 범주 범례가 있는 힘 기반, 원형, 직교 좌표 레이아웃.'],
    embeddings: ['임베딩 · 유사도', '1536차원 임베딩을 3D로 투영(PCA / UMAP 방식 / 무작위 투영)하고 코사인 k-NN 엣지와 top-k 유사도 질의를 제공합니다.'],
    scene: ['3D 장면 · 물리', 'PBR 방식 재질과 조명을 적용한 기본 도형, 바닥으로 떨어지는 강체, 레이캐스트 선택.'],
    sparklines: ['스파크라인 그리드', 'GPU 장치 하나(CharturboDevice)를 공유하는 스파크라인 24개.'],
    animation: ['애니메이션', 'Rust에서 계산하는 선택형 진입·업데이트 트윈.'],
    export: ['SVG · PDF · PNG 내보내기', 'DOM 레이블까지 포함한 벡터 SVG, 1페이지 PDF, PNG 내보내기.'],
    react: ['React', 'charturbo/react의 <CharturboChart> 컴포넌트와 메모이즈한 props.'],
    vue: ['Vue', 'charturbo/vue의 <CharturboChart> 컴포넌트와 shallowRef 데이터.'],
  },
  zh: {
    scientific3d: ['PointCloud3D · Surface3D', 'XYZ 点云与 Y 轴向上的高度网格，支持固定坐标轴、数据纵横比、正交投影、标量着色、空洞、高度等值线和实时流式更新。'],
    line: ['折线图 · 面积图 · 带状图 · 误差线 · 脉冲图', '百万点折线图、堆叠面积图、独立带状图、科学误差线、事件脉冲线和实时流式更新。'],
    bar: ['柱状图 · 条形图 · 数据标签 · 象形柱图', '分组/堆叠/百分比柱状图，带数据标签和误差线的条形图，直方图，以及象形柱图。'],
    scatter: ['散点图 · 框选', '支持矩形框选的 6 万点散点图，以及逐点设置大小的气泡图。'],
    candlestick: ['K 线图 · OHLC · 导航器', '带成交量和按像素列聚合的 K 线与独立 OHLC 柱，以及长时间序列下方的范围导航器。'],
    heatmap: ['热力图', '带色条且可切换色阶的 GPU 纹理热力图，以及日历热力图。'],
    box: ['箱线图 · 小提琴图', 'O(n) 分组统计、Tukey 须线、异常值和 KDE 小提琴图。'],
    pie: ['饼图 · 环形图 · 玫瑰图', '带外部标签和引导线的饼图、中心显示总计的环形图、南丁格尔玫瑰图、半环形图、圆角扇区和嵌套环。'],
    combo: ['组合图', '在同一绘图区中组合堆叠柱、面积和右轴虚线。'],
    business: ['雷达图 · 仪表盘 · 漏斗图 · 瀑布图', '商业图表：雷达图、带状态区间的实时仪表盘、转化漏斗图和含小计的瀑布图。'],
    hierarchy: ['矩形树图 · 旭日图 · 桑基图 · 树图', '支持点击下钻的层级结构、能量流与可折叠树图。'],
    graph: ['3D 关系图 · 2D 关系图 · 网络', '最多 2 万节点的力导向 3D 网络（Barnes-Hut）：元数据提示框、邻居高亮、布局预设、最短路径和搜索。2D 关系图：带类别图例的力导向、环形和直角坐标布局。'],
    embeddings: ['嵌入向量 · 相似度', '将 1536 维嵌入向量投影到 3D（PCA / 类 UMAP / 随机投影），并提供余弦 k-NN 边和 top-k 相似度查询。'],
    scene: ['3D 场景 · 物理', '采用 PBR 风格材质与光照的基本体、落到地面的刚体以及射线拾取。'],
    sparklines: ['迷你图网格', '24 个迷你图共享同一个 GPU 设备（CharturboDevice）。'],
    animation: ['动画', '在 Rust 中计算的可选入场与更新补间动画。'],
    export: ['SVG · PDF · PNG 导出', '包含 DOM 标签的矢量 SVG、单页 PDF 和 PNG 导出。'],
    react: ['React', '来自 charturbo/react 的 <CharturboChart> 组件，配合记忆化 props。'],
    vue: ['Vue', '来自 charturbo/vue 的 <CharturboChart> 组件，配合 shallowRef 数据。'],
  },
};

/** Families with title / description in the current site language. */
export const FAMILIES: Family[] = FAMILIES_EN.map((f) => {
  const text = lang === 'en' ? undefined : FAMILY_TEXT[lang][f.id];
  return text ? { id: f.id, title: text[0], description: text[1] } : f;
});

/** Docs page of each family (chart manual, or the guide page for the feature demos). */
export const DOC_PAGES: Record<string, string> = {
  scientific3d: 'charts/scientific-3d', line: 'charts/line', bar: 'charts/bar', scatter: 'charts/scatter',
  candlestick: 'charts/candlestick', heatmap: 'charts/heatmap', box: 'charts/box-violin', pie: 'charts/pie',
  combo: 'charts/combo', business: 'charts/radar', hierarchy: 'charts/treemap-sunburst', graph: 'charts/graph-3d',
  embeddings: 'charts/embeddings', scene: 'charts/scene-3d', sparklines: 'charts/sparkline',
  animation: 'guide/animation', export: 'guide/export', react: 'guide/react', vue: 'guide/vue',
};

function navLink(href: string, text: string, current = false): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (current) a.setAttribute('aria-current', 'page');
  return a;
}

/**
 * Site header, the same sections as the docs nav: guide, chart manuals, API, examples,
 * benchmarks. On the gallery and the family pages a second row switches between examples.
 */
export function renderHeader(active: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'site-header';
  const brand = navLink('./index.html', 'Charturbo');
  brand.className = 'brand';
  brand.setAttribute('aria-label', t('site.home'));
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', t('site.mainNav'));
  const examples = active !== 'benchmarks';
  nav.append(
    navLink(docsHref('guide/getting-started'), t('site.guide')),
    navLink(docsHref('charts/line'), t('site.charts')),
    navLink(docsHref('api/index.html'), t('site.api')),
    navLink('./gallery.html', t('site.examples'), examples),
    navLink('./benchmarks.html', t('site.benchmarks'), !examples),
    navLink('https://github.com/jparkk0517/Charturbo', 'GitHub ↗'),
  );
  header.append(brand, nav, themeControl(), languageControl());
  if (examples) {
    const tabs = header.appendChild(document.createElement('nav'));
    tabs.className = 'site-tabs';
    tabs.setAttribute('aria-label', t('site.familyNav'));
    tabs.append(navLink('./gallery.html', t('site.all'), active === 'gallery'));
    for (const f of FAMILIES) tabs.append(navLink(`./${f.id}.html`, f.title.split(' · ')[0], f.id === active));
  }
  return header;
}
