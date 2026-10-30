import { Charturbo, type ScenePointShadowMapSize, type Vec3Tuple } from 'charturbo';

export const meta = {
  title: 'Point-light shadows · setShadows({ point })',
  description:
    'Omnidirectional shadows from the point light: a glowing lamp drifts over a ring of boxes, pillars, spheres and a cylinder, and their shadows swing outward on every side (six cube-map faces rendered from the lamp each frame). The lamp bulb casts no shadow (castShadow: false), the red box ignores incoming shadows (receiveShadow: false), and the floating alpha-tested checker panel casts a holed shadow. Toggle point shadows, soften the edges (PCF radius) and change the cube face size.',
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

  sdk.addPlane({ position: [0, -1, 0], scale: [200, 2, 140], color: [0.62, 0.63, 0.66, 1], roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const pos: Vec3Tuple = [Math.cos(a) * 38, 0, Math.sin(a) * 30];
    if (i % 2 === 0) {
      sdk.addBox({ position: [pos[0], 12, pos[2]], scale: [6, 24, 6], color: [0.9, 0.86, 0.78, 1], roughness: 0.6 });
    } else {
      sdk.addSphere({ position: [pos[0], 6, pos[2]], scale: [12, 12, 12], color: [0.9, 0.55, 0.25, 1], roughness: 0.35 });
    }
  }
  sdk.addBox({ position: [-14, 7, 8], rotation: [0, 0.5, 0], scale: [12, 14, 12], color: [0.25, 0.6, 1, 1], roughness: 0.5 });
  sdk.addCylinder({ position: [16, 6, -6], scale: [9, 12, 9], color: [0.4, 0.85, 0.5, 1], roughness: 0.6 });
  sdk.addBox({ position: [-26, 3, 18], scale: [6, 6, 6], color: [1, 0.4, 0.4, 1], roughness: 0.5, receiveShadow: false });
  sdk.addBox({ position: [10, 16, 18], rotation: [0, 0.3, 0], scale: [12, 0.6, 12], color: [1, 1, 1, 1], roughness: 0.7, map: cutout });
  const bulb = sdk.addSphere({ scale: [2.5, 2.5, 2.5], color: [1, 0.95, 0.7, 1], emissive: 1, castShadow: false, receiveShadow: false });

  sdk.setLighting({ ambientIntensity: 0.12, directionalIntensity: 0, pointIntensity: 1.6 });
  sdk.setShadows({ point: { enabled: true, mapSize: 512, softness: 1 } });
  sdk.setCameraPose([0, 80, 120], [0, 4, 0]);

  const toggle = toolbar.appendChild(document.createElement('button'));
  const syncToggle = () => {
    const on = sdk.getShadows().point.enabled;
    toggle.textContent = on ? 'point shadows on' : 'point shadows off';
    toggle.setAttribute('aria-pressed', String(on));
  };
  toggle.onclick = () => {
    sdk.setShadows({ point: { enabled: !sdk.getShadows().point.enabled } });
    syncToggle();
  };
  syncToggle();

  const softLabel = toolbar.appendChild(document.createElement('label'));
  softLabel.textContent = 'softness ';
  const softness = softLabel.appendChild(document.createElement('input'));
  softness.type = 'range';
  softness.min = '0';
  softness.max = '4';
  softness.step = '0.25';
  softness.value = '1';
  softness.oninput = () => sdk.setShadows({ point: { softness: Number(softness.value) } });

  const mapSize = toolbar.appendChild(document.createElement('select'));
  mapSize.setAttribute('aria-label', 'Cube face size');
  for (const value of [256, 512, 1024]) {
    const option = mapSize.appendChild(document.createElement('option'));
    option.value = String(value);
    option.textContent = `${value}²`;
  }
  mapSize.value = '512';
  mapSize.onchange = () => {
    sdk.setShadows({ point: { mapSize: Number(mapSize.value) as ScenePointShadowMapSize } });
    // The engine clamps to the device limit
    mapSize.value = String(sdk.getShadows().point.mapSize);
  };

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let t = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    t += (now - last) / 1000;
    last = now;
    // The lamp drifts on a slow figure eight and bobs up and down
    const lamp: Vec3Tuple = [Math.sin(t * 0.4) * 22, 22 + Math.sin(t * 0.9) * 6, Math.sin(t * 0.8) * 14];
    sdk.setObjectTransform(bulb, { position: lamp });
    sdk.setLighting({ pointPosition: lamp });
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
