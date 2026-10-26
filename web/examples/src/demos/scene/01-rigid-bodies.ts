import { VizEngineSDK, type RgbaTuple } from 'viz-engine-sdk';

export const meta = {
  title: 'Rigid-body drop with raycast picking',
  description:
    'Dynamic boxes, spheres and cylinders fall under gravity and collide with a static floor and steps (AABB contacts, restitution). Click an object: a ray from the camera returns the object and the hit point. Drag orbits, wheel zooms.',
  height: 460,
};

const PALETTE: RgbaTuple[] = [
  [0.22, 0.53, 0.9, 1],
  [0.95, 0.55, 0.2, 1],
  [0.3, 0.78, 0.55, 1],
  [0.86, 0.33, 0.45, 1],
  [0.62, 0.5, 0.92, 1],
];

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const status = document.createElement('span');
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { nodeCount: 0, edgeCount: 0 });

  let dropped = 0;
  const drop = (count: number) => {
    for (let i = 0; i < count; i++, dropped++) {
      const shape = (['box', 'sphere', 'cylinder'] as const)[dropped % 3];
      const size = 6 + (dropped % 4) * 1.5;
      sdk.addPrimitive({
        name: `${shape}-${dropped}`,
        shape,
        position: [(Math.random() - 0.5) * 50, 50 + Math.random() * 60, (Math.random() - 0.5) * 30],
        scale: [size, size, size],
        color: PALETTE[dropped % PALETTE.length],
        metallic: shape === 'sphere' ? 0.6 : 0.1,
        roughness: shape === 'sphere' ? 0.25 : 0.6,
        bodyType: 'dynamic',
        restitution: 0.35,
        angularVelocity: [Math.random() - 0.5, Math.random() - 0.5, 0],
      });
    }
    status.textContent = `${sdk.objectCount()} objects`;
  };
  const reset = () => {
    dropped = 0;
    sdk.loadScene({
      lighting: { ambientIntensity: 0.3, directionalDirection: [0.4, 0.9, 0.5], directionalIntensity: 1, pointIntensity: 0.5 },
      helpers: { showGrid: true, gridSize: 160, gridDivisions: 16 },
      rigidPhysics: { enabled: true, gravity: [0, -40, 0] },
      graphVisible: false,
      objects: [
        { kind: 'primitive', name: 'floor', shape: 'plane', position: [0, -1, 0], scale: [160, 2, 160], color: [0.11, 0.14, 0.2, 1], roughness: 0.9 },
        { kind: 'primitive', name: 'step', shape: 'box', position: [-25, 5, 0], scale: [30, 10, 30], color: [0.2, 0.25, 0.34, 1] },
        { kind: 'primitive', name: 'pillar', shape: 'cylinder', position: [30, 10, -10], scale: [10, 20, 10], color: [0.2, 0.25, 0.34, 1] },
      ],
    });
    sdk.setCameraPose([0, 55, 115], [0, 10, 0]);
    drop(18);
  };
  for (const [label, run] of [['Drop 10', () => drop(10)], ['Reset', reset]] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = label;
    button.onclick = run;
  }
  toolbar.appendChild(status);

  // Mouse orbit / zoom + click-to-pick (a click = press and release within 5 px)
  const events = new AbortController();
  const signal = events.signal;
  let last: { x: number; y: number } | null = null;
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (last = down = { x: e.clientX, y: e.clientY }), { signal });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || e.buttons === 0) return;
    sdk.rotateCamera(-(e.clientX - last.x) * 0.006, (e.clientY - last.y) * 0.006);
    last = { x: e.clientX, y: e.clientY };
  }, { signal });
  canvas.addEventListener('pointerup', (e) => {
    last = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const hit = sdk.raycastObjectAtNdc(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2);
    const picked = hit && sdk.getObjectRecord(hit.objectId);
    sdk.selectObject(picked?.bodyType === 'dynamic' ? picked.id : null); // outline falling objects only
    status.textContent = hit ? `${picked?.name} hit at (${hit.point.map((v) => v.toFixed(1)).join(', ')})` : `${sdk.objectCount()} objects`;
  }, { signal });
  canvas.addEventListener('wheel', (e) => (e.preventDefault(), sdk.zoomCamera(e.deltaY * 0.18)), { passive: false, signal });

  // Physics + render loop
  let frame = 0;
  const tick = () => {
    sdk.stepPhysics(1 / 60);
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  reset();
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), events.abort(), sdk.dispose()) };
}
