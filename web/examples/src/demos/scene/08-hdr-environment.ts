import { Charturbo, type SceneToneMapping } from 'charturbo';

export const meta = {
  title: 'HDR environment · loadEnvironmentHdr',
  description:
    'A Radiance .hdr sky (blue gradient, warm horizon, a sun 80 times brighter than white) is written in the browser as RGBE bytes and loaded with loadEnvironmentHdr, which prefilters it once on the GPU: smooth spheres show a sharp sun, rough ones a soft glow. Gold metal on top, painted plastic below, roughness rising left to right. Turn the sky with the rotation slider, change the exposure and tone mapping, or compare with the same sky as an 8-bit texture, where the sun clips to white and rough reflections go dull.',
  height: 440,
};

const W = 512;
const H = 256;

/** Linear RGB radiance of the demo sky along a direction (y up). */
function skyRadiance(d: number[], sun: number[]): number[] {
  const sunCos = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
  if (sunCos > Math.cos((1.5 * Math.PI) / 180)) return [80, 74, 62];
  // Warm glow around the sun
  const glow = Math.pow(Math.max(0, sunCos), 64) * 4;
  if (d[1] >= 0) {
    const t = Math.pow(1 - d[1], 4);
    return [0.18 + 1.1 * t + glow, 0.32 + 0.85 * t + glow * 0.8, 0.85 + 0.35 * t + glow * 0.5];
  }
  const t = Math.min(1, -d[1] * 6);
  return [0.09 + 0.45 * (1 - t), 0.08 + 0.38 * (1 - t), 0.07 + 0.3 * (1 - t)];
}

/** Equirect texels (u = 0.5 faces -z, top row up) of `skyRadiance`. */
function skyTexels(): Float32Array {
  const sun = [-0.55, 0.42, 0.72]; // behind the camera, so the spheres reflect it
  const len = Math.hypot(sun[0], sun[1], sun[2]);
  const s = sun.map((c) => c / len);
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const d = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
      rgb.set(skyRadiance(d, s), (y * W + x) * 3);
    }
  }
  return rgb;
}

/** A flat (uncompressed) Radiance RGBE file: shared 8-bit exponent per texel. */
function encodeHdr(width: number, height: number, rgb: Float32Array): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const out = new Uint8Array(header.length + width * height * 4);
  out.set(header);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    const m = Math.max(r, g, b);
    const o = header.length + i * 4;
    if (m < 1e-32) continue; // all zero
    // frexp: m = f * 2^e with f in [0.5, 1), so every mantissa is < 256
    let e = Math.floor(Math.log2(m)) + 1;
    if (m >= 2 ** e) e += 1;
    const scale = 256 / 2 ** e;
    out[o] = Math.min(255, Math.floor(r * scale));
    out[o + 1] = Math.min(255, Math.floor(g * scale));
    out[o + 2] = Math.min(255, Math.floor(b * scale));
    out[o + 3] = e + 128;
  }
  return out;
}

/** The same sky clipped to 8-bit sRGB (what an LDR equirect image would hold). */
function ldrTexels(rgb: Float32Array): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const encode = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  for (let i = 0; i < W * H; i++) out.set([encode(rgb[i * 3]), encode(rgb[i * 3 + 1]), encode(rgb[i * 3 + 2]), 255], i * 4);
  return out;
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

  const sky = skyTexels();
  const file = encodeHdr(W, H, sky);
  const started = performance.now();
  const hdr = await sdk.loadEnvironmentHdr(new Blob([file], { type: 'image/vnd.radiance' }));
  const loadMs = performance.now() - started;
  const ldr = sdk.createDataTexture(W, H, ldrTexels(sky));

  sdk.addPlane({ position: [0, -1, 0], scale: [220, 2, 140], color: [0.32, 0.33, 0.35, 1], roughness: 0.85 });
  const roughness = [0, 0.15, 0.3, 0.5, 0.75, 1];
  roughness.forEach((r, col) => {
    const x = -50 + col * 20;
    sdk.addSphere({ position: [x, 28, 0], scale: [16, 16, 16], color: [1, 0.78, 0.36, 1], metallic: 1, roughness: r });
    sdk.addSphere({ position: [x, 9, 0], scale: [16, 16, 16], color: [0.75, 0.12, 0.1, 1], metallic: 0, roughness: r });
  });
  // Only the environment lights the scene
  sdk.setLighting({ ambientIntensity: 0, directionalIntensity: 0, pointIntensity: 0 });
  sdk.setShading({ model: 'pbr', toneMapping: 'aces', exposure: 0.8, environment: { map: hdr, intensity: 1, rotation: 0 } });
  sdk.setCameraPose([0, 34, 110], [0, 18, 0]);

  const info = toolbar.appendChild(document.createElement('span'));
  info.textContent = `${(file.length / 1024).toFixed(0)} KB .hdr, loaded + prefiltered in ${loadMs.toFixed(0)} ms`;

  const source = toolbar.appendChild(document.createElement('select'));
  source.setAttribute('aria-label', 'Environment');
  for (const [value, label] of [['hdr', 'HDR (.hdr)'], ['ldr', '8-bit texture']]) {
    const option = source.appendChild(document.createElement('option'));
    option.value = value;
    option.textContent = label;
  }
  source.onchange = () => sdk.setShading({ environment: { map: source.value === 'hdr' ? hdr : ldr } });

  const slider = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
    const wrap = toolbar.appendChild(document.createElement('label'));
    wrap.textContent = `${label} `;
    const input = wrap.appendChild(document.createElement('input'));
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.oninput = () => set(Number(input.value));
  };
  slider('rotation', -Math.PI, Math.PI, 0.01, 0, (rotation) => sdk.setShading({ environment: { rotation } }));
  slider('exposure', 0.1, 3, 0.05, 0.8, (exposure) => sdk.setShading({ exposure }));

  const toneMapping = toolbar.appendChild(document.createElement('select'));
  toneMapping.setAttribute('aria-label', 'Tone mapping');
  for (const value of ['aces', 'reinhard', 'none']) {
    const option = toneMapping.appendChild(document.createElement('option'));
    option.value = option.textContent = value;
  }
  toneMapping.onchange = () => sdk.setShading({ toneMapping: toneMapping.value as SceneToneMapping });

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  const tick = () => {
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      sdk.disposeTexture(hdr);
      sdk.disposeTexture(ldr);
      sdk.dispose();
    },
  };
}
