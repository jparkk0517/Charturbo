import {
  BarChartItemDescriptor,
  EmbeddingProjectionMode,
  LineSeriesDescriptor,
  NodeDetails,
  NodeMetadata,
  RgbaTuple,
  Vec3Tuple,
  Charturbo,
} from '../sdk/charturbo';

export type ShowcaseExampleId =
  | 'line-chart-massive'
  | 'bar-chart-massive'
  | 'scatter-chart-massive'
  | 'embedding-galaxy'
  | 'cloud-topology'
  | 'global-backbone';

export interface ShowcaseAction {
  id: string;
  label: string;
  run: () => void;
}

export interface ShowcaseExampleMeta {
  id: ShowcaseExampleId;
  categoryGroup: '2d-chart' | '3d-viz';
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  statsLabel: string;
  codeSnippet: string;
}

/** Width of the floating inspector panel over the canvas' right edge (CSS px). */
const SHOWCASE_INSPECTOR_WIDTH = 330;

export const SHOWCASE_EXAMPLES: ShowcaseExampleMeta[] = [
  {
    id: 'line-chart-massive',
    categoryGroup: '2d-chart',
    badge: '2D High-Volume Line',
    title: '📈 대용량 시계열 선 그래프 (최대 50,000 포인트)',
    subtitle: 'Multi-Series Time-Series · Zero-Lag WebGPU Line & Point Instancing',
    description:
      '일반 DOM/Canvas2D 차트에서 수만 개 포인트를 그리면 프레임 드랍이 발생하지만, Charturbo는 WebGPU 인스턴싱과 O(log N) Octree 인덱싱으로 20,000~50,000개 시계열 포인트를 60FPS로 렌더링하고 마우스 오버 시 즉시 개별 시점 데이터를 조회합니다.',
    statsLabel: '20,000 ~ 50,000 Points · 60 FPS',
    codeSnippet: `// 1. 수만 개 시계열 데이터를 단일 WebGPU 패스로 렌더링
sdk.renderLineChart(
  [
    { name: 'AI-Cluster-Throughput', values: seriesA_Float32, color: [0.22, 0.78, 0.98, 1] },
    { name: 'Memory-Bandwidth-GBs', values: seriesB_Float32, color: [0.22, 0.92, 0.62, 1] },
    { name: 'Net-Ingress-Mpps',     values: seriesC_Float32, color: [0.98, 0.45, 0.68, 1] },
    { name: 'P99-Latency-Index',    values: seriesD_Float32, color: [0.98, 0.78, 0.22, 1] },
  ],
  { viewMode: '2d', showBackdropGrid: true, xLabelPrefix: 'T', navigator: true }
);

// 2. 50,000개 포인트 중 마우스가 가리키는 시점 데이터를 O(log N)으로 즉시 조회
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: true,
  onNodeClick: (point) => renderInspector(point),
});`,
  },
  {
    id: 'bar-chart-massive',
    categoryGroup: '2d-chart',
    badge: '2D / 3D Bar & Histogram',
    title: '📊 대용량 막대그래프 & 분포 히스토그램 (2D ↔ 3D)',
    subtitle: 'GPU Instanced Bars · Distribution Histogram · 2D Flat & 3D Matrix View',
    description:
      '수백 개의 막대그래프(Bar)와 구간 분포 히스토그램을 WebGPU로 렌더링합니다. 깔끔한 2D 평면 막대 차트와 3D 입체 매트릭스 차트를 원클릭으로 전환할 수 있으며, 각 막대 상단 마커를 클릭해 정확한 수치와 점유율(%)을 확인할 수 있습니다.',
    statsLabel: '64 ~ 240 GPU Bars · 2D/3D Toggle',
    codeSnippet: `// 1. 2D 평면 막대그래프 또는 3D 매트릭스 막대 차트 렌더링
sdk.renderBarChart(barItems, {
  viewMode: '2d', // '2d' (평면 막대 차트) | '3d' (입체 매트릭스 차트)
  width: 164,
  maxBarHeight: 78,
});

// 2. 2D 정면 카메라 ↔ 3D 등각 카메라 즉시 전환
sdk.setChartViewMode('2d');`,
  },
  {
    id: 'scatter-chart-massive',
    categoryGroup: '2d-chart',
    badge: '2D Massive Scatter',
    title: '🫧 초대용량 2D 산점도 & 버블 차트 (30,000 포인트)',
    subtitle: '30,000 ~ 1,000,000 Points · GPU Instancing · X/Y Zoom · Grid-Hash Hover',
    description:
      '30,000개(최대 100만 개) 2D 산점도/버블 포인트를 GPU 인스턴싱으로 60FPS 표시합니다. 포인트는 한 번만 업로드되고 휠 줌·드래그 팬은 x/y 두 축을 함께 이동하며, Rust 균일 그리드 공간 해시로 가장 가까운 점을 즉시 찾아 툴팁을 띄웁니다. 범례로 세그먼트를 켜고 끌 수 있습니다.',
    statsLabel: '30,000 Points · Native Scatter',
    codeSnippet: `// 1. 30,000개 (X, Y, 반지름 px, 시리즈 id) 산점도 데이터 벌크 렌더링
sdk.renderScatterChart(
  { x: xFloat32, y: yFloat32, sizes: radiusPxFloat32, clusters: seriesUint16 },
  {
    title: '고객 세그먼트 분포',
    seriesNames: ['High-Value Loyal', 'AI Power Users' /* ... */],
    axes: { x: { title: '참여도' }, y: { title: '매출 지수' } },
    opacity: 0.8,
  }
);

// 2. 휠: x/y 줌 · 드래그: 팬 · 더블클릭: 리셋 · 범례 클릭: 세그먼트 토글
sdk.enableNodeInteractions(canvas);
sdk.zoomChartXY(0.35); // 프로그램으로 확대`,
  },
  {
    id: 'embedding-galaxy',
    categoryGroup: '3d-viz',
    badge: 'AI / High-Dim Vector DB',
    title: '🧠 고차원(128D~3072D) 임베딩 ➔ 3D 투영 & 코사인 검색',
    subtitle: 'Any Dimension (128D·768D·1024D·1536D·3072D) · Matrix-Free PCA + UMAP',
    description:
      '수백~수천 차원(128D, 384D, 768D, 1024D, 1536D, 3072D) 원본 임베딩 벡터 행렬(N×D)을 Rust WASM에서 직접 입력받아 Matrix-Free Power Iteration PCA와 코사인 k-NN Force 최적화로 3D 공간에 투영합니다. 노드를 클릭하면 원본 D차원 코사인 유사도 Top-K 문서를 즉시 계산합니다.',
    statsLabel: '128D ~ 3072D Live Projection · Exact Cosine Top-K',
    codeSnippet: `// 1. 어떤 차원(128D, 768D, 1024D, 1536D, 3072D...)이든 Float32Array(N × D) 그대로 입력!
const stats = sdk.loadEmbeddings(highDimFloat32, {
  dimensions: 1536,           // 64D ~ 4096D+ 어떤 차원 수든 지정 가능
  projection: 'pca-umap',     // 'pca-umap' | 'pca' | 'random-projection'
  kNeighbors: 5,              // D차원 코사인 유사도 상위 K개 이웃 자동 엣지 연결
  similarityThreshold: 0.45,
});

// 2. 3D 화면 거리가 아닌 '원본 D차원 벡터 내적' 기반 정확한 코사인 유사도 Top-K 검색
const topMatches = sdk.queryCosineSimilar(docId, 8);`,
  },
  {
    id: 'cloud-topology',
    categoryGroup: '3d-viz',
    badge: '3D Network & APM',
    title: '🌐 클라우드 마이크로서비스 토폴로지 & 장애 추적',
    subtitle: 'Ingress Gateway · Service Mesh · DB Shards · BFS Shortest Trace',
    description:
      '계층형 클라우드 아키텍처(Edge CDN → API Gateway → Microservices → Vector/Redis/Postgres Shards)의 트래픽과 지연시간을 3D로 시각화합니다. 노드를 클릭해 RPS·P99 지연시간을 확인하거나 게이트웨이에서 장애 노드까지의 최단 호출 경로(BFS)를 추적하세요.',
    statsLabel: '320 Services · 740 Edges · BFS Trace',
    codeSnippet: `// 1. 마이크로서비스 토폴로지 로드 & 메타데이터 바인딩
sdk.loadDataset({ positions, masses, colors, clusters, edges });
sdk.setNodeMetadata(serviceMetadataMap);

// 2. 게이트웨이(#0) ➔ 장애 노드(#87) 간 최단 호출 경로(BFS) 추적 및 하이라이트
const tracePath = sdk.highlightShortestPath(0, 87);`,
  },
  {
    id: 'global-backbone',
    categoryGroup: '3d-viz',
    badge: '3D Geo-Spatial Network',
    title: '🌍 글로벌 해저케이블 백본 & 저궤도 위성 통신망',
    subtitle: '3D Earth Sphere · Orbital Rings · Submarine Cable Routing',
    description:
      '3D 지구 구체와 궤도 링 위에 전 세계 24개 핵심 인터넷 익스체인지(IXP) 허브와 180개 저궤도(LEO) 위성을 구면 좌표계로 배치한 글로벌 통신망입니다. 대륙 간 최단 광케이블/위성 라우팅 경로를 탐색해 보세요.',
    statsLabel: '204 Global Hubs & Satellites · 3D Globe',
    codeSnippet: `// 1. 중심 지구본(Sphere)과 위성 궤도 토러스 링(CustomMesh) 생성
sdk.addSphere({ position: [0, 0, 0], scale: [86, 86, 86], color: [0.06, 0.19, 0.38, 1] });
const orbitRing = Charturbo.createTorusMesh(64, 0.45, 10, 56);
sdk.addCustomMesh({ ...orbitRing, rotation: [0.45, 0, 0.2] });

// 2. 위도·경도(Lat/Lon) ➔ 3D 구면 좌표 변환 후 대륙 간 최단 경로 탐색
sdk.highlightShortestPath(seoulHubId, frankfurtHubId);`,
  },
];

export class CharturboShowcaseController {
  private readonly sdk: Charturbo;
  private readonly canvas: HTMLCanvasElement;
  private readonly onSelectNode: (details: NodeDetails | null) => void;
  private readonly onStatusChange: (msg: string) => void;

  private active = false;
  private currentExample: ShowcaseExampleId = 'line-chart-massive';
  private rafId: number | null = null;
  private detachInteractions: (() => void) | null = null;

  // State for 2D / 3D examples
  private timeSec = 0;
  private simulateForce = false;
  private autoRotate = false;
  private is2DCameraMode = true;

  // Line chart state
  private linePointCount = 20000;
  private lineWidthPx = 2;
  private lineViewMode: '2d' | '2.5d' = '2d';
  private peakNodeId = 0;
  /** Live streaming demo: samples appended per series so far, and the y autoscale toggle */
  private lineStreaming = false;
  private lineStreamIndex = 0;
  private lineAutoY = false;

  // Bar chart state
  private barCount = 80;
  private barViewMode: '2d' | '3d' = '2d';
  private barDistribution: 'growth' | 'gaussian' | 'pareto' = 'growth';

  // Scatter chart state
  private scatterPointCount = 30000;
  /** Scatter brush selection mode (drag = box select) and its 'select' subscription */
  private scatterBrush = false;
  private stopBrushEvents: (() => void) | null = null;

  // Embedding state
  private embeddingDim = 1024;
  private embeddingProj: EmbeddingProjectionMode = 'pca-umap';

  // Global backbone rings
  private orbitRingIds: number[] = [];

  // Pointer camera state
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor(
    sdk: Charturbo,
    canvas: HTMLCanvasElement,
    onSelectNode: (details: NodeDetails | null) => void,
    onStatusChange: (msg: string) => void
  ) {
    this.sdk = sdk;
    this.canvas = canvas;
    this.onSelectNode = onSelectNode;
    this.onStatusChange = onStatusChange;
    this.bindCanvasCameraControls();
    this.bindSidebarDOM();
  }

  isActive(): boolean {
    return this.active;
  }

  getCurrentExample(): ShowcaseExampleId {
    return this.currentExample;
  }

  activate(initialExample?: ShowcaseExampleId): void {
    this.active = true;
    if (initialExample) {
      this.currentExample = initialExample;
    }

    if (!this.detachInteractions) {
      this.detachInteractions = this.sdk.enableNodeInteractions(this.canvas, {
        builtInTooltip: true,
        highlightNeighborsOnClick: 1,
        focusOnDoubleClick: true,
        autoRender: false,
        onNodeClick: (details) => {
          if (!this.active) return;
          if (details) {
            this.onStatusChange(
              `🔍 [${details.label}] 선택됨 — 우측 데이터 인스펙터에서 상세 수치와 속성을 확인하세요`
            );
            this.onSelectNode(details);
          } else {
            this.sdk.clearSelection();
            this.onSelectNode(null);
          }
        },
      });
    }

    this.loadExample(this.currentExample);
    this.startLoop();
  }

  deactivate(): void {
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.detachInteractions) {
      this.detachInteractions();
      this.detachInteractions = null;
    }
    this.setScatterBrush(false);
    this.sdk.clearScene();
    this.sdk.setHelpers({ showGrid: false, showAxes: false });
    this.sdk.setGraphVisible(true);
  }

  loadExample(id: ShowcaseExampleId): void {
    this.currentExample = id;
    this.timeSec = 0;
    this.simulateForce = false;
    this.orbitRingIds = [];
    this.setScatterBrush(false);
    this.sdk.clearScene();
    this.sdk.clearSelection();
    this.sdk.setGraphVisible(true);
    this.onSelectNode(null);

    const meta = SHOWCASE_EXAMPLES.find((m) => m.id === id);
    const is2DDefault = meta?.categoryGroup === '2d-chart';
    this.is2DCameraMode = is2DDefault;
    this.autoRotate = !is2DDefault;

    const autoRotCheck = document.getElementById('showcase-auto-rotate') as HTMLInputElement | null;
    if (autoRotCheck) {
      autoRotCheck.checked = this.autoRotate;
    }

    switch (id) {
      case 'line-chart-massive':
        this.buildMassiveLineChartExample();
        break;
      case 'bar-chart-massive':
        this.buildMassiveBarChartExample();
        break;
      case 'scatter-chart-massive':
        this.buildMassiveScatterChartExample();
        break;
      case 'embedding-galaxy':
        this.buildEmbeddingGalaxyExample();
        break;
      case 'cloud-topology':
        this.buildCloudTopologyExample();
        break;
      case 'global-backbone':
        this.buildGlobalBackboneExample();
        break;
    }

    this.updateSidebarUI();
    this.sdk.render();

    const firstNode = this.sdk.getNodeDetails(0);
    if (firstNode) {
      this.onSelectNode(firstNode);
    }
  }

  // ===========================================================================
  // 1. 📈 대용량 시계열 선 그래프 (20,000 ~ 50,000 포인트 멀티 시리즈 Line Chart)
  // ===========================================================================
  private buildMassiveLineChartExample(
    totalPoints = this.linePointCount,
    viewMode: '2d' | '2.5d' = this.lineViewMode
  ): void {
    this.linePointCount = totalPoints;
    this.lineViewMode = viewMode;
    this.is2DCameraMode = viewMode === '2d';
    this.lineStreaming = false;

    const seriesCount = 4;
    const pointsPerSeries = Math.floor(totalPoints / seriesCount);
    const seriesNames = [
      'AI-Inference-RPS',
      'GPU-Memory-Bandwidth-GBs',
      'Network-Ingress-Mpps',
      'Cache-Hit-Ratio-Index',
    ];

    const seriesList: LineSeriesDescriptor[] = [];
    let bestVal = -Infinity;
    let bestGlobalIdx = 0;

    for (let s = 0; s < seriesCount; s++) {
      const vals = new Float32Array(pointsPerSeries);
      let acc = 100 + s * 35;
      const freq1 = 0.0045 * (s + 1);
      const freq2 = 0.028 * (4 - s);

      for (let i = 0; i < pointsPerSeries; i++) {
        // Deterministic multi-frequency time-series + occasional traffic spike
        const wave =
          Math.sin(i * freq1) * 28 +
          Math.cos(i * freq2 + s) * 14 +
          Math.sin(i * 0.13 + s * 2) * 5.5;
        const spike =
          s === 0 && Math.abs(i - Math.floor(pointsPerSeries * 0.68)) < 12
            ? 85 * Math.exp(-Math.pow((i - Math.floor(pointsPerSeries * 0.68)) / 5, 2))
            : 0;
        acc = acc * 0.985 + (110 + s * 28 + wave + spike) * 0.015;
        const v = acc + wave * 0.65 + spike;
        vals[i] = v;

        if (v > bestVal) {
          bestVal = v;
          bestGlobalIdx = s * pointsPerSeries + i;
        }
      }

      seriesList.push({
        name: seriesNames[s],
        values: vals,
      });
    }

    this.peakNodeId = bestGlobalIdx;
    this.lineStreamIndex = pointsPerSeries;
    const t0 = performance.now();
    const res = this.sdk.renderLineChart(seriesList, {
      width: 172,
      height: 88,
      viewMode,
      showBackdropGrid: true,
      xLabelPrefix: 'T',
      lineWidth: this.lineWidthPx,
      title: '실시간 인프라 텔레메트리',
      axes: { x: { title: '샘플 (T+n)' }, y: { title: '처리량', autoscale: this.lineAutoY ? 'visible' : 'all' } },
      // Keep the plot clear of the inspector panel on the right
      padding: { right: SHOWCASE_INSPECTOR_WIDTH },
      // Range selector strip under the plot (2D): drag / resize the zoom window over all data
      navigator: viewMode === '2d',
    });
    // SLO threshold line + incident window around the traffic spike (data units: y, sample index)
    const spikeAt = Math.floor(pointsPerSeries * 0.68);
    const halfWindow = Math.max(12, Math.round(pointsPerSeries * 0.012));
    const sloY = Math.round((bestVal * 0.82) / 10) * 10;
    this.sdk.setAnnotations([
      {
        type: 'xband',
        from: spikeAt - halfWindow,
        to: spikeAt + halfWindow,
        color: [0.94, 0.35, 0.33, 1],
        opacity: 0.16,
        label: '장애 구간',
        labelPosition: 'end',
      },
      {
        type: 'hline',
        y: sloY,
        color: [0.94, 0.35, 0.33, 0.9],
        width: 1.5,
        dash: 6,
        label: `SLO ${sloY}`,
        z: 'above',
      },
    ]);
    const elapsed = performance.now() - t0;

    this.onStatusChange(
      `📈 [대용량 선 그래프 렌더링 완료] ${res.totalPoints.toLocaleString()}개 시계열 포인트 (${res.seriesCount}개 시리즈 · ${viewMode.toUpperCase()}) — ${elapsed.toFixed(1)}ms`
    );
  }

  // ===========================================================================
  // 2. 📊 대용량 막대그래프 & 분포 히스토그램 (2D 평면 ↔ 3D 입체 매트릭스)
  // ===========================================================================
  private buildMassiveBarChartExample(
    barCount = this.barCount,
    viewMode: '2d' | '3d' = this.barViewMode,
    dist: 'growth' | 'gaussian' | 'pareto' = this.barDistribution
  ): void {
    this.barCount = barCount;
    this.barViewMode = viewMode;
    this.barDistribution = dist;
    this.is2DCameraMode = viewMode === '2d';

    const items: BarChartItemDescriptor[] = [];
    const sectors = ['AI Cloud', 'Vector DB', 'Edge CDN', 'ZeroTrust', 'FinTech', 'BioMed', 'Robotics', ' Commerce'];

    for (let i = 0; i < barCount; i++) {
      const t = i / Math.max(1, barCount - 1);
      let val = 10;
      if (dist === 'growth') {
        val = 18 + t * 95 + Math.sin(i * 0.45) * 18 + (i % 7 === 0 ? 28 : 0);
      } else if (dist === 'gaussian') {
        const z = (t - 0.5) * 5.2;
        val = 8 + 135 * Math.exp(-0.5 * z * z) + Math.cos(i * 0.8) * 6;
      } else {
        // Pareto power-law distribution
        val = 14 + 145 * Math.pow(1 - t * 0.88, 2.6) + (i % 5) * 3;
      }

      const sector = sectors[i % sectors.length];
      items.push({
        label: `Bin-${String(i + 1).padStart(3, '0')} (${sector})`,
        value: val,
        category: `${sector} · ${dist.toUpperCase()}`,
        attributes: {
          bucketIndex: `#${i + 1} / ${barCount}`,
          distribution: dist.toUpperCase(),
          yoyDelta: `${val > 75 ? '+' : ''}${(val * 0.42 - 12).toFixed(1)}%`,
        },
      });
    }

    const t0 = performance.now();
    this.sdk.renderBarChart(items, {
      viewMode,
      width: 168,
      maxBarHeight: 78,
      title: `구간별 처리량 분포 (${dist.toUpperCase()})`,
      axes: { y: { title: '처리량' } },
      padding: { right: SHOWCASE_INSPECTOR_WIDTH },
    });
    const elapsed = performance.now() - t0;

    this.onStatusChange(
      `📊 [대용량 막대 차트 완료] ${barCount}개 막대 (${viewMode.toUpperCase()} 뷰 · ${dist.toUpperCase()} 분포) — ${elapsed.toFixed(1)}ms`
    );
  }

  // ===========================================================================
  // 3. 🫧 초대용량 2D 산점도 & 버블 차트 (30,000 포인트 Scatter / Bubble Plot)
  // ===========================================================================
  /** Toggles scatter brush selection (`'xy'`) and reports each selection in the status bar. */
  private setScatterBrush(on: boolean): void {
    this.stopBrushEvents?.();
    this.stopBrushEvents = null;
    if (!on && this.scatterBrush) this.sdk.clearChartSelection();
    this.scatterBrush = on;
    this.sdk.setChartBrush(on ? 'xy' : false);
    if (!on) return;
    this.stopBrushEvents = this.sdk.on('select', (sel) => {
      if (!sel.xRange) {
        this.onStatusChange('🖌️ 브러시 선택 해제');
        return;
      }
      const f = (v: number) => v.toFixed(1);
      const y = sel.yRange ? ` · y ${f(sel.yRange[0])} ~ ${f(sel.yRange[1])}` : '';
      this.onStatusChange(
        `🖌️ [브러시 선택] ${sel.count.toLocaleString()}개 포인트 — x ${f(sel.xRange[0])} ~ ${f(sel.xRange[1])}${y}`
      );
    });
  }

  private buildMassiveScatterChartExample(pointCount = this.scatterPointCount): void {
    this.scatterPointCount = pointCount;
    this.is2DCameraMode = true;

    const xArr = new Float32Array(pointCount);
    const yArr = new Float32Array(pointCount);
    const sizes = new Float32Array(pointCount);
    const clusters = new Uint16Array(pointCount);
    const metaMap = new Map<number, NodeMetadata>();

    const centers = [
      [-45, 22],
      [42, 26],
      [-38, -24],
      [44, -22],
      [0, 32],
      [0, -30],
      [-18, 0],
      [20, 2],
    ];
    const groupNames = [
      'High-Value Loyal',
      'AI Power Users',
      'Enterprise Tier',
      'Fast-Growing SMB',
      'Cloud Native Dev',
      'Dormant Accounts',
      'New Signups',
      'Anomaly / Fraud Risk',
    ];

    let seed = 1337;
    const nextRand = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };

    for (let i = 0; i < pointCount; i++) {
      const c = i % 8;
      const [cx, cy] = centers[c];
      // Box-Muller-like radial spread
      const r = Math.pow(nextRand(), 0.65) * 24;
      const theta = nextRand() * Math.PI * 2;
      const px = cx + Math.cos(theta) * r;
      const py = cy + Math.sin(theta) * r * 0.82;

      xArr[i] = px;
      yArr[i] = py;
      clusters[i] = c;
      // Radius in CSS px: every 29th point is a bubble
      sizes[i] = i % 29 === 0 ? 6 : pointCount > 100000 ? 1.5 : 2.5;

      if (i < 2500) {
        metaMap.set(i, {
          label: `Sample-${String(i).padStart(5, '0')}`,
          category: groupNames[c],
          description: `${pointCount.toLocaleString()}개 산점도 분포 중 '${groupNames[c]}' 세그먼트에 속하는 데이터 포인트입니다.`,
          tags: ['scatter-plot', groupNames[c].toLowerCase()],
          attributes: {
            segment: groupNames[c],
            coordXY: `(${px.toFixed(1)}, ${py.toFixed(1)})`,
            anomalyScore: Number((r / 24).toFixed(3)),
          },
        });
      }
    }

    const t0 = performance.now();
    this.sdk.renderScatterChart(
      { x: xArr, y: yArr, sizes, clusters },
      {
        width: 168,
        height: 94,
        title: `고객 세그먼트 분포 (${pointCount.toLocaleString()} points)`,
        seriesNames: groupNames,
        axes: { x: { title: '참여도 (Engagement)' }, y: { title: '매출 지수 (Revenue Index)' } },
        opacity: pointCount > 100000 ? 0.55 : 0.8,
        padding: { right: SHOWCASE_INSPECTOR_WIDTH },
      }
    );
    this.sdk.setNodeMetadata(metaMap);
    const elapsed = performance.now() - t0;

    this.onStatusChange(
      `🫧 [초대용량 산점도 완료] ${pointCount.toLocaleString()}개 포인트 (2D) — ${elapsed.toFixed(1)}ms`
    );
  }

  // ===========================================================================
  // 4. 🧠 고차원(128D~3072D) 임베딩 ➔ 3D 실시간 투영 & 코사인 검색
  // ===========================================================================
  private buildEmbeddingGalaxyExample(
    dim = this.embeddingDim,
    proj: EmbeddingProjectionMode = this.embeddingProj
  ): void {
    this.embeddingDim = dim;
    this.embeddingProj = proj;
    this.is2DCameraMode = false;
    this.sdk.clearScene();

    const N = dim >= 1536 ? 480 : 720;
    const C = 8;
    const metaMap = new Map<number, NodeMetadata>();

    const topics = [
      'AI & LLM Architecture',
      'Quantitative Finance',
      'Genomics & BioMed',
      'Rust & Systems Kernel',
      'Cybersecurity & ZeroTrust',
      'Quantum Physics',
      'Cloud Native & WebGPU',
      'Legal & Patent Corpus',
    ];

    const sampleKeywords = [
      'Transformer Attention',
      'Black-Scholes Option',
      'CRISPR-Cas9 Folding',
      'WebGPU WGSL Shader',
      'Zero-Trust mTLS',
      'Superconducting Qubit',
      'Barnes-Hut Octree',
      'Antitrust Compliance',
    ];

    const { vectors, clusters } = Charturbo.generateSyntheticHighDimEmbeddings(N, dim, C, 42 + dim);

    const stats = this.sdk.loadEmbeddings(vectors, {
      dimensions: dim,
      projection: proj,
      kNeighbors: 4,
      similarityThreshold: 0.45,
      clusters,
      umapWarmupTicks: 32,
      spaceRadius: 85,
    });

    for (let i = 0; i < N; i++) {
      const c = clusters[i];
      const topicName = topics[c % topics.length];
      const kw = sampleKeywords[c % sampleKeywords.length];
      const v0 = vectors[i * dim].toFixed(3);
      const v1 = vectors[i * dim + 1].toFixed(3);
      const v2 = vectors[i * dim + 2].toFixed(3);

      metaMap.set(i, {
        label: i < C ? `[Centroid] ${topicName}` : `Doc-${String(i).padStart(4, '0')} (${kw})`,
        category: `${topicName} (${dim}D)`,
        description: `원본 ${dim.toLocaleString()}차원 임베딩 벡터 [${v0}, ${v1}, ${v2}, ...]를 Rust WASM (${proj.toUpperCase()})으로 3D 공간에 투영한 문서 노드입니다.`,
        tags: [topicName.toLowerCase(), kw.toLowerCase(), `${dim}d`],
        attributes: {
          originalDim: `${dim}D Vector`,
          projection: proj.toUpperCase(),
          vecSample: `[${v0}, ${v1}, …]`,
          projTimeMs: `${stats.elapsedMs.toFixed(1)} ms`,
        },
      });
    }

    this.sdk.setNodeMetadata(metaMap);
    this.sdk.setHelpers({ showGrid: false, showAxes: true, axesLength: 85 });
    this.sdk.setCameraPose([0, 52, 160], [0, 0, 0]);
    this.onStatusChange(
      `🧠 [${dim}차원 임베딩 ➔ 3D 투영 완료] ${N}개×${dim}D 벡터 (${proj.toUpperCase()}) · ${stats.edgeCount}개 코사인 k-NN 엣지 생성 (${stats.elapsedMs.toFixed(1)}ms)`
    );
  }

  // ===========================================================================
  // 5. 🌐 클라우드 마이크로서비스 토폴로지 & 장애 추적
  // ===========================================================================
  private buildCloudTopologyExample(): void {
    this.is2DCameraMode = false;
    const N = 320;
    const positions = new Float32Array(N * 3);
    const masses = new Float32Array(N);
    const colors = new Float32Array(N * 4);
    const clusters = new Uint16Array(N);
    const edgeList: number[] = [];
    const metaMap = new Map<number, NodeMetadata>();

    const tiers = [
      {
        name: 'Edge CDN / WAF',
        count: 16,
        radius: 18,
        y: 36,
        cluster: 0,
        color: [0.22, 0.78, 0.98, 1.0] as RgbaTuple,
        mass: 2.4,
      },
      {
        name: 'API Gateway',
        count: 24,
        radius: 34,
        y: 18,
        cluster: 1,
        color: [0.38, 0.92, 0.65, 1.0] as RgbaTuple,
        mass: 2.0,
      },
      {
        name: 'Core Microservice',
        count: 96,
        radius: 58,
        y: 0,
        cluster: 2,
        color: [0.65, 0.52, 0.98, 1.0] as RgbaTuple,
        mass: 1.4,
      },
      {
        name: 'Event Kafka / Queue',
        count: 64,
        radius: 52,
        y: -18,
        cluster: 3,
        color: [0.98, 0.75, 0.24, 1.0] as RgbaTuple,
        mass: 1.3,
      },
      {
        name: 'Storage & Vector DB Shard',
        count: 120,
        radius: 74,
        y: -36,
        cluster: 4,
        color: [0.98, 0.38, 0.52, 1.0] as RgbaTuple,
        mass: 1.1,
      },
    ];

    const tierRanges: Array<{ start: number; end: number }> = [];
    let idx = 0;
    const regions = ['ap-northeast-2 (Seoul)', 'us-east-1 (Virginia)', 'eu-central-1 (Frankfurt)', 'ap-northeast-1 (Tokyo)'];
    const svcNames = ['auth-svc', 'payment-engine', 'order-orchestrator', 'recommend-llm', 'inventory-core', 'billing-worker', 'search-indexer', 'fraud-detector'];

    for (const tier of tiers) {
      const start = idx;
      for (let i = 0; i < tier.count; i++) {
        const angle = (i / tier.count) * Math.PI * 2 + tier.cluster * 0.4;
        const rJitter = tier.radius + ((i * 13) % 9) - 4;
        const yJitter = tier.y + (((i * 7) % 7) - 3) * 1.4;
        positions[idx * 3] = Math.cos(angle) * rJitter;
        positions[idx * 3 + 1] = yJitter;
        positions[idx * 3 + 2] = Math.sin(angle) * rJitter;

        masses[idx] = tier.mass;
        clusters[idx] = tier.cluster;
        colors.set(tier.color, idx * 4);

        const region = regions[idx % regions.length];
        const isAnomalous = idx === 19 || idx === 87;
        if (isAnomalous) {
          colors.set([1.0, 0.18, 0.25, 1.0], idx * 4);
          masses[idx] = 2.8;
        }

        const label =
          tier.cluster === 2
            ? `${svcNames[i % svcNames.length]}-${String(i).padStart(2, '0')}`
            : `${tier.name.split(' ')[0].toLowerCase()}-node-${String(idx).padStart(3, '0')}`;

        metaMap.set(idx, {
          label,
          category: tier.name,
          description: isAnomalous
            ? `⚠️ [SLO 지연 경보] ${region} 리전에서 P99 응답 지연이 감지된 인스턴스입니다.`
            : `${region} 클러스터에서 정상 가동 중인 ${tier.name} 인스턴스입니다.`,
          tags: [tier.name.toLowerCase(), region.split(' ')[0], isAnomalous ? 'sla-warning' : 'healthy'],
          attributes: {
            region: region.split(' ')[0],
            status: isAnomalous ? '⚠️ Degraded' : '✅ Healthy',
            p99LatencyMs: isAnomalous ? 482.5 : Number((2.1 + ((idx * 19) % 35) * 0.4).toFixed(1)),
            trafficRps: 450 + ((idx * 173) % 6200),
            cpuLoad: `${isAnomalous ? 94 : 24 + ((idx * 11) % 55)}%`,
          },
        });
        idx++;
      }
      tierRanges.push({ start, end: idx });
    }

    for (let t = 0; t < tierRanges.length - 1; t++) {
      const upper = tierRanges[t];
      const lower = tierRanges[t + 1];
      const upperLen = upper.end - upper.start;
      const lowerLen = lower.end - lower.start;

      for (let i = 0; i < lowerLen; i++) {
        const child = lower.start + i;
        const p1 = upper.start + (i % upperLen);
        const p2 = upper.start + ((i * 3 + 1) % upperLen);
        edgeList.push(p1, child);
        if (p1 !== p2) edgeList.push(p2, child);
      }
    }

    this.sdk.loadDataset({
      positions,
      masses,
      colors,
      clusters,
      edges: new Uint32Array(edgeList),
    });
    this.sdk.setNodeMetadata(metaMap);
    this.sdk.setHelpers({ showGrid: true, gridSize: 220, gridDivisions: 22, showAxes: false });

    const coreId = this.sdk.addCylinder({
      name: 'Cloud-Core-Bus',
      position: [0, 0, 0],
      scale: [8, 76, 8],
      color: [0.12, 0.28, 0.48, 1.0],
      metallic: 0.7,
      roughness: 0.2,
      emissive: 0.25,
    });
    this.orbitRingIds.push(coreId);
    this.sdk.setCameraPose([0, 42, 148], [0, -2, 0]);
  }

  // ===========================================================================
  // 6. 🌍 글로벌 해저케이블 백본 & 저궤도 위성 통신망
  // ===========================================================================
  private buildGlobalBackboneExample(): void {
    this.is2DCameraMode = false;
    const hubs = [
      { name: 'ICN-Seoul', lat: 37.56, lon: 126.97, region: 'East Asia' },
      { name: 'NRT-Tokyo', lat: 35.67, lon: 139.65, region: 'East Asia' },
      { name: 'SIN-Singapore', lat: 1.35, lon: 103.82, region: 'SE Asia' },
      { name: 'HKG-HongKong', lat: 22.31, lon: 114.16, region: 'East Asia' },
      { name: 'SYD-Sydney', lat: -33.86, lon: 151.2, region: 'Oceania' },
      { name: 'BOM-Mumbai', lat: 19.07, lon: 72.87, region: 'South Asia' },
      { name: 'DXB-Dubai', lat: 25.2, lon: 55.27, region: 'Middle East' },
      { name: 'FRA-Frankfurt', lat: 50.11, lon: 8.68, region: 'Europe' },
      { name: 'LHR-London', lat: 51.5, lon: -0.12, region: 'Europe' },
      { name: 'AMS-Amsterdam', lat: 52.36, lon: 4.9, region: 'Europe' },
      { name: 'CDG-Paris', lat: 48.85, lon: 2.35, region: 'Europe' },
      { name: 'ARN-Stockholm', lat: 59.32, lon: 18.06, region: 'Europe' },
      { name: 'IAD-Virginia', lat: 38.9, lon: -77.03, region: 'North America' },
      { name: 'JFK-NewYork', lat: 40.71, lon: -74.0, region: 'North America' },
      { name: 'ORD-Chicago', lat: 41.87, lon: -87.62, region: 'North America' },
      { name: 'SJC-SiliconValley', lat: 37.33, lon: -121.88, region: 'North America' },
      { name: 'SEA-Seattle', lat: 47.6, lon: -122.33, region: 'North America' },
      { name: 'YYZ-Toronto', lat: 43.65, lon: -79.38, region: 'North America' },
      { name: 'GRU-SaoPaulo', lat: -23.55, lon: -46.63, region: 'South America' },
      { name: 'SCL-Santiago', lat: -33.44, lon: -70.66, region: 'South America' },
      { name: 'JNB-Johannesburg', lat: -26.2, lon: 28.04, region: 'Africa' },
      { name: 'CAI-Cairo', lat: 30.04, lon: 31.23, region: 'Africa' },
      { name: 'LOS-Lagos', lat: 6.52, lon: 3.37, region: 'Africa' },
      { name: 'HNL-Honolulu', lat: 21.3, lon: -157.85, region: 'Pacific Hub' },
    ];

    const satCount = 180;
    const N = hubs.length + satCount;
    const positions = new Float32Array(N * 3);
    const masses = new Float32Array(N);
    const colors = new Float32Array(N * 4);
    const clusters = new Uint16Array(N);
    const edgeList: number[] = [];
    const metaMap = new Map<number, NodeMetadata>();

    const surfaceR = 46;
    const latLonToXYZ = (latDeg: number, lonDeg: number, r: number): Vec3Tuple => {
      const lat = (latDeg * Math.PI) / 180;
      const lon = (lonDeg * Math.PI) / 180;
      return [
        r * Math.cos(lat) * Math.sin(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.cos(lon),
      ];
    };

    for (let i = 0; i < hubs.length; i++) {
      const h = hubs[i];
      const [x, y, z] = latLonToXYZ(h.lat, h.lon, surfaceR);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      masses[i] = 2.6;
      clusters[i] = 0;
      colors.set([0.2, 0.95, 0.72, 1.0], i * 4);

      metaMap.set(i, {
        label: h.name,
        category: `Tier-1 IXP Hub (${h.region})`,
        description: `${h.region} 대륙 간 해저 광케이블 및 위성 게이트웨이 코어 허브입니다.`,
        tags: ['ixp-hub', h.region.toLowerCase(), h.name.toLowerCase()],
        attributes: {
          coordinates: `${h.lat.toFixed(1)}°, ${h.lon.toFixed(1)}°`,
          capacityTbps: 120 + (i % 7) * 40,
          activeCables: 4 + (i % 5),
          tier: 'Tier-1 Core',
        },
      });
    }

    const cablePairs = [
      [0, 1], [0, 3], [0, 2], [1, 15], [1, 16], [1, 23], [23, 15], [2, 3], [2, 4], [2, 5],
      [5, 6], [6, 7], [6, 21], [21, 7], [7, 8], [7, 9], [7, 10], [7, 11], [8, 12], [8, 13],
      [9, 13], [12, 13], [12, 14], [14, 15], [14, 16], [13, 17], [12, 18], [18, 19], [18, 22],
      [22, 8], [20, 22], [20, 5],
    ];
    for (const [u, v] of cablePairs) {
      edgeList.push(u, v);
    }

    for (let s = 0; s < satCount; s++) {
      const id = hubs.length + s;
      const orbitIdx = s % 3;
      const orbitR = 62 + orbitIdx * 8;
      const angle = (s / satCount) * Math.PI * 2 * 3;
      const tilt = 0.45 + orbitIdx * 0.35;

      const x = Math.cos(angle) * orbitR;
      const y = Math.sin(angle) * Math.sin(tilt) * orbitR;
      const z = Math.sin(angle) * Math.cos(tilt) * orbitR;

      positions[id * 3] = x;
      positions[id * 3 + 1] = y;
      positions[id * 3 + 2] = z;
      masses[id] = 1.05;
      clusters[id] = orbitIdx + 1;
      colors.set(
        orbitIdx === 0
          ? [0.35, 0.78, 0.98, 1.0]
          : orbitIdx === 1
            ? [0.75, 0.52, 0.98, 1.0]
            : [0.98, 0.78, 0.32, 1.0],
        id * 4
      );

      const linkedHub = s % hubs.length;
      edgeList.push(linkedHub, id);
      if (s >= 3) {
        edgeList.push(id - 3, id);
      }

      metaMap.set(id, {
        label: `LEO-Sat-${String(s + 1).padStart(3, '0')}`,
        category: `LEO Orbital Shell #${orbitIdx + 1}`,
        description: `고도 ${550 + orbitIdx * 120}km 궤도를 비행하며 지상 IXP 허브(${hubs[linkedHub].name})와 레이저 인터링크로 연결된 저궤도 통신 위성입니다.`,
        tags: ['leo-satellite', `shell-${orbitIdx + 1}`, hubs[linkedHub].name.toLowerCase()],
        attributes: {
          altitudeKm: `${550 + orbitIdx * 120} km`,
          laserLinkGbps: 40 + orbitIdx * 20,
          groundGateway: hubs[linkedHub].name,
          rttMs: Number((18.5 + (s % 12) * 1.4).toFixed(1)),
        },
      });
    }

    this.sdk.loadDataset({
      positions,
      masses,
      colors,
      clusters,
      edges: new Uint32Array(edgeList),
    });
    this.sdk.setNodeMetadata(metaMap);

    this.sdk.setHelpers({ showGrid: false, showAxes: false });
    this.sdk.addSphere({
      name: 'Earth-Core-Globe',
      position: [0, 0, 0],
      scale: [86, 86, 86],
      color: [0.06, 0.19, 0.38, 1.0],
      metallic: 0.3,
      roughness: 0.65,
      emissive: 0.08,
    });

    const ringMesh = Charturbo.createTorusMesh(64, 0.45, 10, 56);
    const ring1 = this.sdk.addCustomMesh({
      name: 'Orbital-Plane-Alpha',
      positions: ringMesh.positions,
      normals: ringMesh.normals,
      indices: ringMesh.indices,
      rotation: [0.45, 0, 0.2],
      color: [0.22, 0.68, 0.98, 1.0],
      emissive: 0.4,
    });
    const ring2 = this.sdk.addCustomMesh({
      name: 'Orbital-Plane-Beta',
      positions: ringMesh.positions,
      normals: ringMesh.normals,
      indices: ringMesh.indices,
      rotation: [-0.55, 0.3, -0.25],
      color: [0.68, 0.42, 0.98, 1.0],
      emissive: 0.35,
    });
    this.orbitRingIds.push(ring1, ring2);

    this.sdk.setCameraPose([0, 48, 165], [0, 0, 0]);
  }

  // ===========================================================================
  // Context-Specific Quick Actions per Example
  // ===========================================================================
  /** Dark <-> light chart theme (canvas, marks, labels, legend, tooltip). */
  private themeToggleAction(): ShowcaseAction {
    const next = this.sdk.getTheme().name === 'dark' ? 'light' : 'dark';
    return {
      id: 'theme-toggle',
      label: `🎨 차트 테마 전환 (현재 ${this.sdk.getTheme().name === 'dark' ? '다크' : '라이트'} ➔ ${next === 'dark' ? '다크' : '라이트'})`,
      run: () => {
        this.sdk.setTheme(next);
        this.updateSidebarUI();
      },
    };
  }

  /** Canvas + overlay (title, legend, axes) as a 2x PNG download (sdk.downloadImage). */
  private exportPngAction(): ShowcaseAction {
    return {
      id: 'export-png',
      label: '📷 PNG로 저장',
      run: () => {
        const name = `${this.currentExample}.png`;
        this.sdk
          .downloadImage(name, { pixelRatio: Math.max(2, window.devicePixelRatio || 1) })
          .then(() => this.onStatusChange(`📷 ${name} 저장 완료`))
          .catch((err: unknown) => this.onStatusChange(`📷 PNG 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
      },
    };
  }

  getActionsForCurrentExample(): ShowcaseAction[] {
    switch (this.currentExample) {
      case 'line-chart-massive':
        return [
          {
            id: 'scale-points',
            label: `⚡ 시계열 데이터 규모 변경 (현재 ${this.linePointCount.toLocaleString()}개 ➔ 10K / 20K / 50K 포인트)`,
            run: () => {
              const counts = [10000, 20000, 50000];
              const next = counts[(counts.indexOf(this.linePointCount) + 1) % counts.length];
              this.buildMassiveLineChartExample(next, this.lineViewMode);
              this.updateSidebarUI();
              this.onSelectNode(this.sdk.getNodeDetails(this.peakNodeId));
            },
          },
          this.themeToggleAction(),
          this.exportPngAction(),
          {
            id: 'line-width',
            label: `✏️ 선 두께 변경 (현재 ${this.lineWidthPx}px ➔ 1 / 2 / 3px)`,
            run: () => {
              const widths = [1, 2, 3];
              this.lineWidthPx = widths[(widths.indexOf(this.lineWidthPx) + 1) % widths.length];
              this.sdk.setLineWidth(this.lineWidthPx);
              this.updateSidebarUI();
            },
          },
          {
            id: 'toggle-25d',
            label: `📐 뷰 전환: ${this.lineViewMode === '2d' ? '2.5D 다층 리본 뷰로 보기' : '2D 정면 평면 차트로 보기'}`,
            run: () => {
              const nextMode = this.lineViewMode === '2d' ? '2.5d' : '2d';
              this.buildMassiveLineChartExample(this.linePointCount, nextMode);
              this.updateSidebarUI();
            },
          },
          {
            id: 'line-stream',
            label: this.lineStreaming
              ? '⏹️ 실시간 스트리밍 정지'
              : '▶️ 실시간 스트리밍 시작 (프레임당 200포인트 추가 · 슬라이딩 윈도우)',
            run: () => {
              this.lineStreaming = !this.lineStreaming;
              this.onStatusChange(
                this.lineStreaming
                  ? `▶️ [실시간 스트리밍] 시리즈당 ${Math.floor(this.linePointCount / 4).toLocaleString()}개 윈도우 유지 (maxPoints) — 확대 후 오른쪽 끝에 두면 최신 데이터를 따라갑니다`
                  : '⏹️ [실시간 스트리밍 정지]'
              );
              this.updateSidebarUI();
            },
          },
          {
            id: 'line-auto-y',
            label: `↕️ Y축 자동 맞춤 (보이는 구간 기준): ${this.lineAutoY ? '켜짐 ➔ 끄기' : '꺼짐 ➔ 켜기'}`,
            run: () => {
              this.lineAutoY = !this.lineAutoY;
              this.sdk.setYDomain({ autoscale: this.lineAutoY ? 'visible' : 'all' });
              this.onStatusChange(
                this.lineAutoY
                  ? '↕️ [Y축 자동 맞춤] 확대 / 이동한 구간의 데이터 범위에 맞춰 Y축이 조정됩니다'
                  : '↕️ [Y축 고정] 전체 데이터 범위 기준'
              );
              this.updateSidebarUI();
            },
          },
          {
            id: 'focus-peak',
            label: `🔍 전체 시리즈 최고점(Peak #${this.peakNodeId}) 스파이크 자동 탐지 & 포커스`,
            run: () => {
              // No selection highlight here: on a chart it would re-show the hidden data points
              this.sdk.focusNode(this.peakNodeId);
              const d = this.sdk.getNodeDetails(this.peakNodeId);
              this.onSelectNode(d);
              this.onStatusChange(
                `🔍 [피크 스파이크 탐지] ${d?.label ?? ''} (값: ${d?.metadata.attributes?.value ?? ''}) 포커스 완료`
              );
            },
          },
        ];

      case 'bar-chart-massive':
        return [
          this.themeToggleAction(),
          this.exportPngAction(),
          {
            id: 'bar-view-toggle',
            label: `📐 뷰 전환: ${this.barViewMode === '2d' ? '3D 입체 매트릭스 막대 차트로 전환' : '2D 평면 막대 차트로 전환'}`,
            run: () => {
              const nextMode = this.barViewMode === '2d' ? '3d' : '2d';
              const nextCount = nextMode === '3d' ? 64 : 120;
              this.buildMassiveBarChartExample(nextCount, nextMode, this.barDistribution);
              this.updateSidebarUI();
              this.onSelectNode(this.sdk.getNodeDetails(0));
            },
          },
          {
            id: 'bar-dist-cycle',
            label: `📊 데이터 분포 전환 (현재: ${this.barDistribution.toUpperCase()} ➔ 성장형 / 정규분포 / 파레토)`,
            run: () => {
              const dists: Array<'growth' | 'gaussian' | 'pareto'> = ['growth', 'gaussian', 'pareto'];
              const nextDist = dists[(dists.indexOf(this.barDistribution) + 1) % dists.length];
              this.buildMassiveBarChartExample(this.barCount, this.barViewMode, nextDist);
              this.updateSidebarUI();
              this.onSelectNode(this.sdk.getNodeDetails(Math.floor(this.barCount / 2)));
            },
          },
          {
            id: 'bar-count-cycle',
            label: `🔢 막대(Bin) 개수 변경 (현재 ${this.barCount}개 ➔ 64 / 120 / 240개)`,
            run: () => {
              const counts = [64, 120, 240];
              const nextCount = counts[(counts.indexOf(this.barCount) + 1) % counts.length];
              this.buildMassiveBarChartExample(nextCount, this.barViewMode, this.barDistribution);
              this.updateSidebarUI();
            },
          },
        ];

      case 'scatter-chart-massive':
        return [
          this.exportPngAction(),
          {
            id: 'scatter-zoom-roi',
            label: '🔍 중앙 관심 영역(ROI) x/y 확대 (zoomChartXY) · 더블클릭으로 리셋',
            run: () => {
              this.sdk.zoomChartXY(0.35, 0, 0);
              this.onStatusChange('🔍 [x/y 줌] 포인트 재업로드 없이 축 변환만 갱신 — 휠/드래그로 계속 탐색하세요');
            },
          },
          {
            id: 'scatter-brush',
            label: this.scatterBrush
              ? '🖌️ 브러시로 선택 끄기 (드래그 = 이동으로 복귀)'
              : '🖌️ 브러시로 선택 (드래그 = 사각형 선택 · Alt+드래그 이동 · Esc/클릭 해제)',
            run: () => {
              this.setScatterBrush(!this.scatterBrush);
              this.updateSidebarUI();
              this.onStatusChange(
                this.scatterBrush
                  ? '🖌️ [브러시] 드래그로 사각형을 그리면 안의 포인트가 강조됩니다 (공간 해시 질의)'
                  : '🖌️ 브러시 해제 — 드래그가 다시 x/y 이동으로 동작합니다'
              );
            },
          },
          {
            id: 'scatter-cluster-filter',
            label: '🎨 이상치 위험군 (Anomaly / Fraud Risk) 세그먼트만 표시 ↔ 전체',
            run: () => {
              const only = this.sdk.isSeriesVisible(0);
              for (let s = 0; s < 8; s++) this.sdk.setSeriesVisible(s, !only || s === 7);
              this.onStatusChange(
                only ? `🎨 'Anomaly / Fraud Risk' 세그먼트만 표시` : '🎨 전체 세그먼트 표시'
              );
            },
          },
          {
            id: 'scatter-count-toggle',
            label: `📈 포인트 수 전환: ${this.scatterPointCount > 100000 ? '1,000,000 ➔ 30,000' : '30,000 ➔ 1,000,000'}`,
            run: () => {
              this.buildMassiveScatterChartExample(this.scatterPointCount > 100000 ? 30000 : 1000000);
              this.updateSidebarUI();
            },
          },
        ];

      case 'embedding-galaxy':
        return [
          {
            id: 'dim-cycle',
            label: `📐 입력 임베딩 차원 변경 (현재 ${this.embeddingDim}D ➔ 128D / 384D / 768D / 1024D / 1536D / 3072D)`,
            run: () => {
              const dims = [128, 384, 768, 1024, 1536, 3072];
              const nextDim = dims[(dims.indexOf(this.embeddingDim) + 1) % dims.length];
              this.buildEmbeddingGalaxyExample(nextDim, this.embeddingProj);
              this.updateSidebarUI();
              this.onSelectNode(this.sdk.getNodeDetails(0));
            },
          },
          {
            id: 'proj-cycle',
            label: `🧭 3D 차원 축소 방식 전환 (현재: ${this.embeddingProj.toUpperCase()})`,
            run: () => {
              const modes: EmbeddingProjectionMode[] = ['pca-umap', 'pca', 'random-projection'];
              const nextProj = modes[(modes.indexOf(this.embeddingProj) + 1) % modes.length];
              this.buildEmbeddingGalaxyExample(this.embeddingDim, nextProj);
              this.updateSidebarUI();
              this.onSelectNode(this.sdk.getNodeDetails(0));
            },
          },
          {
            id: 'exact-cosine',
            label: `🔮 원본 ${this.embeddingDim}차원 내적 기반 코사인 유사도 Top-8 정밀 검색 (#0 기준)`,
            run: () => {
              const matches = this.sdk.queryCosineSimilar(0, 8);
              this.sdk.highlightNeighbors(0, 1);
              this.sdk.focusNode(0);
              this.onSelectNode(this.sdk.getNodeDetails(0));
              const summary = matches
                .slice(0, 4)
                .map((m) => `#${m.nodeId}(${m.cosineSimilarity.toFixed(3)})`)
                .join(', ');
              this.onStatusChange(
                `🔮 [${this.embeddingDim}D 원본 코사인 유사도 Top-K] #0 기준 최근접: ${summary}`
              );
            },
          },
        ];

      case 'cloud-topology':
        return [
          {
            id: 'trace-fault',
            label: '⚡ 게이트웨이(#0) ➔ 장애 노드(#87) 최단 호출 경로 추적',
            run: () => {
              const path = this.sdk.highlightShortestPath(0, 87);
              const details = this.sdk.getNodeDetails(87);
              if (details) this.onSelectNode(details);
              this.onStatusChange(
                `⚡ [장애 호출 경로 추적] #0 ➔ #87 (${path.length - 1} Hops: ${Array.from(path).join(' → ')})`
              );
            },
          },
          {
            id: 'filter-db',
            label: '🗄️ Storage & Vector DB 샤드 계층만 필터링',
            run: () => {
              const sel = this.sdk.selectCluster(4);
              this.onStatusChange(`🗄️ Storage & Vector DB 계층 (${sel.length}개 샤드) 필터링 완료`);
            },
          },
          {
            id: 'toggle-force',
            label: '🔥 물리 레이아웃(Force) 시뮬레이션 토글',
            run: () => {
              this.simulateForce = !this.simulateForce;
              this.onStatusChange(`물리 시뮬레이션 ${this.simulateForce ? '활성화' : '일시정지'}`);
            },
          },
        ];

      case 'global-backbone':
        return [
          {
            id: 'route-kr-eu',
            label: '⚡ 서울(ICN #0) ➔ 프랑크푸르트(FRA #7) 최단 광케이블 경로',
            run: () => {
              const path = this.sdk.highlightShortestPath(0, 7);
              const labels = Array.from(path).map((id) => this.sdk.getNodeMetadata(id).label ?? `#${id}`);
              this.onSelectNode(this.sdk.getNodeDetails(0));
              this.onStatusChange(`⚡ [글로벌 최단 라우팅] ${labels.join(' ➔ ')} (${path.length - 1} Hops)`);
            },
          },
          {
            id: 'route-us-br',
            label: '⚡ 실리콘밸리(SJC #15) ➔ 상파울루(GRU #18) 최단 경로',
            run: () => {
              const path = this.sdk.highlightShortestPath(15, 18);
              const labels = Array.from(path).map((id) => this.sdk.getNodeMetadata(id).label ?? `#${id}`);
              this.onSelectNode(this.sdk.getNodeDetails(15));
              this.onStatusChange(`⚡ [글로벌 최단 라우팅] ${labels.join(' ➔ ')} (${path.length - 1} Hops)`);
            },
          },
          {
            id: 'filter-ixp',
            label: '🌐 지상 Tier-1 IXP 코어 허브(24개)만 하이라이트',
            run: () => {
              const sel = this.sdk.selectCluster(0);
              this.onStatusChange(`🌐 전 세계 Tier-1 IXP 코어 허브 ${sel.length}개 선택됨`);
            },
          },
        ];
    }
  }

  // ===========================================================================
  // Render & Animation Loop
  // ===========================================================================
  private startLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    const tick = () => {
      if (!this.active) return;
      const dt = 0.016;
      this.timeSec += dt;

      if (this.autoRotate && !this.is2DCameraMode && !this.isDragging) {
        this.sdk.rotateCamera(0.0026, 0);
      }

      if (this.lineStreaming && this.currentExample === 'line-chart-massive') {
        this.appendLineStreamFrame();
      }

      if (this.simulateForce) {
        this.sdk.stepPhysics(dt);
      } else if (this.currentExample === 'global-backbone' && this.orbitRingIds.length >= 2) {
        this.sdk.setObjectTransform(this.orbitRingIds[0], {
          rotation: [0.45, this.timeSec * 0.25, 0.2],
        });
        this.sdk.setObjectTransform(this.orbitRingIds[1], {
          rotation: [-0.55, -this.timeSec * 0.2, -0.25],
        });
      }

      this.sdk.render();
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /** Appends 50 samples to each of the 4 series (200 / frame); maxPoints keeps the window size. */
  private appendLineStreamFrame(): void {
    const perSeries = 50;
    const maxPoints = Math.floor(this.linePointCount / 4);
    const start = this.lineStreamIndex;
    for (let s = 0; s < 4; s++) {
      const vals = new Float32Array(perSeries);
      const freq1 = 0.0045 * (s + 1);
      const freq2 = 0.028 * (4 - s);
      for (let k = 0; k < perSeries; k++) {
        const i = start + k;
        const wave = Math.sin(i * freq1) * 28 + Math.cos(i * freq2 + s) * 14 + Math.sin(i * 0.13 + s * 2) * 5.5;
        // Slow regime drift so the y autoscale has something to follow
        const drift = Math.sin(i * 0.0007 + s) * 40;
        vals[k] = 110 + s * 28 + wave * 1.65 + drift;
      }
      this.sdk.appendSeriesData(s, vals, undefined, { maxPoints });
    }
    this.lineStreamIndex += perSeries;
  }

  // ===========================================================================
  // DOM Sidebar & 2D/3D Smart Camera Event Binding
  // ===========================================================================
  private bindCanvasCameraControls(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this.isDragging) return;
      // Touch / pen gestures (orbit, pinch, chart pan) are owned by the SDK; mouse stays here
      if (e.pointerType !== 'mouse' && this.sdk.handlesTouchGestures()) return;
      // Graph / 3D views: the SDK's built-in camera controls orbit / pan / zoom
      if (this.sdk.handlesCameraControls()) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      // Brush mode: the SDK draws the selection box (Alt + drag still navigates)
      if (this.sdk.handlesChartBrush() && !e.altKey) return;
      // In 2D chart mode, dragging pans across X/Y unless Shift is held to tilt into 3D!
      if (this.is2DCameraMode && !e.shiftKey) {
        // 2D line charts navigate their own x axis (wheel / drag) inside the SDK
        if (this.sdk.handlesChartNavigation()) return;
        this.sdk.panCamera(-dx * 0.18, dy * 0.18);
      } else {
        this.sdk.rotateCamera(-dx * 0.006, dy * 0.006);
      }
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });
  }

  private bindSidebarDOM(): void {
    const listEl = document.getElementById('showcase-card-list');
    if (listEl) {
      listEl.innerHTML = '';
      for (const item of SHOWCASE_EXAMPLES) {
        const card = document.createElement('button');
        card.className = 'showcase-item-card';
        card.dataset.showcaseId = item.id;
        card.innerHTML = `
          <div class="sc-card-top">
            <span class="sc-badge">${item.badge}</span>
            <span class="sc-stats">${item.statsLabel}</span>
          </div>
          <div class="sc-card-title">${item.title}</div>
          <div class="sc-card-sub">${item.subtitle}</div>
        `;
        card.addEventListener('click', () => {
          this.loadExample(item.id);
          this.onStatusChange(`🎨 시각화 전환: ${item.title} — 데이터 포인트를 클릭해 상세 수치를 확인하세요!`);
        });
        listEl.appendChild(card);
      }
    }

    const autoRotCheck = document.getElementById('showcase-auto-rotate') as HTMLInputElement | null;
    autoRotCheck?.addEventListener('change', () => {
      this.autoRotate = autoRotCheck.checked;
      if (this.autoRotate) {
        this.is2DCameraMode = false;
      }
    });

    const copyBtn = document.getElementById('btn-copy-showcase-code');
    copyBtn?.addEventListener('click', () => {
      const meta = SHOWCASE_EXAMPLES.find((m) => m.id === this.currentExample);
      if (meta && navigator.clipboard) {
        navigator.clipboard.writeText(meta.codeSnippet);
        copyBtn.textContent = '✅ 복사됨!';
        setTimeout(() => {
          copyBtn.textContent = '📋 SDK 코드 복사';
        }, 1500);
      }
    });
  }

  private updateSidebarUI(): void {
    const meta = SHOWCASE_EXAMPLES.find((m) => m.id === this.currentExample);
    if (!meta) return;

    document.querySelectorAll<HTMLElement>('.showcase-item-card').forEach((el) => {
      el.classList.toggle('active', el.dataset.showcaseId === this.currentExample);
    });

    const titleEl = document.getElementById('showcase-active-title');
    const descEl = document.getElementById('showcase-active-desc');
    const codeEl = document.getElementById('showcase-code-box');
    const actionsEl = document.getElementById('showcase-Dynamic-actions');

    if (titleEl) titleEl.textContent = meta.title;
    if (descEl) descEl.textContent = meta.description;
    if (codeEl) codeEl.textContent = meta.codeSnippet;

    if (actionsEl) {
      actionsEl.innerHTML = '';
      for (const act of this.getActionsForCurrentExample()) {
        const btn = document.createElement('button');
        btn.className = 'action-btn secondary-btn showcase-action-btn';
        btn.textContent = act.label;
        btn.addEventListener('click', act.run);
        actionsEl.appendChild(btn);
      }
    }
  }
}
