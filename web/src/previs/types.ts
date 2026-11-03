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

/**
 * Easing of the segment that STARTS at a keyframe (`step` holds the value until the next key).
 *
 * `smooth`: cubic Hermite through the keys with Catmull-Rom (finite difference) tangents in TIME,
 * per component: m_k = (v_{k+1} - v_{k-1}) / (t_{k+1} - t_{k-1}); at the first / last key the
 * one-sided difference (v_1 - v_0) / (t_1 - t_0) / (v_n - v_{n-1}) / (t_n - t_{n-1}). The curve passes
 * through every key and its velocity is continuous at a key whose two neighboring segments are both
 * `smooth` (a `smooth` segment next to another easing still meets the key value, not its speed).
 * May overshoot between keys, so it is rejected on `size` tracks and `camera.fov`. Boolean tracks stay
 * step-wise.
 */
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step' | 'smooth';

export interface Keyframe<T> {
  /** Seconds on the global clock. */
  t: number;
  v: T;
  /** Default `'linear'`. */
  ease?: Easing;
}

/** Keyframes sorted by strictly increasing `t`. Before the first key and after the last the value is held. */
export type Track<T> = Keyframe<T>[];

export type PrevisShape = 'box' | 'sphere' | 'cylinder' | 'model';

/** How a model's rest-pose bounds map onto the node `size`. */
export type PrevisModelFit =
  /** Uniform scale so the bounds fit inside `size` (proportions kept). Default. */
  | 'contain'
  /** Per-axis scale so the bounds match `size` exactly. */
  | 'stretch';

/**
 * Plays one glTF animation clip on the global clock:
 * clipTime(t) = max(0, t - start) * speed, wrapped per `loop` (GltfAnimator semantics).
 *
 * SEGMENTS: `PrevisModel.animation` may be an array of these, sorted by strictly increasing `start`
 * (`start` is required on every entry after the first). Segment i is active on
 * [start_i, start_{i+1}); before the first start the first segment holds clip time 0. Each segment's
 * clip time counts from its own start. During [start_i, start_i + blendIn_i) (i > 0) the pose
 * cross-fades from segment i-1 (which keeps advancing) to segment i with weight
 * w = (t - start_i) / blendIn_i.
 */
export interface PrevisModelAnimation {
  /** Clip name or index in the glTF file. */
  clip: string | number;
  /** Global time in seconds at which clip time 0 plays; before it the clip's first pose is held. Default 0. */
  start?: number;
  /** Clip seconds per global second, > 0. Default 1. */
  speed?: number;
  /** Default `'repeat'`. */
  loop?: 'repeat' | 'once' | 'pingpong';
  /**
   * Seconds to cross-fade in from the previous segment (array form only; must be 0 or absent on
   * the first segment). Finite, >= 0, and at most the time to the next segment's start (a fade
   * may not be cut short). Default 0 (hard cut).
   */
  blendIn?: number;
}

/** One weighted clip of a node's pose at a frame; `segment` indexes the normalized segment array. */
export interface ClipWeight {
  /** Index into the node's segments (a single-object `animation` is segment 0). */
  segment: number;
  /** Clip time in seconds BEFORE loop wrapping: (t - start) * speed, >= 0. */
  time: number;
  /** 0..1; the weights of one frame's entries sum to 1. */
  weight: number;
}

/**
 * A glTF 2.0 model (`.glb` / `.gltf`) used as a node's shape. It is drawn in the node's flat
 * `color` (textures and material colors are ignored) so role colors stay exact. Its rest-pose
 * bounds are centered on the node origin and scaled to `size` per `fit`, like the primitives.
 */
export interface PrevisModel {
  /**
   * Relative path (resolved against the doc's location by the renderer / viewer), or an
   * absolute `http(s):` / `data:` URL.
   */
  src: string;
  /** Default `'contain'`. */
  fit?: PrevisModelFit;
  /** One clip, or clip segments (see `PrevisModelAnimation`). */
  animation?: PrevisModelAnimation | PrevisModelAnimation[];
  /**
   * Default false. When true, every frame the player shifts the model vertically (world Y, after the
   * node's own transform, parents and re-parenting) so the lowest point of the POSED mesh (clips,
   * blends and `tracks.joints` included) sits exactly on y = 0: feet stay on the floor while a crouch
   * or a clip moves the hips. The authored height is therefore overridden; turn it off for jumps or
   * models standing on something other than the ground. Props attached to its joints move with it.
   */
  groundLock?: boolean;
}

export interface PrevisNode {
  /** Unique, stable, `[A-Za-z0-9_.-]+`. Tracks, `parent`, `follow` and `role` refer to it. */
  id: string;
  shape: PrevisShape;
  /** Required when `shape` is `'model'`, forbidden otherwise. */
  model?: PrevisModel;
  /**
   * Id of another node; position and rotation are local to the parent. The parent's `size` does
   * NOT scale this node or its offset (see `size`).
   */
  parent?: string;
  /**
   * glTF node name (unique in the model) of the `parent` model node to attach to, e.g. a hand
   * joint. Requires `parent` to be a `shape: 'model'` node. This node's position / rotation become
   * local to that joint's CURRENT posed frame (clip, blend and `tracks.joints` included) instead of
   * the parent node origin, with the joint's scale removed (meters stay meters, like `parent`).
   * Unknown joint names fail the load. Mesh-less attach nodes (an empty "hand_socket" node in a static
   * model) work too: the node's rest pose is used.
   */
  parentJoint?: string;
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
  /**
   * How `tracks.rotation` and `tracks.joints` interpolate angles, per Euler component. `'direct'`
   * (default): the values as written. `'shortest'`: each key's component is first unwrapped by a
   * multiple of 2π to lie within π of the previous key's (unwrapped) component, so yaw 3.0 -> -3.0
   * turns 0.28 rad instead of 6.0. Per component, not a quaternion slerp; exact for single-axis turns.
   */
  rotationPath?: 'direct' | 'shortest';
  /** Initial visibility, default true. */
  visible?: boolean;
  tracks?: {
    position?: Track<Vec3>;
    rotation?: Track<Vec3>;
    size?: Track<Vec3>;
    /** Boolean tracks are step-wise regardless of `ease`. */
    visible?: Track<boolean>;
    /**
     * Model nodes only: per-joint rotation offsets keyed by glTF node name (unique in the model).
     * Each value is an Euler `[rx, ry, rz]` (radians, order YXZ like `rotation`) applied ADDITIVELY
     * in the joint's local frame on top of the current clip pose (the rest pose without a clip):
     * local rotation = pose * offset. `[0, 0, 0]` leaves the joint as the clip / rest pose.
     * Unknown joint names fail the load.
     */
    joints?: Record<string, Track<Vec3>>;
    /**
     * Re-parenting over time (pick up, hand off, throw). Always step-wise regardless of `ease`.
     * Before the first key the static `parent` / `parentJoint` apply. `null` = world (no parent).
     *
     * At each key time t_k the node's WORLD transform (position + rotation, joint pose included)
     * is kept: the player captures it under the old parent at t_k and expresses it in the new
     * parent's frame (`capture`). After the switch, position / rotation tracks act as DELTAS from
     * their own value at t_k, applied in the new parent's frame:
     *   local position = capture.position + (P(t) - P(t_k))
     *   local rotation = capture.rotation * (R(t_k)^-1 * R(t))        (quaternions)
     * so an unchanged track keeps the node exactly where the switch left it (no pop), and a throw
     * arc after `null` is authored relative to the release point. With `snap: true` the capture is
     * skipped and the tracks are absolute in the new parent's frame again (a pop is the author's
     * choice). `size` and `visible` are not affected.
     * "Under the old parent at t_k" is the left limit: when several nodes switch at the same t_k (a
     * hand-off swap), every capture uses the configuration just before t_k. Parent cycles are invalid
     * at every key time, and a camera cannot `follow` a node that hangs from a joint at any time.
     */
    parent?: Track<PrevisParentRef | null>;
  };
}

/** A parent assignment of `tracks.parent`. */
export interface PrevisParentRef {
  /** Id of the new parent node. */
  node: string;
  /** glTF node name in `node` (a `shape: 'model'` node), like `parentJoint`. */
  joint?: string;
  /** Default false: keep the world transform at the switch (see `tracks.parent`). */
  snap?: boolean;
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
  /** Free text for the handoff prompt's shot list (e.g. "wide, slow push-in"). */
  note?: string;
  /** `[start, end)` on the global clock. Shots must cover `[0, duration)` without gaps or overlap. */
  start: number;
  end: number;
  camera: {
    /** Eye position over time. */
    position: Track<Vec3>;
    target: CameraTarget;
    /** Vertical field of view in degrees over time; default constant 45. */
    fov?: Track<number>;
    /**
     * Roll in radians about the view direction over time; default constant 0. Positive tilts the
     * camera's up toward screen right (the scene appears to turn counterclockwise).
     */
    roll?: Track<number>;
    /**
     * World up direction of the camera over time (need not be unit length); default constant
     * [0, 1, 0]. Roll is applied on top of it. Animate it through a crane over the target (for
     * example [0, 1, 0] -> [0, 0, -1] -> [0, -1, 0]) to avoid the 180° image flip that a fixed up
     * causes when the view direction passes through it.
     */
    up?: Track<Vec3>;
    /**
     * Handheld camera: deterministic noise added AFTER the tracks (and `follow`) are evaluated.
     * Seven independent channels (eye x/y/z, target x/y/z, roll), each a 1D Perlin gradient noise
     * (integer lattice, quintic fade 6t^5 - 15t^4 + 10t^3 from Perlin 2002 "Improving Noise", 1D
     * gradients uniform in [-1, 1] from a seeded permutation as in Perlin 1985) of global time
     * t * freq, scaled so every channel stays within
     * [-1, 1] times its amplitude. Same doc + seed = identical frames; different channels never share
     * a lattice. Noise is 0 at lattice points, so it does not jump at cuts but also does not restart.
     */
    shake?: CameraShake;
  };
}

export interface CameraShake {
  /** Meters, >= 0: max offset of eye and target per axis. */
  amp: number;
  /** Noise lattice frequency in Hz (lattice points per second), > 0. */
  freq: number;
  /** Radians, >= 0: max roll offset. Default 0. */
  roll?: number;
  /** Integer seed. Default 0. */
  seed?: number;
}

export interface PrevisDoc {
  version: 1;
  /** Free text, shown in reports only. */
  title?: string;
  fps: number;
  size: { width: number; height: number };
  /** Background (clear) color. */
  background: Rgb;
  /** Engine units per meter, default 10. */
  worldScale?: number;
  /** Real-world colors to keep roles away from (skin, outfit, set), see the handoff. */
  avoidColors?: Rgb[];
  roles: PrevisRole[];
  nodes: PrevisNode[];
  shots: Shot[];
  /** Timed events for the handoff prompt (impact, cut motivation, sound cue); `t` in global seconds within the doc duration. */
  markers?: PrevisMarker[];
}

export interface PrevisMarker {
  t: number;
  /** Non-empty free text, e.g. "bottle hits the wall". */
  label: string;
}

/** Local transform of a node at one time. */
export interface NodeState {
  position: Vec3;
  rotation: Vec3;
  size: Vec3;
  visible: boolean;
  /**
   * Clip time in seconds BEFORE loop wrapping (max(0, t - start) * speed); present only for model
   * nodes with an `animation`. The player passes it to `GltfAnimator.seek`, which wraps it.
   */
  clipTime?: number;
  /**
   * Weighted clips of this frame (1 entry, or 2 while cross-fading: previous segment first);
   * present only for model nodes with an `animation`. For a single-object `animation` it is
   * `[{ segment: 0, time: clipTime, weight: 1 }]`; `clipTime` is kept for that form only.
   */
  clips?: ClipWeight[];
  /** Joint rotation offsets (Euler YXZ radians) of this frame; present only when `tracks.joints` is. */
  joints?: Record<string, Vec3>;
  /**
   * Present only when `tracks.parent` is: the active parent of this frame (`null` = world) and the
   * index of the active `tracks.parent` key (-1 before the first key, when the static fields apply).
   * `position` / `rotation` above are then the RAW track values; the player combines them with
   * the capture of that key (see `tracks.parent`).
   */
  parentRef?: { ref: PrevisParentRef | null; key: number };
}

/** Everything the player needs to draw one frame. */
export interface FrameState {
  time: number;
  shotId: string;
  /** `roll` in radians (see `Shot.camera.roll`). */
  camera: { eye: Vec3; target: Vec3; fovDeg: number; roll: number; up: Vec3 };
  /** Local (parent-relative) states keyed by node id. */
  nodes: Record<string, NodeState>;
}

export interface Issue {
  /** JSON path such as `nodes[3].tracks.position[2].t`. */
  path: string;
  message: string;
}
