// README benchmark charts: `npm run bench:charts [-- results.json]` reads a bench results file
// (default ../docs/bench/results.json) and writes light / dark SVG small multiples to
// ../docs/assets/bench-{ttff,fps,graph}-{light,dark}.svg. Chart charts: one panel per comparison
// scenario; graph chart: one panel per (metric, graph size), viz vs three.js. One bar per
// library in a fixed order; viz-engine-sdk carries the accent hue, the other libraries share a
// neutral so the eye lands on "ours vs the rest". Every bar is direct-labeled with its value
// (a static SVG has no tooltip), failed runs are written out instead of drawn.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WEB, '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'docs/bench/results.json');
const OUT = path.join(ROOT, 'docs/assets');
const results = JSON.parse(fs.readFileSync(input, 'utf8'));

const LIBS = [
  { id: 'viz', label: 'viz-engine-sdk' },
  { id: 'uplot', label: 'uPlot' },
  { id: 'echarts', label: 'ECharts' },
  { id: 'chartjs', label: 'Chart.js' },
  { id: 'plotly', label: 'Plotly' },
];
const GRAPH_LIBS = [
  { id: 'viz', label: 'viz-engine-sdk' },
  { id: 'three', label: 'three.js' },
];
const SCENARIOS = [
  { id: 'line-1m-1s', label: '선 1M 포인트' },
  { id: 'line-10m-1s', label: '선 10M 포인트' },
  { id: 'scatter-1m', label: '산점도 1M 포인트' },
  { id: 'bar-10k', label: '막대 10k 카테고리' },
];
const THEMES = {
  light: {
    surface: '#fcfcfb', primary: '#0b0b0b', secondary: '#52514e', muted: '#898781',
    grid: '#e1e0d9', axis: '#c3c2b7', ours: '#2a78d6', other: '#898781',
  },
  dark: {
    surface: '#1a1a19', primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781',
    grid: '#2c2c2a', axis: '#383835', ours: '#3987e5', other: '#898781',
  },
};
const METRICS = [
  {
    id: 'ttff',
    title: '첫 화면까지 걸린 시간',
    subtitle: 'render 호출 → 첫 프레임 표시, 5회 중앙값 · 짧을수록 좋음',
    unit: 'ms',
    value: (r) => r.ttff.frame.median,
    format: (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)),
    shared: false,
  },
  {
    id: 'fps',
    title: '줌·팬 중 프레임 속도',
    subtitle: '3초 동안 확대·이동 (막대는 hover 이동), 60 Hz 화면 · 높을수록 좋음',
    unit: 'fps',
    value: (r) => r.steady.fps,
    format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    shared: true,
    max: 60,
  },
];

/** Graph chart: rows = metric, columns = graph size */
const GRAPH_SIZES = [
  { id: 'graph-10k', label: '노드 10k · 엣지 20k' },
  { id: 'graph-100k', label: '노드 100k · 엣지 200k' },
];
const msFormat = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
const GRAPH_METRICS = [
  { label: '프레임 속도', hint: '높을수록 좋음', unit: 'fps', value: (r) => r.steady.fps, format: METRICS[1].format, shared: true, max: 60 },
  { label: '프레임당 물리 연산', hint: '짧을수록 좋음', unit: 'ms', value: (r) => r.steady.physics.median, format: msFormat, shared: false },
  { label: '데이터 로드 → 첫 프레임', hint: '짧을수록 좋음', unit: 'ms', value: (r) => r.ttff.frame.median, format: msFormat, shared: false },
];
const GRAPH = {
  id: 'graph',
  title: '3D 그래프: 물리 시뮬레이션 + 카메라 회전',
  subtitle: '같은 시드 그래프, 같은 Barnes-Hut 힘 모델을 매 프레임 실행하며 3초간 궤도 회전 · 중앙값',
  libs: GRAPH_LIBS,
  panels: GRAPH_METRICS.flatMap((metric) => GRAPH_SIZES.map((g) => ({ scenario: g.id, label: metric.label, sub: `${g.label} · ${metric.hint}`, metric }))),
  footer: (m) => {
    // Latest run that measured the graph scenarios (a merged partial run, else the full run)
    const run = (m.partialRuns ?? []).filter((p) => p.filter?.includes('graph')).at(-1) ?? m;
    return `${m.machine.cpu} · ${run.chrome.replace('/', ' ')} headless · viz-engine-sdk ${m.versions.viz} WebGPU · three.js ${m.versions.three} WebGL2 · ${run.date.slice(0, 10)}`;
  },
};

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, &quot;Apple SD Gothic Neo&quot;, &quot;Malgun Gothic&quot;, sans-serif';
const W = 880;
const COLS = 2;
const PAD = 24;
const GUTTER = 32;
const HEADER = 76;
const PANEL_TITLE = 28;
const ROW = 26;
const BAR = 14;
const LABEL_W = 108;
const VALUE_W = 64;
const FOOTER = 34;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function failure(error) {
  if (/timeout/i.test(error)) return '시간 초과 (300초)';
  if (/unsupported/i.test(error)) return '지원 안 함';
  return '실패';
}

function rowsFor(scenario, metric, libs = LIBS) {
  return libs.map((lib) => {
    const run = results.compare.find((x) => x.scenario === scenario && x.lib === lib.id);
    if (!run) return null;
    if (!run.ok) return { lib, note: failure(run.error ?? '') };
    return { lib, value: metric.value(run.result) };
  }).filter(Boolean);
}

/** A bar with 4px rounded data-end, square at the baseline. */
function bar(x, y, w, h, fill) {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return '';
  return `<path d="M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}z" fill="${fill}"/>`;
}

/** Chart spec of a metric chart: one panel per comparison scenario. */
function metricSpec(metric) {
  return {
    title: metric.title,
    subtitle: metric.subtitle,
    libs: LIBS,
    panels: SCENARIOS.map((s) => ({ scenario: s.id, label: s.label, metric })),
    footer: (m) => `${m.machine.cpu} · ${m.chrome.replace('/', ' ')} headless · viz-engine-sdk는 WebGPU · 같은 시드 데이터 · ${m.date.slice(0, 10)}`,
  };
}

function chart(spec, t) {
  const panelW = (W - 2 * PAD - (COLS - 1) * GUTTER) / COLS;
  const maxRows = Math.max(...spec.panels.map((p) => rowsFor(p.scenario, p.metric, spec.libs).length));
  const panelH = PANEL_TITLE + maxRows * ROW + 8;
  const rowsN = Math.ceil(spec.panels.length / COLS);
  const H = HEADER + rowsN * panelH + (rowsN - 1) * 20 + FOOTER;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">${esc(spec.title)}</title>`);
  const desc = spec.panels
    .map((p) => `${p.label}${p.sub ? ` (${p.sub})` : ''}: ${rowsFor(p.scenario, p.metric, spec.libs).map((r) => `${r.lib.label} ${r.note ?? `${p.metric.format(r.value)} ${p.metric.unit}`}`).join(', ')}`)
    .join('. ');
  out.push(`<desc id="d">${esc(desc)}</desc>`);
  out.push(`<rect width="${W}" height="${H}" rx="8" fill="${t.surface}"/>`);
  out.push(`<text x="${PAD}" y="34" font-size="18" font-weight="600" fill="${t.primary}">${esc(spec.title)}</text>`);
  out.push(`<text x="${PAD}" y="56" font-size="13" fill="${t.secondary}">${esc(spec.subtitle)}</text>`);

  spec.panels.forEach((s, i) => {
    const metric = s.metric;
    const px = PAD + (i % COLS) * (panelW + GUTTER);
    const py = HEADER + Math.floor(i / COLS) * (panelH + 20);
    const rows = rowsFor(s.scenario, metric, spec.libs);
    const max = metric.shared ? metric.max : Math.max(...rows.filter((r) => r.value != null).map((r) => r.value));
    const x0 = px + LABEL_W;
    const plotW = panelW - LABEL_W - VALUE_W;
    const sub = s.sub ? `<tspan font-size="12" font-weight="400" fill="${t.muted}">  ${esc(s.sub)}</tspan>` : '';
    out.push(`<text x="${px}" y="${py + 16}" font-size="14" font-weight="600" fill="${t.primary}">${esc(s.label)}${sub}</text>`);
    const top = py + PANEL_TITLE;
    const bottom = top + rows.length * ROW;
    if (metric.shared) {
      for (const v of [30, 60]) {
        const gx = x0 + (v / max) * plotW;
        out.push(`<line x1="${gx}" y1="${top - 4}" x2="${gx}" y2="${bottom - 4}" stroke="${t.grid}" stroke-width="1"/>`);
        // Panels with a subtitle: tick labels under the grid (the subtitle runs across the top)
        out.push(`<text x="${gx}" y="${s.sub ? bottom + 8 : top - 8}" font-size="10" text-anchor="middle" fill="${t.muted}">${v}</text>`);
      }
    }
    out.push(`<line x1="${x0}" y1="${top - 4}" x2="${x0}" y2="${bottom - 4}" stroke="${t.axis}" stroke-width="1"/>`);
    rows.forEach((r, k) => {
      const y = top + k * ROW;
      const cy = y + BAR / 2;
      const ours = r.lib.id === 'viz';
      const ink = ours ? t.primary : t.secondary;
      const weight = ours ? ' font-weight="600"' : '';
      out.push(`<text x="${x0 - 10}" y="${cy + 4}" font-size="12" text-anchor="end" fill="${ink}"${weight}>${esc(r.lib.label)}</text>`);
      if (r.note) {
        out.push(`<text x="${x0 + 8}" y="${cy + 4}" font-size="12" font-style="italic" fill="${t.muted}">${esc(r.note)}</text>`);
        return;
      }
      const w = Math.max(2, (r.value / max) * plotW);
      out.push(bar(x0 + 1, y, w, BAR, ours ? t.ours : t.other));
      out.push(`<text x="${x0 + 1 + w + 6}" y="${cy + 4}" font-size="12" fill="${ink}"${weight} style="font-variant-numeric: tabular-nums">${esc(metric.format(r.value))}<tspan fill="${t.muted}" font-weight="400"> ${metric.unit}</tspan></text>`);
    });
  });

  const foot = spec.footer(results.meta);
  out.push(`<text x="${PAD}" y="${H - 14}" font-size="11" fill="${t.muted}">${esc(foot)}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

fs.mkdirSync(OUT, { recursive: true });
const specs = METRICS.map((metric) => ({ id: metric.id, ...metricSpec(metric) }));
// The graph chart only once the results hold the graph scenarios
if (results.compare.some((r) => r.scenario.startsWith('graph-'))) specs.push(GRAPH);
for (const spec of specs) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    const file = path.join(OUT, `bench-${spec.id}-${mode}.svg`);
    fs.writeFileSync(file, `${chart(spec, theme)}\n`);
    console.log(`[bench:charts] ${path.relative(ROOT, file)}`);
  }
}
