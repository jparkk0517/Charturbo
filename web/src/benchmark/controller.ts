import { EngineAdapter } from '../adapters/engine-adapter';
import { GraphDatasetTS } from '../domain/dataset';
import { AggregatedMetrics, MetricsCollector } from './metrics';

export type EngineTarget = 'rust' | 'three';

export interface CustomDatasetInput {
  seed: number;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
}

export interface FeatureComparisonResult {
  operation: string;
  rustMs: number;
  threeMs: number;
  speedup: number;
  selectedCount: number;
}

export interface ComparisonReport {
  rust: AggregatedMetrics;
  three: AggregatedMetrics;
  physicsSpeedup: number;
  totalSpeedup: number;
  lastFeatureComparison?: FeatureComparisonResult;
}

export class BenchmarkController {
  private readonly rustAdapter: EngineAdapter;
  private readonly threeAdapter: EngineAdapter;
  private readonly rustMetrics = new MetricsCollector(45);
  private readonly threeMetrics = new MetricsCollector(45);
  private lastFeatureComparison?: FeatureComparisonResult;

  constructor(rustAdapter: EngineAdapter, threeAdapter: EngineAdapter) {
    this.rustAdapter = rustAdapter;
    this.threeAdapter = threeAdapter;
  }

  applyCustomDataset(input: CustomDatasetInput): CustomDatasetInput {
    const sanitized: CustomDatasetInput = {
      seed: Math.max(1, Math.floor(input.seed || 42)),
      nodeCount: Math.max(10, Math.min(100000, Math.floor(input.nodeCount || 1000))),
      edgeCount: Math.max(0, Math.min(250000, Math.floor(input.edgeCount ?? 2000))),
      clusterCount: Math.max(1, Math.min(64, Math.floor(input.clusterCount || 8))),
    };

    this.rustMetrics.reset();
    this.threeMetrics.reset();

    if (this.rustAdapter.loadRawDataset && this.threeAdapter.loadRawDataset) {
      const ds = GraphDatasetTS.generateSeeded({
        seed: sanitized.seed,
        nodeCount: sanitized.nodeCount,
        edgeCount: sanitized.edgeCount,
        clusterCount: sanitized.clusterCount,
        spaceRadius: 100.0,
      });
      const rawBuffers = ds.toRawBuffers();
      const rustMs = this.rustAdapter.loadRawDataset(rawBuffers);
      const threeMs = this.threeAdapter.loadRawDataset(rawBuffers);
      this.lastFeatureComparison = {
        operation: `TypedArray 벌크 로드 (${sanitized.nodeCount.toLocaleString()} 노드)`,
        rustMs,
        threeMs,
        speedup: rustMs > 0.001 ? threeMs / rustMs : 0,
        selectedCount: sanitized.nodeCount,
      };
    } else {
      this.rustAdapter.reloadDataset(
        sanitized.seed,
        sanitized.nodeCount,
        sanitized.edgeCount,
        sanitized.clusterCount
      );
      this.threeAdapter.reloadDataset(
        sanitized.seed,
        sanitized.nodeCount,
        sanitized.edgeCount,
        sanitized.clusterCount
      );
    }
    return sanitized;
  }

  compareWarmup(ticks = 50, dt = 0.016): FeatureComparisonResult {
    const r = this.rustAdapter.warmup?.(ticks, dt) ?? { elapsedMs: 0, kineticEnergy: 0 };
    const t = this.threeAdapter.warmup?.(ticks, dt) ?? { elapsedMs: 0, kineticEnergy: 0 };
    const res: FeatureComparisonResult = {
      operation: `Headless Warm-up (${ticks} ticks)`,
      rustMs: r.elapsedMs,
      threeMs: t.elapsedMs,
      speedup: r.elapsedMs > 0.001 ? t.elapsedMs / r.elapsedMs : 0,
      selectedCount: ticks,
    };
    this.lastFeatureComparison = res;
    return res;
  }

  compareBoxSelect(
    minNdcX: number,
    minNdcY: number,
    maxNdcX: number,
    maxNdcY: number
  ): FeatureComparisonResult {
    const r = this.rustAdapter.boxSelect?.(minNdcX, minNdcY, maxNdcX, maxNdcY) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const t = this.threeAdapter.boxSelect?.(minNdcX, minNdcY, maxNdcX, maxNdcY) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const res: FeatureComparisonResult = {
      operation: `Octree Box 영역 선택 (${r.selectedCount.toLocaleString()}개 매칭)`,
      rustMs: r.elapsedMs,
      threeMs: t.elapsedMs,
      speedup: r.elapsedMs > 0.001 ? t.elapsedMs / r.elapsedMs : 0,
      selectedCount: r.selectedCount,
    };
    this.lastFeatureComparison = res;
    return res;
  }

  compareNeighborHighlight(nodeId: number, hops = 2): FeatureComparisonResult {
    const r = this.rustAdapter.highlightNeighbors?.(nodeId, hops) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const t = this.threeAdapter.highlightNeighbors?.(nodeId, hops) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const res: FeatureComparisonResult = {
      operation: `${hops}-Hop 서브그래프 탐색 & Dimming (노드 #${nodeId}, ${r.selectedCount}개 연결)`,
      rustMs: r.elapsedMs,
      threeMs: t.elapsedMs,
      speedup: r.elapsedMs > 0.001 ? t.elapsedMs / r.elapsedMs : 0,
      selectedCount: r.selectedCount,
    };
    this.lastFeatureComparison = res;
    return res;
  }

  compareClusterSelect(clusterId: number): FeatureComparisonResult {
    const r = this.rustAdapter.selectCluster?.(clusterId) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const t = this.threeAdapter.selectCluster?.(clusterId) ?? {
      elapsedMs: 0,
      selectedCount: 0,
    };
    const res: FeatureComparisonResult = {
      operation: `클러스터 #${clusterId} 필터링 & Dimming (${r.selectedCount.toLocaleString()}개 노드)`,
      rustMs: r.elapsedMs,
      threeMs: t.elapsedMs,
      speedup: r.elapsedMs > 0.001 ? t.elapsedMs / r.elapsedMs : 0,
      selectedCount: r.selectedCount,
    };
    this.lastFeatureComparison = res;
    return res;
  }

  clearSelectionAll(): void {
    this.rustAdapter.clearSelection?.();
    this.threeAdapter.clearSelection?.();
  }

  fitToViewAll(): void {
    this.rustAdapter.fitToView?.();
    this.threeAdapter.fitToView?.();
  }

  setFrustumCullingAll(enabled: boolean): void {
    this.rustAdapter.setFrustumCulling?.(enabled);
    this.threeAdapter.setFrustumCulling?.(enabled);
  }

  resetMetrics(target?: EngineTarget): void {
    if (!target || target === 'rust') this.rustMetrics.reset();
    if (!target || target === 'three') this.threeMetrics.reset();
  }

  rotateCameras(deltaYaw: number, deltaPitch: number): void {
    this.rustAdapter.rotateCamera(deltaYaw, deltaPitch);
    this.threeAdapter.rotateCamera(deltaYaw, deltaPitch);
  }

  zoomCameras(delta: number): void {
    this.rustAdapter.zoomCamera(delta);
    this.threeAdapter.zoomCamera(delta);
  }

  renderStaticPreview(): void {
    this.rustAdapter.tick(0.0, false);
    this.threeAdapter.tick(0.0, false);
  }

  stepSingleEngine(target: EngineTarget, dt: number, simulatePhysics: boolean): ComparisonReport {
    if (target === 'rust') {
      const rTiming = this.rustAdapter.tick(dt, simulatePhysics);
      this.rustMetrics.record({
        frameTimeMs: rTiming.totalTimeMs,
        physicsTimeMs: rTiming.physicsTimeMs,
        renderTimeMs: rTiming.renderTimeMs,
      });
    } else {
      const tTiming = this.threeAdapter.tick(dt, simulatePhysics);
      this.threeMetrics.record({
        frameTimeMs: tTiming.totalTimeMs,
        physicsTimeMs: tTiming.physicsTimeMs,
        renderTimeMs: tTiming.renderTimeMs,
      });
    }

    return this.getReport();
  }

  getReport(): ComparisonReport {
    const rust = this.rustMetrics.summarize();
    const three = this.threeMetrics.summarize();

    const physicsSpeedup =
      rust.avgPhysicsTimeMs > 0.0001 && three.avgPhysicsTimeMs > 0.0001
        ? three.avgPhysicsTimeMs / rust.avgPhysicsTimeMs
        : 0;

    const totalSpeedup =
      rust.avgFrameTimeMs > 0.0001 && three.avgFrameTimeMs > 0.0001
        ? three.avgFrameTimeMs / rust.avgFrameTimeMs
        : 0;

    return {
      rust,
      three,
      physicsSpeedup,
      totalSpeedup,
      lastFeatureComparison: this.lastFeatureComparison,
    };
  }
}
