# Quaternius model (CC0)

3D model by Quaternius, https://quaternius.com, from the free "Universal Base Characters [Standard]" kit, folder `Base Characters/Godot - UE/` (glTF with OpenGL-convention normal maps). License CC0 1.0 (Creative Commons Zero, https://creativecommons.org/publicdomain/zero/1.0/); the pack's license text is in `LICENSE.txt`. Crediting is not mandatory.

| File | Use |
| --- | --- |
| `Superhero_Male_FullBody.gltf` + `.bin` | skinned character (UE-style skeleton, 1.82 m, T-pose), retargeted in `../../retarget-demo.gen.ts` (`retarget-demo.json`) and `../../gate-raid.gen.ts` (`gate-raid.json`, textured pass) with `model.retarget.map: 'ue'` |
| `T_Superhero_Male_Dark.png`, `T_Superhero_Male_Normal.png`, `T_Superhero_Male_Roughness.png`, `T_Hair_1_BaseColor.png`, `T_Hair_1_Normal.png`, `T_Eye_Brown.png`, `T_Eye_Normal.png` | textures referenced by the `.gltf` |

Modification: the pack's `.gltf` referenced two images that are not in the pack (`T_Hair_1_Normal_png.png`, `T_Eye_Normal_png.png`). Their `uri` was changed to the existing `T_Hair_1_Normal.png` and `T_Eye_Normal.png`. All other files are unmodified copies.
