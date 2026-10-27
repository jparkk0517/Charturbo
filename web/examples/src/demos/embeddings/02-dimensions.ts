import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Any dimension: 128 → 3072',
  description:
    'The same pipeline for common embedding sizes. Without cluster ids the engine runs spherical k-means in the original space to color the points; the status line shows the projection + k-NN time.',
  height: 400,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const status = document.createElement('span');
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0, locale: 'en-US' });
  sdk.setHelpers({ showAxes: true, axesLength: 85 });
  // Built-in orbit / pan / zoom
  sdk.enableNodeInteractions(canvas, {
    autoRender: true,
    formatTooltip: (d) => `<b>vector #${d.id}</b><div style="color:#38bdf8">cluster ${d.clusterId} · ${d.degree} neighbors</div>`,
  });

  const load = (dimensions: number) => {
    const { vectors } = Charturbo.generateSyntheticHighDimEmbeddings(800, dimensions, 6, dimensions);
    const stats = sdk.loadEmbeddings(vectors, { dimensions, projection: 'pca', kNeighbors: 3, similarityThreshold: 0.3 });
    sdk.setCameraPose([0, 50, 160], [0, 0, 0]);
    sdk.render();
    status.textContent = `${stats.nodeCount} × ${stats.dimensions}D → 3D · ${stats.edgeCount.toLocaleString()} edges · ${stats.elapsedMs.toFixed(0)} ms`;
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.dim === String(dimensions)));
  };
  for (const dim of [128, 384, 768, 1536, 3072]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = `${dim}D`;
    button.dataset.dim = String(dim);
    button.onclick = () => load(dim);
  }
  toolbar.appendChild(status);

  // The camera turns slowly while the pointer is away
  let hovering = false;
  canvas.onpointerenter = () => (hovering = true);
  canvas.onpointerleave = () => (hovering = false);
  let frame = 0;
  const tick = () => {
    if (!hovering) sdk.rotateCamera(0.0025, 0);
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  load(1536);
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), sdk.dispose()) };
}
