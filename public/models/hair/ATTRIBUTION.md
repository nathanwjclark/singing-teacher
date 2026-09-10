# Hair model attribution

The rendered hair uses **MakeHuman short04**, an actual openly licensed 3D hairstyle with its original UV-mapped fine-strand texture. It is adapted here into an offset parted haircut; it is not a procedurally generated replacement mesh.

- Author/project: MakeHuman system assets.
- Source listing (short04 is explicitly CC0): https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- Downloaded official archive: https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
- Archive members: `hair/short04/short04.obj` and `hair/short04/short04_diffuse.png`.
- License: **CC0 1.0 Universal**, included as [LICENSE-CC0.txt](LICENSE-CC0.txt).
- Upstream license text: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md
- Retrieved: 2026-09-10.

The OBJ header explicitly states that this asset was released as CC0 in September 2020. It identifies the copyright holders at that release as Data Collection AB, Joel Palmius, and Jonas Hauquier. MakeHuman's software license is separate from this asset license.

## Included files and changes

`short04-source.obj` is the unmodified source mesh (865 vertices, 525 polygon faces). `short04-diffuse.png` is the unmodified source texture, preserving the authored fine hair strands and transparent edges.

At runtime, `src/lib/modelHair.ts` preserves the source topology and UV coordinates, scales/translates its positions into the anatomy head rig, gently shapes a crown valley, and adds a narrow scalp-colored ribbon following the imported surface to make the offset part visible. A slight cool material tint is applied. No individual 3D strand tubes are added. The asset is decorative and is not an anatomical measurement.

The target head rig origin is world `(0,151,-1)` centimeters. Source coordinates are mapped to head-local x `(x+0.00515)*10.55`, y `8+(y-6.4721)*7.08`, z `-10.7+(z+0.4595)*10.9`, followed by the small crown adjustment described above. The forward hairline is lowered by up to 3.25 cm (smoothly across local z −1 to 9) to cover the taller Z-Anatomy frontal vault while preserving the brow muscles and crown volume.

## Source checksums (SHA-256)

- `short04-source.obj`: `676964a133ee35ffcea1195382bf75542da7a298931e4001bc7b0d7b707225de`
- `short04-diffuse.png`: `0bef7fc0e403db5a40fabb2111ebfa6f7e8158e204c6e56b8da98e9ef527846e`
