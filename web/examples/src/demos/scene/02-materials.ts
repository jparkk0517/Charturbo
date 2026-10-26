import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Materials · lighting · custom mesh',
  description:
    'Spheres from rough to glossy (left → right) and dielectric to metallic (front → back), an emissive row, and a custom torus mesh. The point light circles the scene; toggle the lights to compare.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { nodeCount: 0, edgeCount: 0 });

  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false); // a still life: no gravity
  sdk.addPlane({ position: [0, -1, 0], scale: [170, 2, 120], color: [0.1, 0.12, 0.17, 1], roughness: 0.95 });
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      sdk.addSphere({
        position: [-50 + col * 20, 8, -25 + row * 20],
        scale: [14, 14, 14],
        color: [0.85, 0.55, 0.25, 1],
        roughness: 1 - col / 5,
        metallic: row / 2,
      });
    }
  }
  for (let col = 0; col < 6; col++) {
    sdk.addBox({ position: [-50 + col * 20, 5, 38], scale: [10, 10, 10], color: [0.25, 0.6, 1, 1], emissive: col / 5 });
  }
  const torus = sdk.addCustomMesh({
    name: 'torus',
    ...VizEngineSDK.createTorusMesh(8, 2.6, 24, 48), // positions, normals, indices
    position: [0, 40, -10],
    color: [0.62, 0.5, 0.92, 1],
    metallic: 0.8,
    roughness: 0.2,
  });
  sdk.setCameraPose([0, 75, 135], [0, 10, 0]);

  const lights = { ambient: true, directional: true, point: true };
  const applyLights = () =>
    sdk.setLighting({
      ambientIntensity: lights.ambient ? 0.28 : 0.02,
      directionalIntensity: lights.directional ? 0.9 : 0,
      pointIntensity: lights.point ? 0.9 : 0,
    });
  for (const key of ['ambient', 'directional', 'point'] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = `${key} light`;
    button.setAttribute('aria-pressed', 'true');
    button.onclick = () => {
      lights[key] = !lights[key];
      button.setAttribute('aria-pressed', String(lights[key]));
      applyLights();
    };
  }
  applyLights();

  // Built-in orbit (drag), pan (Shift / right drag) and zoom (wheel)
  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

  // Animate: the point light circles, the torus spins
  let frame = 0;
  const start = performance.now();
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    sdk.setLighting({ pointPosition: [Math.cos(t * 0.8) * 60, 35, Math.sin(t * 0.8) * 60] });
    sdk.setObjectTransform(torus, { rotation: [t * 0.6, t * 0.9, 0] });
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), detach(), sdk.dispose()) };
}
