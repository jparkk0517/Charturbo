import { Charturbo } from 'charturbo';

export const meta = {
  title: 'PBR material maps · normalMap · aoMap',
  description:
    'glTF-style texture maps on PBR materials, all generated with createDataTexture: a tiled brick wall with a normal map and an occlusion map in the mortar, a sphere with metallic-roughness stripes (polished metal next to matte paint), a riveted panel whose bolts come from a normal map, and a box with an emissive ring. The objects turn slowly so the lighting moves across the bumps. Toggle each map, change the normal strength, and switch to the classic model, which ignores the maps.',
  height: 440,
};

/** `size` x `size` RGBA8 texels from a function of (x, y). */
function texels(size: number, f: (x: number, y: number) => number[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.set(f(x, y), (y * size + x) * 4);
  return out;
}

/** Packs a tangent-space normal (+y = up in the image) into RGB. */
const packNormal = (n: number[]) => {
  const len = Math.hypot(n[0], n[1], n[2]);
  return [...n.map((c) => Math.round((c / len) * 127.5 + 127.5)), 255];
};

/** Bricks: 2 rows of 2 bricks per tile, offset every other row; `mortar` is the joint width. */
function brickAt(x: number, y: number, size: number) {
  const rowH = size / 4;
  const row = Math.floor(y / rowH);
  const bx = (x + (row % 2) * (size / 4)) % (size / 2);
  const by = y % rowH;
  // Distance (texels) to the nearest joint, signed by direction for the bevel normal
  const dl = bx, dr = size / 2 - 1 - bx, dt = by, db = rowH - 1 - by;
  return { row, dl, dr, dt, db, edge: Math.min(dl, dr, dt, db) };
}

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);

  const S = 128;
  const bevel = 3;
  const brickColor = sdk.createDataTexture(S, S, texels(S, (x, y) => {
    const b = brickAt(x, y, S);
    if (b.edge < 1.5) return [190, 185, 175, 255];
    const tint = ((b.row * 7 + Math.floor((x + (b.row % 2) * 32) / 64) * 3) % 5) * 10;
    return [160 + tint, 70 + tint / 2, 50, 255];
  }));
  const brickNormal = sdk.createDataTexture(S, S, texels(S, (x, y) => {
    const b = brickAt(x, y, S);
    if (b.edge < 1.5) return packNormal([0, 0, 1]);
    // Bevelled brick edges tilt away from the brick centre
    let nx = 0, ny = 0;
    if (b.dl < bevel) nx -= 1 - b.dl / bevel;
    if (b.dr < bevel) nx += 1 - b.dr / bevel;
    if (b.dt < bevel) ny += 1 - b.dt / bevel;
    if (b.db < bevel) ny -= 1 - b.db / bevel;
    return packNormal([nx, ny, 1]);
  }));
  const brickAo = sdk.createDataTexture(S, S, texels(S, (x, y) => {
    const e = brickAt(x, y, S).edge;
    return [Math.round(Math.min(1, 0.35 + e * 0.2) * 255), 255, 255, 255];
  }));
  const stripes = sdk.createDataTexture(64, 64, texels(64, (x) => (Math.floor(x / 8) % 2 === 0 ? [0, 30, 255, 255] : [0, 220, 0, 255])));
  const rivets = sdk.createDataTexture(64, 64, texels(64, (x, y) => {
    const dx = ((x % 16) - 7.5) / 4, dy = ((y % 16) - 7.5) / 4;
    const r2 = dx * dx + dy * dy;
    return packNormal(r2 < 1 ? [dx, -dy, Math.sqrt(1 - r2)] : [0, 0, 1]);
  }));
  const ring = sdk.createDataTexture(64, 64, texels(64, (x, y) => {
    const r = Math.hypot(x - 31.5, y - 31.5);
    return r > 15 && r < 23 ? [255, 255, 255, 255] : r < 6 ? [120, 120, 120, 255] : [0, 0, 0, 255];
  }));

  sdk.addPlane({ position: [0, -1, 0], scale: [220, 2, 140], color: [0.45, 0.47, 0.5, 1], roughness: 0.8 });
  const wall = sdk.addBox({ position: [-52, 16, 0], scale: [30, 30, 30], color: [1, 1, 1, 1], roughness: 0.85, map: brickColor });
  const sphere = sdk.addSphere({ position: [-16, 16, 0], scale: [28, 28, 28], color: [0.95, 0.78, 0.45, 1], metallic: 1, roughness: 1 });
  const panel = sdk.addBox({ position: [18, 16, 0], scale: [28, 28, 28], color: [0.6, 0.65, 0.7, 1], metallic: 0.8, roughness: 0.4, mapRepeat: [2, 2] });
  const lamp = sdk.addBox({ position: [52, 16, 0], scale: [26, 26, 26], color: [0.12, 0.12, 0.14, 1], roughness: 0.5 });
  const spinners = [wall, sphere, panel, lamp];

  sdk.setLighting({ ambientIntensity: 0.3, directionalDirection: [-0.5, 0.9, 0.6], directionalIntensity: 1.2, pointPosition: [40, 50, 60], pointIntensity: 0.4 });
  sdk.setShading({ model: 'pbr', toneMapping: 'aces', exposure: 1.1, environment: { sky: [0.65, 0.72, 0.85], ground: [0.3, 0.27, 0.24], intensity: 1 } });
  sdk.setShadows({ enabled: true, softness: 1.5 });
  sdk.setCameraPose([0, 45, 125], [0, 14, 0]);

  const state = { normal: true, ao: true, mr: true, emissive: true, scale: 1 };
  const apply = () => {
    sdk.setObjectMaterial(wall, { normalMap: state.normal ? brickNormal : null, normalScale: state.scale, aoMap: state.ao ? brickAo : null });
    sdk.setObjectMaterial(sphere, { metallicRoughnessMap: state.mr ? stripes : null });
    sdk.setObjectMaterial(panel, { normalMap: state.normal ? rivets : null, normalScale: state.scale });
    sdk.setObjectMaterial(lamp, state.emissive ? { emissiveMap: ring, emissiveColor: [1, 0.5, 0.12] } : { emissiveMap: null, emissiveColor: [0, 0, 0] });
  };
  apply();

  const toggle = (label: string, key: 'normal' | 'ao' | 'mr' | 'emissive') => {
    const button = toolbar.appendChild(document.createElement('button'));
    const sync = () => {
      button.textContent = `${label} ${state[key] ? 'on' : 'off'}`;
      button.setAttribute('aria-pressed', String(state[key]));
    };
    button.onclick = () => {
      state[key] = !state[key];
      apply();
      sync();
    };
    sync();
  };
  toggle('normalMap', 'normal');
  toggle('aoMap', 'ao');
  toggle('metallicRoughnessMap', 'mr');
  toggle('emissiveMap', 'emissive');

  const scaleLabel = toolbar.appendChild(document.createElement('label'));
  scaleLabel.textContent = 'normalScale ';
  const scale = scaleLabel.appendChild(document.createElement('input'));
  scale.type = 'range';
  scale.min = '-2';
  scale.max = '3';
  scale.step = '0.1';
  scale.value = '1';
  scale.oninput = () => {
    state.scale = Number(scale.value);
    apply();
  };

  const model = toolbar.appendChild(document.createElement('select'));
  model.setAttribute('aria-label', 'Shading model');
  for (const value of ['pbr', 'classic']) {
    const option = model.appendChild(document.createElement('option'));
    option.value = option.textContent = value;
  }
  model.onchange = () => sdk.setShading({ model: model.value as 'pbr' | 'classic' });

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let t = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    t += (now - last) / 1000;
    last = now;
    spinners.forEach((id, i) => sdk.setObjectTransform(id, { rotation: [0, t * 0.3 + i * 0.6, 0] }));
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
