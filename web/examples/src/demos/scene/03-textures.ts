import { Charturbo } from 'charturbo';
import { bindSceneDesign } from '../../scene-design';

export const meta = {
  title: 'Textures · UV mapping · alpha cutout',
  description:
    'A checkerboard from createDataTexture tiles the floor (mapRepeat), a procedural canvas texture wraps a box, a sphere and a custom torus (its uvs come with createTorusMesh), and a cutout plane with alphaTest shows the sky through its holes. Toggle the tiling or tint the floor with the buttons.',
  height: 420,
};

/** 8 x 8 texel checkerboard as RGBA8 (first row = top of the image). */
function checkerboard(size: number, a: [number, number, number], b: [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, bl] = (x + y) % 2 === 0 ? a : b;
      rgba.set([r, g, bl, 255], (y * size + x) * 4);
    }
  }
  return rgba;
}

/** A canvas painted at runtime: warm diagonal stripes with a ring and an arrow that shows the orientation. */
function stripedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, '#f6b042');
  gradient.addColorStop(1, '#d1495b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  for (let i = -256; i < 256; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 256);
    ctx.lineTo(i + 24, 256);
    ctx.lineTo(i + 280, 0);
    ctx.lineTo(i + 256, 0);
    ctx.fill();
  }
  ctx.strokeStyle = '#1b2430';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1b2430';
  ctx.beginPath(); // the arrow points to the top of the image (v = 0)
  ctx.moveTo(128, 50);
  ctx.lineTo(166, 110);
  ctx.lineTo(90, 110);
  ctx.fill();
  return canvas;
}

/** A canvas with transparent holes: fragments under alphaTest are discarded. */
function cutoutCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2f9e75';
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalCompositeOperation = 'destination-out';
  for (const [x, y] of [[32, 32], [96, 32], [32, 96], [96, 96]]) {
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
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

  // Textures: raw texels, and decoded canvases (any image source works the same way)
  const checker = sdk.createDataTexture(8, 8, checkerboard(8, [236, 239, 244], [96, 108, 128]));
  const stripes = await sdk.loadTexture(stripedCanvas());
  const cutout = await sdk.loadTexture(cutoutCanvas());

  const floor = sdk.addPlane({
    position: [0, -1, 0],
    scale: [170, 2, 120],
    color: [1, 1, 1, 1],
    roughness: 0.95,
    map: checker,
    mapRepeat: [16, 12],
  });
  const box = sdk.addBox({ position: [-40, 12, 0], scale: [22, 22, 22], map: stripes, roughness: 0.6 });
  const sphere = sdk.addSphere({ position: [0, 14, 0], scale: [26, 26, 26], map: stripes, mapRepeat: [2, 1], metallic: 0.1, roughness: 0.4 });
  const torus = sdk.addCustomMesh({
    name: 'torus',
    ...Charturbo.createTorusMesh(8, 2.8, 24, 48), // positions, normals, uvs, indices
    position: [40, 20, 0],
    map: stripes,
    mapRepeat: [4, 1],
    metallic: 0.2,
    roughness: 0.35,
  });
  // A cutout wall: alphaTest 0.5 is the default for textured objects
  const wall = sdk.addBox({ position: [0, 14, 30], scale: [60, 28, 1], map: cutout, alphaTest: 0.5, roughness: 0.8 });
  sdk.setCameraPose([0, 70, 140], [0, 10, 0]);

  let tiled = true;
  const tiling = toolbar.appendChild(document.createElement('button'));
  tiling.textContent = 'floor tiling';
  tiling.setAttribute('aria-pressed', 'true');
  tiling.onclick = () => {
    tiled = !tiled;
    tiling.setAttribute('aria-pressed', String(tiled));
    sdk.setObjectMaterial(floor, { mapRepeat: tiled ? [16, 12] : [4, 3] });
  };
  let tinted = false;
  // The color multiplies the texture: white shows it as drawn
  const paint = () => {
    for (const id of [box, sphere, torus, wall]) sdk.setObjectMaterial(id, { color: [1, 1, 1, 1] });
    sdk.setObjectMaterial(floor, { color: tinted ? [0.55, 0.8, 1, 1] : [1, 1, 1, 1] });
  };
  const tint = toolbar.appendChild(document.createElement('button'));
  tint.textContent = 'tint';
  tint.setAttribute('aria-pressed', 'false');
  tint.onclick = () => {
    tinted = !tinted;
    tint.setAttribute('aria-pressed', String(tinted));
    paint();
  };

  // The shared design panel recolors objects; paint() restores the white base color after each change
  const appearance = bindSceneDesign(sdk, (brightness) => {
    sdk.setLighting({ ambientIntensity: 0.4 * brightness, directionalIntensity: 0.9 * brightness, pointIntensity: 0.5 * brightness });
    paint();
  });
  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

  // Animate: the torus spins and its texture scrolls
  let frame = 0;
  const start = performance.now();
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    sdk.setObjectTransform(torus, { rotation: [t * 0.5, t * 0.8, 0] });
    sdk.setObjectMaterial(torus, { mapOffset: [(t * 0.1) % 1, 0] });
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      appearance.dispose();
      detach();
      sdk.dispose();
    },
  };
}
