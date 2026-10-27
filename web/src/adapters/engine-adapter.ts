import { RawGraphData } from '../sdk/charturbo';

export interface EngineStepTiming {
  physicsTimeMs: number;
  renderTimeMs: number;
  totalTimeMs: number;
  kineticEnergy: number;
}

export interface WarmupTiming {
  elapsedMs: number;
  kineticEnergy: number;
}

export interface SpatialQueryTiming {
  elapsedMs: number;
  selectedCount: number;
}

export interface EngineAdapter {
  readonly name: string;
  reloadDataset(seed: number, nodeCount: number, edgeCount: number, clusterCount: number): void;
  loadRawDataset?(data: RawGraphData): number;
  warmup?(ticks: number, dt: number): WarmupTiming;
  boxSelect?(minNdcX: number, minNdcY: number, maxNdcX: number, maxNdcY: number): SpatialQueryTiming;
  highlightNeighbors?(nodeId: number, hops: number): SpatialQueryTiming;
  selectCluster?(clusterId: number): SpatialQueryTiming;
  clearSelection?(): void;
  fitToView?(): void;
  setFrustumCulling?(enabled: boolean): void;
  tick(dt: number, simulatePhysics: boolean): EngineStepTiming;
  rotateCamera(deltaYaw: number, deltaPitch: number): void;
  zoomCamera(delta: number): void;
  resize(width: number, height: number): void;
  nodeCount(): number;
  edgeCount(): number;
}
