import * as THREE from 'three';
import { ATLAS_WIDTH, ATLAS_HEIGHT } from '../../lib/atlasMotion';

/** Existing side-pane cast, registered to the reference plate's lips and neck.
 * This is a teaching shape, not a fitted patient airway or measured lumen.
 * Its rest paths are kept in their original SVG coordinates, then placed in the
 * plate's native left-facing coordinates. Both layers use the same surface rig.
 */
export function createTractOverlay() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH; canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw the vocal tract overlay');
  context.setTransform(-5.9, 0, 0, 4.55, 1491.5, 245.35);
  const fill = (path: string, color: string | CanvasGradient, stroke?: string, width = 1) => {
    context.fillStyle = color; context.fill(new Path2D(path));
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(new Path2D(path)); }
  };
  const line = (path: string, color: string, width = 1) => {
    context.strokeStyle = color; context.lineWidth = width; context.stroke(new Path2D(path));
  };
  const lumen = context.createLinearGradient(153, 180, 235, 123);
  lumen.addColorStop(0, '#367c76'); lumen.addColorStop(.4, '#a4e0cf');
  lumen.addColorStop(.68, '#68b4a6'); lumen.addColorStop(1, '#326a68');
  // Same reference airway, centerline, tongue boundary and rings as the former
  // lower SVG. Point deformation now comes from the plate's shared anatomy rig.
  line('M 236 93 Q 211 82 194 102 Q 182 110 173 132', '#7fb7af38', 15);
  fill('M 235 123 Q 211 117 191 119 Q 169 118 159 139 Q 155 151 153 163 L 154 197 Q 154 211 151 234 L 166 234 Q 170 210 167 195 L 166 165 Q 163 154 174 143 Q 184 132 200 131 Q 216 131 235 137 Z', lumen, '#b4e8d8', 1.4);
  line('M 231 129 Q 181 120 163 146 Q 160 160 160 188 Q 163 210 158 233', '#e3fff16e');
  fill('M 166 159 C 156 144 176 129 195 132 C 209 134 215 134 223 139 C 224 145 210 153 194 154 C 181 154 178 165 166 159 Z', '#bd7788b8', '#e5a3ad', .8);
  context.beginPath(); context.ellipse(160, 185, 8, 4, 0, 0, Math.PI * 2);
  context.fillStyle = '#224940'; context.fill(); context.strokeStyle = '#c7ecd3'; context.lineWidth = 1; context.stroke();
  line('M 158 182 L 162 188 M 162 182 L 158 188', '#e9e5bb', 1.1);
  for (const y of [204, 213, 222, 231]) line(`M 153 ${y} Q 160 ${y + 5} 168 ${y}`, '#c2e9d48c');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
