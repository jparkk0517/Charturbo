/**
 * Lazy glTF decoder loading for the previs tools (offline render page, browser viewer).
 * `gltfExtensions(bytes)` reads `extensionsUsed` of a GLB or .gltf without parsing more than the JSON;
 * `loadDecodersFor(exts)` dynamic-imports a decoder package only when its extension is listed, so a
 * file without compression loads nothing. `window.__previsDecoderLog` (when present) records loads.
 *
 * meshopt: `meshoptimizer` embeds its wasm (nothing to locate).
 * draco: `draco3d/draco_decoder_nodejs.js` (the only decoder JS the package ships; its wasm is the
 * separate `draco_decoder.wasm`). The wasm is imported with vite `?url` (served by the dev server /
 * emitted as an asset by a build), fetched and handed over as `wasmBinary`, so the emscripten module
 * never touches node:fs or guesses a path.
 */
import type { GltfDecoders } from '../src/sdk/scene-gltf';
// @ts-ignore vite `?url` import (no ambient type in this tsconfig)
import dracoWasmUrl from 'draco3d/draco_decoder.wasm?url';

const MESHOPT = 'EXT_meshopt_compression';
const DRACO = 'KHR_draco_mesh_compression';

/** `extensionsUsed` of a GLB (JSON chunk) or a .gltf (JSON text); [] when absent or unreadable. */
export function gltfExtensions(bytes: ArrayBuffer | Uint8Array): string[] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    let text: string;
    if (u8.length >= 20 && u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const len = dv.getUint32(12, true);
      if (dv.getUint32(16, true) !== 0x4e4f534a) return []; // first chunk must be JSON
      text = new TextDecoder().decode(u8.subarray(20, 20 + len));
    } else {
      text = new TextDecoder().decode(u8);
    }
    const json = JSON.parse(text) as { extensionsUsed?: unknown };
    return Array.isArray(json.extensionsUsed) ? json.extensionsUsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

function log(name: string): void {
  const w = window as unknown as { __previsDecoderLog?: string[] };
  (w.__previsDecoderLog ??= []).push(name);
}

/** Loads only the decoders `exts` (see `gltfExtensions`) call for. */
export async function loadDecodersFor(exts: Iterable<string>): Promise<GltfDecoders> {
  const set = new Set(exts);
  const out: GltfDecoders = {};
  if (set.has(MESHOPT)) {
    log('meshopt');
    const { MeshoptDecoder } = await import('meshoptimizer');
    await MeshoptDecoder.ready;
    out.meshopt = MeshoptDecoder;
  }
  if (set.has(DRACO)) {
    log('draco');
    // @ts-ignore draco3d ships no type declarations
    const mod: any = await import('draco3d/draco_decoder_nodejs.js');
    let create: any = mod; // CJS interop may nest the factory under `default` once or twice
    while (typeof create !== 'function' && create?.default) create = create.default;
    if (typeof create !== 'function') throw new Error('draco3d: no factory; module keys=' + Object.keys(mod ?? {}).join(',') + ' type=' + typeof mod);
    const res = await fetch(dracoWasmUrl as string);
    if (!res.ok) throw new Error(`draco decoder wasm: HTTP ${res.status} (${dracoWasmUrl})`);
    out.draco = await create({ wasmBinary: await res.arrayBuffer() });
  }
  return out;
}
