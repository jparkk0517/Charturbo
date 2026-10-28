import { Charturbo, type ScatterTrendlineType } from 'charturbo';

export const meta = {
  title: 'Regression trendlines',
  description:
    'trendline fits each series by least squares (ECharts ecStat linear / exponential / logarithmic / polynomial) and draws it across the visible x range; the legend lists the equation and R². Zoom and pan redraw the curve.',
  height: 460,
};

/** Deterministic noise in [-1, 1) (same chart on every load). */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** x / y / series ids of one dataset per model. */
function dataset(type: ScatterTrendlineType) {
  const r = noise(7);
  const x: number[] = [];
  const y: number[] = [];
  const clusters: number[] = [];
  const add = (px: number, py: number, s = 0) => (x.push(px), y.push(py), clusters.push(s));
  for (let i = 0; i < 120; i++) {
    const t = i / 119;
    switch (type) {
      case 'linear':
        // Two product lines: their own slope each
        add(5 + t * 90, 12 + 0.8 * (5 + t * 90) + r() * 10, 0);
        add(5 + t * 90, 30 + 0.35 * (5 + t * 90) + r() * 8, 1);
        break;
      case 'exponential':
        add(t * 10, 2 * Math.exp(0.38 * t * 10) * (1 + r() * 0.18));
        break;
      case 'logarithmic':
        add(0.5 + t * 60, 4 + 9 * Math.log(0.5 + t * 60) + r() * 3);
        break;
      default:
        add(-4 + t * 8, 0.6 * (-4 + t * 8) ** 3 - 2 * (-4 + t * 8) ** 2 - 4 * (-4 + t * 8) + 10 + r() * 6);
    }
  }
  return { x, y, clusters };
}

export default async function mount(host: HTMLElement) {
  const controls = host.appendChild(document.createElement('div'));
  const model = controls.appendChild(document.createElement('select'));
  model.setAttribute('aria-label', 'Regression model');
  for (const [value, label] of [
    ['linear', 'Linear'],
    ['exponential', 'Exponential'],
    ['logarithmic', 'Logarithmic'],
    ['polynomial', 'Polynomial (order 3)'],
  ]) {
    const option = model.appendChild(document.createElement('option'));
    option.value = value;
    option.textContent = label;
  }
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const draw = () => {
    const type = model.value as ScatterTrendlineType;
    sdk.renderScatterChart(dataset(type), {
      title: `${model.selectedOptions[0]?.textContent ?? type} regression`,
      seriesNames: type === 'linear' ? ['Product A', 'Product B'] : ['Samples'],
      pointRadius: 3.5,
      opacity: 0.7,
      legend: { position: 'right' },
      trendline: { type, order: 3, width: 2.5 },
    });
    sdk.render();
  };
  model.addEventListener('change', draw);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return {
    sdk,
    dispose() {
      model.removeEventListener('change', draw);
      sdk.dispose();
    },
  };
}
