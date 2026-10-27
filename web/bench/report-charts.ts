import { VizDevice, VizEngineSDK, VIZ_THEMES, type VizThemeInput } from '../src/index';
import { conditions, formatValue, METRICS, panelsFor, rowsFor, workload, type Group, type Metric, type Results } from './report-model';

export type ThemeName = 'light' | 'dark' | 'midnight' | 'paper';
export interface Design { theme: ThemeName; accent: string; colorful: boolean; radius: number; labels: boolean; font: string }
export const defaultDesign = (theme: ThemeName = 'light'): Design => ({ theme, accent: '#3182f6', colorful: false, radius: 5, labels: true, font: 'system-ui, -apple-system, sans-serif' });
const COLORS = ['#3182f6', '#14b8a6', '#f59e0b', '#a78bfa', '#f472b6', '#22c55e', '#fb7185', '#38bdf8'];
export function reportTheme(d: Design): VizThemeInput {
  const dark = d.theme === 'dark' || d.theme === 'midnight';
  return {
    ...VIZ_THEMES[dark ? 'dark' : 'light'], name: d.theme,
    surface: d.theme === 'midnight' ? '#101b35' : d.theme === 'paper' ? '#faf6ed' : dark ? '#171c27' : '#ffffff',
    textPrimary: dark ? '#edf2ff' : '#14213d', textSecondary: dark ? '#b6c3da' : '#475569',
    textMuted: dark ? '#93a4bd' : '#64748b', grid: dark ? '#2c3851' : '#e5eaf2',
    baseline: dark ? '#45536d' : '#c5d0df', palette: [d.accent, ...COLORS.slice(1)], fontFamily: d.font,
  };
}

export async function createReportChart(host: HTMLElement, device: VizDevice, data: Results, scenario: string, metric: Metric, design: Design) {
  const canvas = host.appendChild(document.createElement('canvas'));
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  const sdk = await VizEngineSDK.create(canvas, { device, locale: 'en-US', animation: false });
  sdk.enableNodeInteractions(canvas, { autoRender: true, chartNavigation: false });
  let currentDesign = design;
  let lastWidth = 0, lastHeight = 0;
  const update = (next: Design) => {
    currentDesign = next;
    const { width, height } = host.getBoundingClientRect();
    lastWidth = width; lastHeight = height;
    const t = reportTheme(next);
    sdk.setTheme(t);
    const rows = rowsFor(data, scenario, metric).filter((r) => r.value !== null);
    sdk.renderBarChart(rows.map((r, i) => ({
      label: r.label, value: r.value!,
      color: r.lib === 'viz' ? next.accent : next.colorful ? COLORS[(i + 1) % COLORS.length] : next.theme === 'light' || next.theme === 'paper' ? '#94a3b8' : '#7d8da8',
      attributes: { unit: METRICS[metric].unit, workload: workload(r.lib, scenario), measurement: conditions(r.entry) },
    })), {
      orientation: 'horizontal', cornerRadius: next.radius, legend: false,
      // Match the physical chart rectangle to the padded viewport, including on mobile.
      width: Math.max(width - 184, width * 0.2, 1),
      maxBarHeight: Math.max(height - 52, height * 0.2, 1),
      padding: { left: 118, right: 66, top: 12, bottom: 40 },
      labels: next.labels ? { show: true, position: 'outside', format: (n) => formatValue(n), color: t.textPrimary } : false,
      axes: { x: { title: METRICS[metric].unit, format: '.0f' }, y: { format: (i) => rows[Math.round(i)]?.label ?? '' } },
      description: `${scenario} ${METRICS[metric].title}. 작업 조건이 다른 라이브러리를 포함합니다.`,
    });
    sdk.render();
  };
  update(design);
  const observer = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (width !== lastWidth || height !== lastHeight) update(currentDesign);
  });
  observer.observe(host);
  return { sdk, update, dispose: () => { observer.disconnect(); sdk.dispose(); host.replaceChildren(); } };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Only the report frame / notes are composed here. All bars, axes and labels come from SDK SVG export. */
export async function exportReport(data: Results, group: Group, design: Design, device: VizDevice): Promise<string> {
  const panels = panelsFor(group);
  const width = 880, panelWidth = 416, chartHeight = group === 'graph' ? 235 : 305;
  const maxUnavailable = Math.max(...panels.map((p) => rowsFor(data, p.id, p.metric).filter((r) => r.value === null).length));
  const rowHeight = chartHeight + Math.max(124, 72 + maxUnavailable * 15), top = 118;
  const height = top + Math.ceil(panels.length / 2) * rowHeight + 95;
  const theme = reportTheme(design);
  const title = group === 'graph' ? '그래프 엔진 · 작업 조건별 비교' : METRICS[group].title;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="report-title report-desc">`,
    `<title id="report-title">${escape(title)}</title><desc id="report-desc">VizEngineSDK로 렌더링한 벤치마크 결과. 실패는 막대로 그리지 않습니다. 작업 조건과 측정일은 원본 표를 참고하세요.</desc>`,
    `<rect width="100%" height="100%" rx="16" fill="${theme.surface}"/>`,
  ];
  const text = (x: number, y: number, label: string, size = 12, color = theme.textSecondary) => `<text x="${x}" y="${y}" font-family="${escape(design.font)}" font-size="${size}" fill="${color}">${escape(label)}</text>`;
  parts.push(text(24, 35, 'VIZ ENGINE SDK / BENCHMARK', 11, design.accent), text(24, 65, title, 23, theme.textPrimary));
  parts.push(text(24, 90, group === 'graph' ? 'viz·three: 3D 물리 / deck.gl: 렌더만 / cosmos: 2D / 3d-force-graph: d3 물리' : '같은 시드 데이터 · 초기화 제외 · 산점도 ChartGPU는 x축만 이동'));
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: `${panelWidth}px`, height: `${chartHeight}px` });
  document.body.append(host);
  try {
    for (const [index, panel] of panels.entries()) {
      const x = 24 + index % 2 * 432, y = top + Math.floor(index / 2) * rowHeight;
      parts.push(text(x, y, panel.label, 15, theme.textPrimary));
      parts.push(text(x, y + 21, `${group === 'graph' ? METRICS[panel.metric].title + ' · ' : ''}${METRICS[panel.metric].unit}`, 11));
      const rows = rowsFor(data, panel.id, panel.metric);
      const chart = rows.some((r) => r.value !== null) ? await createReportChart(host, device, data, panel.id, panel.metric, design) : null;
      if (chart) try {
        await settle();
        const documentSvg = new DOMParser().parseFromString(chart.sdk.exportChartSVG(), 'image/svg+xml');
        if (documentSvg.querySelector('parsererror')) throw new Error('Invalid SDK SVG');
        const svg = documentSvg.documentElement;
        // Namespace engine clip IDs across panels, including URL references.
        let inner = svg.innerHTML;
        for (const el of Array.from(svg.querySelectorAll('[id]'))) {
          const id = el.id;
          inner = inner.replaceAll(`id="${id}"`, `id="p${index}-${id}"`).replaceAll(`url(#${id})`, `url(#p${index}-${id})`);
        }
        parts.push(`<svg x="${x}" y="${y + 30}" width="${panelWidth}" height="${chartHeight}" viewBox="${svg.getAttribute('viewBox')}">${inner}</svg>`);
      } finally { chart.dispose(); }
      else parts.push(text(x + 16, y + 75, '표시할 유효한 측정값 없음', 12));
      const unavailable = rows.filter((r) => r.value === null);
      unavailable.forEach((r, i) => parts.push(text(x, y + chartHeight + 48 + i * 15, `${r.label}: ${r.status}`, 10)));
      if (!unavailable.length) parts.push(text(x, y + chartHeight + 48, METRICS[panel.metric].hint, 10));
    }
  } finally { host.remove(); }
  const measurements = data.compare.map((r) => r.measurement).filter((m) => !!m);
  const dates = [...new Set(measurements.map((m) => m.date.slice(0, 10)))].sort();
  const configs = [...new Set(measurements.map((m) => `요청 ${m.reps}회 / ${m.duration / 1000}초`))];
  const legacy = data.compare.some((r) => !r.measurement) ? ' · 이전 조건 기록 포함' : '';
  parts.push(text(24, height - 62, `${data.meta.machine.cpu} · ${dates.join(', ') || data.meta.date.slice(0, 10)} · ${configs.join(' · ') || '개별 조건은 원본 참조'}${legacy}`));
  parts.push(text(24, height - 41, '단일 머신 관측값 · 실제 반복 수는 원본 표 참조 · 작업이 다른 FPS는 직접 비교할 수 없습니다.', 11));
  parts.push(text(24, height - 20, 'Rendered with VizEngineSDK · exportChartSVG() · 인터랙티브 비교와 전체 표는 README 링크', 10));
  return parts.join('\n') + '</svg>';
}
