import type { PrevisDoc, PrevisNode } from './types';

/**
 * Whether the player loads the glTF of `node` (same rule as loadPrevisPlayer, see SOCKETS in player.ts):
 * a model node with a `model` that ever shows a shape (visible at rest, or some visible key true), or a pure
 * pivot (visible false, no visible key true) that has a child hanging from one of its joints (`parentJoint`,
 * or a `tracks.parent` key with a `joint` on this node at any time), or the model source of a loaded `model.retarget`
 * (see RETARGET FROM A MODEL: posed even where it is never drawn).
 */
export function nodeLoadsModel(doc: PrevisDoc, node: PrevisNode, depth = 0): boolean {
  if (node.shape !== 'model' || !node.model) return false;
  if (node.visible !== false || (node.tracks?.visible?.some((k) => k.v) ?? false)) return true;
  return doc.nodes.some(
    (c) =>
      (c.parent === node.id && c.parentJoint !== undefined) ||
      (c.tracks?.parent?.some((k) => k.v !== null && k.v.node === node.id && k.v.joint !== undefined) ?? false) ||
      (c !== node && depth < 1 && c.shape === 'model' && c.model?.retarget?.source === node.id && nodeLoadsModel(doc, c, depth + 1)),
  );
}

/** Distinct `model.src` of the nodes the player loads, in doc order. */
export function modelSrcsToLoad(doc: PrevisDoc): string[] {
  const out = new Set<string>();
  for (const n of doc.nodes) if (nodeLoadsModel(doc, n) && n.model) out.add(n.model.src);
  return [...out];
}

/** One extra part of a retargeted character for `retargetParts`: node id and glTF `src`. */
export interface RetargetPart {
  id: string;
  src: string;
}

/**
 * Extra skinned parts of a retargeted character (hair, beard, a helmet): one `shape: 'model'` node per part that follows
 * the same `model.retarget` source as `skin` (same `source`, `map`, `sourceMap`; never `attach`, which at most one model
 * per mannequin may set), with the skin's role, color, `look`, `size`, `visible` and `visible` track (deep copies, taken
 * NOW: call it after the skin's last edit). The part must be a skinned glTF on the same skeleton as the skin: the same
 * bone names, and the same rest pose for the bones the part is skinned to, their ancestors and the leg bones (the solver
 * scales and places every retargeted model by its own legs and hips), e.g. the Quaternius Universal Base Characters
 * "Rigged to Head Bone" hairstyles on the body of the same build. Then every bone of the part gets exactly the skin's
 * pose. Throws when `skin` has no `model.retarget` or a part id equals the skin id.
 */
export function retargetParts(skin: PrevisNode, parts: readonly RetargetPart[]): PrevisNode[] {
  const r = skin.model?.retarget;
  if (skin.shape !== 'model' || !r) throw new Error(`retargetParts: node "${skin.id}" has no model.retarget`);
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return parts.map((p) => {
    if (p.id === skin.id) throw new Error(`retargetParts: part id "${p.id}" equals the skin id`);
    const n: PrevisNode = {
      id: p.id,
      shape: 'model',
      ...(skin.role !== undefined ? { role: skin.role } : {}),
      color: [...skin.color] as PrevisNode['color'],
      ...(skin.look !== undefined ? { look: copy(skin.look) } : {}),
      model: { src: p.src, retarget: { source: r.source, map: r.map, ...(r.sourceMap !== undefined ? { sourceMap: r.sourceMap } : {}) } },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [...skin.size] as PrevisNode['size'],
    };
    if (skin.visible !== undefined) n.visible = skin.visible;
    if (skin.tracks?.visible !== undefined) n.tracks = { visible: copy(skin.tracks.visible) };
    return n;
  });
}
