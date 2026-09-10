import * as THREE from 'three';
import { createAtlasSurface } from '../../lib/atlasSurface';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import { ATLAS_WIDTH as W, ATLAS_HEIGHT as H } from '../../lib/atlasMotion';

/** Oral context traced against the Lynch/Jaffe sagittal reference (CC BY 2.5).
 * Illustrative cavity walls and lips, not a reconstruction of internal tissue.
 * The blue native cast and its comparison remain independent foreground layers.
 */
function createOralTexture(layer: 'upper-cavity' | 'lower-cavity' | 'upper-lip' | 'lower-lip') {
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
  if (layer === 'upper-cavity') {
    // Hard/soft palate above, floor of the mouth below, open toward the pharynx.
    // A translucent shell keeps the fitted airway and red/green differences clear.

    shape('M 197 816 C 260 770 364 763 441 780 C 488 791 532 818 552 851 C 544 860 532 860 522 849 C 493 820 469 809 433 801 C 352 786 266 790 211 827 Z', '#ebd6b142', '#f0d9b794', 3);
    // The alveolar margins make the opening read as a mouth at pane scale.
    shape('M 178 821 Q 187 814 205 820 L 211 862 Q 194 868 180 857 Z', '#f5e8d788', '#f6eadac9', 3);
  } else if (layer === 'lower-cavity') {
    shape('M 155 893 C 176 903 194 925 220 956 C 260 1000 330 1027 411 1030 C 473 1036 531 1020 562 976 L 565 990 C 530 1037 470 1052 409 1045 C 327 1040 250 1010 207 968 C 184 943 170 917 155 893 Z', '#e7c49418', '#dfc69e85', 5);
    shape('M 185 902 Q 201 893 216 900 L 218 936 Q 206 946 192 935 Z', '#f5e8d76b', '#f6eadab0', 3);
  } else if (layer === 'upper-lip') {
    shape('M 111 810 C 100 817 91 834 99 847 C 108 856 124 858 145 866 C 159 867 175 861 187 849 C 160 847 144 838 130 824 Z', '#bd657bdd', '#efafbd', 4);
    context.strokeStyle = '#f6c1cf'; context.lineWidth = 3;
    context.stroke(new Path2D('M 104 846 Q 128 850 145 860'));
  } else {
    shape('M 145 877 C 125 879 105 890 102 903 C 101 916 115 925 129 925 C 152 919 174 908 192 902 L 177 884 C 166 881 154 880 145 877 Z', '#bd657bdd', '#efafbd', 4);
    context.strokeStyle = '#f6c1cf'; context.lineWidth = 3;
    context.stroke(new Path2D('M 114 904 Q 144 894 174 890'));
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
  const layers = (['upper-cavity', 'lower-cavity', 'upper-lip', 'lower-lip'] as const).map(part => {
    const surface = createAtlasSurface(part.startsWith('upper') ? 'upper-oral' : 'lower-oral');
    const texture = createOralTexture(part);
    const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false});
    const mesh = new THREE.Mesh(surface.geometry, material);
    mesh.frustumCulled = false; mesh.renderOrder = part.endsWith('cavity') ? .5 : 2;
    group.add(mesh);
    return {surface, texture, material};
  });
  return {
    group,
    update(state: AnatomyMotionState) { layers.forEach(layer => layer.surface.update(state)); },
    dispose() { layers.forEach(layer => { layer.surface.dispose(); layer.material.dispose(); layer.texture.dispose(); }); },
  };
}
