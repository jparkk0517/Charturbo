import { VizEngineSDK, type LayoutPresetMode } from 'viz-engine-sdk';

export const meta = {
  title: 'Layout presets',
  description:
    'applyLayout places every node instantly (cluster sphere, radial shells, helix, 3D grid); "force" hands the positions back to the simulation. The graph comes from the built-in seeded generator.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  // Seeded synthetic graph: 3,000 nodes, 6,000 edges in 8 clusters
  const sdk = await VizEngineSDK.create(canvas, { seed: 42, nodeCount: 3_000, edgeCount: 6_000, clusterCount: 8, locale: 'en-US' });
  sdk.generateDefaultMetadata('svc');
  sdk.enableNodeInteractions(canvas, {
    autoRender: true,
    formatTooltip: (d) => `<b>${d.label}</b><div style="color:#38bdf8">${d.metadata.category} · cluster ${d.clusterId}</div>`,
  });

  let simulate = false;
  const show = (mode: LayoutPresetMode | 'force') => {
    simulate = mode === 'force';
    if (mode === 'force') sdk.wakeUp();
    else sdk.applyLayout(mode, 85); // radius of the layout volume
    sdk.fitToView();
    sdk.render();
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === mode));
  };
  for (const mode of ['cluster-sphere', 'radial-shells', 'helix', 'grid-3d', 'force'] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = mode;
    button.onclick = () => show(mode);
  }

  // Mouse orbit / pan / zoom (touch gestures are built into enableNodeInteractions)
  const events = new AbortController();
  const signal = events.signal;
  let last: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId); // the release lands here even outside the canvas
  }, { signal });
  canvas.addEventListener('pointerup', () => (last = null), { signal });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || e.buttons === 0) return;
    const [dx, dy] = [e.clientX - last.x, e.clientY - last.y];
    last = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) sdk.panCamera(-dx * 0.25, dy * 0.25);
    else sdk.rotateCamera(-dx * 0.006, dy * 0.006);
    sdk.render();
  }, { signal });
  canvas.addEventListener('wheel', (e) => (e.preventDefault(), sdk.zoomCamera(e.deltaY * 0.18), sdk.render()), { passive: false, signal });

  // Presets are static; the camera slowly turns, and "force" steps the simulation
  let frame = 0;
  const tick = () => {
    if (simulate) sdk.stepPhysics();
    if (!last) sdk.rotateCamera(0.002, 0);
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  show('cluster-sphere');
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), events.abort(), sdk.dispose()) };
}
