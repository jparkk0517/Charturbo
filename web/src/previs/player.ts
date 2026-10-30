/**
 * Previs player: applies an evaluated frame (`evaluateFrame`) to a Charturbo 3D scene. The caller
 * validates the doc, calls `frame(t)` and then `sdk.render()` (and grabs the canvas for video).
 *
 * FLAT COLOR RECIPE (a node must render as exactly its `color`)
 * Shading model `pbr` (`fs_mesh_pbr`, crates/charturbo-core/src/renderer/shader.rs) with
 * toneMapping 'none', exposure 1 and environment intensity 0, ambient / directional / point
 * intensity 0 and material emissive 1 (metallic 0, roughness 1) leaves
 *   out = linear_to_srgb(srgb_to_linear(base) * emissive) = base,
 * which is exact at every viewing angle (the sRGB round trip is lossless).
 * Shadows, helpers (grid/axes), the graph and rigid physics are off. Alpha is exact.
 * MEASURED (previews rendered in headless Chrome, WebGL2 and WebGPU, web/previs/examples/flat-swatches.json):
 * error <= 0.5/255 on face-on swatches and also on faces tilted 40, 61 and 77 degrees.
 * The `classic` model was rejected: its hard-coded fresnel rim 0.14*(1-N.V)^3 lifts every channel
 * (measured 0.5/255 at 40 deg, 5/255 at 61 deg, 16/255 at 77 deg).
 *
 * SIZE-DECOUPLED HIERARCHY
 * The engine multiplies a parent's scale into its children's offsets (world = parentWorld * local),
 * but a previs `size` must only size the node's own shape (see types.ts / evaluate.ts). So each
 * node becomes a PIVOT object (scale [1,1,1], local position/rotation, parent = the parent's pivot)
 * and, when it has a visible shape, a child MESH object (scale = size*worldScale, position 0).
 * The engine clamps object scale to >= 0.05 units, so a mesh smaller than 0.05/worldScale meters
 * per axis is drawn at 0.05 units.
 *
 * INVISIBLE OBJECTS
 * The engine has no per-object visibility flag in its API, so invisible = color alpha 0: pivots are
 * unit boxes with alpha 0; they go through the translucent pipeline (ALPHA_BLENDING, no depth
 * write), which leaves the framebuffer unchanged. A shape hidden by its `visible` track gets alpha
 * 0 via `setObjectMaterial`. Pure pivot nodes (`visible: false` with no visible=true key) get no
 * mesh.
 */
import type { Charturbo, PrimitiveShape } from '../sdk/charturbo';
import { evaluateFrame } from './evaluate';
import type { FrameState, PrevisDoc, PrevisNode, Vec3 } from './types';

export interface PrevisPlayer {
  /** Applies the doc at `time` seconds to the scene (call `sdk.render()` afterwards). */
  frame(time: number): FrameState;
  /** Removes the created objects and restores the theme (background). */
  dispose(): void;
}

const DEFAULT_WORLD_SCALE = 10;

interface NodeObjects {
  node: PrevisNode;
  pivotId: number;
  meshId: number | null;
  /** Last values sent to the engine; per-frame calls are skipped while unchanged. */
  pos: Vec3;
  rot: Vec3;
  meshScale: Vec3;
  meshVisible: boolean;
}

const eqVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

/** Parents before children (document order otherwise); tolerates cycles/unknown parents. */
function topoOrder(nodes: PrevisNode[]): PrevisNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const out: PrevisNode[] = [];
  const visit = (n: PrevisNode, stack: Set<string>): void => {
    if (done.has(n.id) || stack.has(n.id)) return;
    stack.add(n.id);
    const parent = n.parent !== undefined ? byId.get(n.parent) : undefined;
    if (parent) visit(parent, stack);
    stack.delete(n.id);
    done.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n, new Set());
  return out;
}

/** True when the node ever shows a shape: visible at rest or some visible key is true. */
function hasShape(n: PrevisNode): boolean {
  return n.visible !== false || (n.tracks?.visible?.some((k) => k.v) ?? false);
}

export function createPrevisPlayer(sdk: Charturbo, doc: PrevisDoc): PrevisPlayer {
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;

  // Flat look (see header)
  const prevTheme = sdk.getTheme();
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  sdk.setHelpers({ showGrid: false, showAxes: false });
  sdk.setShadows({ enabled: false });
  sdk.setShading({ model: 'pbr', toneMapping: 'none', exposure: 1, environment: { intensity: 0 } });
  sdk.setLighting({ ambientIntensity: 0, directionalIntensity: 0, pointIntensity: 0 });
  sdk.setTheme({ ...prevTheme, surface: [doc.background[0], doc.background[1], doc.background[2], 1] });

  const objects = new Map<string, NodeObjects>();
  const pivotIds = new Map<string, number>();
  const created: number[] = [];

  for (const n of topoOrder(doc.nodes)) {
    const pos = scaled(n.position, ws);
    const rot: Vec3 = [...n.rotation];
    const pivotId = sdk.addPrimitive({
      shape: 'box',
      name: `previs:${n.id}`,
      position: pos,
      rotation: rot,
      scale: [1, 1, 1],
      color: [0, 0, 0, 0],
      bodyType: 'static',
      parentId: n.parent !== undefined ? (pivotIds.get(n.parent) ?? null) : null,
      castShadow: false,
      receiveShadow: false,
    });
    pivotIds.set(n.id, pivotId);
    created.push(pivotId);

    const meshScale = scaled(n.size, ws);
    const meshVisible = n.visible !== false;
    let meshId: number | null = null;
    if (hasShape(n)) {
      meshId = sdk.addPrimitive({
        shape: n.shape as PrimitiveShape,
        name: `previs:${n.id}:mesh`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: meshScale,
        color: [n.color[0], n.color[1], n.color[2], meshVisible ? 1 : 0],
        metallic: 0,
        roughness: 1,
        emissive: 1,
        bodyType: 'static',
        parentId: pivotId,
        castShadow: false,
        receiveShadow: false,
      });
      created.push(meshId);
    }
    objects.set(n.id, { node: n, pivotId, meshId, pos, rot, meshScale, meshVisible });
  }

  let camEye: Vec3 | null = null;
  let camTarget: Vec3 | null = null;
  let camFov: number | null = null;
  let disposed = false;

  return {
    frame(time: number): FrameState {
      const fs = evaluateFrame(doc, time);

      for (const [id, o] of objects) {
        const st = fs.nodes[id];
        if (!st) continue;
        const pos = scaled(st.position, ws);
        if (!eqVec(pos, o.pos) || !eqVec(st.rotation, o.rot)) {
          sdk.setObjectTransform(o.pivotId, { position: pos, rotation: [...st.rotation] });
          o.pos = pos;
          o.rot = [...st.rotation];
        }
        if (o.meshId === null) continue;
        const ms = scaled(st.size, ws);
        if (!eqVec(ms, o.meshScale)) {
          sdk.setObjectTransform(o.meshId, { scale: ms });
          o.meshScale = ms;
        }
        if (st.visible !== o.meshVisible) {
          const c = o.node.color;
          sdk.setObjectMaterial(o.meshId, { color: [c[0], c[1], c[2], st.visible ? 1 : 0] });
          o.meshVisible = st.visible;
        }
      }

      const eye = scaled(fs.camera.eye, ws);
      const target = scaled(fs.camera.target, ws);
      if (!camEye || !camTarget || !eqVec(eye, camEye) || !eqVec(target, camTarget)) {
        sdk.setCameraPose(eye, target);
        camEye = eye;
        camTarget = target;
      }
      if (fs.camera.fovDeg !== camFov) {
        sdk.setCameraFov(fs.camera.fovDeg);
        camFov = fs.camera.fovDeg;
      }
      return fs;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Children first: a mesh goes before its pivot, a pivot after its children
      for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
      created.length = 0;
      objects.clear();
      sdk.setTheme(prevTheme);
    },
  };
}
