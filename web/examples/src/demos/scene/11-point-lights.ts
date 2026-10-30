import { Charturbo, MAX_POINT_LIGHTS, type Vec3Tuple } from 'charturbo';

export const meta = {
  title: 'Multiple point lights · addPointLight',
  description:
    'Up to eight coloured point lights beside the setLighting one: red, green and blue lamps orbit over a floor of white spheres and pillars, mixing their colours where they overlap (cyan, magenta, yellow and white). Each light fades out smoothly at its range; PBR shading uses an inverse-square falloff, classic the familiar point attenuation. Add or remove lights, widen their range and switch the shading model.',
  height: 440,
};

const PALETTE: Vec3Tuple[] = [
  [1, 0.2, 0.15],
  [0.2, 1, 0.3],
  [0.2, 0.4, 1],
  [1, 0.8, 0.2],
  [0.9, 0.3, 1],
  [0.2, 0.95, 1],
  [1, 0.5, 0.1],
  [1, 1, 1],
];

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  sdk.addPlane({ position: [0, -1, 0], scale: [200, 2, 140], color: [0.8, 0.8, 0.82, 1], roughness: 0.85 });
  for (let i = 0; i < 7; i++) {
    const a = (i * 2 * Math.PI) / 7;
    sdk.addSphere({ position: [Math.cos(a) * 34, 6, Math.sin(a) * 26], scale: [12, 12, 12], color: [0.95, 0.95, 0.95, 1], roughness: 0.35 });
  }
  sdk.addCylinder({ position: [0, 9, 0], scale: [10, 18, 10], color: [0.9, 0.9, 0.9, 1], roughness: 0.5 });
  // The setLighting lights stay dim so the coloured ones read
  sdk.setLighting({ ambientIntensity: 0.06, directionalIntensity: 0.08, pointIntensity: 0 });
  sdk.setCameraPose([0, 70, 105], [0, 4, 0]);

  let pbr = false;
  let range = 60;
  // Per light: id, bulb object, orbit phase
  const lights: { id: number; bulb: number; phase: number }[] = [];
  const intensity = () => (pbr ? 500 : 1.6);

  const status = document.createElement('span');
  const sync = () => {
    status.textContent = ` ${lights.length} / ${MAX_POINT_LIGHTS} lights`;
    add.disabled = lights.length >= MAX_POINT_LIGHTS;
    remove.disabled = lights.length === 0;
  };
  const addLight = () => {
    const i = lights.length;
    const color = PALETTE[i % PALETTE.length];
    const id = sdk.addPointLight({ position: [0, 14, 0], color, intensity: intensity(), range });
    const bulb = sdk.addSphere({ scale: [2, 2, 2], color: [...color, 1], emissive: 1 });
    lights.push({ id, bulb, phase: (i * 2 * Math.PI) / 3 + Math.floor(i / 3) * 0.6 });
  };

  const add = toolbar.appendChild(document.createElement('button'));
  add.textContent = 'add light';
  add.onclick = () => {
    addLight();
    sync();
  };
  const remove = toolbar.appendChild(document.createElement('button'));
  remove.textContent = 'remove light';
  remove.onclick = () => {
    const l = lights.pop();
    if (l) {
      sdk.removePointLight(l.id);
      sdk.removeObject(l.bulb);
    }
    sync();
  };

  const rangeLabel = toolbar.appendChild(document.createElement('label'));
  rangeLabel.textContent = 'range ';
  const rangeInput = rangeLabel.appendChild(document.createElement('input'));
  rangeInput.type = 'range';
  rangeInput.min = '15';
  rangeInput.max = '120';
  rangeInput.value = String(range);
  rangeInput.oninput = () => {
    range = Number(rangeInput.value);
    for (const l of lights) sdk.setPointLight(l.id, { range });
  };

  const model = toolbar.appendChild(document.createElement('button'));
  const syncModel = () => {
    model.textContent = pbr ? 'PBR' : 'classic';
    model.setAttribute('aria-pressed', String(pbr));
  };
  model.onclick = () => {
    pbr = !pbr;
    sdk.setShading(pbr ? { model: 'pbr', toneMapping: 'aces', environment: { intensity: 0.15 } } : { model: 'classic' });
    for (const l of lights) sdk.setPointLight(l.id, { intensity: intensity() });
    syncModel();
  };
  syncModel();
  toolbar.appendChild(status);

  for (let i = 0; i < 3; i++) addLight();
  sync();

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let t = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    t += (now - last) / 1000;
    last = now;
    lights.forEach((l, i) => {
      // Each light orbits the centre on its own radius, speed and height
      const a = l.phase + t * (0.35 + 0.08 * i);
      const r = 22 + (i % 3) * 7;
      const pos: Vec3Tuple = [Math.cos(a) * r, 12 + Math.sin(t * 0.7 + i) * 4, Math.sin(a) * r * 0.8];
      sdk.setPointLight(l.id, { position: pos });
      sdk.setObjectTransform(l.bulb, { position: pos });
    });
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
