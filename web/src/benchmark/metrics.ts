export interface FrameSample {
  frameTimeMs: number;
  physicsTimeMs: number;
  renderTimeMs: number;
}

export interface AggregatedMetrics {
  avgFps: number;
  onePercentLowFps: number;
  avgFrameTimeMs: number;
  avgPhysicsTimeMs: number;
  avgRenderTimeMs: number;
  sampleCount: number;
}

export class MetricsCollector {
  private readonly windowSize: number;
  private samples: FrameSample[] = [];

  constructor(windowSize = 60) {
    this.windowSize = Math.max(5, windowSize);
  }

  record(sample: FrameSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
  }

  reset(): void {
    this.samples.length = 0;
  }

  summarize(): AggregatedMetrics {
    const n = this.samples.length;
    if (n === 0) {
      return {
        avgFps: 0,
        onePercentLowFps: 0,
        avgFrameTimeMs: 0,
        avgPhysicsTimeMs: 0,
        avgRenderTimeMs: 0,
        sampleCount: 0,
      };
    }

    let totalFrame = 0;
    let totalPhysics = 0;
    let totalRender = 0;
    const frameTimes: number[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      totalFrame += s.frameTimeMs;
      totalPhysics += s.physicsTimeMs;
      totalRender += s.renderTimeMs;
      frameTimes[i] = s.frameTimeMs;
    }

    frameTimes.sort((a, b) => a - b);
    const p99Idx = Math.min(n - 1, Math.floor(n * 0.99));
    const worstFrameTime = Math.max(0.001, frameTimes[p99Idx]);
    const avgFrameTimeMs = totalFrame / n;

    return {
      avgFps: 1000.0 / Math.max(0.001, avgFrameTimeMs),
      onePercentLowFps: 1000.0 / worstFrameTime,
      avgFrameTimeMs,
      avgPhysicsTimeMs: totalPhysics / n,
      avgRenderTimeMs: totalRender / n,
      sampleCount: n,
    };
  }
}
