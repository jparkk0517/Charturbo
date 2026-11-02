import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('./fixtures/gltf-compressed/', import.meta.url);

function glbJson(name: string): Record<string, any> {
  const b = readFileSync(fileURLToPath(new URL(name, dir)));
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = b.readUInt32LE(12);
  expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

const cases: [string, string[], { skins?: number; animations?: number }][] = [
  ['mug.draco.glb', ['KHR_draco_mesh_compression'], {}],
  ['mug.meshopt.glb', ['EXT_meshopt_compression', 'KHR_mesh_quantization'], {}],
  ['walker.draco.glb', ['KHR_draco_mesh_compression'], { animations: 2 }],
  ['walker.meshopt.glb', ['EXT_meshopt_compression', 'KHR_mesh_quantization'], { animations: 2 }],
  ['tail.draco.glb', ['KHR_draco_mesh_compression'], { skins: 1, animations: 1 }],
  ['tail.meshopt.glb', ['EXT_meshopt_compression', 'KHR_mesh_quantization'], { skins: 1, animations: 1 }],
];

describe('compressed glTF fixtures', () => {
  it.each(cases)('%s declares required extensions', (name, exts, keep) => {
    const j = glbJson(name);
    for (const e of exts) expect(j.extensionsRequired).toContain(e);
    expect((j.skins ?? []).length).toBe(keep.skins ?? 0);
    expect((j.animations ?? []).length).toBe(keep.animations ?? 0);
  });

  it('meshoptimizer decoder is ready', async () => {
    const { MeshoptDecoder } = await import('meshoptimizer');
    await MeshoptDecoder.ready;
    expect(typeof MeshoptDecoder.decodeGltfBuffer).toBe('function');
  });

  it('draco3d decoder module instantiates', async () => {
    // @ts-expect-error draco3d ships no type declarations
    const draco3d: any = await import('draco3d');
    const mod = await (draco3d.default ?? draco3d).createDecoderModule({});
    expect(typeof mod.Decoder).toBe('function');
    const d = new mod.Decoder();
    expect(d).toBeTruthy();
    mod.destroy(d);
  });
});
