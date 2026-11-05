# Quaternius model (CC0): 하온 (haon)

3D model by Quaternius, https://quaternius.com, from the free "Universal Base Characters [Standard]" kit, folder `Base Characters/Godot - UE/` (glTF with OpenGL-convention normal maps). License CC0 1.0 (Creative Commons Zero, https://creativecommons.org/publicdomain/zero/1.0/); the pack's license text is in `LICENSE.txt`. Crediting is not mandatory.

| File | Use |
| --- | --- |
| `Superhero_Female_FullBody.gltf` + `.bin` | skinned character (UE-style skeleton, T-pose), the textured skin of 하온 in the film scenes (`../../common.ts`, `SRC.haon`, `model.retarget.map: 'ue'`) |
| `T_Superhero_Female_Dark_BaseColor.png`, `T_Superhero_Female_Normal.png`, `T_Superhero_Female_Roughness.png`, `T_Hair_2_BaseColor.png`, `T_Hair_2_Normal.png`, `T_Eye_Brown.png`, `T_Eye_Normal.png` | textures referenced by the `.gltf` |

Modifications:

- The pack's `.gltf` referenced an eye normal image that is not in the pack (`T_Eye_Normal_png.png`); its `uri` was changed to the existing `T_Eye_Normal.png`.
- Textures downscaled to 1024 (sips): the five 2048² maps (`T_Superhero_Female_Dark_BaseColor.png`, `T_Superhero_Female_Normal.png`, `T_Superhero_Female_Roughness.png`, `T_Hair_2_BaseColor.png`, `T_Hair_2_Normal.png`; normal maps included) were resized with macOS `sips -Z 1024` (same file names, PNG, same channels), and the `sRGB` / `eXIf` chunks sips adds were removed (the originals carry none). The 256² eye maps are unchanged. One instance then needs about 27 MiB of texture memory instead of about 107 MiB (see `docs/previs/guide.md`, "Texture memory").

All other files are unmodified copies.
