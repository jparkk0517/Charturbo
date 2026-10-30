import { Charturbo, type SceneToneMapping } from 'charturbo';

export const meta = {
  title: 'Physically based shading · setShading',
  description:
    'Opt-in PBR: spheres from rough to smooth (left → right) and dielectric to metal (bottom → top), a textured box and a small glTF house, lit by the directional and point lights plus an equirectangular sky texture built with createDataTexture. Smooth metals mirror the sky, rough ones blur it. Switch back to the classic Blinn-Phong look, pick the tone mapping operator and change the exposure.',
  height: 440,
};

/** Equirectangular sRGB sky (top row = up): blue zenith, pale horizon, warm sun, brown ground. */
function skyTexture(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let c = v < 0.5 ? mix([55, 105, 200], [220, 228, 238], Math.pow(v / 0.5, 1.5)) : mix([150, 130, 100], [70, 55, 45], Math.min(1, (v - 0.5) / 0.3));
      const du = Math.min(Math.abs(u - 0.62), 1 - Math.abs(u - 0.62));
      if (du * du * 4 + (v - 0.3) ** 2 < 0.0025) c = [255, 240, 200];
      if (Math.floor(u * 16) % 4 === 0 && v > 0.38 && v < 0.5) c = c.map((ch) => ch * 0.5); // distant "buildings"
      out.set([...c.map(Math.round), 255], (y * w + x) * 4);
    }
  }
  return out;
}

/** A tiny GLB house: textured walls (embedded PNG), a metallic roof, one root node. */
async function houseGlb(): Promise<ArrayBuffer> {
  const tex = document.createElement('canvas');
  tex.width = tex.height = 32;
  const g = tex.getContext('2d')!;
  g.fillStyle = '#e6d6b8';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#b4603f';
  for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) g.fillRect(col * 8 + (row % 2) * 4 + 1, row * 4 + 1, 6, 2);
  g.fillStyle = '#3d74b0';
  g.fillRect(4, 6, 10, 8);
  const png = new Uint8Array(await (await new Promise<Blob>((ok, fail) => tex.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/png'))).arrayBuffer());

  const parts: Uint8Array[] = [];
  const views: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  let length = 0;
  const view = (bytes: Uint8Array) => {
    const pad = (4 - (length % 4)) % 4;
    parts.push(new Uint8Array(pad), bytes);
    views.push({ buffer: 0, byteOffset: length + pad, byteLength: bytes.byteLength });
    length += pad + bytes.byteLength;
    return views.length - 1;
  };
  const accessor = (data: number[], type: 'SCALAR' | 'VEC2' | 'VEC3', indices = false) => {
    const typed = indices ? new Uint16Array(data) : new Float32Array(data);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const acc: Record<string, unknown> = { bufferView: view(new Uint8Array(typed.buffer)), componentType: indices ? 5123 : 5126, count: data.length / n, type };
    if (type === 'VEC3') {
      acc.min = [0, 1, 2].map((k) => Math.min(...data.filter((_, i) => i % 3 === k)));
      acc.max = [0, 1, 2].map((k) => Math.max(...data.filter((_, i) => i % 3 === k)));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  type V3 = [number, number, number];
  // Quads from a top-left corner, a right edge and a down edge (uv (0, 0) = image top-left)
  const quads = (faces: [V3, V3, V3][]) => {
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const [tl, r, d] of faces) {
      const n = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      const base = pos.length / 3;
      for (const [s, t] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        pos.push(tl[0] + s * r[0] + t * d[0], tl[1] + s * r[1] + t * d[1], tl[2] + s * r[2] + t * d[2]);
        nrm.push(n[0] / len, n[1] / len, n[2] / len);
        uv.push(s, t);
      }
      idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
    }
    return { attributes: { POSITION: accessor(pos, 'VEC3'), NORMAL: accessor(nrm, 'VEC3'), TEXCOORD_0: accessor(uv, 'VEC2') }, indices: accessor(idx, 'SCALAR', true) };
  };
  const walls = quads([
    [[-1, 1.5, 0.9], [2, 0, 0], [0, -1.5, 0]],
    [[1, 1.5, -0.9], [-2, 0, 0], [0, -1.5, 0]],
    [[1, 1.5, 0.9], [0, 0, -1.8], [0, -1.5, 0]],
    [[-1, 1.5, -0.9], [0, 0, 1.8], [0, -1.5, 0]],
  ]);
  const roof = quads([
    [[-1.2, 2.35, 0], [2.4, 0, 0], [0, -0.85, 1.1]],
    [[1.2, 2.35, 0], [-2.4, 0, 0], [0, -0.85, -1.1]],
  ]);
  const imageView = view(png);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0', generator: 'charturbo example 05-pbr' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'house', children: [1, 2] }, { mesh: 0 }, { mesh: 1 }],
      meshes: [{ primitives: [{ ...walls, material: 0 }] }, { primitives: [{ ...roof, material: 1 }] }],
      materials: [
        { name: 'bricks', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } },
        { name: 'copper roof', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.45, 0.3, 1], metallicFactor: 1, roughnessFactor: 0.35 } },
      ],
      textures: [{ source: 0 }],
      images: [{ bufferView: imageView, mimeType: 'image/png' }],
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: length }],
    })
  );
  const jsonLen = Math.ceil(json.byteLength / 4) * 4;
  const binLen = Math.ceil(length / 4) * 4;
  const out = new Uint8Array(28 + jsonLen + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(json, 20);
  dv.setUint32(20 + jsonLen, binLen, true);
  dv.setUint32(24 + jsonLen, 0x004e4942, true); // BIN
  let o = 28 + jsonLen;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out.buffer;
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
  const sky = sdk.createDataTexture(256, 128, skyTexture(256, 128));
  const checker = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) checker.set((Math.floor((i % 32) / 4) + Math.floor(i / 32 / 4)) % 2 ? [200, 60, 40, 255] : [235, 235, 235, 255], i * 4);
  const map = sdk.createDataTexture(32, 32, checker);

  sdk.addPlane({ position: [0, -1, 0], scale: [220, 2, 140], color: [0.36, 0.38, 0.4, 1], roughness: 0.8 });
  const roughness = [0.05, 0.25, 0.5, 0.75, 1];
  const rows = [
    { metallic: 0, color: [0.8, 0.12, 0.1, 1] },
    { metallic: 0.5, color: [0.3, 0.55, 0.9, 1] },
    { metallic: 1, color: [1, 0.78, 0.35, 1] },
  ] as const;
  rows.forEach((row, r) =>
    roughness.forEach((value, c) =>
      sdk.addSphere({ position: [-30 + c * 17, 8 + r * 16, -6], scale: [14, 14, 14], color: [...row.color], roughness: value, metallic: row.metallic })
    )
  );
  const box = sdk.addBox({ position: [-62, 9, 10], rotation: [0, 0.6, 0], scale: [16, 16, 16], color: [1, 1, 1, 1], roughness: 0.6, map });
  const house = await sdk.loadGltf(await houseGlb(), { position: [62, 0, 6], rotation: [0, -0.5, 0], scale: 14 });
  sdk.setLighting({ ambientIntensity: 0.35, directionalDirection: [-0.4, -1, -0.5], directionalIntensity: 1.1, pointPosition: [30, 40, 40], pointIntensity: 0.5 });
  sdk.setShading({ model: 'pbr', toneMapping: 'aces', exposure: 1, environment: { map: sky } });
  sdk.setCameraPose([0, 45, 120], [0, 20, 0]);

  const model = toolbar.appendChild(document.createElement('button'));
  const syncModel = () => {
    const pbr = sdk.getShading().model === 'pbr';
    model.textContent = pbr ? 'PBR' : 'classic';
    model.setAttribute('aria-pressed', String(pbr));
  };
  model.onclick = () => {
    sdk.setShading({ model: sdk.getShading().model === 'pbr' ? 'classic' : 'pbr' });
    syncModel();
  };
  syncModel();

  const toneMapping = toolbar.appendChild(document.createElement('select'));
  toneMapping.setAttribute('aria-label', 'Tone mapping');
  for (const value of ['aces', 'reinhard', 'none']) {
    const option = toneMapping.appendChild(document.createElement('option'));
    option.value = option.textContent = value;
  }
  toneMapping.onchange = () => sdk.setShading({ toneMapping: toneMapping.value as SceneToneMapping });

  const exposureLabel = toolbar.appendChild(document.createElement('label'));
  exposureLabel.textContent = 'exposure ';
  const exposure = exposureLabel.appendChild(document.createElement('input'));
  exposure.type = 'range';
  exposure.min = '0.25';
  exposure.max = '3';
  exposure.step = '0.05';
  exposure.value = '1';
  exposure.oninput = () => sdk.setShading({ exposure: Number(exposure.value) });

  const envButton = toolbar.appendChild(document.createElement('button'));
  envButton.textContent = 'sky texture';
  envButton.setAttribute('aria-pressed', 'true');
  envButton.onclick = () => {
    const on = sdk.getShading().environment.map === null;
    sdk.setShading({ environment: { map: on ? sky : null } });
    envButton.setAttribute('aria-pressed', String(on));
  };

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let angle = 0.6;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    angle += ((now - last) / 1000) * 0.4;
    last = now;
    sdk.setObjectTransform(box, { rotation: [0, angle, 0] });
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      sdk.disposeGltf(house);
      sdk.dispose();
    },
  };
}
