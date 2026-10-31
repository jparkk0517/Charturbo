import { Charturbo, type GltfAnimator } from 'charturbo';

export const meta = {
  title: 'glTF skinning · skinned meshes',
  description:
    'A procedural octopus built in memory as a skinned GLB: one mesh of eight tentacles (about 10,000 vertices) bound to a 48-joint skin (JOINTS_0 / WEIGHTS_0, two bones per vertex), under a rigid body that bobs. loadGltf keeps the skin; the animator sends the whole joint palette in one call per frame and the engine re-skins the vertices on the CPU, so shadows and picking follow the pose. Pick a clip, play or pause, and change the speed; the readout shows the pose-update cost.',
  height: 460,
};

type Quat = [number, number, number, number];
type Mat = number[];

const TENTACLES = 8;
const BONES = 6; // per tentacle
const RINGS = 61; // per tentacle
const SEG = 20;
const LENGTH = 6;
const BODY_RADIUS = 2;

/** Collects buffer views / accessors and writes the GLB container (JSON chunk + BIN chunk). */
class GlbWriter {
  readonly bufferViews: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  readonly accessors: Record<string, unknown>[] = [];
  private parts: Uint8Array[] = [];
  private length = 0;

  accessor(typed: Float32Array | Uint16Array | Uint8Array, type: 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4', extra: Record<string, unknown> = {}): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.parts.push(new Uint8Array(pad));
    this.length += pad;
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: typed.byteLength });
    this.parts.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    this.length += typed.byteLength;
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const componentType = typed instanceof Float32Array ? 5126 : typed instanceof Uint16Array ? 5123 : 5121;
    this.accessors.push({ bufferView: this.bufferViews.length - 1, componentType, count: typed.length / size, type, ...extra });
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

/** Quaternion of `rad` radians about axis 0 (x), 1 (y) or 2 (z). */
const quat = (axis: number, rad: number): Quat => {
  const out: Quat = [0, 0, 0, Math.cos(rad / 2)];
  out[axis] = Math.sin(rad / 2);
  return out;
};

/** Hamilton product a * b (x, y, z, w). */
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Column-major inverse of a rigid transform: rotation about +Y by `yaw`, then translation `t`. */
function inverseYawTranslate(yaw: number, t: [number, number, number]): Mat {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Forward rotation columns: x -> (c, 0, -s), y -> (0, 1, 0), z -> (s, 0, c); inverse = transpose
  const r = [c, 0, s, 0, 1, 0, -s, 0, c];
  const m: Mat = [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1];
  for (let row = 0; row < 3; row++) m[12 + row] = -(m[row] * t[0] + m[4 + row] * t[1] + m[8 + row] * t[2]);
  return m;
}

/**
 * Body (rigid UV sphere, bobbing) -> eight tentacle chains of six joints. The tentacles are one
 * skinned mesh in bind space: tentacle k leaves the body along angle k * 45 deg, its joints sit
 * 1 unit apart and every ring blends its two nearest joints. Clips: 'swim' (2 s), 'curl' (3 s).
 */
function octopusGlb(): { glb: ArrayBuffer; vertices: number; joints: number } {
  const w = new GlbWriter();

  // Body sphere
  const bodyPos: number[] = [];
  const bodyNrm: number[] = [];
  const bodyIdx: number[] = [];
  const LAT = 16;
  const LON = 28;
  for (let i = 0; i <= LAT; i++) {
    const phi = (i / LAT) * Math.PI;
    for (let j = 0; j <= LON; j++) {
      const th = (j / LON) * Math.PI * 2;
      const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      bodyNrm.push(...n);
      bodyPos.push(n[0] * BODY_RADIUS * 1.1, n[1] * BODY_RADIUS * 1.25 + 1.2, n[2] * BODY_RADIUS * 1.1);
    }
  }
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < LON; j++) {
      const a = i * (LON + 1) + j;
      const b = a + LON + 1;
      bodyIdx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  // Tentacles: bind-space vertices, two influences each
  const pos: number[] = [];
  const nrm: number[] = [];
  const jnt: number[] = [];
  const wgt: number[] = [];
  const idx: number[] = [];
  const inverseBind: number[] = [];
  for (let k = 0; k < TENTACLES; k++) {
    const yaw = (k / TENTACLES) * Math.PI * 2;
    const d = [Math.cos(yaw), 0, Math.sin(yaw)];
    const side = [-d[2], 0, d[0]];
    const root: [number, number, number] = [d[0] * BODY_RADIUS, 0.4, d[2] * BODY_RADIUS];
    // Joint i rest world: rotate +X onto d (glTF yaw -angle), translate root + d * i
    for (let i = 0; i < BONES; i++) {
      inverseBind.push(...inverseYawTranslate(-yaw, [root[0] + d[0] * i, root[1], root[2] + d[2] * i]));
    }
    const base = pos.length / 3;
    for (let r = 0; r < RINGS; r++) {
      const s = (r / (RINGS - 1)) * LENGTH;
      const radius = 0.55 * (1 - s / (LENGTH * 1.15));
      const bone = Math.min(BONES - 1, Math.floor(s));
      const f = bone < BONES - 1 ? s - bone : 0;
      for (let q = 0; q < SEG; q++) {
        const a = (q / SEG) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const n = [side[0] * ca, sa, side[2] * ca];
        pos.push(root[0] + d[0] * s + n[0] * radius, root[1] + n[1] * radius * 0.8, root[2] + d[2] * s + n[2] * radius);
        nrm.push(...n);
        jnt.push(k * BONES + bone, k * BONES + Math.min(BONES - 1, bone + 1), 0, 0);
        wgt.push(Math.round((1 - f) * 255), Math.round(f * 255), 0, 0);
      }
    }
    for (let r = 0; r + 1 < RINGS; r++) {
      for (let q = 0; q < SEG; q++) {
        const a = base + r * SEG + q;
        const b = base + r * SEG + ((q + 1) % SEG);
        idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
      }
    }
  }
  const vertices = pos.length / 3 + bodyPos.length / 3;

  // Nodes: 0 body (mesh 0, children = tentacle roots), 1 tentacles (skinned mesh), then joints
  const nodes: Record<string, unknown>[] = [
    { name: 'body', mesh: 0, children: [] as number[] },
    { name: 'tentacles', mesh: 1, skin: 0 },
  ];
  const jointNodes: number[] = [];
  for (let k = 0; k < TENTACLES; k++) {
    const yaw = (k / TENTACLES) * Math.PI * 2;
    for (let i = 0; i < BONES; i++) {
      const index = nodes.length;
      jointNodes.push(index);
      const node: Record<string, unknown> = { name: `t${k}.${i}` };
      if (i === 0) {
        node.translation = [Math.cos(yaw) * BODY_RADIUS, 0.4, Math.sin(yaw) * BODY_RADIUS];
        node.rotation = quat(1, -yaw);
        (nodes[0].children as number[]).push(index);
      } else {
        node.translation = [1, 0, 0];
      }
      if (i + 1 < BONES) node.children = [index + 1];
      nodes.push(node);
    }
  }

  // Clips: 'swim' (a wave down each tentacle, the body bobs) and 'curl' (tentacles roll up)
  const swimTimes = Array.from({ length: 17 }, (_, i) => (i / 16) * 2);
  const curlTimes = [0, 1.5, 3];
  const swimIn = w.accessor(new Float32Array(swimTimes), 'SCALAR');
  const curlIn = w.accessor(new Float32Array(curlTimes), 'SCALAR');
  const swim = { name: 'swim', samplers: [] as Record<string, unknown>[], channels: [] as Record<string, unknown>[] };
  const curl = { name: 'curl', samplers: [] as Record<string, unknown>[], channels: [] as Record<string, unknown>[] };
  const bob = w.accessor(new Float32Array(swimTimes.flatMap((t) => [0, 0.5 + 0.5 * Math.sin(Math.PI * t), 0])), 'VEC3');
  swim.samplers.push({ input: swimIn, output: bob });
  swim.channels.push({ sampler: 0, target: { node: 0, path: 'translation' } });
  for (let k = 0; k < TENTACLES; k++) {
    const yaw = (k / TENTACLES) * Math.PI * 2;
    for (let i = 0; i < BONES; i++) {
      const node = jointNodes[k * BONES + i];
      const rest = i === 0 ? quat(1, -yaw) : ([0, 0, 0, 1] as Quat);
      const keys = swimTimes.map((t) => {
        const phase = Math.PI * t - i * 0.7 + k * 0.8;
        const lift = (i === 0 ? 0.25 : 0.32) * Math.sin(phase);
        const sway = 0.12 * Math.cos(phase * 0.5 + k);
        return qmul(rest, qmul(quat(1, sway), quat(2, lift)));
      });
      swim.samplers.push({ input: swimIn, output: w.accessor(new Float32Array(keys.flat()), 'VEC4') });
      swim.channels.push({ sampler: swim.samplers.length - 1, target: { node, path: 'rotation' } });
      const curled = [0, 1, 0].map((c) => qmul(rest, quat(2, c * (0.15 + i * 0.09))));
      curl.samplers.push({ input: curlIn, output: w.accessor(new Float32Array(curled.flat()), 'VEC4') });
      curl.channels.push({ sampler: curl.samplers.length - 1, target: { node, path: 'rotation' } });
    }
  }

  const glb = w.write({
    asset: { version: '2.0', generator: 'charturbo examples' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes,
    meshes: [
      {
        name: 'body',
        primitives: [
          {
            attributes: { POSITION: w.accessor(new Float32Array(bodyPos), 'VEC3'), NORMAL: w.accessor(new Float32Array(bodyNrm), 'VEC3') },
            indices: w.accessor(new Uint16Array(bodyIdx), 'SCALAR'),
            material: 0,
          },
        ],
      },
      {
        name: 'tentacles',
        primitives: [
          {
            attributes: {
              POSITION: w.accessor(new Float32Array(pos), 'VEC3'),
              NORMAL: w.accessor(new Float32Array(nrm), 'VEC3'),
              JOINTS_0: w.accessor(Uint8Array.from(jnt), 'VEC4'),
              WEIGHTS_0: w.accessor(Uint8Array.from(wgt), 'VEC4', { normalized: true }),
            },
            indices: w.accessor(new Uint16Array(idx), 'SCALAR'),
            material: 1,
          },
        ],
      },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.75, 0.22, 0.35, 1], metallicFactor: 0, roughnessFactor: 0.45 } },
      { pbrMetallicRoughness: { baseColorFactor: [0.9, 0.42, 0.45, 1], metallicFactor: 0, roughnessFactor: 0.55 } },
    ],
    skins: [{ joints: jointNodes, inverseBindMatrices: w.accessor(new Float32Array(inverseBind), 'MAT4'), skeleton: 0 }],
    animations: [swim, curl],
  });
  return { glb, vertices, joints: jointNodes.length };
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
  sdk.addPlane({ position: [0, -1, 0], scale: [180, 2, 130], color: [0.32, 0.5, 0.58, 1], roughness: 0.9 });
  sdk.setLighting({ ambientIntensity: 0.4, directionalDirection: [-0.4, -1, -0.3], directionalIntensity: 0.9, pointPosition: [30, 50, 40], pointIntensity: 0.5 });
  sdk.setShadows({ enabled: true });
  sdk.setCameraPose([0, 48, 78], [0, 4, 0]);

  const { glb, vertices, joints } = octopusGlb();
  const model = await sdk.loadGltf(glb, { scale: 4 });
  // Driven by hand (autoUpdate off) so the readout can time each pose update
  const anim: GltfAnimator = sdk.createGltfAnimator(model, { autoUpdate: false });

  const clipLabel = toolbar.appendChild(document.createElement('label'));
  clipLabel.textContent = 'clip ';
  const clipSelect = clipLabel.appendChild(document.createElement('select'));
  model.animations.forEach((a, i) => clipSelect.add(new Option(`${a.name} (${a.duration} s)`, String(i))));

  const playButton = toolbar.appendChild(document.createElement('button'));
  const speedLabel = toolbar.appendChild(document.createElement('label'));
  speedLabel.textContent = 'speed ';
  const speedInput = speedLabel.appendChild(document.createElement('input'));
  speedInput.type = 'range';
  speedInput.min = '0.1';
  speedInput.max = '3';
  speedInput.step = '0.1';
  speedInput.value = '1';
  const speedValue = speedLabel.appendChild(document.createElement('span'));
  const readout = toolbar.appendChild(document.createElement('span'));
  readout.setAttribute('aria-live', 'off');

  const syncPlay = () => {
    playButton.textContent = anim.playing ? 'pause' : 'play';
    playButton.setAttribute('aria-pressed', String(anim.playing));
  };
  const start = () => {
    anim.play(Number(clipSelect.value), { loop: Number(clipSelect.value) === 1 ? 'pingpong' : 'repeat', speed: Number(speedInput.value) });
    syncPlay();
  };
  clipSelect.onchange = start;
  playButton.onclick = () => {
    if (anim.playing) anim.pause();
    else anim.resume();
    syncPlay();
  };
  speedInput.oninput = () => {
    speedValue.textContent = ` ${Number(speedInput.value).toFixed(1)}x`;
    anim.speed = Number(speedInput.value);
  };
  speedInput.oninput(new Event('input'));
  start();

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  let last = performance.now();
  let cost = 0;
  let shown = 0;
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (anim.playing) {
      // JS joint palette + one engine call that re-skins the mesh on the CPU
      const t0 = performance.now();
      anim.update(dt);
      const ms = performance.now() - t0;
      cost = cost === 0 ? ms : cost * 0.9 + ms * 0.1;
    }
    if (now - shown > 250) {
      shown = now;
      readout.textContent = ` pose update ${cost.toFixed(2)} ms · ${vertices.toLocaleString('en-US')} vertices · ${joints} joints`;
    }
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      anim.dispose();
      sdk.disposeGltf(model);
      sdk.dispose();
    },
  };
}
