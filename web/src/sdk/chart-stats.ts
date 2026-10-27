/**
 * Render statistics of an engine (`Charturbo.getRenderStats`): GPU buffer / texture bytes,
 * chart upload traffic, staged instance counts and the WebAssembly memory size, decoded from the
 * engine's flat `render_stats` array (lib_stats.rs). Meant for benchmarks and diagnostics.
 */

export interface CharturboRenderStats {
  /** Bytes allocated in GPU vertex / instance buffers and chart textures (capacity) */
  gpuBytes: number;
  /** Bytes the last frame uploaded for the chart (0 = nothing changed) */
  chartUploadBytes: number;
  /** Chart bytes uploaded since the engine was created */
  chartUploadTotal: number;
  /** Frames that uploaded chart data */
  chartUploads: number;
  /** Frames rendered */
  frames: number;
  /** Staged marks of the last upload of each layer */
  seriesSegments: number;
  points: number;
  bars: number;
  fillVertices: number;
  markers: number;
  /** Size of the engine's WebAssembly memory (shared by every engine of the page) */
  wasmMemoryBytes: number;
}

export interface RenderStatsBackend {
  render_stats?(): Float64Array | number[];
}

/** Decodes `render_stats()`; null when the backend does not provide it. */
export function readRenderStats(backend: RenderStatsBackend): CharturboRenderStats | null {
  const s = backend.render_stats?.();
  if (!s || s.length < 11) return null;
  return {
    gpuBytes: s[0],
    chartUploadBytes: s[1],
    chartUploadTotal: s[2],
    chartUploads: s[3],
    frames: s[4],
    seriesSegments: s[5],
    points: s[6],
    bars: s[7],
    fillVertices: s[8],
    markers: s[9],
    wasmMemoryBytes: s[10],
  };
}
