import { Charturbo, type LayoutPresetMode } from 'charturbo';

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
  const sdk = await Charturbo.create(canvas, { seed: 42, nodeCount: 3_000, edgeCount: 6_000, clusterCount: 8, locale: 'en-US' });
  sdk.generateDefaultMetadata('svc');
  // Default tooltip (label, category, cluster, degree, position) + built-in orbit / pan / zoom
  sdk.enableNodeInteractions(canvas, { autoRender: true });

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

  // The idle turn pauses while the pointer is over the canvas
  let hovering = false;
  canvas.onpointerenter = () => (hovering = true);
  canvas.onpointerleave = () => (hovering = false);

  // Presets are static; the camera slowly turns, and "force" steps the simulation
  let frame = 0;
  const tick = () => {
    if (simulate) sdk.stepPhysics();
    if (!hovering) sdk.rotateCamera(0.002, 0);
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  show('cluster-sphere');
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), sdk.dispose()) };
}
