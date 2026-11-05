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
  PrevisRetarget,
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

export { createMannequin, jointedJointIds, walk, jump, raiseArm, shrug, lookAt, twoBoneIK, crouch, pickUp, applyMotion, attachProp, twoToneBox } from './mannequin.ts';
export type {
  Limbs,
  MannequinOptions,
  MannequinJoints,
  Mannequin,
  JointedJoints,
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

export { nodeLoadsModel, modelSrcsToLoad, retargetParts } from './models.ts';
export type { RetargetPart } from './models.ts';

export {
  KAYKIT_RETARGET_MAP,
  UE_RETARGET_MAP,
  RETARGET_MAPS,
  WALKER_SOURCE_MAP,
  RETARGET_SOURCE_MAPS,
  mannequinFrames,
  modelSourceFrames,
  modelSourceRest,
  scaleFrames,
  prepareRetarget,
  rigFromWorldMatrices,
  rigRestPose,
  shortestArc,
  quatRotate,
} from './retarget.ts';
export type { RetargetTrs, RetargetRig, RetargetJoint, RetargetSourceJoint, MannequinJointFrame, Retargeter } from './retarget.ts';
