# Quaternius hairstyles (CC0)

3D models by Quaternius, https://quaternius.com, from the free "Universal Base Characters [Standard]" kit, folder `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/` (each hairstyle is a skinned mesh on the kit's full UE-style skeleton, 100 % weighted to `Head`). Textures from `Hairstyles/Textures/` with the OpenGL-convention normal maps of `Hairstyles/Textures/Normals Unity - Godot/` (byte-identical to the copies in the glTF folder). License CC0 1.0 (Creative Commons Zero, https://creativecommons.org/publicdomain/zero/1.0/); the pack's license text is in `LICENSE.txt`. Crediting is not mandatory.

They are drawn as extra retargeted parts of a Superhero body (`retargetParts`, see `docs/previs/guide.md` "Hair and other parts of a retargeted character"): the hairstyle's skeleton is retargeted from the same source as the body, so its Head bone gets exactly the body's pose. A hairstyle must sit on the body of the same build (male styles: the regular male skeleton, equal to `../Superhero_Male_FullBody.gltf` from the pelvis to the Head and in the legs; female styles: the female skeleton, equal to `../../../film/models/haon/Superhero_Female_FullBody.gltf`).

| File | Skeleton | Material / textures | Use |
| --- | --- | --- | --- |
| `Hair_SimpleParted.gltf` + `.bin` | male | `MI_Hair_1`: `T_Hair_1_*` | hero hair in `../../../retarget-demo.gen.ts` and `../../../gate-raid.gen.ts` (`hero_hair`) |
| `Hair_Beard.gltf` + `.bin` | male | `MI_Hair_1`: `T_Hair_1_*` | gate-raid giant (`giant_beard`), film 도원 (`mentor_hair_beard`, `../../../film/common.ts` `HAIR`) |
| `Hair_Buzzed.gltf` + `.bin` | male | `MI_Hair_1`: `T_Hair_1_*` | film 도원 (`mentor_hair_buzzed`) |
| `Hair_Buns.gltf` + `.bin` | female | `MI_Hair_2`: `T_Hair_2_*`, tinted (below) | film 하온 (`haon_hair_buns`) |
| `T_Hair_1_BaseColor.png`, `T_Hair_1_Normal.png`, `T_Hair_2_BaseColor.png`, `T_Hair_2_Normal.png` | | | textures referenced by the `.gltf` files |

The kit's eyebrows (`Eyebrows_Regular`, `Eyebrows_Female`) are not copied: the Superhero bodies already contain the same eyebrow meshes.

Modifications:

- Textures downscaled to 1024 (sips): the four 2048² maps were resized with macOS `sips -Z 1024` (same file names, PNG, same channels), and the `sRGB` / `eXIf` chunks sips adds were removed (the originals carry none). The results are byte-identical to `../T_Hair_1_*.png` and `../../../film/models/haon/T_Hair_2_*.png`. One hairstyle node then needs 2 x 5.33 MiB = 10.7 MiB of texture memory (RGBA8 with mipmaps) instead of about 43 MiB.
- `Hair_Buns.gltf`: `"baseColorFactor": [0.16, 0.09, 0.06, 1.0]` added to the material `MI_Hair_2` (dark brown; the grey hair texture is meant to be tinted, glTF multiplies the texture by this linear factor). The same factor is on `MI_Hair_2` (the eyebrows) of `../../../film/models/haon/Superhero_Female_FullBody.gltf`. The male styles are untinted (silver-white).

All other files are unmodified copies.
