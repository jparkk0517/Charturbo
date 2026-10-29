/**
 * Translated `meta.title` / `meta.description` of every demo, keyed by `<family>/<demo-file-id>`.
 * The demo files themselves stay English: their source is shown verbatim as example code, and
 * their `meta` is the English text and the fallback for any missing entry here.
 */
import { lang } from './i18n';

interface DemoText { title: string; description: string }
type Entry = Record<'ko' | 'zh', DemoText>;

const DEMO_TEXT: Record<string, Entry> = {
  'animation/01-update': {
    ko: { title: '애니메이션 업데이트', description: '선택형 트윈: 진입 시 막대가 기준선에서 자라나고, 업데이트 시 보간됩니다(Rust에서 스테이징된 마크에만 적용).' },
    zh: { title: '动画更新', description: '可选补间：入场时柱子从基线生长，更新时进行插值（在 Rust 中计算，仅作用于已暂存的图元）。' },
  },
  'animation/02-enter': {
    ko: { title: '선 드러내기와 파이 진입', description: '선은 시저 사각형을 통해 왼쪽에서 오른쪽으로 드러납니다(지오메트리 변경 없음). 파이는 페이드와 확대로 나타납니다.' },
    zh: { title: '折线展开与饼图入场', description: '折线通过裁剪矩形从左到右展开（不改变几何数据）；饼图淡入并放大出现。' },
  },
  'bar/01-grouped-stacked': {
    ko: { title: '그룹형 · 누적형 · 백분율 막대', description: '다중 시리즈 막대: 레이아웃을 전환하고, 범례를 클릭하면 시리즈가 숨겨지며 엔진이 다시 누적합니다.' },
    zh: { title: '分组 · 堆叠 · 百分比柱状图', description: '多系列柱状图：切换布局；点击图例可隐藏系列，引擎会重新堆叠。' },
  },
  'bar/02-horizontal-labels': {
    ko: { title: '가로 막대, 데이터 레이블, 오차 막대', description: '레이블 배치와 충돌 검사는 Rust에서 실행되며, DOM은 텍스트만 배치합니다.' },
    zh: { title: '条形图、数据标签与误差线', description: '标签布局和碰撞检测在 Rust 中运行，DOM 只负责放置文本。' },
  },
  'bar/03-histogram': {
    ko: { title: '50만 샘플 히스토그램', description: 'Rust에서 O(n) 구간 분할(기본값: Freedman–Diaconis 규칙).' },
    zh: { title: '50 万样本直方图', description: '在 Rust 中进行 O(n) 分箱（默认采用 Freedman–Diaconis 规则）。' },
  },
  'bar/04-background': {
    ko: { title: '배경 트랙이 있는 막대', description: 'background: 값 축 전체 길이에 걸친 옅은 트랙을 막대마다 뒤에 그립니다(그룹형은 막대 칸마다, 누적형은 카테고리마다 하나).' },
    zh: { title: '带背景轨道的柱状图', description: 'background：在每根柱子后方绘制贯穿整个数值轴的浅色轨道（分组时每个柱位一条，堆叠时每个类别一条）。' },
  },
  'bar/05-label-rotation': {
    ko: { title: '라벨 회전', description: '막대 값은 막대 안에서 90° 회전하고, 긴 카테고리 이름은 x축에서 회전하며 회전된 크기 기준으로 솎아 냅니다.' },
    zh: { title: '标签旋转', description: '柱值在柱内旋转 90°；较长的类别名称在 x 轴上旋转，并按旋转后的占位进行抽稀。' },
  },
  'box/01-boxplot': {
    ko: { title: '상자 그림', description: 'Rust에서 정렬 없이 선택 알고리즘으로 사분위수를 구하고, Tukey 수염, 샘플링된 이상값, 평균 마커를 표시합니다.' },
    zh: { title: '箱线图', description: '在 Rust 中通过选择算法（无需排序）计算四分位数，并显示 Tukey 须线、抽样异常值和均值标记。' },
  },
  'box/02-violin': {
    ko: { title: '바이올린 플롯', description: '구간화된 가우시안 KDE(Silverman 대역폭)를 O(n + grid)로 계산하고 내부 상자를 함께 그립니다.' },
    zh: { title: '小提琴图', description: '以 O(n + grid) 计算分箱高斯 KDE（Silverman 带宽），并绘制内部箱体。' },
  },
  'business/01-radar': {
    ko: { title: '레이더', description: '포인터에 가장 가까운 축을 선택해 그 축의 모든 시리즈를 보여줍니다.' },
    zh: { title: '雷达图', description: '悬停时选取离指针最近的轴，并显示该轴上的所有系列。' },
  },
  'business/02-gauge': {
    ko: { title: '실시간 게이지', description: '상태 구간은 항상 색상과 아이콘, 레이블을 함께 사용합니다. setGaugeValue는 바늘만 다시 만듭니다.' },
    zh: { title: '实时仪表盘', description: '状态区间始终同时使用颜色、图标和标签。setGaugeValue 只重建指针。' },
  },
  'business/03-funnel': {
    ko: { title: '깔때기', description: '단계별 너비와 전환율(첫 단계 대비, 이전 단계 대비)을 Rust에서 계산합니다.' },
    zh: { title: '漏斗图', description: '各阶段宽度和转化率（相对首阶段与上一阶段）均在 Rust 中计算。' },
  },
  'business/04-waterfall': {
    ko: { title: '소계가 있는 폭포 차트', description: '누적 합계, 연결선, 부호가 있는 레이블. 증가와 감소를 빨강/초록 색상만으로 구분하지 않습니다.' },
    zh: { title: '含小计的瀑布图', description: '累计值、连接线和带符号标签；增减从不只依赖红/绿颜色区分。' },
  },
  'candlestick/01-ohlc': {
    ko: { title: '거래량이 있는 캔들스틱', description: '2년 치 일별 OHLC입니다. 축소하면 2 px보다 좁은 캔들을 Rust에서 픽셀 열 단위로 집계합니다.' },
    zh: { title: '带成交量的 K 线图', description: '两年的日线 OHLC 数据。缩小时，窄于 2 px 的 K 线会在 Rust 中按像素列聚合。' },
  },
  'candlestick/02-navigator': {
    ko: { title: '범위 내비게이터', description: '플롯 아래 띠에서 창이나 핸들을 드래그합니다. rangechange 이벤트가 보이는 x 범위를 알려줍니다.' },
    zh: { title: '范围导航器', description: '在绘图区下方的条带中拖动窗口或其手柄；rangechange 事件会报告可见的 x 范围。' },
  },
  'candlestick/03-ohlc-bars': {
    ko: { title: 'OHLC 막대 · 왼쪽 시가, 오른쪽 종가', description: '거래량이 있는 1분봉 50,000개입니다. 축소하면 OHLC를 집계하고, 호버하면 구간 값을 표시합니다. 드래그로 이동하거나 화살표 키를 사용합니다.' },
    zh: { title: 'OHLC 柱 · 左为开盘，右为收盘', description: '50,000 根带成交量的分钟柱。缩小以聚合 OHLC；悬停查看分桶数值，拖动平移，或使用方向键。' },
  },
  'combo/01-combo': {
    ko: { title: '막대 + 영역 + 선(오른쪽 축)', description: '시리즈가 하나의 x 매핑을 공유하므로 선의 점은 각 막대 칸의 가운데에 놓입니다. 툴팁 하나에 모든 시리즈를 표시합니다.' },
    zh: { title: '柱状 + 面积 + 折线（右轴）', description: '各系列共享同一 x 映射：折线点位于每个柱槽的中心。一个提示框显示所有系列。' },
  },
  'embeddings/01-similarity': {
    ko: { title: '1536차원 임베딩 → 3D, 코사인 k-NN', description: '문서 임베딩(합성 데이터, 주제 8개)을 Rust에서 3D로 투영하고 최근접 이웃과 연결합니다. 점을 클릭하면 원래 1536차원에서 정확한 코사인 유사도로 가장 비슷한 문서 5개를 계산합니다.' },
    zh: { title: '1536 维嵌入向量 → 3D 与余弦 k-NN', description: '文档嵌入向量（合成数据，8 个主题）在 Rust 中投影到 3D，并与最近邻相连。点击一个点：在原始 1536 维空间中以精确余弦相似度计算最相似的 5 个文档。' },
  },
  'embeddings/02-dimensions': {
    ko: { title: '어떤 차원이든: 128 → 3072', description: '흔히 쓰는 임베딩 크기에 같은 파이프라인을 적용합니다. 클러스터 id가 없으면 엔진이 원래 공간에서 구면 k-평균을 실행해 점에 색을 칠합니다. 상태 줄에 투영 + k-NN 시간이 표시됩니다.' },
    zh: { title: '任意维度：128 → 3072', description: '对常见嵌入维度使用同一流水线。未提供聚类 id 时，引擎会在原始空间中运行球面 k-means 为点着色；状态行显示投影 + k-NN 耗时。' },
  },
  'export/01-export': {
    ko: { title: '벡터 SVG, PDF, PNG 내보내기', description: 'exportChartSVG는 스테이징된 GPU 마크를 SVG 경로로, DOM 레이블을 <text>로 씁니다. 오른쪽: 내보낸 SVG.' },
    zh: { title: '矢量 SVG、PDF 和 PNG 导出', description: 'exportChartSVG 将已暂存的 GPU 图元写为 SVG 路径，并将 DOM 标签写为 <text>。右侧：导出的 SVG。' },
  },
  'graph/01-force-network': {
    ko: { title: '힘 기반 서비스 네트워크', description: 'Rust의 Barnes-Hut 힘 레이아웃(옥트리, O(n log n))입니다. 노드에 호버하면 메타데이터를, 클릭하면 1-hop 이웃을 강조하고, 더블클릭하면 초점을 맞춥니다. 드래그는 궤도 회전, Shift + 드래그는 이동, 휠은 확대/축소입니다.' },
    zh: { title: '力导向服务网络', description: 'Rust 中的 Barnes-Hut 力导向布局（八叉树，O(n log n)）。悬停节点查看元数据，单击高亮其 1 跳邻居，双击聚焦。拖动环绕旋转，Shift + 拖动平移，滚轮缩放。' },
  },
  'graph/02-layout-presets': {
    ko: { title: '레이아웃 프리셋', description: 'applyLayout은 모든 노드를 즉시 배치합니다(클러스터 구, 방사형 껍질, 나선, 3D 격자). "force"는 위치를 다시 시뮬레이션에 넘깁니다. 그래프는 내장 시드 생성기로 만듭니다.' },
    zh: { title: '布局预设', description: 'applyLayout 可立即放置所有节点（聚类球、径向壳层、螺旋、3D 网格）；"force" 将位置交还给模拟。图由内置的带种子生成器生成。' },
  },
  'graph/03-path-search': {
    ko: { title: '최단 경로 · 노드 검색', description: '노드 두 개를 클릭하면 그 사이의 최단 경로를 강조합니다(Rust의 BFS). 검색은 레이블, 카테고리, 태그를 대상으로 하며, 결과를 고르면 카메라가 그 노드에 초점을 맞춥니다.' },
    zh: { title: '最短路径 · 节点搜索', description: '点击两个节点高亮它们之间的最短路径（Rust 中的 BFS）。搜索匹配名称、类别和标签；选择结果后相机会聚焦到该节点。' },
  },
  'graph/04-graph-force-2d': {
    ko: { title: '2D 힘 기반 그래프', description: 'layout: force로 renderGraph를 호출하면 네트워크가 평면에서 자리 잡습니다(3D 그래프와 같은 Barnes-Hut 시뮬레이터). 범주가 노드 색과 범례를 정하며, 범례를 클릭하면 범주를 숨기고 호버하면 나머지가 흐려집니다. 노드에 호버하면 연결을 강조하고, 화살표 키로 노드를 순회합니다.' },
    zh: { title: '2D 力导向关系图', description: 'layout: force 让 renderGraph 在平面中完成网络布局（与 3D 关系图相同的 Barnes-Hut 模拟器）。类别决定节点颜色并生成图例：点击隐藏类别，悬停淡化其余类别。悬停节点高亮其连线；方向键遍历节点。' },
  },
  'graph/05-graph-circular': {
    ko: { title: '원형 그래프', description: 'layout: circular는 노드를 원 위에 두고 값에 비례해 구간을 나눕니다. rotateLabel은 레이블을 바깥쪽으로 돌립니다. 곡선 엣지는 출발 노드의 색을 따르고 화살표로 끝납니다.' },
    zh: { title: '环形关系图', description: 'layout: circular 将节点排列在圆环上，按值分配弧段；rotateLabel 让标签朝外旋转。曲线边使用源节点颜色并以箭头结尾。' },
  },
  'graph/06-graph-cartesian': {
    ko: { title: '직교 좌표축 위의 그래프', description: 'layout: cartesian은 각 노드를 차트 축의 x / y에 둡니다. x는 범주 축(분기), y는 격자선이 있는 값 축입니다. 화살표 링크는 어떤 프로젝트가 다음 프로젝트로 이어졌는지 보여 줍니다.' },
    zh: { title: '直角坐标系上的关系图', description: 'layout: cartesian 将每个节点放在图表坐标轴的 x / y 处：x 为类目轴（季度），y 为带网格线的数值轴。带箭头的连线表示哪个项目促成了下一个项目。' },
  },
  'heatmap/01-heatmap': {
    ko: { title: '색상 막대가 있는 히트맵', description: '값은 R32Float 텍스처로 한 번만 업로드합니다. 색상 스케일을 바꾸면 1 KB LUT만 다시 업로드합니다.' },
    zh: { title: '带色条的热力图', description: '数值以 R32Float 纹理一次性上传；切换色阶只需重新上传 1 KB 的 LUT。' },
  },
  'heatmap/02-calendar': {
    ko: { title: '캘린더 히트맵', description: '하루에 셀 하나, 레이아웃은 Rust에서 계산합니다. 두 해를 위아래로 쌓고 월요일부터 시작합니다. 마우스를 올리거나 화살표 키로 날짜를 읽고, 데이터가 없는 날은 중립색으로 남습니다.' },
    zh: { title: '日历热力图', description: '每天一个单元格，布局在 Rust 中计算；两年上下堆叠，周一为一周首日。悬停或使用方向键查看某天；无数据的日子保持中性色。' },
  },
  'hierarchy/01-treemap': {
    ko: { title: '드릴다운 트리맵', description: 'Squarified 레이아웃, 레이블, 히트 테스트를 Rust에서 처리합니다. 그룹을 클릭하면 들어가고, 이동 경로나 Escape로 올라갑니다.' },
    zh: { title: '可下钻的矩形树图', description: 'Squarified 布局、标签和命中检测均在 Rust 中完成。点击分组下钻，点击面包屑或按 Escape 返回上层。' },
  },
  'hierarchy/02-sunburst': {
    ko: { title: '평면 행으로 만든 선버스트', description: '{ id, parent, value } 행 데이터입니다. 호를 클릭하면 확대하고, 가운데를 클릭하면 올라갑니다.' },
    zh: { title: '由扁平行数据生成的旭日图', description: '{ id, parent, value } 行数据；点击扇弧放大，点击中心返回上层。' },
  },
  'hierarchy/03-sankey': {
    ko: { title: '생키 에너지 흐름', description: 'Rust에서 d3-sankey 방식 레이아웃(열 배정, 완화, 충돌 해소)을 계산합니다. 호버하면 연결된 흐름을 강조합니다.' },
    zh: { title: '桑基图能量流', description: '在 Rust 中实现 d3-sankey 风格布局（列分配、松弛、碰撞消解）；悬停高亮相连的流。' },
  },
  'hierarchy/04-sankey-vertical': {
    ko: { title: '그라데이션 링크와 단계 스타일의 세로 생키', description: 'orient: vertical은 흐름을 위에서 아래로 그립니다. 리본은 출발 색에서 도착 색으로 섞이고, levels가 열의 색과 링크 불투명도를 정합니다.' },
    zh: { title: '带渐变连线和层级样式的纵向桑基图', description: 'orient: vertical 让流向自上而下；连线由源节点颜色渐变到目标节点颜色；levels 设置各列的颜色和连线不透明度。' },
  },
  'hierarchy/05-tree': {
    ko: { title: '접고 펼치는 트리', description: 'Rust에서 d3 tree()와 같은 정돈된 트리 레이아웃을 계산합니다. 노드를 클릭하거나 Enter / Space를 누르면 펼치거나 접고, 트리는 트윈과 함께 다시 배치됩니다.' },
    zh: { title: '可折叠树图', description: '在 Rust 中计算与 d3 tree() 一致的整齐树布局。点击节点或按 Enter / 空格展开或折叠，树会带过渡动画重新布局。' },
  },
  'hierarchy/06-tree-radial': {
    ko: { title: '방사형 트리', description: 'layout: radial은 루트를 가운데, 말단을 바깥 원에 둡니다. 레이블은 바깥쪽으로 회전합니다. colorBy: group은 최상위 가지마다 색을 나눕니다.' },
    zh: { title: '径向树图', description: 'layout: radial 将根节点置于中心、叶节点置于外圈，标签向外旋转。colorBy: group 为每个顶层分支着色。' },
  },
  'line/01-million': {
    ko: { title: '100만 포인트 선', description: 'Rust의 픽셀 열 단위 M4 데시메이션으로 모든 스파이크를 유지합니다. 휠 = 확대/축소, 드래그 = 이동, 더블클릭 = 초기화.' },
    zh: { title: '100 万点折线图', description: 'Rust 中按像素列进行 M4 抽稀，保留每个尖峰。滚轮 = 缩放，拖动 = 平移，双击 = 重置。' },
  },
  'line/02-area-stacked': {
    ko: { title: '시간 축의 누적 영역', description: '에포크 ms x 값, 달력 눈금, 합계가 포함된 정렬 공유 툴팁. 범례 항목을 클릭하면 다시 누적합니다.' },
    zh: { title: '时间轴上的堆叠面积图', description: 'x 值为 Unix 毫秒时间戳，日历刻度，排序的共享提示框并显示合计。点击图例项可重新堆叠。' },
  },
  'line/03-styles': {
    ko: { title: '선 스타일, 마커, 밴드', description: '신뢰 구간 밴드가 있는 점선 단조 예측, 실측값 마커, 계단형 시리즈, 임계값 주석.' },
    zh: { title: '线型、标记与带状区域', description: '带置信带的虚线单调预测、实际值标记、阶梯系列和阈值标注。' },
  },
  'line/04-streaming': {
    ko: { title: '실시간 스트리밍', description: '50 ms마다 appendSeriesData를 호출해 시리즈당 4,000개 샘플의 슬라이딩 창을 유지합니다. y축은 보이는 창에 맞춰 자동으로 조정됩니다.' },
    zh: { title: '实时流式数据', description: '每 50 ms 调用 appendSeriesData，每个系列保留 4,000 个样本的滑动窗口；y 轴根据可见窗口自动缩放。' },
  },
  'line/05-streaming-area': {
    ko: { title: '원자적 영역 스트리밍', description: 'appendAreaData는 세 시리즈를 한 번에 추가합니다. FIFO는 시리즈당 600개 샘플을 유지합니다. 일시정지, 동작 줄이기, 숨겨진 탭, 화면 밖 차트에서는 시계가 멈춥니다.' },
    zh: { title: '原子化面积图流式更新', description: 'appendAreaData 一次性追加全部三个系列。FIFO 每个系列保留 600 个样本。暂停、减少动态效果、隐藏标签页和屏幕外图表都会停止计时。' },
  },
  'line/06-band': {
    ko: { title: '밴드 · 10만 쌍 샘플', description: '경계선 두 개가 있는 독립 범위 밴드입니다. LOD에서도 양쪽 가장자리의 극값이 유지되며, 빠진 쌍은 공백으로 남습니다. 휠로 확대/축소, 드래그로 이동하거나 화살표 키를 사용합니다.' },
    zh: { title: '带状图 · 100,000 对样本', description: '带两条边界线的独立范围带。LOD 下仍保留两侧边缘的极值；缺失的数据对留下空隙。滚轮缩放，拖动平移，或使用方向键。' },
  },
  'line/07-band-crossing': {
    ko: { title: '밴드 · 교차하는 곡선', description: '독립된 두 곡선은 순서가 바뀔 수 있습니다. 채우기는 교차점마다 나뉘며, 툴팁과 CSV는 원래 가장자리 값을 유지합니다. Shift-드래그로 범위를 선택합니다.' },
    zh: { title: '带状图 · 交叉曲线', description: '两条独立曲线可以交换上下顺序。填充在每个交点处分割；提示框和 CSV 保留原始边缘值。按住 Shift 拖动可选择范围。' },
  },
  'line/08-error-bars': {
    ko: { title: '오차 막대 · 측정 불확도', description: '비대칭 오차, 누락된 샘플, 한쪽 캡만 있는 경계를 가진 독립 수염입니다. 줄기나 캡에 호버하거나, 화살표 키를 쓰거나, Shift-드래그로 선택합니다.' },
    zh: { title: '误差线 · 测量不确定度', description: '具有非对称误差、缺失样本和单侧仅端帽边界的独立须线。悬停在线段或端帽上、使用方向键，或按住 Shift 拖动进行选择。' },
  },
  'line/09-error-horizontal': {
    ko: { title: '오차 막대 · 가로 구간', description: 'Y축에 카테고리를 두고 X축을 따라 절대 low/high 끝점을 표시합니다. 수염을 확대하면 중심이 뷰포트 밖에 있어도 계속 보이고 선택할 수 있습니다.' },
    zh: { title: '误差线 · 水平区间', description: 'Y 轴为类别，沿 X 轴给出绝对 low/high 端点。放大某条须线时，即使其中心位于视口之外，它仍可见且可拾取。' },
  },
  'line/10-impulse': {
    ko: { title: '임펄스 · 독립 이벤트 줄기', description: '사용자 지정 기준선에서 뻗는 양수, 음수, 길이 0인 줄기입니다. 끝 마커는 선택 사항이며, 선 데시메이션이나 이벤트 사이 연결은 없습니다.' },
    zh: { title: '脉冲图 · 独立事件线', description: '从自定义基线出发的正向、负向和零长度线段。端点标记可选；不进行折线抽稀，事件之间也不相连。' },
  },
  'line/11-legend-paged': {
    ko: { title: '범례 위치와 페이지', description: 'legend.position은 범례를 원하는 쪽에 둡니다. 한 줄을 넘는 항목은 ‹ › 페이지로 넘깁니다(overflow: "wrap"은 기존 줄바꿈 유지).' },
    zh: { title: '图例位置与分页', description: 'legend.position 可将图例放在任意一侧；超出一行的条目通过 ‹ › 翻页（overflow: "wrap" 保留原来的换行方式）。' },
  },
  'line/12-pieces': {
    ko: { title: '구간별 색 (대기질)', description: 'pieces는 값 구간에 따라 선 색을 바꿉니다(ECharts visualMap pieces). 어떤 줌에서도 50 / 100 / 150 / 200 / 300을 지나는 지점에서 정확히 색이 바뀌고, 마커와 툴팁 견본도 따라갑니다.' },
    zh: { title: '分段着色（空气质量）', description: 'pieces 按数值区间为折线着色（ECharts visualMap pieces）：无论缩放到何种程度，都会在穿过 50 / 100 / 150 / 200 / 300 的位置准确变色，标记点和提示框色块随之变化。' },
  },
  'line/13-theme-river': {
    ko: { title: '테마 리버 (스트림 그래프)', description: '[날짜, 값, 이름] 행이 흔들림을 최소화한 기준선(d3 stackOffsetWiggle) 둘레의 스트림이 됩니다. 호버하면 그 날짜의 모든 스트림을 나열하고 포인터 아래 스트림을 강조합니다. 범례를 토글하면 기준선을 다시 계산합니다.' },
    zh: { title: '主题河流图（流图）', description: '[日期, 数值, 名称] 行围绕最小摆动基线（d3 stackOffsetWiggle）组成河流。悬停时列出该日期的所有河流并突出指针下的河流；切换图例会重新计算基线。' },
  },
  'pie/01-pie': {
    ko: { title: '바깥 레이블이 있는 파이', description: '정렬, 작은 조각을 "기타" 하나로 묶기, 각도, 지시선 배치를 Rust에서 계산합니다. 호버하면 조각이 튀어나옵니다.' },
    zh: { title: '带外部标签的饼图', description: '排序、将小扇区合并为"其他"、角度和引导线布局均在 Rust 中计算。悬停时扇区会向外拉出。' },
  },
  'pie/02-donut': {
    ko: { title: '가운데 합계가 있는 도넛', description: '가운데 레이블은 보이는 항목의 합계나 호버한 조각을 표시합니다. 범례를 클릭하면 조각이 숨겨집니다.' },
    zh: { title: '中心显示总计的环形图', description: '中心标签显示可见部分的总计或当前悬停的扇区。点击图例可隐藏扇区。' },
  },
  'pie/03-rose': {
    ko: { title: '나이팅게일 로즈', description: '각도는 같고 조각 넓이가 값에 비례합니다(r ∝ √값, 도넛 구멍 포함). 범례를 클릭하면 나머지 조각의 크기를 다시 맞춥니다.' },
    zh: { title: '南丁格尔玫瑰图', description: '各扇区角度相同，面积与数值成正比（r ∝ √数值，带环形内孔）。点击图例会重新缩放其余扇区。' },
  },
  'pie/04-half-donut': {
    ko: { title: '반 도넛', description: 'endAngle로 위쪽 절반만 그립니다. 차트가 반원에 맞춰 배치되어 카드를 채웁니다.' },
    zh: { title: '半环形图', description: 'endAngle 将绘制范围限制在上半部分；图表按半环取景，因而填满卡片。' },
  },
  'pie/05-rounded': {
    ko: { title: '조각 간격이 있는 둥근 도넛', description: 'padAngle은 조각 사이에 각도 간격을 두고, cornerRadius는 모든 모서리를 CSS px 단위로 둥글게 합니다(얇은 조각에서는 모서리가 겹치지 않도록 줄어듭니다).' },
    zh: { title: '带间隔角的圆角环形图', description: 'padAngle 在扇区之间留出角度间隔；cornerRadius 以 CSS px 为单位圆化每个角（在细扇区上会自动缩小，避免圆角交叠）。' },
  },
  'pie/06-nested': {
    ko: { title: '중첩 링', description: '독립된 링 두 개: 퍼센트, 접기, 라벨을 링마다 계산합니다. "Direct"는 두 링에 모두 있어 색과 범례 항목을 하나로 공유합니다.' },
    zh: { title: '嵌套环', description: '两个独立的环：百分比、折叠和标签按环分别计算。"Direct" 同时出现在两个环中，因此共享同一颜色和图例项。' },
  },
  'react/01-react': {
    ko: { title: 'React <CharturboChart>', description: 'data / options는 참조로 비교합니다. 메모이즈해 두면 값이 바뀔 때만 차트가 다시 렌더링됩니다.' },
    zh: { title: 'React <CharturboChart>', description: 'data / options 按引用比较：对其进行记忆化，图表仅在它们变化时重新渲染。' },
  },
  'scatter/01-brush': {
    ko: { title: '브러시 선택이 가능한 6만 포인트 산점도', description: '사각형을 드래그해 선택합니다(Alt + 드래그로 이동, 휠로 x/y 확대/축소). 선택 질의는 엔진의 공간 해시에서 실행됩니다.' },
    zh: { title: '支持框选的 6 万点散点图', description: '拖动矩形进行选择（Alt + 拖动平移，滚轮缩放 x/y）。选择查询在引擎的空间哈希上运行。' },
  },
  'scatter/02-bubble': {
    ko: { title: '버블 차트', description: '포인트별 반지름(CSS px)과 배경색 테두리, 로그 x축.' },
    zh: { title: '气泡图', description: '逐点半径（CSS px），带背景色描边环；x 轴为对数刻度。' },
  },
  'scatter/03-symbols': {
    ko: { title: '시리즈별 심볼', description: 'seriesSymbols: 원, 사각형, 마름모, 삼각형 점(셰이더 signed distance, 안티에일리어싱). 범례 견본도 같은 모양을 씁니다.' },
    zh: { title: '按系列设置标记形状', description: 'seriesSymbols：圆形、方形、菱形和三角形数据点（着色器有向距离，抗锯齿）；图例色块随之变化。' },
  },
  'scatter/04-ripple': {
    ko: { title: '파동 강조', description: '한 시리즈에 ripple(ECharts effectScatter): 점 셰이더에서 고리가 커지며 사라집니다. 파동이 보일 때만 프레임 루프가 돌고, 동작 줄이기 설정에서는 멈춥니다.' },
    zh: { title: '涟漪高亮', description: '在一个系列上启用 ripple（ECharts effectScatter）：圆环在点着色器中扩散并淡出；仅在显示涟漪时运行帧循环（减少动态效果时保持静止）。' },
  },
  'scatter/05-jitter': {
    ko: { title: '지터 스트립 플롯', description: 'jitter는 x가 같은 점을 흩뜨립니다(ggplot2 geom_jitter: 데이터 단위 균등 오프셋, 점마다 고정). 툴팁은 원래 값을 보여 줍니다.' },
    zh: { title: '抖动条带图', description: 'jitter 将 x 相同的点散开（ggplot2 geom_jitter：以数据单位的均匀偏移，每个点固定）；提示框仍显示原始数值。' },
  },
  'scatter/06-trendline': {
    ko: { title: '회귀 추세선', description: 'trendline은 시리즈마다 최소제곱으로 회귀하고(ECharts ecStat 선형 / 지수 / 로그 / 다항식) 보이는 x 범위에 그립니다. 범례에 수식과 R²가 표시되고, 줌·팬하면 곡선을 다시 그립니다.' },
    zh: { title: '回归趋势线', description: 'trendline 按最小二乘法逐系列拟合（ECharts ecStat 线性 / 指数 / 对数 / 多项式），并在可见 x 范围内绘制；图例显示方程和 R²。缩放和平移时重新绘制曲线。' },
  },
  'scene/01-rigid-bodies': {
    ko: { title: '레이캐스트 선택이 가능한 강체 낙하', description: '물체는 회전 없이 출발하지만, 중심에서 벗어난 충돌로 회전하고 마찰로 구가 구릅니다. 상자는 방향이 있는 접촉 매니폴드를, 원기둥은 상자 모양 충돌체를 사용합니다. 클릭해 선택합니다. 드래그는 궤도 회전, Shift + 드래그는 이동, 휠은 확대/축소입니다.' },
    zh: { title: '带射线拾取的刚体下落', description: '物体初始不旋转：偏心碰撞使其旋转，摩擦力让球体滚动。盒体使用有向接触流形；圆柱体使用盒形碰撞体。点击进行拾取。拖动环绕旋转，Shift + 拖动平移，滚轮缩放。' },
  },
  'scene/02-materials': {
    ko: { title: '재질 · 조명 · 사용자 정의 메시', description: '거친 표면에서 매끈한 표면(왼쪽 → 오른쪽), 유전체에서 금속(앞 → 뒤)으로 바뀌는 구, 발광 행, 사용자 정의 토러스 메시입니다. 점광원이 장면 주위를 돌며, 조명을 켜고 꺼서 비교할 수 있습니다.' },
    zh: { title: '材质 · 光照 · 自定义网格', description: '从粗糙到光滑（左 → 右）、从电介质到金属（前 → 后）的球体，一排自发光物体，以及自定义圆环网格。点光源绕场景旋转；可切换灯光进行对比。' },
  },
  'scientific3d/01-point-cloud': {
    ko: { title: 'PointCloud3D · 측정된 나선', description: '스칼라 색상과 고정 CSS 픽셀 지름을 가진 독립 XYZ 샘플 12,000개입니다. 드래그로 궤도 회전, 오른쪽 드래그로 이동, 휠로 확대/축소하며, 화살표 키로 원본 좌표를 탐색합니다.' },
    zh: { title: 'PointCloud3D · 测量螺旋线', description: '12,000 个独立 XYZ 样本，采用标量着色和固定的 CSS 像素直径。拖动环绕旋转，右键拖动平移，滚轮缩放；方向键浏览原始坐标。' },
  },
  'scientific3d/02-surface': {
    ko: { title: 'Surface3D · 구멍이 있는 높이 필드', description: '행 우선 XZ 격자 위의 Y-up 높이입니다. 빠진 정점은 해당 셀 전체를 제거합니다. 포인터 툴팁은 광선 교차점을, 키보드 탐색과 CSV는 원래 정점을 보고합니다.' },
    zh: { title: 'Surface3D · 带空洞的高度场', description: '行优先 XZ 网格上的 Y 向上高度。缺失顶点会移除整个单元格。指针提示框报告射线交点；键盘导航和 CSV 报告原始顶点。' },
  },
  'scientific3d/03-wireframe': {
    ko: { title: 'Surface3D · 와이어프레임', description: '높이에 따라 색이 입혀진 격자 모서리입니다. 호버하면 아래 격자 셀을 선택하고, 드래그하면 다른 각도에서 표면을 살펴볼 수 있습니다.' },
    zh: { title: 'Surface3D · 线框', description: '网格边按高度着色。悬停选中下方的网格单元；拖动可从其他角度查看曲面。' },
  },
  'scientific3d/04-streaming-cloud': {
    ko: { title: '스트리밍 XYZ · 제한된 스캔', description: 'appendPointCloud3D는 색상이 있는 XYZ 배치를 추가하고 최신 샘플 2,400개를 유지합니다. 궤도와 범례 상태는 업데이트 후에도 유지됩니다. 일시정지, 숨겨진 탭, 화면 밖 차트, 동작 줄이기에서는 시계가 멈춥니다.' },
    zh: { title: '流式 XYZ · 有界扫描', description: 'appendPointCloud3D 追加带颜色的 XYZ 批次，并保留最新的 2,400 个样本。每次更新后环绕视角和图例状态保持不变。暂停、隐藏标签页、屏幕外图表和减少动态效果都会停止计时。' },
  },
  'scientific3d/05-streaming-surface': {
    ko: { title: '스트리밍 표면 · 흐르는 필드', description: 'updateSurface3D는 열 우선 높이 띠를 추가합니다. 가장 오래된 열이 빠지고 xStart가 앞으로 이동하며, 49 × 33 창과 궤도는 고정됩니다. CSV와 툴팁은 이동하는 원본 X 좌표를 유지합니다.' },
    zh: { title: '流式曲面 · 滚动场', description: 'updateSurface3D 追加列优先的高度条带。最旧的一列被丢弃，xStart 向前推进，而 49 × 33 窗口和环绕视角保持不变。CSV 和提示框保留移动中的原始 X 坐标。' },
  },
  'scientific3d/06-axes-projection': {
    ko: { title: '축 · 데이터 종횡비 · 직교 투영', description: '120 × 40 × 20 측정 공간입니다. 동일한 데이터 단위와 정육면체 정규화, 원근 투영과 평행 투영을 비교합니다. 고정 도메인은 궤도 회전과 확대/축소 중에도 안정적으로 유지됩니다.' },
    zh: { title: '坐标轴 · 数据纵横比 · 正交投影', description: '120 × 40 × 20 的测量空间。对比等数据单位与立方体归一化，或透视投影与平行投影。固定的值域在环绕旋转和缩放时保持稳定。' },
  },
  'scientific3d/07-contours': {
    ko: { title: 'Surface3D · 움직이는 필드의 등고선', description: 'contours는 렌더링된 삼각형 위에서 고정된 yMin..yMax 도메인 안에 등치선 10개를 고르게 그립니다. updateSurface3D replaceY는 레벨, 구멍, 궤도를 유지하고 선은 새 높이를 따라갑니다. 능선 뒤의 선은 가려진 채로 남습니다.' },
    zh: { title: 'Surface3D · 动态场上的等值线', description: 'contours 在已渲染的三角形上，于固定的 yMin..yMax 值域内均匀绘制 10 条等值线。updateSurface3D replaceY 保持层级、空洞和环绕视角，线条随新高度更新。山脊后的线条保持隐藏。' },
  },
  'sparklines/01-grid': {
    ko: { title: 'GPU 장치 하나로 그리는 스파크라인 24개', description: 'CharturboDevice는 어댑터 / 장치 하나와 파이프라인 세트 하나를 공유합니다. 캔버스마다 장치를 요청하지 않으며 WebGL 컨텍스트 개수 제한도 없습니다.' },
    zh: { title: '一个 GPU 设备上的 24 个迷你图', description: 'CharturboDevice 共享一个适配器 / 设备和一套管线：无需为每个画布请求设备，也没有 WebGL 上下文数量限制。' },
  },
  'vue/01-vue': {
    ko: { title: 'Vue <CharturboChart>', description: 'shallowRef 데이터를 새 배열로 바꾸면 다시 렌더링됩니다. 테마 변경은 setTheme만 호출합니다.' },
    zh: { title: 'Vue <CharturboChart>', description: '将 shallowRef 数据替换为新数组即可重新渲染；主题变更只调用 setTheme。' },
  },
};

/** Title and description of a demo in the site language; the demo's English `meta` is the fallback. */
export function demoText(family: string, id: string, meta?: { title: string; description?: string }): DemoText {
  const text = lang === 'en' ? undefined : DEMO_TEXT[`${family}/${id}`]?.[lang];
  return text ?? { title: meta?.title ?? id, description: meta?.description ?? '' };
}
