import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Pictorial bars',
  description: 'renderPictorialBarChart: bars drawn as symbols. Repeated rects clipped at the value over shadow tracks, stretched path:// icons, repeated people on horizontal bars.',
};

const HEART =
  'path://M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const STAR = 'path://M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z';
const PERSON = 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z';

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const progress = [72, 45, 90, 30, 61, 84, 52];
  const layouts = {
    'repeat + clip': () =>
      sdk.renderPictorialBarChart(
        days.map((label, i) => ({ label, value: progress[i] })),
        {
          title: 'Weekly goal (%)',
          background: true,
          symbol: 'roundRect',
          // As many as fit up to 100, cut at each value
          symbolRepeat: 'fixed',
          symbolClip: true,
          symbolBoundingData: 100,
          symbolSize: ['70%', 10],
          symbolMargin: 2,
        }
      ),
    paths: () =>
      sdk.renderPictorialBarChart(
        [
          { label: 'Likes', value: 40, symbol: HEART, color: '#f43f5e' },
          { label: 'Stars', value: 55, symbol: STAR, color: '#f59e0b' },
          { label: 'Users', value: 30, symbol: PERSON, color: '#0ea5e9' },
          { label: 'Churn', value: -20, symbol: 'arrow', color: '#8b5cf6' },
          { label: 'Visits', value: 25, symbol: 'pin', color: '#10b981' },
        ],
        { title: 'Stretched symbols' }
      ),
    horizontal: () =>
      sdk.renderPictorialBarChart(
        ['North', 'South', 'East', 'West'].map((label, i) => ({ label, value: [8.5, 5, 11, 3.2][i] })),
        {
          title: 'Staff per region',
          orientation: 'horizontal',
          symbol: PERSON,
          symbolRepeat: true,
          symbolClip: true,
          symbolSize: [16, '80%'],
          symbolMargin: '10%',
          background: true,
        }
      ),
  };
  const draw = (name: keyof typeof layouts) => {
    layouts[name]();
    sdk.render();
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === name));
  };
  for (const name of Object.keys(layouts) as (keyof typeof layouts)[]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = name;
    button.onclick = () => draw(name);
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw('repeat + clip');
  return sdk;
}
