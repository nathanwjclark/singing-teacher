# Anatomical model sources and licenses

**Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0**  
**BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan**

These anatomical surfaces are a selected upper-body subset of the Z-Anatomy atlas, derived from BodyParts3D. They are reference anatomy, not a scan of the camera user. The app's animation is an illustrative mapping of visible landmarks, not measurement of internal muscle movement, muscle tension, or bone geometry.

## Original source

- Maintainer repository: https://github.com/LluisV/Z-Anatomy
- Source revision: `6c7f9016bd5899ac8edafd31b9900c151df42ed6` (PC-Version)
- Skeletal source: https://github.com/LluisV/Z-Anatomy/blob/6c7f9016bd5899ac8edafd31b9900c151df42ed6/Resources/Models/FBX/SkeletalSystem100.fbx
- Muscular source: https://github.com/LluisV/Z-Anatomy/blob/6c7f9016bd5899ac8edafd31b9900c151df42ed6/Resources/Models/FBX/MuscularSystem100.fbx
- Source license: https://github.com/LluisV/Z-Anatomy/blob/6c7f9016bd5899ac8edafd31b9900c151df42ed6/Resources/Models/License.txt
- Original model project: https://lifesciencedb.jp/bp3d/info_en/index.html

## License terms

The redistributed anatomical model adaptations (`upper-body.bin` and `upper-body.json`) are licensed **Creative Commons Attribution-ShareAlike 4.0 International**, retaining the underlying BodyParts3D credit and legacy CC BY-SA 2.1 Japan attribution required by the source. The source license is reproduced in `Z-ANATOMY-LICENSE.txt`.

- CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
- CC BY-SA 4.0 legal code: https://creativecommons.org/licenses/by-sa/4.0/legalcode
- CC BY-SA 2.1 Japan: https://creativecommons.org/licenses/by-sa/2.1/jp/

You may share and adapt these assets with attribution and under the applicable share-alike terms. This asset license is separate from the application code. No endorsement by the atlas contributors is implied.

The source license also mentions separately contributed brain, nerves, inner-ear and kidney assets. This selected dataset contains only named skeletal and muscular surfaces from the two files above; it does not include those separately licensed organs.

## Changes made for Singing Teacher

Selected 165 upper-body bone and muscle meshes, excluded attachment markers and labels, cropped triangles below the upper abdomen, baked source world transforms, welded coincident vertices, and quantized positions to 16 bits per axis. Original anatomical mesh names are retained in the JSON manifest, with added coaching region and rig metadata. No anatomical surfaces were procedurally invented. Source geometry uses centimeters; this does not give the viewer a calibrated measurement of the user.

The reproducible extraction script is `scripts/build-anatomy.mjs`. It takes a folder containing the two FBX source files. The browser reconstructs indexed geometry, computes normals and applies presentation materials, illustrative jaw/lip/head/torso movement, and teaching highlights. Cartoon eyeballs are separate application-created decorations and are not anatomical dataset meshes.

Downloaded and adapted September 10, 2026.
