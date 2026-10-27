import './benchmarks.css';
import rawResults from '../../../docs/bench/results.json?raw';
import { VizDevice } from 'viz-engine-sdk';
import { createReportChart, defaultDesign, exportReport, reportTheme, type Design, type ThemeName } from '../../bench/report-charts';
import { conditions, formatValue, METRICS, rowsFor, SCENARIOS, workload, type Group, type Metric, type Results } from '../../bench/report-model';

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
const initialTheme = params.get('theme') as ThemeName;
let design = defaultDesign(themes.includes(initialTheme) ? initialTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let selected = SCENARIOS.find((s) => s.id === params.get('scenario'))?.id ?? SCENARIOS[0].id;
let charts: Awaited<ReturnType<typeof createReportChart>>[] = [];
let device: VizDevice | undefined;
let rendering = false;
const main = document.querySelector('main')!;
main.innerHTML = `
  <header><a href="./index.html" class="brand">VIZ ENGINE SDK</a><nav><a href="https://github.com/jparkk0517/VizEngineSDK/blob/main/docs/BENCHMARKS.md">측정 방법 ↗</a><a href="https://github.com/jparkk0517/VizEngineSDK">GitHub ↗</a></nav></header>
  <section class="intro"><p class="eyebrow">BUILT WITH OUR OWN ENGINE</p><h1>측정 결과를,<br>우리 차트로.</h1><p>같은 데이터에서 관측한 성능을 살펴보세요. 차트의 색상과 디자인도 직접 바꿀 수 있습니다.</p></section>
  <section class="controls" aria-label="비교 및 디자인 설정">
    <label>시나리오<select id="scenario"></select></label>
    <label>테마<select id="theme"><option value="light">Light</option><option value="dark">Dark</option><option value="midnight">Midnight</option><option value="paper">Paper</option></select></label>
    <label>강조 색상<input id="accent" type="color" value="#3182f6"></label>
    <label>색상 방식<select id="palette"><option value="focus">SDK 강조</option><option value="colorful">다색 팔레트</option></select></label>
    <label>글꼴<select id="font"><option value="system-ui, -apple-system, sans-serif">System</option><option value="Georgia, serif">Serif</option><option value="ui-monospace, monospace">Mono</option></select></label>
    <label>모서리 <input id="radius" type="range" min="0" max="12" value="5"></label>
    <label class="check"><input id="labels" type="checkbox" checked> 수치 표시</label>
  </section>
  <div class="report-heading"><h2 id="scenario-title"></h2><button id="download" type="button" disabled>TTFF SVG 다운로드</button></div>
  <p id="status" role="status" aria-live="polite">차트 엔진을 불러오는 중…</p>
  <section id="charts" class="charts" aria-label="성능 차트"></section>
  <section class="notes"><h2>비교 조건을 함께 읽어주세요</h2><ul>
    <li>TTFF는 엔진 초기화 이후 데이터 전달부터 첫 프레임까지입니다. 라이브러리별 재생성·재사용 방식이 다릅니다.</li>
    <li>ChartGPU 산점도는 x축만 이동합니다. SciChart는 데이터 복사를 포함한 수정 측정만 TTFF에 표시합니다.</li>
    <li>viz·three.js는 같은 3D 힘 모델, deck.gl은 렌더만, cosmos.gl은 2D GPU 레이아웃, 3d-force-graph는 다른 d3 힘 모델입니다.</li>
    <li>물리 시간은 CPU 호출 시간입니다. GPU 실행 시간과 같지 않습니다. 시간 초과·미지원·미측정은 0점으로 표시하지 않습니다.</li>
  </ul></section>
  <section class="data-section"><h2>측정 원본</h2><div class="table-wrap"><table><caption>라이브러리별 수치, 조건 및 실패 사유</caption><thead><tr><th>라이브러리</th><th>TTFF (ms)</th><th>FPS</th><th>물리 (ms)</th><th>작업 / 렌더러</th><th>측정 조건</th><th>상태</th></tr></thead><tbody></tbody></table></div></section>
  <footer><span id="environment"></span><span>차트: VizEngineSDK · WebGPU / WebGL2 · SVG export</span></footer>`;

const select = document.querySelector<HTMLSelectElement>('#scenario')!;
for (const s of SCENARIOS) select.add(new Option(s.label, s.id));
select.value = selected;
document.querySelector<HTMLSelectElement>('#theme')!.value = design.theme;
const status = document.querySelector<HTMLElement>('#status')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const chartSection = document.querySelector<HTMLElement>('#charts')!;

function applyDesign() {
  const t = reportTheme(design);
  document.documentElement.dataset.theme = design.theme;
  document.documentElement.style.setProperty('--accent', design.accent);
  document.documentElement.style.fontFamily = design.font;
  chartSection.style.setProperty('--chart-surface', String(t.surface));
  for (const c of charts) c.update(design);
  const url = new URL(location.href);
  url.searchParams.set('scenario', selected);
  url.searchParams.set('theme', design.theme);
  history.replaceState(null, '', url);
}

function renderTable() {
  const body = document.querySelector('tbody')!;
  body.replaceChildren();
  for (const row of rowsFor(data, selected, 'ttff')) {
    const values = (['ttff', 'fps', 'physics'] as Metric[]).map((m) => rowsFor(data, selected, m).find((r) => r.lib === row.lib)!);
    const tr = document.createElement('tr');
    const version = row.entry?.measurement?.version ?? data.meta.versions[row.lib] ?? '';
    const cells = [
      `${row.label} ${version}`,
      ...values.map((r) => r.value === null ? '—' : formatValue(r.value)),
      `${workload(row.lib, selected)} / ${row.entry?.result?.backend ?? '—'}`,
      conditions(row.entry), row.entry?.error ?? [
        ...values.slice(0, selected.startsWith('graph') ? 3 : 2).map((r) => r.status).filter((s, i, all) => all.indexOf(s) === i),
        ...(row.entry?.errors ?? []),
      ].join(' · '),
    ];
    for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    body.append(tr);
  }
}

async function renderScenario() {
  if (rendering) return;
  rendering = true;
  select.disabled = true;
  download.disabled = true;
  window.__benchmark!.ready = false;
  for (const chart of charts) chart.dispose();
  charts = [];
  chartSection.replaceChildren();
  document.querySelector('#scenario-title')!.textContent = SCENARIOS.find((s) => s.id === selected)!.label;
  renderTable();
  applyDesign();
  try {
    if (!device) device = await VizDevice.create();
    const metrics: Metric[] = selected.startsWith('graph') ? ['ttff', 'fps', 'physics'] : ['ttff', 'fps'];
    for (const metric of metrics) {
      const article = document.createElement('article');
      article.className = 'chart-card';
      const h3 = document.createElement('h3'); h3.textContent = METRICS[metric].title;
      const hint = document.createElement('p'); hint.textContent = METRICS[metric].hint;
      const host = document.createElement('div'); host.className = 'chart-host';
      const unavailable = document.createElement('p'); unavailable.className = 'unavailable';
      unavailable.textContent = rowsFor(data, selected, metric).filter((r) => r.value === null).map((r) => `${r.label}: ${r.status}`).join(' · ');
      article.append(h3, hint, host, unavailable); chartSection.append(article);
      const chart = await createReportChart(host, device, data, selected, metric, design);
      charts.push(chart);
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'chart-download';
      save.textContent = `${METRICS[metric].unit} 차트 SVG`;
      save.setAttribute('aria-label', `${METRICS[metric].title} SVG 다운로드`);
      save.addEventListener('click', () => chart.sdk.downloadChartSVG(`${selected}-${metric}-${design.theme}.svg`));
      article.append(save);
    }
    status.textContent = `${device.backend.toUpperCase()} · 실제 SDK 차트입니다. 막대 위에 포인터를 올려 수치를 확인하세요.`;
    download.disabled = false;
    window.__benchmark!.error = undefined;
  } catch (error) {
    status.textContent = `차트를 표시할 수 없습니다: ${String(error)}. 아래 원본 표는 계속 볼 수 있습니다.`;
    window.__benchmark!.error = String(error);
  } finally { rendering = false; select.disabled = false; window.__benchmark!.ready = true; }
}

select.addEventListener('change', () => { selected = select.value; void renderScenario(); });
for (const id of ['theme', 'accent', 'palette', 'font', 'radius', 'labels']) {
  document.getElementById(id)!.addEventListener('input', () => {
    design = {
      theme: document.querySelector<HTMLSelectElement>('#theme')!.value as ThemeName,
      accent: document.querySelector<HTMLInputElement>('#accent')!.value,
      colorful: document.querySelector<HTMLSelectElement>('#palette')!.value === 'colorful',
      radius: Number(document.querySelector<HTMLInputElement>('#radius')!.value),
      labels: document.querySelector<HTMLInputElement>('#labels')!.checked,
      font: document.querySelector<HTMLSelectElement>('#font')!.value,
    } satisfies Design;
    applyDesign();
  });
}
download.addEventListener('click', () => charts[0]?.sdk.downloadChartSVG(`${selected}-ttff-${design.theme}.svg`));
document.querySelector('#environment')!.textContent = `${data.meta.machine.cpu} · ${data.meta.chrome ?? ''} · 개별 날짜·반복·측정 시간은 표 참조`;
window.__benchmark = {
  ready: false,
  async export(input, group, theme) {
    if (!device) device = await VizDevice.create();
    return exportReport(input, group, defaultDesign(theme), device);
  },
};
window.addEventListener('pagehide', () => { charts.forEach((c) => c.dispose()); device?.dispose(); });
void renderScenario();
