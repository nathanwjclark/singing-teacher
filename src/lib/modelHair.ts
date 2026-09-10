import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/** Real MakeHuman short04 mesh/UVs + fine-strand texture, CC0. The source shape
 * is fitted to this rig and given an explicit offset crown part. Attribution and
 * unmodified source are in public/models/hair. Returns before local assets load. */
export function createModelHair(): THREE.Group {
  const hair = new THREE.Group();
  hair.name = 'MakeHuman short04 adapted parted hairstyle';
  hair.userData.decorative = true;
  hair.userData.disposed = false;
  const controller = new AbortController();
  hair.userData.abort = () => controller.abort();
  const base = `${import.meta.env.BASE_URL}models/hair/`;
  const fetchAsset = async (path: string) => {
    const response = await fetch(`${base}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Hair asset ${path} failed (${response.status})`);
    return response;
  };
  hair.userData.ready = (async () => {
    const [obj, blob] = await Promise.all([
      fetchAsset('short04-source.obj').then(response => response.text()),
      fetchAsset('short04-diffuse.png').then(response => response.blob()),
    ]);
    if (hair.userData.disposed) return;
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    if (hair.userData.disposed) { bitmap.close(); return; }
    hair.userData.bitmap = bitmap;
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false; texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({ map: texture, color: 0xc6d6d4, roughness: .72, metalness: .025, alphaTest: .3, side: THREE.DoubleSide });
    hair.userData.hairTexture = texture;
    hair.userData.hairMaterial = material;
    const source = new OBJLoader().parse(obj);
    source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const item of Array.isArray(object.material) ? object.material : [object.material]) item.dispose();
      const geometry = object.geometry;
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = (positions.getX(i) + .00515) * 10.55;
        let y = 8 + (positions.getY(i) - 6.4721) * 7.08;
        const z = -10.7 + (positions.getZ(i) + .4595) * 10.9;
        const partX = -1.2 + z * .07;
        // Preserve original topology, create a shallow valley between two halves.
        const top = THREE.MathUtils.smoothstep(y, 17, 20);
        const front = THREE.MathUtils.smoothstep(z, -7, -3);
        y += top * front * (.48 * Math.exp(-Math.pow((Math.abs(x - partX) - .85) / .7, 2)) - .26 * Math.exp(-Math.pow((x - partX) / .3, 2)));
        positions.setXYZ(i, x, y, z);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      object.material = material;
      object.name = 'CC0 short04 original topology with part adaptation';
    });
    hair.add(source);
    source.updateMatrixWorld(true);
    // A fine exposed-scalp ribbon follows the actual imported crown surface,
    // making the part legible without adding individual 3D hair strands.
    const ray = new THREE.Raycaster();
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 36; i++) {
      const z = 8.4 - i * .37, x = -1.2 + z * .07;
      ray.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(source, true)[0];
      if (hit && hit.point.y > 16) points.push(hit.point.clone().add(new THREE.Vector3(0, .055, 0)));
    }
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const halfWidth = .115 * Math.min(1, (i + 1) / 3, (points.length - i) / 5);
      vertices.push(point.x - halfWidth, point.y, point.z, point.x + halfWidth, point.y, point.z);
      if (i) { const a = (i - 1) * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const part = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x98786a, roughness: .96, side: THREE.DoubleSide }));
    part.name = 'Visible offset scalp part'; hair.add(part);
  })().catch(error => {
    if (!hair.userData.disposed) {
      hair.userData.loadError = error instanceof Error ? error.message : 'Hair asset failed to load';
      console.warn(hair.userData.loadError);
    }
  });
  return hair;
}

/** Complete owned-resource cleanup, including async-loaded geometry. Idempotent.
 * Kept under the existing name so callers need no API change. */
export function disposeModelHairTextures(hair: THREE.Group): void {
  if (hair.userData.disposed) return;
  hair.userData.disposed = true;
  hair.userData.abort?.();
  const materials = new Set<THREE.Material>();
  hair.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  if (hair.userData.hairMaterial) materials.add(hair.userData.hairMaterial);
  materials.forEach(material => material.dispose());
  (hair.userData.hairTexture as THREE.Texture | undefined)?.dispose();
  (hair.userData.bitmap as ImageBitmap | undefined)?.close();
  hair.clear();
}
