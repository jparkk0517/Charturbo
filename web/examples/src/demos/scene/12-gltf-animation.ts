import { Charturbo, type GltfAnimator } from 'charturbo';

export const meta = {
  title: 'glTF animation · playGltfAnimation',
  description:
    'A robot arm built in memory as an animated GLB (node hierarchy with translation / rotation / scale keyframes: LINEAR, STEP and CUBICSPLINE samplers) and played with playGltfAnimation. Only the animated nodes move, through one batched mesh-matrix update per frame; the base stays baked. Pick a clip, play or pause, change the speed (negative plays backwards) or scrub the timeline.',
  height: 440,
};

type V3 = [number, number, number];
type Quat = [number, number, number, number];

/** Collects buffer views / accessors and writes the GLB container (JSON chunk + BIN chunk). */
class GlbWriter {
  readonly bufferViews: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  readonly accessors: Record<string, unknown>[] = [];
  private parts: Uint8Array[] = [];
  private length = 0;

  accessor(data: number[], type: 'SCALAR' | 'VEC3' | 'VEC4', indices = false): number {
    const typed = indices ? new Uint16Array(data) : new Float32Array(data);
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.parts.push(new Uint8Array(pad));
    this.length += pad;
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: typed.byteLength });
    this.parts.push(new Uint8Array(typed.buffer));
    this.length += typed.byteLength;
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    this.accessors.push({ bufferView: this.bufferViews.length - 1, componentType: indices ? 5123 : 5126, count: data.length / size, type });
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

/** Box mesh spanning lo..hi with flat normals. */
function box(w: GlbWriter, lo: V3, hi: V3, material: number) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const b = pos.length / 3;
      for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const p: V3 = [0, 0, 0];
        p[axis] = sign < 0 ? lo[axis] : hi[axis];
        p[u] = a ? hi[u] : lo[u];
        p[v] = c ? hi[v] : lo[v];
        const n: V3 = [0, 0, 0];
        n[axis] = sign;
        pos.push(...p);
        nrm.push(...n);
      }
      idx.push(...(sign > 0 ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]));
    }
  }
  const POSITION = w.accessor(pos, 'VEC3');
  const NORMAL = w.accessor(nrm, 'VEC3');
  return { primitives: [{ attributes: { POSITION, NORMAL }, indices: w.accessor(idx, 'SCALAR', true), material }] };
}

/** Quaternion of `deg` degrees about axis 0 (x), 1 (y) or 2 (z). */
const q = (axis: number, deg: number): Quat => {
  const out: Quat = [0, 0, 0, Math.cos((deg * Math.PI) / 360)];
  out[axis] = Math.sin((deg * Math.PI) / 360);
  return out;
};

/**
 * base -> turret (yaw) -> shoulder (pitch) -> upper arm -> elbow (pitch) -> forearm -> wrist
 * (roll) -> two fingers (slide). Clips: 'pick and place' (4 s), 'wave' (2 s), 'idle' (3 s).
 */
function robotArmGlb(): ArrayBuffer {
  const w = new GlbWriter();
  const meshes = [
    box(w, [-1.2, 0, -1.2], [1.2, 0.35, 1.2], 0), // base
    box(w, [-0.7, 0, -0.7], [0.7, 0.5, 0.7], 1), // turret
    box(w, [-0.2, 0, -0.2], [0.2, 2, 0.2], 2), // upper arm
    box(w, [-0.16, 0, -0.16], [0.16, 1.6, 0.16], 2), // forearm
    box(w, [-0.35, 0, -0.18], [0.35, 0.15, 0.18], 1), // wrist
    box(w, [-0.05, 0, -0.12], [0.05, 0.45, 0.12], 3), // finger
  ];
  const nodes = [
    { name: 'base', mesh: 0, children: [1] },
    { name: 'turret', translation: [0, 0.35, 0], mesh: 1, children: [2] },
    { name: 'shoulder', translation: [0, 0.5, 0], children: [3] },
    { name: 'upper arm', mesh: 2, children: [4] },
    { name: 'elbow', translation: [0, 2, 0], children: [5] },
    { name: 'forearm', mesh: 3, children: [6] },
    { name: 'wrist', translation: [0, 1.6, 0], mesh: 4, children: [7, 8] },
    { name: 'finger L', translation: [-0.25, 0.15, 0], mesh: 5 },
    { name: 'finger R', translation: [0.25, 0.15, 0], mesh: 5 },
  ];
  const keys = (times: number[]) => w.accessor(times, 'SCALAR');
  const quats = (qs: Quat[]) => w.accessor(qs.flat(), 'VEC4');
  const vecs = (vs: V3[]) => w.accessor(vs.flat(), 'VEC3');
  /** CUBICSPLINE output with zero tangents (eased in and out at every key) */
  const eased = (qs: Quat[]) => w.accessor(qs.flatMap((v) => [0, 0, 0, 0, ...v, 0, 0, 0, 0]), 'VEC4');
  const channel = (sampler: number, node: number, path: string) => ({ sampler, target: { node, path } });

  const t5 = keys([0, 1, 2, 3, 4]);
  const pick = {
    name: 'pick and place',
    samplers: [
      { input: t5, output: quats([q(1, 0), q(1, 0), q(1, 120), q(1, 120), q(1, 0)]) },
      { input: t5, output: eased([q(2, 0), q(2, 45), q(2, 20), q(2, 45), q(2, 0)]), interpolation: 'CUBICSPLINE' },
      { input: t5, output: eased([q(2, 0), q(2, 50), q(2, 30), q(2, 50), q(2, 0)]), interpolation: 'CUBICSPLINE' },
      // Fingers snap open / closed
      { input: t5, output: vecs([[-0.25, 0.15, 0], [-0.12, 0.15, 0], [-0.12, 0.15, 0], [-0.25, 0.15, 0], [-0.25, 0.15, 0]]), interpolation: 'STEP' },
      { input: t5, output: vecs([[0.25, 0.15, 0], [0.12, 0.15, 0], [0.12, 0.15, 0], [0.25, 0.15, 0], [0.25, 0.15, 0]]), interpolation: 'STEP' },
    ],
    channels: [channel(0, 1, 'rotation'), channel(1, 2, 'rotation'), channel(2, 4, 'rotation'), channel(3, 7, 'translation'), channel(4, 8, 'translation')],
  };
  const t3 = keys([0, 0.5, 1, 1.5, 2]);
  const wave = {
    name: 'wave',
    samplers: [
      { input: t3, output: quats([q(2, -20), q(2, -20), q(2, -20), q(2, -20), q(2, -20)]) },
      { input: t3, output: quats([q(2, -30), q(2, 10), q(2, -30), q(2, 10), q(2, -30)]) },
      { input: t3, output: quats([q(1, 0), q(1, 90), q(1, 180), q(1, 270), q(1, 360)]) },
    ],
    channels: [channel(0, 2, 'rotation'), channel(1, 4, 'rotation'), channel(2, 6, 'rotation')],
  };
  const t2 = keys([0, 1.5, 3]);
  const idle = {
    name: 'idle',
    samplers: [
      { input: t2, output: vecs([[1, 1, 1], [1.04, 0.97, 1.04], [1, 1, 1]]) },
      { input: t2, output: quats([q(2, 5), q(2, -5), q(2, 5)]) },
    ],
    channels: [channel(0, 1, 'scale'), channel(1, 2, 'rotation')],
  };
  return w.write({
    asset: { version: '2.0', generator: 'charturbo examples' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.18, 0.2, 0.24, 1], metallicFactor: 0.2, roughnessFactor: 0.7 } },
      { pbrMetallicRoughness: { baseColorFactor: [0.85, 0.35, 0.08, 1], metallicFactor: 0.1, roughnessFactor: 0.5 } },
      { pbrMetallicRoughness: { baseColorFactor: [0.85, 0.86, 0.9, 1], metallicFactor: 0.4, roughnessFactor: 0.35 } },
      { pbrMetallicRoughness: { baseColorFactor: [0.95, 0.78, 0.1, 1], metallicFactor: 0.1, roughnessFactor: 0.5 } },
    ],
    animations: [pick, wave, idle],
  });
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
  sdk.addPlane({ position: [0, -1, 0], scale: [180, 2, 130], color: [0.42, 0.45, 0.5, 1], roughness: 0.9 });
  sdk.addBox({ position: [-26, 3, 0], scale: [6, 6, 6], color: [0.2, 0.55, 0.85, 1] });
  sdk.addBox({ position: [13, 3, 22], scale: [6, 6, 6], color: [0.3, 0.75, 0.35, 1] });
  sdk.setLighting({ ambientIntensity: 0.4, directionalDirection: [-0.4, -1, -0.3], directionalIntensity: 0.9, pointPosition: [30, 50, 40], pointIntensity: 0.5 });
  sdk.setShadows({ enabled: true });
  sdk.setCameraPose([10, 55, 95], [0, 14, 0]);

  const model = await sdk.loadGltf(robotArmGlb(), { scale: 8 });
  let anim: GltfAnimator | null = null;

  const clipLabel = toolbar.appendChild(document.createElement('label'));
  clipLabel.textContent = 'clip ';
  const clipSelect = clipLabel.appendChild(document.createElement('select'));
  model.animations.forEach((a, i) => clipSelect.add(new Option(`${a.name} (${a.duration} s)`, String(i))));

  const playButton = toolbar.appendChild(document.createElement('button'));
  const speedLabel = toolbar.appendChild(document.createElement('label'));
  speedLabel.textContent = 'speed ';
  const speedInput = speedLabel.appendChild(document.createElement('input'));
  speedInput.type = 'range';
  speedInput.min = '-2';
  speedInput.max = '2';
  speedInput.step = '0.1';
  speedInput.value = '1';
  const speedValue = speedLabel.appendChild(document.createElement('span'));

  const timeLabel = toolbar.appendChild(document.createElement('label'));
  timeLabel.textContent = 'time ';
  const timeInput = timeLabel.appendChild(document.createElement('input'));
  timeInput.type = 'range';
  timeInput.min = '0';
  timeInput.step = '0.01';
  const timeValue = timeLabel.appendChild(document.createElement('span'));

  const syncPlay = () => {
    const playing = anim?.playing ?? false;
    playButton.textContent = playing ? 'pause' : 'play';
    playButton.setAttribute('aria-pressed', String(playing));
  };
  const syncTime = () => {
    const t = anim?.time ?? 0;
    timeInput.value = String(t);
    timeValue.textContent = ` ${t.toFixed(2)} s`;
  };
  const start = () => {
    const index = Number(clipSelect.value);
    timeInput.max = String(model.animations[index].duration);
    anim = sdk.playGltfAnimation(model, index, { loop: 'repeat', speed: Number(speedInput.value) });
    syncPlay();
    syncTime();
  };
  clipSelect.onchange = start;
  playButton.onclick = () => {
    if (!anim) return;
    if (anim.playing) anim.pause();
    else anim.resume();
    syncPlay();
  };
  speedInput.oninput = () => {
    speedValue.textContent = ` ${Number(speedInput.value).toFixed(1)}x`;
    if (anim) anim.speed = Number(speedInput.value);
  };
  speedInput.oninput(new Event('input'));
  timeInput.oninput = () => {
    // Scrubbing pauses and shows the exact pose
    anim?.pause().seek(Number(timeInput.value));
    syncPlay();
    syncTime();
  };
  start();

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  const tick = () => {
    // render() advances the playing animator with the wall clock
    sdk.render();
    if (anim?.playing) syncTime();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      sdk.disposeGltf(model);
      sdk.dispose();
    },
  };
}
