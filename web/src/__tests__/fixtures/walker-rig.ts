import type { Quat } from '../../previs/evaluate';
import type { Vec3 } from '../../previs/types';
import type { RetargetRig } from '../../previs/retarget';

const qAxis = (axis: 0 | 1 | 2, deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  const q: Quat = [0, 0, 0, Math.cos(h)];
  q[axis] = Math.sin(h);
  return q;
};

/**
 * models/walker.glb (previs/examples/models.gen.ts buildWalker): every node in the loader's depth-first order with its
 * rest local TRS (file units = meters, 1.75 tall, feet on y = 0, facing +z; its ".R" limbs sit at +x).
 */
export function walkerRig(): RetargetRig {
  const I: Quat = [0, 0, 0, 1];
  const rows: [string, number, Vec3, Quat][] = [
    ['walker', -1, [0, 0, 0], I],
    ['hips', 0, [0, 0.96, 0], I],
    ['torso', 1, [0, 0.04, 0], I],
    ['head', 2, [0, 0.5, 0], I],
    ['upperArm.R', 2, [0.23, 0.45, 0], qAxis(2, -6)],
    ['lowerArm.R', 4, [0, -0.3, 0], qAxis(0, -12)],
    ['upperArm.L', 2, [-0.23, 0.45, 0], qAxis(2, 6)],
    ['lowerArm.L', 6, [0, -0.3, 0], qAxis(0, -12)],
    ['upperLeg.R', 1, [0.09, -0.02, 0], I],
    ['lowerLeg.R', 8, [0, -0.46, 0], I],
    ['upperLeg.L', 1, [-0.09, -0.02, 0], I],
    ['lowerLeg.L', 10, [0, -0.46, 0], I],
  ];
  return { names: rows.map((r) => r[0]), parents: rows.map((r) => r[1]), restLocal: rows.map((r) => ({ t: r[2], r: r[3], s: [1, 1, 1] })) };
}
