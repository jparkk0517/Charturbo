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
      if (k.ease !== undefined && !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'].includes(k.ease as string)) {
        add(`${p}.ease`, `ease must be one of linear, ease-in, ease-out, ease-in-out, step; got ${JSON.stringify(k.ease)}`);
      }
    });
  };
  const vecTrack = (t: unknown, path: string) => track(t, path, vec3);

  // Nodes
  const nodeIds = new Set<string>();
  const nodes: unknown[] = Array.isArray(d.nodes) ? d.nodes : [];
  if (!Array.isArray(d.nodes)) add('nodes', 'nodes must be an array');
  nodes.forEach((n, i) => {
    if (isObj(n) && typeof n.id === 'string') {
      if (!/^[A-Za-z0-9_.-]+$/.test(n.id)) add(`nodes[${i}].id`, `node id "${n.id}" must match [A-Za-z0-9_.-]+ (letters, digits, _ . -)`);
      if (nodeIds.has(n.id)) add(`nodes[${i}].id`, `duplicate node id "${n.id}"; ids must be unique`);
      nodeIds.add(n.id);
    }
  });
  const parentOf = new Map<string, string>();
  nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!isObj(n)) return add(p, 'node must be an object');
    if (typeof n.id !== 'string' || !n.id) add(`${p}.id`, 'node id must be a non-empty string matching [A-Za-z0-9_.-]+');
    if (!['box', 'sphere', 'cylinder'].includes(n.shape as string)) add(`${p}.shape`, `shape must be box, sphere or cylinder; got ${JSON.stringify(n.shape)}`);
    rgb(n.color, `${p}.color`);
    vec3(n.position, `${p}.position`);
    vec3(n.rotation, `${p}.rotation`);
    vec3(n.size, `${p}.size`);
    if (n.parent !== undefined) {
      if (typeof n.parent !== 'string' || !nodeIds.has(n.parent)) add(`${p}.parent`, `parent "${String(n.parent)}" does not exist; use an existing node id or remove "parent"`);
      else if (n.parent === n.id) add(`${p}.parent`, `node "${String(n.id)}" cannot be its own parent; cycle`);
      else if (typeof n.id === 'string') parentOf.set(n.id, n.parent);
    }
    if (n.role !== undefined && (typeof n.role !== 'string' || !roleIds.has(n.role))) {
      add(`${p}.role`, `role "${String(n.role)}" is not defined in roles; add it to roles or fix the id`);
    }
    if (n.visible !== undefined && typeof n.visible !== 'boolean') add(`${p}.visible`, 'visible must be true or false');
    if (n.tracks !== undefined) {
      if (!isObj(n.tracks)) return add(`${p}.tracks`, 'tracks must be an object');
      const t = n.tracks;
      if (t.position !== undefined) vecTrack(t.position, `${p}.tracks.position`);
      if (t.rotation !== undefined) vecTrack(t.rotation, `${p}.tracks.rotation`);
      if (t.size !== undefined) vecTrack(t.size, `${p}.tracks.size`);
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

  // Shots
  if (!Array.isArray(d.shots) || d.shots.length === 0) {
    add('shots', 'shots must be a non-empty array; add at least one shot { id, start: 0, end, camera }');
  } else {
    let prevEnd = 0;
    let prevId = '';
    let prevStart = -Infinity;
    const shotIds = new Set<string>();
    d.shots.forEach((s, i) => {
      const p = `shots[${i}]`;
      if (!isObj(s)) return add(p, 'shot must be an object');
      const id = typeof s.id === 'string' ? s.id : `#${i}`;
      if (typeof s.id !== 'string' || !s.id) add(`${p}.id`, 'shot id must be a non-empty string');
      else if (shotIds.has(s.id)) add(`${p}.id`, `duplicate shot id "${s.id}"`);
      else shotIds.add(s.id);
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
        }
        if (c.target.offset !== undefined) vec3(c.target.offset, `${p}.camera.target.offset`);
      } else if (c.target.track !== undefined) vecTrack(c.target.track, `${p}.camera.target.track`);
      else add(`${p}.camera.target`, 'target needs either "track" (look-at keyframes) or "follow" (node id)');
      if (c.fov !== undefined) {
        track(c.fov, `${p}.camera.fov`, (v, pp) => {
          if (isNum(v) && v > 0 && v < 180) return true;
          add(pp, `fov must be a finite number of degrees in (0, 180); got ${JSON.stringify(v)}`);
          return false;
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, doc: input as unknown as PrevisDoc };
}
