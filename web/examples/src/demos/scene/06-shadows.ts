import { Charturbo, type SceneShadowMapSize } from 'charturbo';

export const meta = {
  title: 'Directional shadows · setShadows',
  description:
    'Opt-in shadow mapping from the directional light: a box, a sphere, a cylinder and a torus orbit over a plane while the sun circles overhead. The red box ignores incoming shadows (receiveShadow: false), the glass sphere casts none (castShadow: false), and the floating alpha-tested checker panel casts a shadow with holes. Toggle shadows, soften the edges (PCF radius), change the shadow map size, and switch MSAA x4 anti-aliasing (setAntialias) to smooth the stair-stepped mesh edges.',
  height: 440,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  const size = 64;
  const holes = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const on = (Math.floor((i % size) / 8) + Math.floor(i / size / 8)) % 2 === 0;
    holes.set(on ? [245, 210, 90, 255] : [0, 0, 0, 0], i * 4);
  }
  const cutout = sdk.createDataTexture(size, size, holes);

  sdk.addPlane({ position: [0, -1, 0], scale: [200, 2, 140], color: [0.62, 0.64, 0.68, 1], roughness: 0.9 });
  const orbiters = [
    sdk.addBox({ scale: [16, 16, 16], color: [0.25, 0.6, 1, 1], roughness: 0.5 }),
    sdk.addSphere({ scale: [18, 18, 18], color: [0.9, 0.55, 0.25, 1], roughness: 0.3 }),
    sdk.addCylinder({ scale: [12, 20, 12], color: [0.4, 0.85, 0.5, 1], roughness: 0.6 }),
    sdk.addCustomMesh({ ...Charturbo.createTorusMesh(8, 2.6, 24, 48), color: [0.8, 0.4, 0.9, 1], roughness: 0.4 }),
  ];
  sdk.addBox({ position: [-10, 5, 0], scale: [10, 10, 10], color: [1, 0.4, 0.4, 1], roughness: 0.5, receiveShadow: false });
  sdk.addSphere({ position: [0, 34, 0], scale: [10, 10, 10], color: [0.85, 0.92, 1, 1], roughness: 0.1, castShadow: false });
  sdk.addBox({ position: [55, 26, 30], rotation: [0, 0.4, 0], scale: [30, 0.6, 30], color: [1, 1, 1, 1], roughness: 0.7, map: cutout });
  sdk.setLighting({ ambientIntensity: 0.3, directionalIntensity: 0.95, pointPosition: [0, 60, 80], pointIntensity: 0.3 });
  sdk.setShadows({ enabled: true, mapSize: 2048, softness: 1.5 });
  sdk.setCameraPose([0, 75, 140], [0, 6, 0]);

  const toggle = toolbar.appendChild(document.createElement('button'));
  const syncToggle = () => {
    const on = sdk.getShadows().enabled;
    toggle.textContent = on ? 'shadows on' : 'shadows off';
    toggle.setAttribute('aria-pressed', String(on));
  };
  toggle.onclick = () => {
    sdk.setShadows({ enabled: !sdk.getShadows().enabled });
    syncToggle();
  };
  syncToggle();

  const softLabel = toolbar.appendChild(document.createElement('label'));
  softLabel.textContent = 'softness ';
  const softness = softLabel.appendChild(document.createElement('input'));
  softness.type = 'range';
  softness.min = '0';
  softness.max = '8';
  softness.step = '0.25';
  softness.value = '1.5';
  softness.oninput = () => sdk.setShadows({ softness: Number(softness.value) });

  const mapSize = toolbar.appendChild(document.createElement('select'));
  mapSize.setAttribute('aria-label', 'Shadow map size');
  for (const value of [512, 1024, 2048, 4096]) {
    const option = mapSize.appendChild(document.createElement('option'));
    option.value = option.textContent = String(value);
  }
  mapSize.value = '2048';
  mapSize.onchange = () => {
    sdk.setShadows({ mapSize: Number(mapSize.value) as SceneShadowMapSize });
    // The engine clamps to the device limit
    mapSize.value = String(sdk.getShadows().mapSize);
  };

  const msaa = toolbar.appendChild(document.createElement('button'));
  const syncMsaa = () => {
    const on = sdk.getAntialias() === 4;
    msaa.textContent = on ? 'MSAA x4' : 'MSAA off';
    msaa.setAttribute('aria-pressed', String(on));
  };
  msaa.onclick = () => {
    // Stays off (with a console warning) on a device without x4 support
    sdk.setAntialias(sdk.getAntialias() === 4 ? 1 : 4);
    syncMsaa();
  };
  syncMsaa();

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let t = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    t += (now - last) / 1000;
    last = now;
    orbiters.forEach((id, i) => {
      const a = t * 0.35 + (i * Math.PI) / 2;
      sdk.setObjectTransform(id, { position: [Math.cos(a) * 40, 10, Math.sin(a) * 28], rotation: [0, a, 0] });
    });
    // directionalDirection points toward the sun
    const sun = t * 0.2;
    sdk.setLighting({ directionalDirection: [Math.cos(sun) * 0.7, 1, Math.sin(sun) * 0.7] });
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      sdk.dispose();
    },
  };
}
