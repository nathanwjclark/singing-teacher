import * as THREE from 'three';
import type { AnatomyMotionState } from './anatomyState';
import { ATLAS_WIDTH as W, ATLAS_HEIGHT as H, deformAtlasPoint, referenceTongueRig, type AtlasTongueRig } from './atlasMotion';

/** Each anatomical piece owns its vertices. Sharing a pose must never mean
 * sharing the tongue's deformation with the skull or the airway cast. */
export function createAtlasSurface(layer: 'tongue' | 'structure') {
  const geometry = new THREE.PlaneGeometry(W, H, 96, 112);
  const positions = geometry.getAttribute('position');
  const rest = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    rest[i * 2] = positions.getX(i) + W / 2;
    rest[i * 2 + 1] = H / 2 - positions.getY(i);
  }
  return {
    geometry,
    update(state: AnatomyMotionState, rig: AtlasTongueRig = referenceTongueRig) {
      for (let i = 0; i < positions.count; i++) {
        const [x, y] = deformAtlasPoint(rest[i * 2], rest[i * 2 + 1], state, rig, layer);
        positions.setXYZ(i, W - x, -y, 0);
      }
      positions.needsUpdate = true;
    },
    dispose() { geometry.dispose(); },
  };
}
