# Compressed glTF fixtures

Generated from the uncompressed models in `web/previs/examples/models/{mug,walker,tail}.glb`
with `@gltf-transform/cli` **4.5.1** (released 2026-09-28; run via npx, not a dependency).
Decoders for tests: `draco3d` 1.5.9, `meshoptimizer` 1.3.0 (devDependencies only).

## Reproduce (from `web/`)

```sh
D=src/__tests__/fixtures/gltf-compressed
for m in mug walker tail; do
  npx -y @gltf-transform/cli@4.5.1 draco   previs/examples/models/$m.glb $D/$m.draco.glb
  npx -y @gltf-transform/cli@4.5.1 meshopt previs/examples/models/$m.glb $D/$m.meshopt.glb
done
npx -y @gltf-transform/cli@4.5.1 inspect $D/tail.draco.glb   # per-file summary
```

Default options only. The `meshopt` command quantizes by itself, so `KHR_mesh_quantization`
is also required by every meshopt fixture (no separate `quantize` variant needed).
The `draco` command does not add quantization extensions.

## Fixtures

| file | source | bytes (source) | extensionsRequired | nodes | meshes/prims | accessors | skins | animations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mug.draco.glb | mug.glb | 3580 (16092) | KHR_draco_mesh_compression | 1 | 1/1 | 3 | 0 | 0 |
| mug.meshopt.glb | mug.glb | 5416 (16092) | EXT_meshopt_compression, KHR_mesh_quantization | 1 | 1/1 | 3 | 0 | 0 |
| walker.draco.glb | walker.glb | 11564 (20328) | KHR_draco_mesh_compression | 12 | 7/7 | 34 | 0 | 2 |
| walker.meshopt.glb | walker.glb | 14060 (20328) | EXT_meshopt_compression, KHR_mesh_quantization | 22 | 7/7 | 28 | 0 | 2 |
| tail.draco.glb | tail.glb | 4436 (8132) | KHR_draco_mesh_compression | 5 | 1/1 | 11 | 1 | 1 |
| tail.meshopt.glb | tail.glb | 5656 (8132) | EXT_meshopt_compression, KHR_mesh_quantization | 5 | 1/1 | 11 | 1 | 1 |

Notes:
- `tail` keeps its skin (JOINTS_0 present) and animation; `walker` keeps both animations.
- `walker.meshopt.glb` has 22 nodes vs 12 in the source: the CLI's quantize step adds
  nodes (dequantization transforms) and prunes unused accessors (34 to 28).
- Source models have no extensions (`extensionsUsed` empty).
- CLI prune messages such as "Removed types... Skin (1)" refer to intermediate steps; the final
  files still contain the skin.
