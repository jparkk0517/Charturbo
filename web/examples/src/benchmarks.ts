import './style.css';
import './benchmarks.css';
import rawResults from '../../../docs/bench/results.json?raw';
import { CharturboDevice } from 'charturbo';
import { createReportChart, defaultDesign, exportReport, reportTheme, type ThemeName } from '../../bench/report-charts';
import { conditions, formatValue, METRICS, rowsFor, SCENARIOS, workload, type Group, type Metric, type Results } from '../../bench/report-model';
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
main.innerHTML = `
  <section class="intro"><p class="eyebrow">BUILT WITH OUR OWN ENGINE</p><h1>측정 결과를,<br>우리 차트로.</h1><p>같은 데이터에서 관측한 성능을 살펴보세요.</p><p class="links"><a href="https://github.com/jparkk0517/Charturbo/blob/main/docs/BENCHMARKS.md">측정 방법 ↗</a><a href="https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.json">CPU·GPU 전체 측정 원본 ↗</a><a href="https://github.com/jparkk0517/Charturbo">GitHub ↗</a></p></section>
  <nav class="scenario-nav" aria-label="시나리오 바로가기"></nav>
  <p id="status" role="status" aria-live="polite">차트 엔진을 불러오는 중…</p>
  <div id="scenarios"></div>
  <section class="notes"><h2>비교 조건을 함께 읽어주세요</h2><ul>
    <li>TTFF는 엔진 초기화 이후 데이터 전달부터 첫 프레임까지입니다. 라이브러리별 재생성·재사용 방식이 다릅니다.</li>
    <li>ChartGPU 산점도는 x축만 이동합니다. SciChart는 데이터 복사를 포함한 수정 측정만 TTFF에 표시합니다.</li>
    <li>Charturbo는 시나리오별 CPU·GPU 유효 측정 중 FPS가 높은 모드 하나를 표시합니다(동률이면 물리 시간이 짧은 모드). 모든 지표는 선택된 동일 측정에서 가져오며, 사용 모드는 표와 툴팁에 표시합니다.</li>
    <li>Charturbo·three.js는 같은 3D 힘 모델입니다. SDK의 hybrid GPU 모드는 GPU 반발력 + CPU 적분·공간 인덱스 방식입니다. deck.gl은 렌더만, cosmos.gl은 2D, 3d-force-graph는 다른 d3 힘 모델입니다.</li>
    <li>SDK GPU 물리 시간은 업로드·GPU 완료·리드백·CPU 적분을 포함한 경과 시간이며, 나머지는 CPU 실행/제출 시간입니다. cosmos v3는 프레임당 한 스텝을 검증합니다. 시간 초과·미지원·미측정은 0점으로 표시하지 않습니다.</li>
  </ul></section>
  <footer><span id="environment"></span><span>차트: Charturbo · WebGPU / WebGL2 · SVG export</span></footer>`;

const status = document.querySelector<HTMLElement>('#status')!;
const scenarioNav = document.querySelector<HTMLElement>('.scenario-nav')!;
const scenarioList = document.querySelector<HTMLElement>('#scenarios')!;
const metricsOf = (scenario: string): Metric[] => scenario.startsWith('graph') ? ['ttff', 'fps', 'physics'] : ['ttff', 'fps'];

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
  details.innerHTML = `<summary>비교 수치 표</summary><div class="table-wrap"><table><caption>라이브러리별 수치, 조건 및 실패 사유</caption><thead><tr><th>라이브러리</th><th>TTFF (ms)</th><th>FPS</th><th>물리 (ms)</th><th>작업 / 렌더러</th><th>측정 조건</th><th>상태</th></tr></thead><tbody></tbody></table></div>`;
  const body = details.querySelector('tbody')!;
  for (const row of rowsFor(data, scenario, 'ttff')) {
    const values = (['ttff', 'fps', 'physics'] as Metric[]).map((m) => rowsFor(data, scenario, m).find((r) => r.lib === row.lib)!);
    const tr = document.createElement('tr');
    const version = row.entry?.measurement?.version ?? data.meta.versions[row.lib] ?? '';
    const cells = [
      `${row.label} ${version}`,
      ...values.map((r) => r.value === null ? '—' : formatValue(r.value)),
      `${workload(row.entry?.lib ?? row.lib, scenario)} / ${row.entry?.result?.backend ?? '—'}`,
      conditions(row.entry), row.entry?.error ?? [
        ...values.slice(0, metricsOf(scenario).length).map((r) => r.status).filter((s, i, all) => all.indexOf(s) === i),
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
    link.textContent = s.label;
    const section = scenarioList.appendChild(document.createElement('section'));
    section.className = 'scenario';
    section.id = s.id;
    const h2 = section.appendChild(document.createElement('h2'));
    h2.textContent = s.label;
    const grid = section.appendChild(document.createElement('div'));
    grid.className = 'charts';
    grid.setAttribute('aria-label', `${s.label} 성능 차트`);
    for (const metric of metricsOf(s.id)) {
      const article = document.createElement('article');
      article.className = 'chart-card';
      const h3 = document.createElement('h3'); h3.textContent = METRICS[metric].title;
      const hint = document.createElement('p'); hint.textContent = METRICS[metric].hint;
      const host = document.createElement('div'); host.className = 'chart-host';
      const unavailable = document.createElement('p'); unavailable.className = 'unavailable';
      unavailable.textContent = rowsFor(data, s.id, metric).filter((r) => r.value === null).map((r) => `${r.label}: ${r.status}`).join(' · ');
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
      save.textContent = `${METRICS[metric].unit} 차트 SVG`;
      save.setAttribute('aria-label', `${SCENARIOS.find((s) => s.id === scenario)!.label} ${METRICS[metric].title} SVG 다운로드`);
      save.addEventListener('click', () => chart.sdk.downloadChartSVG(`${scenario}-${metric}-${design.theme}.svg`));
      article.append(save);
    }
    status.textContent = `${device.backend.toUpperCase()} · 실제 SDK 차트입니다. 막대 위에 포인터를 올려 수치를 확인하세요.`;
    window.__benchmark!.error = undefined;
  } catch (error) {
    status.textContent = `차트를 표시할 수 없습니다: ${String(error)}. 각 시나리오의 수치 표는 계속 볼 수 있습니다.`;
    window.__benchmark!.error = String(error);
  } finally { window.__benchmark!.ready = true; }
}

// Header theme select: same report themes, so it just re-themes the charts
subscribeTheme(() => {
  if (design.theme === getThemeName()) return;
  design = defaultDesign(getThemeName());
  applyDesign();
});
document.querySelector('#environment')!.textContent = `${data.meta.machine.cpu} · ${data.meta.chrome ?? ''} · 개별 날짜·반복·측정 시간은 표 참조`;
window.__benchmark = {
  ready: false,
  async export(input, group, theme) {
    device ??= await CharturboDevice.create();
    return exportReport(input, group, defaultDesign(theme), device);
  },
};
window.addEventListener('pagehide', () => { charts.forEach((c) => c.dispose()); device?.dispose(); });
void renderAll();
