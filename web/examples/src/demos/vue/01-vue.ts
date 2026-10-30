import { createApp, defineComponent, h, ref, shallowRef, onUnmounted } from 'vue';
import { CharturboChart, type CharturboChartInstance } from 'charturbo/vue';
import { chartTheme, getThemeName, setThemeName, subscribeTheme } from '../../theme';

export const meta = {
  title: 'Vue <CharturboChart>',
  description: 'Replace shallowRef data with a new array to re-render; theme changes only call setTheme.',
};

const regions = ['APAC', 'EMEA', 'US-East', 'US-West', 'LATAM'];
const randomData = () => ({
  categories: regions,
  series: ['Q1', 'Q2'].map((name) => ({ name, values: regions.map(() => 50 + Math.round(Math.random() * 150)) })),
});

const Dashboard = defineComponent({
  setup() {
    const data = shallowRef(randomData());
    const theme = shallowRef(chartTheme());
    onUnmounted(subscribeTheme(() => { theme.value = chartTheme(); }));
    const chart = ref<CharturboChartInstance | null>(null);
    // decal: pattern fills per series (kept by the theme switch and the SVG export)
    const options = { title: 'Revenue (Vue)', mode: 'stacked' as const, decal: true };
    return () => [
      h('div', { class: 'toolbar' }, [
        h('button', { onClick: () => (data.value = randomData()) }, 'New data'),
        h('button', { onClick: () => setThemeName(getThemeName() === 'dark' ? 'light' : 'dark') }, `Theme: ${theme.value.name}`),
        h('button', { onClick: () => chart.value?.sdk?.downloadChartSVG('vue-chart.svg') }, 'Download SVG'),
      ]),
      h(CharturboChart, {
        ref: chart,
        type: 'bar',
        data: data.value,
        options,
        theme: theme.value,
        createOptions: { locale: 'en-US' },
        style: 'height: 290px',
        onError: (e: unknown) => console.error(e),
      }),
    ];
  },
});

export default function mount(host: HTMLElement) {
  const app = createApp(Dashboard);
  app.mount(host);
  return { dispose: () => app.unmount() };
}
