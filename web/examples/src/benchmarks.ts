// First: sets <html lang> before the chart engine loads.
import { lang, setPageMeta, t } from './i18n';
import { MESSAGES, type MessageKey } from './messages';
import './style.css';
import './benchmarks.css';
import rawResults from '../../../docs/bench/results.json?raw';
import { CharturboDevice } from 'charturbo';
import { createReportChart, defaultDesign, exportReport, reportTheme, type ThemeName } from '../../bench/report-charts';
import { formatValue, METRICS, rowsFor, SCENARIOS, workload, type Entry, type Group, type Metric, type Results } from '../../bench/report-model';
import { renderHeader } from './families';
import { getThemeName, setThemeName, subscribeTheme } from './theme';

declare global {
  interface Window {
    __benchmark?: {
      export(data: Results, group: Group, theme: ThemeName): Promise<string>;
      ready: boolean;
      error?: string;
    };
  }
}

const data: Results = JSON.parse(rawResults);
const params = new URLSearchParams(location.search);
const themes: ThemeName[] = ['light', 'dark', 'midnight', 'paper'];
// The site-wide theme (header select) drives the report; `?theme=` overrides it
const initialTheme = params.get('theme') as ThemeName;
if (themes.includes(initialTheme)) setThemeName(initialTheme);
let design = defaultDesign(getThemeName());
let charts: Awaited<ReturnType<typeof createReportChart>>[] = [];
let device: CharturboDevice | undefined;
document.body.prepend(renderHeader('benchmarks'));
const main = document.querySelector('main')!;
main.className = 'bench';
setPageMeta(t('bench.title'), t('bench.description'));
const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
main.innerHTML = `
  <section class="intro"><p class="eyebrow">${esc(t('bench.eyebrow'))}</p><h1>${t('bench.headingHtml')}</h1><p>${esc(t('bench.intro'))}</p><p class="links"><a href="https://github.com/jparkk0517/Charturbo/blob/main/docs/${lang === 'en' ? '' : `${lang}/`}contributing/benchmarks.md">${esc(t('bench.methodology'))}</a><a href="https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.json">${esc(t('bench.raw'))}</a><a href="https://github.com/jparkk0517/Charturbo">GitHub ↗</a></p></section>
  <nav class="scenario-nav" aria-label="${esc(t('bench.scenarioNav'))}"></nav>
  <p id="status" role="status" aria-live="polite">${esc(t('bench.loading'))}</p>
  <div id="scenarios"></div>
  <section class="notes"><h2>${esc(t('bench.notesHeading'))}</h2><ul>
    ${(['bench.note1', 'bench.note2', 'bench.note3', 'bench.note4', 'bench.note5'] as const).map((k) => `<li>${esc(t(k))}</li>`).join('\n    ')}
  </ul></section>
  <footer><span id="environment"></span><span>${esc(t('bench.footer'))}</span></footer>`;

const status = document.querySelector<HTMLElement>('#status')!;
const scenarioNav = document.querySelector<HTMLElement>('.scenario-nav')!;
const scenarioList = document.querySelector<HTMLElement>('#scenarios')!;
const metricsOf = (scenario: string): Metric[] => scenario.startsWith('graph') ? ['ttff', 'fps', 'physics'] : ['ttff', 'fps'];

// bench/report-model (shared with the README export) speaks Korean: map its labels by id or by text.
const scenarioLabel = (id: string) => {
  const key = `bench.scenario.${id}` as MessageKey;
  return Object.hasOwn(MESSAGES.en, key) ? t(key) : SCENARIOS.find((s) => s.id === id)?.label ?? id;
};
const metricTitle = (m: Metric) => t(`bench.metric.${m}.title`);
const metricHint = (m: Metric) => t(`bench.metric.${m}.hint`);
const KO_TEXT: Record<string, MessageKey> = {
  '미측정': 'bench.status.notMeasured', '시간 초과': 'bench.status.timeout', '미지원': 'bench.status.unsupported',
  '측정 실패': 'bench.status.failed', '재측정 필요: 데이터 복사 제외': 'bench.status.rerunCopy',
  '재측정 필요: 물리 미검증': 'bench.status.rerunPhysics', '재측정 필요: 중복 물리 실행': 'bench.status.rerunDuplicate',
  '해당 없음: 물리 없음': 'bench.status.noPhysics', '측정 완료': 'bench.status.measured', '측정값 없음': 'bench.status.noValue',
  'x축만 줌·팬': 'bench.workload.zoomPanX', 'hover': 'bench.workload.hover', '줌·팬': 'bench.workload.zoomPan',
  '3D CPU 물리 + 회전': 'bench.workload.cpuPhysics', '3D hybrid GPU 물리 + 회전': 'bench.workload.hybridPhysics',
  '3D 물리 + 회전': 'bench.workload.physics', '렌더만 + 회전': 'bench.workload.renderOnly',
  '2D GPU 레이아웃': 'bench.workload.gpuLayout2d', '3D d3 물리 + 회전': 'bench.workload.d3Physics',
};
/** Status / workload text from report-model in the site language (unknown text passes through). */
const localize = (text: string) => (lang !== 'ko' && Object.hasOwn(KO_TEXT, text) ? t(KO_TEXT[text]) : text);
function conditionsText(entry: Entry | undefined): string {
  const m = entry?.measurement;
  return m
    ? t('bench.conditions', { date: m.date.slice(0, 10), runs: entry?.result?.ttff.frame.n ?? m.reps, seconds: m.duration / 1000 })
    : t('bench.conditionsLegacy');
}

function applyDesign() {
  const t = reportTheme(design);
  main.style.setProperty('--chart-surface', String(t.surface));
  for (const c of charts) c.update(design);
  const url = new URL(location.href);
  url.searchParams.delete('scenario');
  url.searchParams.set('theme', design.theme);
  history.replaceState(null, '', url);
}

function renderTable(scenario: string): HTMLElement {
  const details = document.createElement('details');
  details.className = 'scenario-data';
  details.innerHTML = `<summary>${esc(t('bench.tableSummary'))}</summary><div class="table-wrap"><table><caption>${esc(t('bench.tableCaption'))}</caption><thead><tr><th>${esc(t('bench.colLibrary'))}</th><th>TTFF (ms)</th><th>FPS</th><th>${esc(t('bench.colPhysics'))}</th><th>${esc(t('bench.colWorkload'))}</th><th>${esc(t('bench.colConditions'))}</th><th>${esc(t('bench.colStatus'))}</th></tr></thead><tbody></tbody></table></div>`;
  const body = details.querySelector('tbody')!;
  for (const row of rowsFor(data, scenario, 'ttff')) {
    const values = (['ttff', 'fps', 'physics'] as Metric[]).map((m) => rowsFor(data, scenario, m).find((r) => r.lib === row.lib)!);
    const tr = document.createElement('tr');
    const version = row.entry?.measurement?.version ?? data.meta.versions[row.lib] ?? '';
    const cells = [
      `${row.label} ${version}`,
      ...values.map((r) => r.value === null ? '—' : formatValue(r.value)),
      `${localize(workload(row.entry?.lib ?? row.lib, scenario))} / ${row.entry?.result?.backend ?? '—'}`,
      conditionsText(row.entry), row.entry?.error ?? [
        ...values.slice(0, metricsOf(scenario).length).map((r) => localize(r.status)).filter((s, i, all) => all.indexOf(s) === i),
        ...(row.entry?.errors ?? []),
      ].join(' · '),
    ];
    for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    body.append(tr);
  }
  return details;
}

/** Every scenario on one page: heading, one chart per metric, then its table (collapsed). */
async function renderAll() {
  window.__benchmark!.ready = false;
  applyDesign();
  const hosts: { scenario: string; metric: Metric; article: HTMLElement; host: HTMLElement }[] = [];
  for (const s of SCENARIOS) {
    const link = scenarioNav.appendChild(document.createElement('a'));
    link.href = `#${s.id}`;
    link.textContent = scenarioLabel(s.id);
    const section = scenarioList.appendChild(document.createElement('section'));
    section.className = 'scenario';
    section.id = s.id;
    const h2 = section.appendChild(document.createElement('h2'));
    h2.textContent = scenarioLabel(s.id);
    const grid = section.appendChild(document.createElement('div'));
    grid.className = 'charts';
    grid.setAttribute('aria-label', t('bench.chartsLabel', { scenario: scenarioLabel(s.id) }));
    for (const metric of metricsOf(s.id)) {
      const article = document.createElement('article');
      article.className = 'chart-card';
      const h3 = document.createElement('h3'); h3.textContent = metricTitle(metric);
      const hint = document.createElement('p'); hint.textContent = metricHint(metric);
      const host = document.createElement('div'); host.className = 'chart-host';
      const unavailable = document.createElement('p'); unavailable.className = 'unavailable';
      unavailable.textContent = rowsFor(data, s.id, metric).filter((r) => r.value === null).map((r) => `${r.label}: ${localize(r.status)}`).join(' · ');
      article.append(h3, hint, host, unavailable);
      grid.append(article);
      hosts.push({ scenario: s.id, metric, article, host });
    }
    section.append(renderTable(s.id));
  }
  // The DOM (and tables) are complete before the engine loads: a deep link lands on its section
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  try {
    device ??= await CharturboDevice.create();
    for (const { scenario, metric, article, host } of hosts) {
      const chart = await createReportChart(host, device, data, scenario, metric, design);
      charts.push(chart);
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'chart-download';
      save.textContent = t('bench.download', { unit: METRICS[metric].unit });
      save.setAttribute('aria-label', t('bench.downloadLabel', { scenario: scenarioLabel(scenario), metric: metricTitle(metric) }));
      save.addEventListener('click', () => chart.sdk.downloadChartSVG(`${scenario}-${metric}-${design.theme}.svg`));
      article.append(save);
    }
    status.textContent = t('bench.ready', { backend: device.backend.toUpperCase() });
    window.__benchmark!.error = undefined;
  } catch (error) {
    status.textContent = t('bench.failed', { error: String(error) });
    window.__benchmark!.error = String(error);
  } finally { window.__benchmark!.ready = true; }
}

// Header theme select: same report themes, so it just re-themes the charts
subscribeTheme(() => {
  if (design.theme === getThemeName()) return;
  design = defaultDesign(getThemeName());
  applyDesign();
});
document.querySelector('#environment')!.textContent = t('bench.environment', { cpu: data.meta.machine.cpu, chrome: data.meta.chrome ?? '' });
window.__benchmark = {
  ready: false,
  async export(input, group, theme) {
    device ??= await CharturboDevice.create();
    return exportReport(input, group, defaultDesign(theme), device);
  },
};
window.addEventListener('pagehide', () => { charts.forEach((c) => c.dispose()); device?.dispose(); });
void renderAll();
