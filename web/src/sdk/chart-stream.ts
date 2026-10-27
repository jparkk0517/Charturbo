/** Data-only chunks for appending to an existing chart; names and styling stay unchanged. */
export interface SeriesDataChunk {
  values: Float32Array | number[];
  /** Required for charts with explicit x. Numeric values or epoch milliseconds / Dates. */
  x?: Float64Array | number[] | Date[];
}

/** Validates and packs a batch before making a single atomic WASM call. */
export function packAreaAppend(chunks: readonly SeriesDataChunk[], count: number, hasX: boolean, stacked: boolean, maxPoints = 0) {
  const fail = (message: string): never => { throw new Error(`appendAreaData: ${message}`); };
  if (!Number.isInteger(maxPoints) || maxPoints < 0 || maxPoints > 0xffff_ffff) {
    fail('maxPoints must be an integer between 0 (unlimited) and 4294967295');
  }
  if (chunks.length !== count) fail('provide a chunk for every series');
  let total = 0;
  for (const [s, chunk] of chunks.entries()) {
    const x = chunk.x;
    if (hasX && (x?.length ?? 0) !== chunk.values.length) fail(`series ${s}: provide one x for each value`);
    if (!hasX && x !== undefined) fail('the chart has no x; pass values only');
    if (stacked && chunk.values.length !== chunks[0].values.length) fail('stacked areas need aligned samples');
    if (x) {
      for (let i = 0; i < x.length; i++) {
        const value = Number(x[i]);
        if (!Number.isFinite(value) || (i > 0 && value < Number(x[i - 1]))) fail(`series ${s}: x must be finite and sorted ascending`);
        if (stacked && s > 0 && value !== Number(chunks[0].x![i])) fail('stacked areas need shared x');
      }
    }
    total += chunk.values.length;
  }
  const values = new Float32Array(total);
  const xs = new Float64Array(hasX ? total : 0);
  const lengths = new Uint32Array(count);
  let at = 0;
  chunks.forEach((chunk, s) => {
    lengths[s] = chunk.values.length;
    // Match renderLineChart's null-gap convention for untyped JavaScript callers.
    for (let i = 0; i < chunk.values.length; i++) values[at + i] = chunk.values[i] ?? NaN;
    if (hasX && chunk.x) for (let i = 0; i < chunk.x.length; i++) xs[at + i] = Number(chunk.x[i]);
    at += chunk.values.length;
  });
  return { values, lengths, xs, maxPoints };
}
