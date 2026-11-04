import type { Issue, PrevisDoc, Rgb } from './types';

const MAX_ISSUES = 50;
const EPS = 1e-9;
const MIN_COLOR_DISTANCE = 25;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (0..1) to CIE Lab (D65). */
export function rgbToLab(c: Rgb): [number, number, number] {
  const r = srgbToLinear(c[0]);
  const g = srgbToLinear(c[1]);
  const b = srgbToLinear(c[2]);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 distance between two sRGB colors. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);

function totalEnd(shots: unknown[]): number {
  let m = 0;
  for (const s of shots) if (isObj(s) && isNum(s.end)) m = Math.max(m, s.end);
  return m;
}

/** Engine limits of a point light (src/sdk/scene-lights.ts) in engine units = meters * worldScale. */
const RIM_MAX_INTENSITY = 1e6;
const RIM_MIN_RANGE = 0.01;

export function validateDoc(
  input: unknown,
): { ok: true; doc: PrevisDoc } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ path, message });
  };

  if (!isObj(input)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'document must be a JSON object; wrap it in { "version": 1, ... }' }],
    };
  }
  const d = input;

  const vec3 = (v: unknown, path: string): boolean => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
      add(path, 'must be an array of exactly 3 finite numbers like [0, 0, 0]');
      return false;
    }
    return true;
  };
  const rgb = (v: unknown, path: string): v is Rgb => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => isNum(x) && x >= 0 && x <= 1)) {
      add(path, `color must be [r, g, b] with 3 finite values in 0..1 (e.g. [0.5, 0, 0.8]); got ${JSON.stringify(v)}`);
      return false;
    }
    return true;
  };

  if (d.version !== 1) add('version', `version must be 1; got ${JSON.stringify(d.version)}. Set "version": 1`);
  if (!(typeof d.fps === 'number' && Number.isInteger(d.fps) && d.fps >= 1 && d.fps <= 120)) {
    add('fps', `fps must be an integer in 1..120; got ${JSON.stringify(d.fps)}. Use e.g. 24 or 30`);
  }
  if (!isObj(d.size)) {
    add('size', 'size must be { "width": number, "height": number } with even integers in 16..4096');
  } else {
    for (const k of ['width', 'height'] as const) {
      const v = d.size[k];
      if (!(typeof v === 'number' && Number.isInteger(v) && v % 2 === 0 && v >= 16 && v <= 4096)) {
        add(`size.${k}`, `${k} must be an even integer in 16..4096; got ${JSON.stringify(v)}. Use e.g. ${k === 'width' ? 1280 : 720}`);
      }
    }
  }
  rgb(d.background, 'background');
  if (d.worldScale !== undefined && !(isNum(d.worldScale) && d.worldScale > 0)) {
    add('worldScale', `worldScale must be a finite number > 0; got ${JSON.stringify(d.worldScale)}. Omit it for the default 10`);
  }
  const avoid: Rgb[] = [];
  const avoidIdx: number[] = [];
  if (d.avoidColors !== undefined) {
    if (!Array.isArray(d.avoidColors)) add('avoidColors', 'avoidColors must be an array of [r, g, b] colors');
    else {
      d.avoidColors.forEach((c, i) => {
        if (rgb(c, `avoidColors[${i}]`)) {
          avoid.push(c);
          avoidIdx.push(i);
        }
      });
    }
  }

  // Lighting (textured pass only)
  if (d.lighting !== undefined) {
    const lp = 'lighting';
    const unknownKeys = (o: Record<string, unknown>, path: string, allowed: string[], what: string) => {
      for (const key of Object.keys(o)) {
        if (!allowed.includes(key)) add(`${path}.${key}`, `unknown ${what} key "${key}"; allowed: ${allowed.join(', ')}`);
      }
    };
    const range = (o: Record<string, unknown>, k: string, path: string, max: number) => {
      const x = o[k];
      if (x !== undefined && !(isNum(x) && x >= 0 && x <= max)) add(`${path}.${k}`, `${k} must be a finite number in 0..${max}; got ${JSON.stringify(x)}`);
    };
    const L = d.lighting;
    if (!isObj(L)) add(lp, 'lighting must be an object { key?, env?, rim?, exposure?, toneMapping? }');
    else {
      unknownKeys(L, lp, ['key', 'env', 'rim', 'exposure', 'toneMapping'], 'lighting');
      if (L.key !== undefined) {
        const kp = `${lp}.key`;
        if (!isObj(L.key)) add(kp, 'key must be an object { dir?, intensity?, shadows? }');
        else {
          unknownKeys(L.key, kp, ['dir', 'intensity', 'shadows'], 'lighting.key');
          if (L.key.dir !== undefined && vec3(L.key.dir, `${kp}.dir`)) {
            const [x, y, z] = L.key.dir as number[];
            if (x === 0 && y === 0 && z === 0) add(`${kp}.dir`, 'dir must not be the zero vector (it points toward the light); use [0.45, 0.85, 0.55] for the default');
          }
          range(L.key, 'intensity', kp, 4);
          if (L.key.shadows !== undefined && typeof L.key.shadows !== 'boolean') add(`${kp}.shadows`, 'shadows must be true or false');
        }
      }
      if (L.env !== undefined) {
        const ep = `${lp}.env`;
        if (!isObj(L.env)) add(ep, 'env must be an object { sky?, ground?, intensity? }');
        else {
          unknownKeys(L.env, ep, ['sky', 'ground', 'intensity'], 'lighting.env');
          if (L.env.sky !== undefined) rgb(L.env.sky, `${ep}.sky`);
          if (L.env.ground !== undefined) rgb(L.env.ground, `${ep}.ground`);
          range(L.env, 'intensity', ep, 16);
        }
      }
      if (L.rim !== undefined) {
        const ws = isNum(d.worldScale) && d.worldScale > 0 ? d.worldScale : 10; // invalid worldScale is reported above
        const rp = `${lp}.rim`;
        if (!Array.isArray(L.rim)) add(rp, 'rim must be an array of { position, color?, intensity, range? }');
        else {
          if (L.rim.length > 8) add(rp, `rim allows at most 8 lights; got ${L.rim.length}. Remove ${L.rim.length - 8}`);
          L.rim.forEach((r, i) => {
            const p = `${rp}[${i}]`;
            if (!isObj(r)) return add(p, 'rim light must be an object { position, color?, intensity, range? }');
            unknownKeys(r, p, ['position', 'color', 'intensity', 'range'], 'rim light');
            if (r.position === undefined) add(`${p}.position`, 'rim light requires position [x, y, z] in meters');
            else vec3(r.position, `${p}.position`);
            if (r.color !== undefined) rgb(r.color, `${p}.color`);
            if (r.intensity === undefined) add(`${p}.intensity`, 'rim light requires intensity (number >= 0)');
            else if (!(isNum(r.intensity) && r.intensity >= 0)) add(`${p}.intensity`, `intensity must be a finite number >= 0; got ${JSON.stringify(r.intensity)}`);
            else if (r.intensity * ws * ws > RIM_MAX_INTENSITY) {
              add(`${p}.intensity`, `intensity ${r.intensity} x worldScale^2 (${ws * ws}) = ${r.intensity * ws * ws} exceeds the engine maximum ${RIM_MAX_INTENSITY}; with worldScale ${ws} intensity must be <= ${RIM_MAX_INTENSITY / (ws * ws)}`);
            }
            if (r.range !== undefined && !(isNum(r.range) && r.range > 0)) add(`${p}.range`, `range must be a finite number of meters > 0; got ${JSON.stringify(r.range)}`);
            else if (r.range !== undefined && (r.range as number) * ws < RIM_MIN_RANGE) {
              add(`${p}.range`, `range ${r.range} m x worldScale ${ws} = ${(r.range as number) * ws} is below the engine minimum ${RIM_MIN_RANGE}; with worldScale ${ws} range must be >= ${RIM_MIN_RANGE / ws} m`);
            }
          });
        }
      }
      range(L, 'exposure', lp, 16);
      if (L.toneMapping !== undefined && !['aces', 'reinhard', 'none'].includes(L.toneMapping as string)) {
        add(`${lp}.toneMapping`, `toneMapping must be aces, reinhard or none; got ${JSON.stringify(L.toneMapping)}`);
      }
    }
  }

  // Roles
  const roleIds = new Set<string>();
  const roleColors: { i: number; id: string; color: Rgb }[] = [];
  if (!Array.isArray(d.roles)) add('roles', 'roles must be an array (may be empty)');
  else {
    d.roles.forEach((r, i) => {
      const p = `roles[${i}]`;
      if (!isObj(r)) return add(p, 'role must be an object { id, label, color }');
      if (typeof r.id !== 'string' || !r.id) add(`${p}.id`, 'role id must be a non-empty string');
      else if (roleIds.has(r.id)) add(`${p}.id`, `duplicate role id "${r.id}"; role ids must be unique`);
      else roleIds.add(r.id);
      if (typeof r.label !== 'string' || !r.label) add(`${p}.label`, 'role label must be a non-empty string, e.g. "main woman"');
      if (rgb(r.color, `${p}.color`)) roleColors.push({ i, id: String(r.id), color: r.color });
    });
  }
  for (let a = 0; a < roleColors.length; a++) {
    for (let b = a + 1; b < roleColors.length; b++) {
      const dist = colorDistance(roleColors[a].color, roleColors[b].color);
      if (dist < MIN_COLOR_DISTANCE) {
        add(
          `roles[${roleColors[b].i}].color`,
          `role "${roleColors[b].id}" color is too close to role "${roleColors[a].id}" (distance ${dist.toFixed(1)} < ${MIN_COLOR_DISTANCE}); pick clearly different hues so the video model can tell them apart`,
        );
      }
    }
    avoid.forEach((av, k) => {
      const dist = colorDistance(roleColors[a].color, av);
      if (dist < MIN_COLOR_DISTANCE) {
        add(
          `roles[${roleColors[a].i}].color`,
          `role "${roleColors[a].id}" color is too close to avoidColors[${avoidIdx[k]}] (distance ${dist.toFixed(1)} < ${MIN_COLOR_DISTANCE}); it may be mistaken for skin/outfit/set. Choose a more distinct color`,
        );
      }
    });
  }

  // Tracks
  const track = (t: unknown, path: string, value: (v: unknown, p: string) => boolean) => {
    if (!Array.isArray(t) || t.length < 1) return add(path, 'track must be an array with at least 1 keyframe { t, v }');
    let prev = -Infinity;
    t.forEach((k, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(k)) return add(p, 'keyframe must be an object { t, v, ease? }');
      if (!isNum(k.t)) add(`${p}.t`, `keyframe t must be a finite number of seconds; got ${JSON.stringify(k.t)}`);
      else {
        if (k.t <= prev) {
          add(`${p}.t`, `keyframe times must strictly increase: t=${fmt(k.t)} is not greater than previous ${fmt(prev)}; sort keys and remove duplicates`);
        }
        prev = k.t;
      }
      value(k.v, `${p}.v`);
      if (k.ease !== undefined && !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step', 'smooth'].includes(k.ease as string)) {
        add(`${p}.ease`, `ease must be one of linear, ease-in, ease-out, ease-in-out, step, smooth; got ${JSON.stringify(k.ease)}`);
      }
    });
  };
  const vecTrack = (t: unknown, path: string) => track(t, path, vec3);
  // `smooth` may overshoot between keys: not allowed where a value outside the keys' range breaks things
  const noSmooth = (t: unknown, path: string, why: string) => {
    if (!Array.isArray(t)) return;
    t.forEach((k, i) => {
      if (isObj(k) && k.ease === 'smooth') add(`${path}[${i}].ease`, `ease "smooth" is not allowed on ${why} (it can overshoot between keys); use linear or ease-in-out`);
    });
  };

  // Nodes
  const nodeIds = new Set<string>();
  const shapeOf = new Map<string, unknown>();
  const nodes: unknown[] = Array.isArray(d.nodes) ? d.nodes : [];
  if (!Array.isArray(d.nodes)) add('nodes', 'nodes must be an array');
  nodes.forEach((n, i) => {
    if (isObj(n) && typeof n.id === 'string') {
      if (!/^[A-Za-z0-9_.-]+$/.test(n.id)) add(`nodes[${i}].id`, `node id "${n.id}" must match [A-Za-z0-9_.-]+ (letters, digits, _ . -)`);
      if (nodeIds.has(n.id)) add(`nodes[${i}].id`, `duplicate node id "${n.id}"; ids must be unique`);
      else shapeOf.set(n.id, n.shape);
      nodeIds.add(n.id);
    }
  });
  const parentOf = new Map<string, string>();
  /** Nodes with a valid `parentJoint`: id -> joint name (the camera cannot follow them, see shots). */
  const jointOf = new Map<string, string>();
  /** Valid `tracks.parent` keys per node (node null = world), in key order. */
  const parentKeys = new Map<string, { i: number; k: number; t: number; node: string | null; joint?: string }[]>();
  nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!isObj(n)) return add(p, 'node must be an object');
    if (typeof n.id !== 'string' || !n.id) add(`${p}.id`, 'node id must be a non-empty string matching [A-Za-z0-9_.-]+');
    if (!['box', 'sphere', 'cylinder', 'model'].includes(n.shape as string)) add(`${p}.shape`, `shape must be box, sphere, cylinder or model; got ${JSON.stringify(n.shape)}`);
    if (n.shape === 'model' && n.model === undefined) {
      add(`${p}.model`, 'shape "model" requires a model object { src, fit?, animation? }, e.g. "model": { "src": "robot.glb" }');
    } else if (n.model !== undefined && n.shape !== 'model') {
      add(`${p}.model`, `model is only allowed when shape is "model"; got shape ${JSON.stringify(n.shape)}. Remove "model" or set "shape": "model"`);
    } else if (n.model !== undefined) {
      const mp = `${p}.model`;
      const m = n.model;
      if (!isObj(m)) add(mp, 'model must be an object { src, fit?, animation? }');
      else {
        if (typeof m.src !== 'string' || !m.src) add(`${mp}.src`, `model src must be a non-empty string (relative path or http(s)/data URL); got ${JSON.stringify(m.src)}`);
        if (m.fit !== undefined && m.fit !== 'contain' && m.fit !== 'stretch') {
          add(`${mp}.fit`, `fit must be contain or stretch; got ${JSON.stringify(m.fit)}`);
        }
        if (m.groundLock !== undefined && typeof m.groundLock !== 'boolean') {
          add(`${mp}.groundLock`, `groundLock must be true or false; got ${JSON.stringify(m.groundLock)}`);
        }
        if (m.animation !== undefined) {
          const ap = `${mp}.animation`;
          const a = m.animation;
          const checkAnim = (e: unknown, ep: string, index: number | null) => {
            if (!isObj(e)) return add(ep, 'animation must be an object { clip, start?, speed?, loop?, blendIn? }');
            const clipOk = (typeof e.clip === 'string' && e.clip !== '') || (typeof e.clip === 'number' && Number.isInteger(e.clip) && e.clip >= 0);
            if (!clipOk) add(`${ep}.clip`, `clip must be a non-empty clip name or a non-negative integer clip index; got ${JSON.stringify(e.clip)}`);
            if (e.start !== undefined && !isNum(e.start)) add(`${ep}.start`, `start must be a finite number of seconds; got ${JSON.stringify(e.start)}`);
            if (e.speed !== undefined && !(isNum(e.speed) && e.speed > 0)) add(`${ep}.speed`, `speed must be a finite number > 0; got ${JSON.stringify(e.speed)}`);
            if (e.loop !== undefined && !['repeat', 'once', 'pingpong'].includes(e.loop as string)) {
              add(`${ep}.loop`, `loop must be repeat, once or pingpong; got ${JSON.stringify(e.loop)}`);
            }
            if (e.blendIn !== undefined) {
              if (!(isNum(e.blendIn) && e.blendIn >= 0)) add(`${ep}.blendIn`, `blendIn must be a finite number of seconds >= 0; got ${JSON.stringify(e.blendIn)}`);
              else if (e.blendIn !== 0 && (index === null || index === 0)) {
                add(`${ep}.blendIn`, 'blendIn needs a previous segment to cross-fade from; remove it or set 0 on the first segment');
              }
            }
          };
          if (Array.isArray(a)) {
            if (a.length === 0) add(ap, 'animation array must not be empty; give at least one segment { clip, start?, ... } or remove "animation"');
            let prevStart = -Infinity;
            let prevBlend: unknown;
            a.forEach((e, k) => {
              const ep = `${ap}[${k}]`;
              checkAnim(e, ep, k);
              if (!isObj(e)) return;
              if (k > 0 && e.start === undefined) add(`${ep}.start`, 'start is required on every segment after the first');
              const st = e.start === undefined ? (k === 0 ? 0 : undefined) : e.start;
              if (isNum(st)) {
                if (k > 0 && st <= prevStart) add(`${ep}.start`, `start must be strictly greater than the previous segment start (${prevStart}); got ${st}`);
                // A fade cut short by the next segment would drop the outgoing pose in one frame
                else if (k > 1 && isNum(prevBlend) && prevBlend > st - prevStart) {
                  add(`${ap}[${k - 1}].blendIn`, `blendIn (${prevBlend}) must not exceed the time to the next segment start (${st - prevStart}); shorten it or start the next segment later`);
                }
                prevStart = st;
              }
              prevBlend = e.blendIn;
            });
          } else checkAnim(a, ap, null);
        }
      }
    }
    rgb(n.color, `${p}.color`);
    vec3(n.position, `${p}.position`);
    vec3(n.rotation, `${p}.rotation`);
    vec3(n.size, `${p}.size`);
    if (n.parent !== undefined) {
      if (typeof n.parent !== 'string' || !nodeIds.has(n.parent)) add(`${p}.parent`, `parent "${String(n.parent)}" does not exist; use an existing node id or remove "parent"`);
      else if (n.parent === n.id) add(`${p}.parent`, `node "${String(n.id)}" cannot be its own parent; cycle`);
      else if (typeof n.id === 'string') parentOf.set(n.id, n.parent);
    }
    if (n.parentJoint !== undefined) {
      const jp = `${p}.parentJoint`;
      if (typeof n.parentJoint !== 'string' || n.parentJoint === '') {
        add(jp, `parentJoint must be a non-empty glTF node name of the parent model (e.g. "hand.R"); got ${JSON.stringify(n.parentJoint)}`);
      } else if (n.parent === undefined) {
        add(jp, 'parentJoint requires "parent" to name the model node that has the joint; add "parent" or remove "parentJoint"');
      } else if (typeof n.parent === 'string' && nodeIds.has(n.parent) && n.parent !== n.id) {
        if (shapeOf.get(n.parent) !== 'model') {
          add(jp, `parentJoint needs a parent with shape "model"; parent "${n.parent}" has shape ${JSON.stringify(shapeOf.get(n.parent))}. Remove "parentJoint" or parent the node to a model node`);
        } else if (typeof n.id === 'string') jointOf.set(n.id, n.parentJoint);
      }
    }
    if (n.role !== undefined && (typeof n.role !== 'string' || !roleIds.has(n.role))) {
      add(`${p}.role`, `role "${String(n.role)}" is not defined in roles; add it to roles or fix the id`);
    } else if (typeof n.role === 'string' && Array.isArray(n.color) && n.color.length === 3 && n.color.every(isNum)) {
      const rc = roleColors.find((r) => r.id === n.role);
      if (rc && colorDistance(rc.color, n.color as Rgb) > 1) {
        add(`${p}.color`, `node color differs from role "${n.role}" color; the handoff prompt maps the role color, so set the node color to ${JSON.stringify(rc.color)}`);
      }
    }
    if (n.rotationPath !== undefined && n.rotationPath !== 'direct' && n.rotationPath !== 'shortest') {
      add(`${p}.rotationPath`, `rotationPath must be direct or shortest; got ${JSON.stringify(n.rotationPath)}`);
    }
    if (n.visible !== undefined && typeof n.visible !== 'boolean') add(`${p}.visible`, 'visible must be true or false');
    if (n.look !== undefined) {
      const lp = `${p}.look`;
      const l = n.look;
      if (!isObj(l)) add(lp, 'look must be an object { color?, roughness?, metallic?, show? }');
      else {
        for (const key of Object.keys(l)) {
          if (!['color', 'roughness', 'metallic', 'show'].includes(key)) add(`${lp}.${key}`, `unknown look key "${key}"; allowed: color, roughness, metallic, show`);
        }
        const modelMsg = (k: string) => `look.${k} is not allowed on shape "model" nodes: model nodes keep their own materials in the textured pass. Remove "${k}"`;
        if (l.color !== undefined) {
          if (n.shape === 'model') add(`${lp}.color`, modelMsg('color'));
          else rgb(l.color, `${lp}.color`);
        }
        for (const k of ['roughness', 'metallic'] as const) {
          if (l[k] === undefined) continue;
          if (n.shape === 'model') add(`${lp}.${k}`, modelMsg(k));
          else if (!(isNum(l[k]) && (l[k] as number) >= 0 && (l[k] as number) <= 1)) add(`${lp}.${k}`, `${k} must be a finite number in 0..1; got ${JSON.stringify(l[k])}`);
        }
        if (l.show !== undefined && !['both', 'flat', 'textured'].includes(l.show as string)) {
          add(`${lp}.show`, `show must be both, flat or textured; got ${JSON.stringify(l.show)}`);
        }
      }
    }
    if (n.tracks !== undefined) {
      if (!isObj(n.tracks)) return add(`${p}.tracks`, 'tracks must be an object');
      const t = n.tracks;
      if (t.position !== undefined) vecTrack(t.position, `${p}.tracks.position`);
      if (t.rotation !== undefined) vecTrack(t.rotation, `${p}.tracks.rotation`);
      if (t.size !== undefined) {
        vecTrack(t.size, `${p}.tracks.size`);
        noSmooth(t.size, `${p}.tracks.size`, 'size tracks (sizes must stay >= 0 and model fitting reads the key range)');
      }
      if (t.joints !== undefined) {
        const jp = `${p}.tracks.joints`;
        if (n.shape !== 'model') {
          add(jp, `joints are only allowed on shape "model" nodes; got shape ${JSON.stringify(n.shape)}. Remove "joints" or set "shape": "model"`);
        } else if (!isObj(t.joints)) {
          add(jp, 'joints must be an object of joint name -> track, e.g. { "leftArm": [{ "t": 0, "v": [0, 0, 0] }] }');
        } else {
          for (const [name, jt] of Object.entries(t.joints)) {
            if (name === '') add(jp, 'joint name must be a non-empty string (the glTF node name)');
            else vecTrack(jt, `${jp}.${name}`);
          }
        }
      }
      if (t.parent !== undefined) {
        const keys: { i: number; k: number; t: number; node: string | null; joint?: string }[] = [];
        track(t.parent, `${p}.tracks.parent`, (v, pp) => {
          if (v === null) return true;
          if (!isObj(v)) {
            add(pp, `parent key value must be null (world) or { node, joint?, snap? }; got ${JSON.stringify(v)}`);
            return false;
          }
          let ok = true;
          if (typeof v.node !== 'string' || !nodeIds.has(v.node)) {
            add(`${pp}.node`, `node "${String(v.node)}" does not exist; use an existing node id, or null for the world`);
            ok = false;
          } else if (v.node === n.id) {
            add(`${pp}.node`, `node "${String(n.id)}" cannot be its own parent; cycle`);
            ok = false;
          }
          if (v.joint !== undefined) {
            if (typeof v.joint !== 'string' || v.joint === '') {
              add(`${pp}.joint`, `joint must be a non-empty glTF node name of the parent model (e.g. "hand.R"); got ${JSON.stringify(v.joint)}`);
              ok = false;
            } else if (typeof v.node === 'string' && nodeIds.has(v.node) && shapeOf.get(v.node) !== 'model') {
              add(`${pp}.joint`, `joint needs a parent with shape "model"; node "${v.node}" has shape ${JSON.stringify(shapeOf.get(v.node))}. Remove "joint" or pick a model node`);
              ok = false;
            }
          }
          if (v.snap !== undefined && typeof v.snap !== 'boolean') {
            add(`${pp}.snap`, `snap must be true or false; got ${JSON.stringify(v.snap)}`);
            ok = false;
          }
          return ok;
        });
        if (Array.isArray(t.parent) && typeof n.id === 'string') {
          t.parent.forEach((k, ki) => {
            if (!isObj(k) || !isNum(k.t)) return;
            if (k.v === null) keys.push({ i, k: ki, t: k.t, node: null });
            else if (isObj(k.v) && typeof k.v.node === 'string' && nodeIds.has(k.v.node) && k.v.node !== n.id) {
              const joint = typeof k.v.joint === 'string' && k.v.joint !== '' && shapeOf.get(k.v.node) === 'model' ? k.v.joint : undefined;
              keys.push({ i, k: ki, t: k.t, node: k.v.node, ...(joint !== undefined ? { joint } : {}) });
            }
          });
          parentKeys.set(n.id, keys);
        }
      }
      if (t.visible !== undefined) {
        track(t.visible, `${p}.tracks.visible`, (v, pp) => {
          if (typeof v === 'boolean') return true;
          add(pp, 'visible keyframe value must be true or false');
          return false;
        });
      }
    }
  });
  // parent cycles
  const reported = new Set<string>();
  nodes.forEach((n, i) => {
    if (!isObj(n) || typeof n.id !== 'string' || reported.has(n.id)) return;
    const seen = new Set<string>([n.id]);
    let cur = parentOf.get(n.id);
    while (cur !== undefined) {
      if (cur === n.id) {
        add(`nodes[${i}].parent`, `parent cycle through node "${n.id}"; a node cannot be its own ancestor. Remove or change one "parent" in the loop`);
        seen.forEach((s) => reported.add(s));
        break;
      }
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  });

  // parent cycles at every key time of every tracks.parent (static cycles are reported above)
  const keyTimes = [...new Set([...parentKeys.values()].flatMap((ks) => ks.map((k) => k.t)))].sort((a, b) => a - b);
  for (const T of keyTimes) {
    /** Active key per node at T (last key with t <= T). */
    const activeAt = (id: string) => {
      let hit: { i: number; k: number; t: number; node: string | null } | undefined;
      for (const k of parentKeys.get(id) ?? []) if (k.t <= T) hit = k;
      return hit;
    };
    const parentAt = (id: string): string | undefined => {
      const k = activeAt(id);
      return k ? (k.node ?? undefined) : parentOf.get(id);
    };
    for (const n of nodes) {
      if (!isObj(n) || typeof n.id !== 'string' || reported.has(n.id)) continue;
      const seen = new Set<string>([n.id]);
      for (let cur = parentAt(n.id); cur !== undefined; cur = parentAt(cur)) {
        if (cur === n.id) {
          // Report at a node of the loop whose parent comes from a key active at T
          const loop = [...seen];
          const at = loop.map((id) => activeAt(id)).find((k) => k !== undefined);
          if (at) {
            add(
              `nodes[${at.i}].tracks.parent[${at.k}].v.node`,
              `parent cycle at t=${fmt(T)} through nodes ${loop.map((id) => `"${id}"`).join(', ')}; a node cannot be its own ancestor at any time. Change one parent in the loop or the key times`,
            );
          }
          loop.forEach((id) => reported.add(id));
          break;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
      }
    }
  }
  /** Nodes that hang from a joint at some time: id -> first such joint use. */
  const jointUse = new Map<string, { joint: string; model: string; t?: number }>();
  for (const [id, joint] of jointOf) jointUse.set(id, { joint, model: parentOf.get(id)! });
  for (const [id, ks] of parentKeys) {
    const k = ks.find((x) => x.joint !== undefined);
    if (k && !jointUse.has(id)) jointUse.set(id, { joint: k.joint!, model: k.node!, t: k.t });
  }

  // Look membership: a node drawn in a pass may only reference nodes drawn in that pass
  const showOf = new Map<string, string>();
  for (const n of nodes) {
    if (!isObj(n) || typeof n.id !== 'string') continue;
    const s = isObj(n.look) && typeof n.look.show === 'string' && ['both', 'flat', 'textured'].includes(n.look.show) ? n.look.show : 'both';
    showOf.set(n.id, s);
  }
  const inLook = (id: string, look: 'flat' | 'textured') => {
    const s = showOf.get(id);
    return s === undefined || s === 'both' || s === look;
  };
  nodes.forEach((n, i) => {
    if (!isObj(n) || typeof n.id !== 'string') return;
    const id = n.id;
    const own = showOf.get(id);
    if (own === undefined) return;
    for (const look of ['flat', 'textured'] as const) {
      if (!inLook(id, look)) continue;
      const check = (ref: unknown, path: string, what: string) => {
        if (typeof ref !== 'string' || !nodeIds.has(ref) || ref === id || inLook(ref, look)) return;
        add(path, `look.show "${own}": ${what} "${ref}" is not drawn in the ${look} pass (it has look.show "${showOf.get(ref)}"), but node "${id}" is. Give both nodes the same look.show, or set "${ref}" look.show to "both"`);
      };
      check(n.parent, `nodes[${i}].parent`, 'parent');
      if (isObj(n.tracks) && Array.isArray(n.tracks.parent)) {
        n.tracks.parent.forEach((k, ki) => {
          if (isObj(k) && isObj(k.v)) check(k.v.node, `nodes[${i}].tracks.parent[${ki}].v.node`, 'tracks.parent node');
        });
      }
    }
  });

  // Shots
  if (!Array.isArray(d.shots) || d.shots.length === 0) {
    add('shots', 'shots must be a non-empty array; add at least one shot { id, start: 0, end, camera }');
  } else {
    let prevEnd = 0;
    let prevId = '';
    let prevStart = -Infinity;
    const shotIds = new Set<string>();
    const shotIdsLower = new Map<string, string>();
    d.shots.forEach((s, i) => {
      const p = `shots[${i}]`;
      if (!isObj(s)) return add(p, 'shot must be an object');
      const id = typeof s.id === 'string' ? s.id : `#${i}`;
      if (s.note !== undefined && (typeof s.note !== 'string' || s.note.trim() === '')) {
        add(`${p}.note`, `note must be a non-empty string (free text for the handoff shot list); got ${JSON.stringify(s.note)}. Remove "note" or give it text`);
      }
      if (typeof s.id !== 'string' || !s.id) add(`${p}.id`, 'shot id must be a non-empty string');
      else if (!/^[A-Za-z0-9_.-]+$/.test(s.id) || s.id === '.' || s.id === '..') {
        add(`${p}.id`, `shot id "${s.id}" must match [A-Za-z0-9_.-]+ (letters, digits, _ . -) and must not be "." or ".." (shot ids become file names)`);
      } else if (shotIds.has(s.id)) add(`${p}.id`, `duplicate shot id "${s.id}"`);
      else if (shotIdsLower.has(s.id.toLowerCase())) {
        add(`${p}.id`, `shot id "${s.id}" differs from "${shotIdsLower.get(s.id.toLowerCase())}" only by case; ids become file names and collide on case-insensitive file systems. Rename one`);
      } else {
        shotIds.add(s.id);
        shotIdsLower.set(s.id.toLowerCase(), s.id);
      }
      if (!isNum(s.start)) add(`${p}.start`, 'start must be a finite number of seconds');
      if (!isNum(s.end)) add(`${p}.end`, 'end must be a finite number of seconds');
      if (isNum(s.start) && isNum(s.end)) {
        const st = s.start;
        const en = s.end;
        if (st >= en) add(`${p}.end`, `shot "${id}" start ${fmt(st)} must be less than end ${fmt(en)}`);
        if (st < prevStart) {
          add(`${p}.start`, `shots must be sorted by start: shot "${id}" starts at ${fmt(st)} before the previous shot; reorder shots`);
        } else if (i === 0) {
          if (Math.abs(st) > EPS) add(`${p}.start`, `shots must cover from 0: first shot "${id}" starts at ${fmt(st)}; set start to 0`);
        } else if (st > prevEnd + EPS) {
          add(`${p}.start`, `shots must cover 0..${fmt(totalEnd(d.shots as unknown[]))} without gap: shot "${id}" starts at ${fmt(st)} but "${prevId}" ends at ${fmt(prevEnd)}. Set start to ${fmt(prevEnd)} or extend "${prevId}"`);
        } else if (st < prevEnd - EPS) {
          add(`${p}.start`, `shots must not overlap: shot "${id}" starts at ${fmt(st)} but "${prevId}" ends at ${fmt(prevEnd)}. Set start to ${fmt(prevEnd)}`);
        }
        prevStart = st;
        prevEnd = en;
        prevId = id;
      }
      if (!isObj(s.camera)) return add(`${p}.camera`, 'camera must be { position: Track, target: { track } | { follow } }');
      const c = s.camera;
      vecTrack(c.position, `${p}.camera.position`);
      if (!isObj(c.target)) add(`${p}.camera.target`, 'target must be { track: Track<Vec3> } or { follow: nodeId, offset? }');
      else if (c.target.follow !== undefined) {
        if (typeof c.target.follow !== 'string' || !nodeIds.has(c.target.follow)) {
          add(`${p}.camera.target.follow`, `follow "${String(c.target.follow)}" is not a node id; use an existing node id`);
        } else {
          if (showOf.get(c.target.follow) !== 'both') {
            add(
              `${p}.camera.target.follow`,
              `follow "${c.target.follow}" has look.show "${showOf.get(c.target.follow)}"; the camera is shared by every pass, so its follow target must have look.show "both". Set "look.show": "both" or use a target "track"`,
            );
          }
          // The evaluator places nodes without joint poses: a joint-attached node (or descendant) has no known position
          const seen = new Set<string>();
          let found = false;
          for (let cur: string | undefined = c.target.follow; cur !== undefined && !seen.has(cur); cur = parentOf.get(cur)) {
            seen.add(cur);
            const joint = jointOf.get(cur);
            if (joint === undefined) continue;
            const model = parentOf.get(cur)!;
            const via = cur === c.target.follow ? `is attached` : `hangs from node "${cur}", which is attached`;
            add(
              `${p}.camera.target.follow`,
              `follow "${c.target.follow}" ${via} to joint "${joint}" of model "${model}"; the camera cannot follow joint-attached nodes (their joint pose is only known when rendering). Follow "${model}" with an "offset", or use a target "track"`,
            );
            found = true;
            break;
          }
          // tracks.parent: every parent the node or an ancestor has at ANY time (a capture keeps the joint pose)
          if (!found && parentKeys.size > 0) {
            const reach = new Set<string>([c.target.follow]);
            const queue = [c.target.follow];
            while (queue.length > 0) {
              const cur = queue.shift()!;
              const use = jointUse.get(cur);
              if (use) {
                const via = cur === c.target.follow ? '' : ` through node "${cur}"`;
                const when = use.t !== undefined ? ` (tracks.parent from t=${fmt(use.t)})` : '';
                add(
                  `${p}.camera.target.follow`,
                  `follow "${c.target.follow}" hangs${via} from joint "${use.joint}" of model "${use.model}"${when}; the camera cannot follow nodes that are joint-attached at any time (the joint pose, also the one kept by a tracks.parent switch, is only known when rendering). Follow "${use.model}" with an "offset", or use a target "track"`,
                );
                break;
              }
              const next = [parentOf.get(cur), ...(parentKeys.get(cur) ?? []).map((k) => k.node)];
              for (const x of next) {
                if (typeof x === 'string' && !reach.has(x)) {
                  reach.add(x);
                  queue.push(x);
                }
              }
            }
          }
        }
        if (c.target.offset !== undefined) vec3(c.target.offset, `${p}.camera.target.offset`);
      } else if (c.target.track !== undefined) vecTrack(c.target.track, `${p}.camera.target.track`);
      else add(`${p}.camera.target`, 'target needs either "track" (look-at keyframes) or "follow" (node id)');
      if (c.roll !== undefined) {
        track(c.roll, `${p}.camera.roll`, (v, pp) => {
          if (isNum(v)) return true;
          add(pp, `roll must be a finite number of radians; got ${JSON.stringify(v)}`);
          return false;
        });
      }
      if (c.up !== undefined) {
        track(c.up, `${p}.camera.up`, (v, pp) => {
          if (!vec3(v, pp)) return false;
          const [x, y, z] = v as number[];
          if (x === 0 && y === 0 && z === 0) {
            add(pp, 'up must not be the zero vector; use [0, 1, 0] for the default');
            return false;
          }
          return true;
        });
        // Opposite neighbouring keys interpolate through the zero vector: the image would flip there
        if (Array.isArray(c.up)) {
          for (let k = 1; k < c.up.length; k++) {
            const a = (c.up[k - 1] as { v?: unknown })?.v;
            const b = (c.up[k] as { v?: unknown })?.v;
            if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3 || ![...a, ...b].every(isNum)) continue;
            const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            const len = Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]);
            if (len > 0 && dot <= -len * (1 - 1e-9)) {
              add(`${p}.camera.up[${k}].v`, 'up must not be opposite to the previous key (the interpolation passes through the zero vector and flips the image); add an intermediate key, e.g. [0, 0, -1] between [0, 1, 0] and [0, -1, 0]');
            }
          }
        }
      }
      // eye == target is undefined for a look-at; checked only when both tracks are constant (1 keyframe)
      if (Array.isArray(c.position) && c.position.length === 1 && isObj(c.target) && Array.isArray(c.target.track) && c.target.track.length === 1) {
        const a = (c.position[0] as { v?: unknown }).v;
        const b = (c.target.track[0] as { v?: unknown }).v;
        if (Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 && a.every((x, k) => x === b[k])) {
          add(`${p}.camera`, 'camera position equals target (constant tracks); move position away from target so the camera has a view direction');
        }
      }
      if (c.shake !== undefined) {
        const sp = `${p}.camera.shake`;
        const k = c.shake;
        if (!isObj(k)) add(sp, 'shake must be { amp, freq, roll?, seed? }');
        else {
          for (const key of Object.keys(k)) {
            if (!['amp', 'freq', 'roll', 'seed'].includes(key)) add(`${sp}.${key}`, `unknown shake key "${key}"; allowed: amp, freq, roll, seed`);
          }
          if (!isNum(k.amp) || k.amp < 0) add(`${sp}.amp`, `amp must be a finite number of meters >= 0; got ${JSON.stringify(k.amp)}`);
          if (!isNum(k.freq) || k.freq <= 0) add(`${sp}.freq`, `freq must be a finite number of Hz > 0; got ${JSON.stringify(k.freq)}`);
          if (k.roll !== undefined && (!isNum(k.roll) || k.roll < 0)) add(`${sp}.roll`, `roll must be a finite number of radians >= 0; got ${JSON.stringify(k.roll)}`);
          if (k.seed !== undefined && !(isNum(k.seed) && Number.isInteger(k.seed))) add(`${sp}.seed`, `seed must be an integer; got ${JSON.stringify(k.seed)}`);
        }
      }
      if (c.fov !== undefined) {
        track(c.fov, `${p}.camera.fov`, (v, pp) => {
          if (isNum(v) && v >= 10 && v <= 120) return true;
          add(pp, `fov must be a finite number of degrees in [10, 120] (engine clamp); got ${JSON.stringify(v)}`);
          return false;
        });
        noSmooth(c.fov, `${p}.camera.fov`, 'fov tracks (fov must stay in [10, 120])');
      }
    });
  }

  // Markers
  if (d.markers !== undefined) {
    if (!Array.isArray(d.markers)) add('markers', 'markers must be an array of { t, label }');
    else {
      const dur = Array.isArray(d.shots) ? totalEnd(d.shots) : 0;
      d.markers.forEach((m, i) => {
        const p = `markers[${i}]`;
        if (!isObj(m)) return add(p, 'marker must be an object { t, label }');
        if (!isNum(m.t)) add(`${p}.t`, `marker t must be a finite number of seconds; got ${JSON.stringify(m.t)}`);
        else if (m.t < 0 || m.t > dur + EPS) add(`${p}.t`, `marker t=${fmt(m.t)} must be within 0..${fmt(dur)} (the doc duration)`);
        if (typeof m.label !== 'string' || m.label.trim() === '') add(`${p}.label`, 'marker label must be a non-empty string, e.g. "bottle hits the wall"');
      });
    }
  }

  if (issues.length === 0 && isNum(d.fps) && Math.round(totalEnd(d.shots as unknown[]) * d.fps) < 1) {
    add('shots', 'total duration is shorter than one frame; lengthen the last shot or raise fps');
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, doc: input as unknown as PrevisDoc };
}
