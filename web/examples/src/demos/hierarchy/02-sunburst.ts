import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Sunburst from flat rows',
  description: 'Rows of { id, parent, value }; click an arc to zoom into it, the center to go up.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const rows = [
    { id: 'src', name: 'src' },
    { id: 'sdk', parent: 'src', name: 'sdk' },
    { id: 'core', parent: 'sdk', name: 'viz-engine-sdk.ts', value: 294 },
    { id: 'a11y', parent: 'sdk', name: 'chart-a11y.ts', value: 79 },
    { id: 'hier', parent: 'sdk', name: 'chart-hierarchy.ts', value: 47 },
    { id: 'exp', parent: 'sdk', name: 'chart-export.ts', value: 23 },
    { id: 'react', parent: 'src', name: 'react' },
    { id: 'rc', parent: 'react', name: 'VizChart.tsx', value: 2.3 },
    { id: 'rh', parent: 'react', name: 'useVizChart.ts', value: 4.7 },
    { id: 'vue', parent: 'src', name: 'vue' },
    { id: 'vc', parent: 'vue', name: 'VizChart.ts', value: 3.7 },
    { id: 'vh', parent: 'vue', name: 'useVizChart.ts', value: 3.8 },
    { id: 'wasm', parent: 'src', name: 'wasm-pkg' },
    { id: 'js', parent: 'wasm', name: 'viz_core.js', value: 221 },
    { id: 'dts', parent: 'wasm', name: 'viz_core.d.ts', value: 73 },
  ];
  sdk.renderSunburst(rows, { title: 'Source size (KB)', format: ',.1f' });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
