import {
  EngineAdapter,
  EngineStepTiming,
  SpatialQueryTiming,
  WarmupTiming,
} from './engine-adapter';
import { RawGraphData, VizEngineSDK } from '../sdk/viz-engine-sdk';

export class RustWgpuAdapter implements EngineAdapter {
  readonly name = 'VizEngineSDK (Rust + wgpu WASM)';
  readonly sdk: VizEngineSDK;

  private constructor(sdk: VizEngineSDK) {
    this.sdk = sdk;
  }

  static async create(
    canvas: HTMLCanvasElement,
    seed: number,
    nodeCount: number,
    edgeCount: number,
    clusterCount: number
  ): Promise<RustWgpuAdapter> {
    const sdk = await VizEngineSDK.create(canvas, {
      seed,
      nodeCount,
      edgeCount,
      clusterCount,
      // The benchmark host sizes both canvases itself (DPR capped at 2, see main.ts)
      autoResize: false,
    });
    return new RustWgpuAdapter(sdk);
  }

  reloadDataset(seed: number, nodeCount: number, edgeCount: number, clusterCount: number): void {
    this.sdk.reloadSeededDataset(seed, nodeCount, edgeCount, clusterCount);
  }

  loadRawDataset(data: RawGraphData): number {
    const t0 = performance.now();
    this.sdk.loadDataset(data);
    this.sdk.render();
    return performance.now() - t0;
  }

  warmup(ticks: number, dt: number): WarmupTiming {
    const t0 = performance.now();
    const kineticEnergy = this.sdk.warmup(ticks, dt);
    this.sdk.render();
    return {
      elapsedMs: performance.now() - t0,
      kineticEnergy,
    };
  }

  boxSelect(
    minNdcX: number,
    minNdcY: number,
    maxNdcX: number,
    maxNdcY: number
  ): SpatialQueryTiming {
    const t0 = performance.now();
    const ids = this.sdk.boxSelect(minNdcX, minNdcY, maxNdcX, maxNdcY);
    this.sdk.render();
    return {
      elapsedMs: performance.now() - t0,
      selectedCount: ids.length,
    };
  }

  highlightNeighbors(nodeId: number, hops: number): SpatialQueryTiming {
    const t0 = performance.now();
    const ids = this.sdk.highlightNeighbors(nodeId, hops);
    this.sdk.render();
    return {
      elapsedMs: performance.now() - t0,
      selectedCount: ids.length,
    };
  }

  selectCluster(clusterId: number): SpatialQueryTiming {
    const t0 = performance.now();
    const ids = this.sdk.selectCluster(clusterId);
    this.sdk.render();
    return {
      elapsedMs: performance.now() - t0,
      selectedCount: ids.length,
    };
  }

  clearSelection(): void {
    this.sdk.clearSelection();
    this.sdk.render();
  }

  fitToView(): void {
    this.sdk.fitToView();
    this.sdk.render();
  }

  setFrustumCulling(enabled: boolean): void {
    this.sdk.setFrustumCulling(enabled);
    this.sdk.render();
  }

  tick(dt: number, simulatePhysics: boolean): EngineStepTiming {
    const t0 = performance.now();
    let kineticEnergy = 0;
    if (simulatePhysics) {
      kineticEnergy = this.sdk.stepPhysics(dt);
    }
    const t1 = performance.now();
    this.sdk.render();
    const t2 = performance.now();

    return {
      physicsTimeMs: t1 - t0,
      renderTimeMs: t2 - t1,
      totalTimeMs: t2 - t0,
      kineticEnergy,
    };
  }

  rotateCamera(deltaYaw: number, deltaPitch: number): void {
    this.sdk.rotateCamera(deltaYaw, deltaPitch);
  }

  zoomCamera(delta: number): void {
    this.sdk.zoomCamera(delta);
  }

  resize(width: number, height: number): void {
    this.sdk.resize(width, height);
  }

  nodeCount(): number {
    return this.sdk.nodeCount();
  }

  edgeCount(): number {
    return this.sdk.edgeCount();
  }
}
