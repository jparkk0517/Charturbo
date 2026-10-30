import { Charturbo, type GltfLoadResult, type RgbaTuple } from 'charturbo';
import { bindSceneDesign } from '../../scene-design';

export const meta = {
  title: 'glTF models · loadGltf',
  description:
    'A low-poly cottage and tree built in memory as a GLB file (binary chunk, embedded PNG textures, node hierarchy, KHR_texture_transform tiling on the roof) and loaded with loadGltf three times with different position / rotation / scale. disposeGltf removes a model with its textures; the buttons reload the models or stop the turntable.',
  height: 420,
};

/** Paints a texture with integer rects (crisp pixels) and encodes it as PNG bytes. */
async function pngTexture(size: number, paint: (g: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d')!);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Collects buffer views / accessors and writes the GLB container (JSON chunk + BIN chunk). */
class GlbWriter {
  readonly bufferViews: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  readonly accessors: Record<string, unknown>[] = [];
  private parts: Uint8Array[] = [];
  private length = 0;

  view(bytes: Uint8Array): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.parts.push(new Uint8Array(pad));
    this.length += pad;
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength });
    this.parts.push(bytes);
    this.length += bytes.byteLength;
    return this.bufferViews.length - 1;
  }

  accessor(data: number[], type: 'SCALAR' | 'VEC2' | 'VEC3', indices = false): number {
    const typed = indices ? new Uint16Array(data) : new Float32Array(data);
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const acc: Record<string, unknown> = { bufferView: this.view(new Uint8Array(typed.buffer)), componentType: indices ? 5123 : 5126, count: data.length / size, type };
    if (type === 'VEC3' && !indices) {
      // POSITION accessors need min / max
      acc.min = [0, 1, 2].map((k) => Math.min(...data.filter((_, i) => i % 3 === k)));
      acc.max = [0, 1, 2].map((k) => Math.max(...data.filter((_, i) => i % 3 === k)));
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  write(json: Record<string, unknown>): ArrayBuffer {
    const text = new TextEncoder().encode(JSON.stringify({ ...json, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{ byteLength: this.length }] }));
    const jsonLen = Math.ceil(text.byteLength / 4) * 4;
    const binLen = Math.ceil(this.length / 4) * 4;
    const out = new Uint8Array(28 + jsonLen + binLen);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.byteLength, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4e4f534a, true); // JSON
    out.fill(0x20, 20, 20 + jsonLen);
    out.set(text, 20);
    dv.setUint32(20 + jsonLen, binLen, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true); // BIN
    let o = 28 + jsonLen;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out.buffer;
  }
}

type V3 = [number, number, number];

/** Quads from a top-left corner, a right edge and a down edge: uv (0, 0) is the image's top-left. */
function quads(w: GlbWriter, faces: [V3, V3, V3][]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const [tl, r, d] of faces) {
    const n = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    const base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      pos.push(tl[0] + u * r[0] + v * d[0], tl[1] + u * r[1] + v * d[1], tl[2] + u * r[2] + v * d[2]);
      nrm.push(n[0] / len, n[1] / len, n[2] / len);
      uv.push(u, v);
    }
    idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
  }
  return { attributes: { POSITION: w.accessor(pos, 'VEC3'), NORMAL: w.accessor(nrm, 'VEC3'), TEXCOORD_0: w.accessor(uv, 'VEC2') }, indices: w.accessor(idx, 'SCALAR', true) };
}

const box = (hx: number, hy: number, hz: number): [V3, V3, V3][] => [
  [[-hx, hy, hz], [2 * hx, 0, 0], [0, -2 * hy, 0]],
  [[hx, hy, -hz], [-2 * hx, 0, 0], [0, -2 * hy, 0]],
  [[hx, hy, hz], [0, 0, -2 * hz], [0, -2 * hy, 0]],
  [[-hx, hy, -hz], [0, 0, 2 * hz], [0, -2 * hy, 0]],
  [[-hx, hy, -hz], [2 * hx, 0, 0], [0, 0, 2 * hz]],
];

/** A cone of `n` sides without normals: the loader computes smooth ones. */
function cone(w: GlbWriter, radius: number, base: number, height: number, n: number) {
  const pos = [0, base + height, 0];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.push(Math.cos(a) * radius, base, -Math.sin(a) * radius);
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  return { attributes: { POSITION: w.accessor(pos, 'VEC3') }, indices: w.accessor(idx, 'SCALAR', true) };
}

/** The model: a cottage (walls, roof, chimney, door) and a tree under one root node. Units are meters. */
async function cottageGlb(): Promise<ArrayBuffer> {
  const w = new GlbWriter();
  const bricks = await pngTexture(64, (g) => {
    g.fillStyle = '#e2d3b3';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#b4603f';
    for (let row = 0; row < 16; row++) for (let col = -1; col < 8; col++) g.fillRect(col * 8 + (row % 2) * 4 + 1, row * 4 + 1, 6, 2);
    g.fillStyle = '#f1f4f8';
    g.fillRect(6, 8, 22, 18);
    g.fillStyle = '#3d74b0';
    g.fillRect(8, 10, 8, 6);
    g.fillRect(18, 10, 8, 6);
    g.fillRect(8, 18, 8, 6);
    g.fillRect(18, 18, 8, 6);
  });
  const shingles = await pngTexture(16, (g) => {
    g.fillStyle = '#8f2d22';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#b8473a';
    g.fillRect(1, 1, 6, 6);
    g.fillRect(9, 1, 6, 6);
    g.fillRect(5, 9, 6, 6);
    g.fillRect(13, 9, 3, 6);
    g.fillRect(0, 9, 3, 6);
  });
  const roofRun = 1.2;
  const roofRise = 0.85;
  const roofDepth = 1.1;
  const json = {
    asset: { version: '2.0', generator: 'charturbo example 04-gltf' },
    extensionsUsed: ['KHR_texture_transform'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'cottage', children: [1, 2, 3, 4, 5] },
      { name: 'walls', mesh: 0, translation: [0, 0.75, 0] },
      { name: 'roof', mesh: 1, translation: [0, 1.5, 0] },
      { name: 'chimney', mesh: 2, translation: [-0.55, 2.1, -0.35] },
      { name: 'door', mesh: 3, translation: [0.45, 0.45, 0.905] },
      // Rotated and scaled node: the hierarchy is baked into the vertices
      { name: 'tree', mesh: 4, translation: [2.1, 0, 0.6], rotation: [0, Math.sin(0.4), 0, Math.cos(0.4)], scale: [1, 1.3, 1] },
    ],
    meshes: [
      { name: 'walls', primitives: [{ ...quads(w, box(1, 0.75, 0.9)), material: 0 }] },
      {
        name: 'roof',
        primitives: [
          {
            ...quads(w, [
              [[-roofRun, roofRise, 0], [2 * roofRun, 0, 0], [0, -roofRise, roofDepth]],
              [[roofRun, roofRise, 0], [-2 * roofRun, 0, 0], [0, -roofRise, -roofDepth]],
            ]),
            material: 1,
          },
          {
            // Gables: triangles, no uvs
            attributes: { POSITION: w.accessor([1, roofRise, 0, 1, 0, roofDepth, 1, 0, -roofDepth, -1, roofRise, 0, -1, 0, -roofDepth, -1, 0, roofDepth], 'VEC3') },
            material: 3,
          },
        ],
      },
      { name: 'chimney', primitives: [{ ...quads(w, box(0.13, 0.35, 0.13)), material: 2 }] },
      { name: 'door', primitives: [{ ...quads(w, [[[-0.2, 0.45, 0], [0.4, 0, 0], [0, -0.9, 0]]]), material: 4 }] },
      {
        name: 'tree',
        primitives: [
          { ...cone(w, 0.55, 0.3, 1.4, 10), material: 5 },
          { ...quads(w, box(0.09, 0.35, 0.09)), material: 6 },
        ],
      },
    ],
    materials: [
      { name: 'bricks', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } },
      {
        name: 'shingles',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 1, extensions: { KHR_texture_transform: { scale: [4, 3] } } },
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
      },
      { name: 'stone', pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.14, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: 'plaster', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.66, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: 'door', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.08, 0.03, 1], metallicFactor: 0.3, roughnessFactor: 0.5 } },
      { name: 'leaves', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.35, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
      { name: 'bark', pbrMetallicRoughness: { baseColorFactor: [0.18, 0.09, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { name: 'bricks', bufferView: w.view(bricks), mimeType: 'image/png' },
      { name: 'shingles', bufferView: w.view(shingles), mimeType: 'image/png' },
    ],
  };
  return w.write(json);
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
  sdk.addPlane({ position: [0, -1, 0], scale: [180, 2, 130], color: [0.32, 0.46, 0.3, 1], roughness: 0.95 });

  const glb = await cottageGlb();
  const placements = [
    { position: [-8, 0, 0], rotation: [0, 0.35, 0], scale: 16 },
    { position: [-52, 0, -30], rotation: [0, 1.2, 0], scale: 11 },
    { position: [48, 0, -24], rotation: [0, -0.8, 0], scale: [12, 15, 12] },
  ] as const;
  let models: GltfLoadResult[] = [];
  // The model's own colors: the shared design panel recolors objects, paint() restores them
  const colors = new Map<number, RgbaTuple>();
  const paint = () => {
    for (const [id, color] of colors) sdk.setObjectMaterial(id, { color });
  };
  const load = async () => {
    for (const m of models) sdk.disposeGltf(m);
    models = [];
    colors.clear();
    for (const p of placements) {
      const model = await sdk.loadGltf(glb, { position: [...p.position], rotation: [...p.rotation], scale: typeof p.scale === 'number' ? p.scale : [...p.scale] });
      models.push(model);
      for (const id of model.objects) colors.set(id, sdk.getObjectRecord(id)!.color);
    }
  };
  await load();
  sdk.setCameraPose([0, 60, 125], [0, 12, 0]);

  const reload = toolbar.appendChild(document.createElement('button'));
  reload.textContent = 'reload models';
  reload.onclick = async () => {
    reload.disabled = true;
    try {
      await load();
      appearance.refresh();
    } finally {
      reload.disabled = false;
    }
  };
  let spinning = true;
  const spin = toolbar.appendChild(document.createElement('button'));
  spin.textContent = 'turntable';
  spin.setAttribute('aria-pressed', 'true');
  spin.onclick = () => {
    spinning = !spinning;
    spin.setAttribute('aria-pressed', String(spinning));
  };

  const appearance = bindSceneDesign(sdk, (brightness) => {
    sdk.setLighting({ ambientIntensity: 0.4 * brightness, directionalIntensity: 0.9 * brightness, pointIntensity: 0.5 * brightness });
    paint();
  });
  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

  // The first model turns: every object of a model shares the model's pivot (its glTF origin)
  let frame = 0;
  let angle: number = placements[0].rotation[1];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (spinning && models[0]) {
      angle += ((now - last) / 1000) * 0.4;
      for (const id of models[0].objects) sdk.setObjectTransform(id, { rotation: [0, angle, 0] });
    }
    last = now;
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
