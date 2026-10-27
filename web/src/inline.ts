/**
 * `charturbo/inline`: the main entry with the WebAssembly module embedded (base64), so
 * there is no separate `.wasm` file to serve. Use it with bundlers or CDNs that do not emit
 * `new URL('...', import.meta.url)` assets (e.g. esbuild without a copy step). The main entry
 * downloads less (binary `.wasm`, streaming compile) — prefer it when your bundler supports it.
 * The UMD build (`<script>` tag) is built from this entry.
 *
 * @packageDocumentation
 * @module charturbo/inline
 */
import wasmBase64 from 'virtual:charturbo-wasm-base64';
import { setWasmSourceLazy } from './sdk/charturbo';

/** Decoded on the first engine start, not at import (SSR / unused imports stay cheap). */
setWasmSourceLazy(() => {
  const fromBase64 = (Uint8Array as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (fromBase64) return fromBase64(wasmBase64);
  const bin = atob(wasmBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
});

export * from './index';
