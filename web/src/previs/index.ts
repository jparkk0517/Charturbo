/**
 * Public barrel for the previs document model and its pure helpers: types, evaluate, validate, handoff,
 * mannequin, models. Scripts (`previs/examples/*.gen.ts`) import from here.
 *
 * NOT re-exported: `player.ts`. It imports the Charturbo SDK at runtime (scene, glTF loader), so importing
 * it pulls in the engine. Import it directly from its own module:
 *   import { loadPrevisPlayer } from '../../src/previs/player.ts';   // path relative to the importing file
 */

export type {
  Vec3,
  Rgb,
  Easing,
  Keyframe,
  Track,
  PrevisShape,
  PrevisModelFit,
  PrevisModelAnimation,
  ClipWeight,
  PrevisModel,
  PrevisNode,
  PrevisParentRef,
  PrevisRole,
  CameraTarget,
  Shot,
  CameraShake,
  PrevisDoc,
  PrevisMarker,
  NodeState,
  FrameState,
  Issue,
} from './types.ts';

export {
  evalTrack,
  docDuration,
  frameCount,
  clipWeightsAt,
  parentKeyAt,
  parentRefOf,
  nodeStateAt,
  worldPosition,
  eulerYXZToQuat,
  matrixToEulerYXZ,
  quatToEulerYXZ,
  createParentResolver,
  worldTransform,
  perlin1,
  evaluateFrame,
} from './evaluate.ts';
export type {
  Quat,
  WorldTransform,
  JointFrame,
  WorldTransformOptions,
  ParentCapture,
  ParentResolver,
} from './evaluate.ts';

export { rgbToLab, colorDistance, validateDoc } from './validate.ts';

export { suggestRoleColors, colorName, buildHandoff } from './handoff.ts';

export { createMannequin, walk, jump, raiseArm, shrug, lookAt, twoBoneIK, crouch, pickUp, applyMotion, attachProp, twoToneBox } from './mannequin.ts';
export type {
  Limbs,
  MannequinOptions,
  MannequinJoints,
  Mannequin,
  MotionTracks,
  MotionFragments,
  WalkOptions,
  JumpOptions,
  RaiseArmOptions,
  ShrugOptions,
  LookAtOptions,
  TwoBoneSolution,
  CrouchOptions,
  PickUpOptions,
  PickUpResult,
  PropOptions,
  TwoToneBoxOptions,
} from './mannequin.ts';

export { nodeLoadsModel, modelSrcsToLoad } from './models.ts';
