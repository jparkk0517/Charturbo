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
