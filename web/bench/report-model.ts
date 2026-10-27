/** Shared interpretation of the measured data for the live report and README exports. */
export type Metric = 'ttff' | 'fps' | 'physics';
export type Group = 'ttff' | 'fps' | 'graph';
export interface Measurement {
  date: string;
  reps: number;
  duration: number;
  version?: string;
  chrome?: string;
}
export interface Entry {
  scenario: string;
  lib: string;
  ok: boolean;
  error?: string;
  errors?: string[];
  measurement?: Measurement;
  result?: {
    backend: string;
    methodologyVersion?: number;
    physicsValidation?: { ticks: number; movedNodes: number };
    ttff: { frame: { median: number; n: number } };
    steady: { fps: number; physics?: { median: number } };
  };
}
export interface Results {
  meta: Measurement & { machine: { cpu: string }; versions: Record<string, string> };
  compare: Entry[];
}
export const CHART_LIBS = ['viz', 'uplot', 'echarts', 'chartjs', 'plotly', 'chartgpu', 'scichart', 'highcharts'];
export const GRAPH_LIBS = ['viz', 'vizgpu', 'three', 'deckgl', 'cosmos', 'forcegraph3d'];
export const LIB_NAMES: Record<string, string> = {
  viz: 'VizEngineSDK', vizgpu: 'VizEngine GPU', uplot: 'uPlot', echarts: 'ECharts', chartjs: 'Chart.js', plotly: 'Plotly',
  chartgpu: 'ChartGPU', scichart: 'SciChart', highcharts: 'Highcharts', three: 'three.js',
  deckgl: 'deck.gl', cosmos: 'cosmos.gl', forcegraph3d: '3d-force-graph',
};
export const SCENARIOS = [
  { id: 'line-1m-1s', label: '선 · 100만 포인트' },
  { id: 'line-10m-1s', label: '선 · 1,000만 포인트' },
  { id: 'scatter-1m', label: '산점도 · 100만 포인트' },
  { id: 'bar-10k', label: '막대 · 1만 카테고리' },
  { id: 'graph-10k', label: '그래프 · 노드 1만 / 엣지 2만' },
  { id: 'graph-100k', label: '그래프 · 노드 10만 / 엣지 20만' },
];
export const METRICS: Record<Metric, { title: string; unit: string; hint: string }> = {
  ttff: { title: '데이터 전달 → 첫 프레임', unit: 'ms', hint: '짧을수록 좋음 · 초기화 제외' },
  fps: { title: '상호작용 중 프레임 속도', unit: 'fps', hint: '높을수록 좋음 · 60 Hz 환경' },
  physics: { title: '프레임당 물리 / 제출 시간', unit: 'ms', hint: 'CPU/제출 시간 · VizEngine GPU는 GPU 왕복 포함' },
};
export const formatValue = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

export function workload(lib: string, scenario: string): string {
  if (!scenario.startsWith('graph')) return lib === 'chartgpu' && scenario === 'scatter-1m' ? 'x축만 줌·팬' : scenario === 'bar-10k' ? 'hover' : '줌·팬';
  return ({ viz: '3D 물리 + 회전', vizgpu: '3D hybrid GPU 물리 + 회전', three: '3D 물리 + 회전', deckgl: '렌더만 + 회전', cosmos: '2D GPU 레이아웃', forcegraph3d: '3D d3 물리 + 회전' } as Record<string, string>)[lib] ?? '';
}

/** Failed / missing / invalid measurements are not converted to zero-length bars. */
export function metricValue(entry: Entry | undefined, metric: Metric): { value: number | null; status: string } {
  if (!entry) return { value: null, status: '미측정' };
  if (!entry.ok || !entry.result) return { value: null, status: /timeout/i.test(entry.error ?? '') ? '시간 초과' : /unsupported/i.test(entry.error ?? '') ? '미지원' : '측정 실패' };
  const r = entry.result;
  if (entry.lib === 'scichart' && metric === 'ttff' && (r.methodologyVersion ?? 1) < 2) return { value: null, status: '재측정 필요: 데이터 복사 제외' };
  if (entry.lib === 'forcegraph3d' && (!r.physicsValidation || r.physicsValidation.ticks !== 1 || r.physicsValidation.movedNodes < 1)) return { value: null, status: '재측정 필요: 물리 미검증' };
  if (entry.lib === 'vizgpu' && (r.physicsValidation?.ticks !== 1 || !(r.physicsValidation.movedNodes > 0))) return { value: null, status: '재측정 필요: 물리 미검증' };
  if (entry.lib === 'cosmos' && ((r.methodologyVersion ?? 1) < 3 || r.physicsValidation?.ticks !== 1 || !(r.physicsValidation.movedNodes > 0))) return { value: null, status: '재측정 필요: 중복 물리 실행' };
  if (metric === 'physics' && entry.lib === 'deckgl') return { value: null, status: '해당 없음: 물리 없음' };
  const value = metric === 'ttff' ? r.ttff.frame.median : metric === 'fps' ? r.steady.fps : r.steady.physics?.median;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { value, status: '측정 완료' }
    : { value: null, status: '측정값 없음' };
}

export function rowsFor(data: Results, scenario: string, metric: Metric) {
  return (scenario.startsWith('graph') ? GRAPH_LIBS : CHART_LIBS).map((lib) => {
    const entry = data.compare.find((r) => r.scenario === scenario && r.lib === lib);
    return { lib, label: LIB_NAMES[lib], entry, ...metricValue(entry, metric) };
  });
}

export function conditions(entry: Entry | undefined): string {
  const m = entry?.measurement;
  return m ? `${m.date.slice(0, 10)} · ${entry?.result?.ttff.frame.n ?? m.reps}회 · ${m.duration / 1000}초` : '이전 병합 측정 · 개별 조건 미기록';
}

export function panelsFor(group: Group) {
  return group === 'graph'
    ? (['fps', 'physics', 'ttff'] as Metric[]).flatMap((metric) => SCENARIOS.slice(4).map((s) => ({ ...s, metric })))
    : SCENARIOS.slice(0, 4).map((s) => ({ ...s, metric: group as Metric }));
}
