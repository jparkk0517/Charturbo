import { describe, expect, it } from 'vitest';
import { evaluateFrame, frameCount, worldPosition } from '../previs/evaluate';
import { buildHandoff, suggestRoleColors } from '../previs/handoff';
import { applyMotion, attachProp, createMannequin, jump, raiseArm, walk } from '../previs/mannequin';
import type { PrevisDoc } from '../previs/types';
import { validateDoc } from '../previs/validate';

/** Mannequin (all limbs) + motions + prop + two shots must pass the validator and evaluate to sane frames. */
function buildDoc(): PrevisDoc {
  const [purple, yellow, orange] = suggestRoleColors(3, [[0.9, 0.75, 0.65]]);
  const hero = createMannequin({ id: 'hero', color: purple, role: 'hero', limbs: 'full' });
  const rival = createMannequin({ id: 'rival', color: yellow, role: 'rival', position: [1.5, 0, 0], limbs: 'none' });
  let nodes = [...hero.nodes, ...rival.nodes];
  nodes = attachProp(nodes, hero.joints.handR!, { id: 'glasses', size: [0.14, 0.04, 0.05], color: orange, role: 'glasses' });
  nodes = applyMotion(nodes, [
    walk({ joints: hero.joints, from: [0, 0, 0], to: [0, 0, -3], start: 0, end: 2 }),
    raiseArm({ joints: hero.joints, side: 'right', start: 2, end: 2.5 }),
    jump({ joints: hero.joints, start: 2.5, airTime: 0.6, height: 0.5, base: [0, 0, -3] }),
  ]);
  return {
    version: 1,
    fps: 24,
    size: { width: 540, height: 960 },
    background: [0.8, 0.8, 0.8],
    avoidColors: [[0.9, 0.75, 0.65]],
    roles: [
      { id: 'hero', label: 'main woman', color: purple, reference: 'face sheet' },
      { id: 'rival', label: 'defender', color: yellow },
      { id: 'glasses', label: 'sunglasses', color: orange },
    ],
    nodes,
    shots: [
      { id: 'a', start: 0, end: 2, camera: { position: [{ t: 0, v: [2, 1.6, 3] }], target: { follow: 'hero.spine' } } },
      { id: 'b', start: 2, end: 3.5, camera: { position: [{ t: 2, v: [-2, 1.2, 1] }], target: { track: [{ t: 2, v: [0, 1, -3] }] }, fov: [{ t: 2, v: 60 }] } },
    ],
  };
}

describe('previs pipeline integration', () => {
  it('a limbed mannequin document passes the validator (ids with upper-case L/R suffixes)', () => {
    const r = validateDoc(JSON.parse(JSON.stringify(buildDoc())));
    expect(r.ok ? [] : r.issues).toEqual([]);
  });

  it('evaluates every frame without throwing and follows the walker', () => {
    const r = validateDoc(buildDoc());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const doc = r.doc;
    const n = frameCount(doc);
    expect(n).toBe(84);
    for (let i = 0; i < n; i++) evaluateFrame(doc, i / doc.fps);
    const early = evaluateFrame(doc, 0.1);
    const late = evaluateFrame(doc, 1.9);
    expect(early.shotId).toBe('a');
    expect(evaluateFrame(doc, 2.2).shotId).toBe('b');
    expect(evaluateFrame(doc, 3.0).camera.fovDeg).toBe(60);
    // follow target tracks the walker toward -z
    expect(late.camera.target[2]).toBeLessThan(early.camera.target[2] - 1);
    // the hand prop rides with the right hand
    const hand = worldPosition(doc, late.nodes, 'hero.handR');
    const prop = worldPosition(doc, late.nodes, 'glasses');
    expect(Math.hypot(hand[0] - prop[0], hand[1] - prop[1], hand[2] - prop[2])).toBeLessThan(0.3);
  });

  it('handoff maps every role color to its label', () => {
    const r = validateDoc(buildDoc());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const h = buildHandoff(r.doc, { references: [{ name: 'face sheet', role: 'hero' }], textOnly: ['hand motion'], lang: 'en' });
    for (const label of ['main woman', 'defender', 'sunglasses']) expect(h.prompt).toContain(label);
    expect(h.uploadOrder[0]).toMatch(/previs/i);
  });
});

describe('validator guards (review fixes)', () => {
  const issuesOf = (mutate: (d: PrevisDoc) => void) => {
    const d = JSON.parse(JSON.stringify(buildDoc())) as PrevisDoc;
    mutate(d);
    const r = validateDoc(d);
    return r.ok ? [] : r.issues;
  };
  it('rejects fov outside the engine clamp', () => {
    expect(issuesOf((d) => { d.shots[1].camera.fov = [{ t: 2, v: 150 }]; }).length).toBeGreaterThan(0);
  });
  it('rejects a doc shorter than one frame', () => {
    expect(issuesOf((d) => { d.shots = [{ ...d.shots[0], start: 0, end: 0.01 }]; }).length).toBeGreaterThan(0);
  });
  it('rejects a node color that differs from its role color', () => {
    expect(issuesOf((d) => { d.nodes.find((n) => n.id === 'rival.upper')!.color = [1, 0, 0]; }).some((i) => i.path.endsWith('.color'))).toBe(true);
  });
});
