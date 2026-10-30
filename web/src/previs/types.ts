/**
 * Previs document: a declarative, JSON-serializable timeline for blockout ("mannequin") videos.
 * It is meant to be written and edited by an AI agent or a person, evaluated per frame by
 * `evaluate.ts`, applied to a Charturbo scene by the player and rendered to video offline.
 *
 * Conventions
 * - Time is in seconds on ONE global clock; shots only choose the camera, they do not shift time.
 * - Lengths are in meters. The player multiplies them by `worldScale` to get engine units.
 * - Angles are radians. Rotations are Euler `[rx, ry, rz]`, interpolated per component.
 * - Colors are sRGB `[r, g, b]` in 0..1.
 * - Y is up. The engine camera looks down -z at yaw 0.
 */

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

/** Easing of the segment that STARTS at a keyframe (`step` holds the value until the next key). */
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

export interface Keyframe<T> {
  /** Seconds on the global clock. */
  t: number;
  v: T;
  /** Default `'linear'`. */
  ease?: Easing;
}

/** Keyframes sorted by strictly increasing `t`. Before the first key and after the last the value is held. */
export type Track<T> = Keyframe<T>[];

export type PrevisShape = 'box' | 'sphere' | 'cylinder';

export interface PrevisNode {
  /** Unique, stable, `[A-Za-z0-9_.-]+`. Tracks, `parent`, `follow` and `role` refer to it. */
  id: string;
  shape: PrevisShape;
  /**
   * Id of another node; position and rotation are local to the parent. The parent's `size` does
   * NOT scale this node or its offset (see `size`).
   */
  parent?: string;
  /** Id of an entry in `PrevisDoc.roles`; the handoff prompt maps its color to what it stands for. */
  role?: string;
  /** Flat color. */
  color: Rgb;
  /** Rest transform, used where no track exists. */
  position: Vec3;
  rotation: Vec3;
  /**
   * Full extents in meters of THIS node's own shape (a unit shape scaled to `size`). It never
   * scales children or their offsets: world transform = parent translation + rotation only.
   */
  size: Vec3;
  /** Initial visibility, default true. */
  visible?: boolean;
  tracks?: {
    position?: Track<Vec3>;
    rotation?: Track<Vec3>;
    size?: Track<Vec3>;
    /** Boolean tracks are step-wise regardless of `ease`. */
    visible?: Track<boolean>;
  };
}

/** What a color stands for in the final generation (drives the handoff prompt). */
export interface PrevisRole {
  id: string;
  /** e.g. "main woman", "defender", "sunglasses". */
  label: string;
  /** The color its nodes use; must be unique across roles and clear of `avoidColors`. */
  color: Rgb;
  /** Name of the reference image that supplies its look (face sheet, outfit sheet...), if any. */
  reference?: string;
}

export type CameraTarget =
  /** A look-at point over time. */
  | { track: Track<Vec3> }
  /** Follow a node's world position, plus an optional offset in meters. */
  | { follow: string; offset?: Vec3 };

export interface Shot {
  id: string;
  /** `[start, end)` on the global clock. Shots must cover `[0, duration)` without gaps or overlap. */
  start: number;
  end: number;
  camera: {
    /** Eye position over time. */
    position: Track<Vec3>;
    target: CameraTarget;
    /** Vertical field of view in degrees over time; default constant 45. */
    fov?: Track<number>;
  };
}

export interface PrevisDoc {
  version: 1;
  /** Free text, shown in reports only. */
  title?: string;
  fps: number;
  size: { width: number; height: number };
  /** Background (clear) color. */
  background: Rgb;
  /** Engine units per meter, default 10 (the engine camera cannot come closer than 5 units to its target). */
  worldScale?: number;
  /** Real-world colors to keep roles away from (skin, outfit, set), see the handoff. */
  avoidColors?: Rgb[];
  roles: PrevisRole[];
  nodes: PrevisNode[];
  shots: Shot[];
}

/** Local transform of a node at one time. */
export interface NodeState {
  position: Vec3;
  rotation: Vec3;
  size: Vec3;
  visible: boolean;
}

/** Everything the player needs to draw one frame. */
export interface FrameState {
  time: number;
  shotId: string;
  camera: { eye: Vec3; target: Vec3; fovDeg: number };
  /** Local (parent-relative) states keyed by node id. */
  nodes: Record<string, NodeState>;
}

export interface Issue {
  /** JSON path such as `nodes[3].tracks.position[2].t`. */
  path: string;
  message: string;
}
