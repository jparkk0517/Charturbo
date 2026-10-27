import { Charturbo, type RgbaTuple } from 'charturbo';
import { bindSceneDesign } from '../../scene-design';

export const meta = {
  title: 'Rigid-body drop with raycast picking',
  description:
    'Bodies start without spin: off-center impacts make them rotate, and friction makes spheres roll. Boxes use oriented contact manifolds; cylinders use box-shaped colliders. Click to pick. Drag orbits, Shift + drag pans, wheel zooms.',
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
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

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
        rotation: [0, 0, (Math.random() - 0.5) * 0.8],
      });
    }
    status.textContent = `${sdk.objectCount()} objects`;
    appearance.refresh();
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
  const appearance = bindSceneDesign(sdk, (brightness) => sdk.setLighting({
    ambientIntensity: 0.3 * brightness,
    directionalIntensity: brightness,
    pointIntensity: 0.5 * brightness,
  }));

  // Built-in orbit / pan / zoom; a click (press + release within 5 px) casts a ray into the scene
  const detach = sdk.enableNodeInteractions(canvas, {
    builtInTooltip: false, // no graph nodes here
    focusOnDoubleClick: false,
    onNodeClick: (_node, e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = sdk.raycastObjectAtNdc(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2);
      const picked = hit && sdk.getObjectRecord(hit.objectId);
      sdk.selectObject(picked?.id ?? null); // large static planes get an outline-only selection
      status.textContent = hit ? `${picked?.name} hit at (${hit.point.map((v) => v.toFixed(1)).join(', ')})` : `${sdk.objectCount()} objects`;
    },
  });

  // Physics + render loop
  let frame = 0;
  const tick = () => {
    sdk.stepPhysics(1 / 60);
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  reset();
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), appearance.dispose(), detach(), sdk.dispose()) };
}
