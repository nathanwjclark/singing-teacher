import * as THREE from 'three';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import { ATLAS_WIDTH as W, ATLAS_HEIGHT as H, deformAtlasPoint } from '../../lib/atlasMotion';

/** Oral context traced against the Lynch/Jaffe sagittal reference (CC BY 2.5).
 * Illustrative cavity walls and lips, not a reconstruction of internal tissue.
 * The blue native cast and its comparison remain independent foreground layers.
 */
function createOralTexture(layer: 'cavity' | 'lips') {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw mouth cavity');
  context.lineJoin = 'round'; context.lineCap = 'round';
  const shape = (path: string, fill: string, stroke: string, width: number) => {
    const outline = new Path2D(path);
    context.fillStyle = fill; context.fill(outline);
    context.strokeStyle = stroke; context.lineWidth = width; context.stroke(outline);
  };
  if (layer === 'cavity') {
    // Hard/soft palate above, floor of the mouth below, open toward the pharynx.
    // A translucent shell keeps the fitted airway and red/green differences clear.
    shape('M 156 856 C 182 849 197 827 219 813 C 279 774 369 772 438 786 C 484 795 519 817 553 853 C 578 883 585 936 562 976 C 531 1020 473 1036 411 1030 C 330 1027 260 1000 220 956 C 194 925 176 903 155 893 Z', '#e7c4940d', '#dfc69e85', 5);
    shape('M 197 816 C 260 770 364 763 441 780 C 488 791 532 818 552 851 C 544 860 532 860 522 849 C 493 820 469 809 433 801 C 352 786 266 790 211 827 Z', '#ebd6b142', '#f0d9b794', 3);
    // The alveolar margins make the opening read as a mouth at pane scale.
    shape('M 178 821 Q 187 814 205 820 L 211 862 Q 194 868 180 857 Z', '#f5e8d788', '#f6eadac9', 3);
    shape('M 185 902 Q 201 893 216 900 L 218 936 Q 206 946 192 935 Z', '#f5e8d76b', '#f6eadab0', 3);
  } else {
    shape('M 111 810 C 100 817 91 834 99 847 C 108 856 124 858 145 866 C 159 867 175 861 187 849 C 160 847 144 838 130 824 Z', '#bd657bdd', '#efafbd', 4);
    shape('M 145 877 C 125 879 105 890 102 903 C 101 916 115 925 129 925 C 152 919 174 908 192 902 L 177 884 C 166 881 154 880 145 877 Z', '#bd657bdd', '#efafbd', 4);
    context.strokeStyle = '#f6c1cf'; context.lineWidth = 3;
    context.stroke(new Path2D('M 104 846 Q 128 850 145 860 M 114 904 Q 144 894 174 890'));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Add once beside the cast. update() uses the shared jaw/head state while
 * deliberately leaving cavity walls and lips independent of tongue excursions.
 */
export function createOralOverlay() {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(W, H, 96, 112);
  const positions = geometry.getAttribute('position');
  const rest = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    rest[i * 2] = positions.getX(i) + W / 2;
    rest[i * 2 + 1] = H / 2 - positions.getY(i);
  }
  const textures = [createOralTexture('cavity'), createOralTexture('lips')];
  const materials = textures.map(map => new THREE.MeshBasicMaterial({
    map, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
  materials.forEach((material, index) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = index === 0 ? .5 : 2;
    group.add(mesh);
  });
  const neutralTongue = { lateral: 0, lift: 0, extension: 0, curl: 0, visible: false };
  return {
    group,
    update(state: AnatomyMotionState) {
      const oralState = { ...state, tongue: neutralTongue };
      for (let i = 0; i < positions.count; i++) {
        const [x, y] = deformAtlasPoint(rest[i * 2], rest[i * 2 + 1], oralState);
        positions.setXYZ(i, W - x, -y, 0);
      }
      positions.needsUpdate = true;
    },
    dispose() {
      geometry.dispose(); materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
    },
  };
}
