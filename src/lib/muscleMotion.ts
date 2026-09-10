import { BufferAttribute, DynamicDrawUsage, Group, Matrix4, Mesh, Vector3 } from 'three';

type Rig = 'torso' | 'head' | 'jaw';
type Rigs = Record<Rig | 'leftShoulder' | 'rightShoulder', Group>;
type Binding = {
  mesh: Mesh;
  positions: BufferAttribute;
  normals: BufferAttribute;
  rest: Float32Array;
  restNormals: Float32Array;
  headWeights: Float32Array;
  jawWeights: Float32Array;
  shoulderWeights: Float32Array;
  side: number;
  expression: string;
};
const ramp = (value: number, low: number, high: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Illustrative attachment weights in the dataset's original centimeter coordinates.
 * These preserve the original surfaces and blend their attachment motion; they
 * are presentation rigging, not a simulation or measurement of muscle tension. */
function attachmentWeights(name: string): ((x: number, y: number, z: number) => [number, number]) | undefined {
  const n = name.toLowerCase();
  if (n.includes('frontalis') || n.includes('orbicularis_oculi')) return () => [1, 0];
  if (n.includes('deltoid') || n.includes('pectoralis_major')) return () => [0, 0];
  if (n.includes('mentalis') || n.includes('depressor_labii')) return () => [0, 1];
  if (n.includes('masseter')) return (_x, y) => {
    const head = ramp(y, 152, 156.7); return [head, 1 - head];
  };
  if (n.includes('temporalis_muscle')) return (_x, y) => {
    const head = ramp(y, 155, 159.2); return [head, 1 - head];
  };
  if (n.includes('orbicularis_oris')) return (_x, y) => {
    const head = ramp(y, 152, 154.3); return [head, 1 - head];
  };
  if (n.includes('zygomaticus') || n.includes('levator_labii')) return (_x, y) => {
    const jaw = (1 - ramp(y, 152.5, 155.5)) * .45; return [1 - jaw, jaw];
  };
  if (n.includes('anterior_belly_of_digastric')) return (_x, _y, z) => [0, ramp(z, 3.9, 6.5)];
  if (n.includes('posterior_belly_of_digastric')) return (_x, y) => [ramp(y, 151, 156), 0];
  if (n.includes('mylohyoid')) return (x, _y, z) => [0, Math.max(ramp(Math.abs(x), .4, 2.4), ramp(z, 4, 6.7))];
  if (n.includes('sternocleidomastoid')) return (_x, y) => [ramp(y, 142, 155.5), 0];
  if (n.includes('levator_scapulae')) return (_x, y) => [ramp(y, 142, 152.5), 0];
  // The source calls the skull-attached upper trapezius bundle "Ascending".
  if (n.includes('trapezius')) return (x, y) => [ramp(y, 144.5, 156.5) * (1 - ramp(Math.abs(x), 4, 11)), 0];
  return undefined;
}

/** CPU skinning only for muscles spanning moving attachments. Other muscles keep
 * their existing bone parent. All math precedes the shared mirrored scene parent,
 * so reflection, torso motion and orbiting are applied exactly once by THREE. */
export function createMuscleMotion(rigs: Rigs) {
  const bindings: Binding[] = [];
  const inverseHeadBind = new Matrix4().makeTranslation(0, -21, 1);
  const inverseJawBind = new Matrix4().makeTranslation(0, -26, 0);
  const headMotion = new Matrix4();
  const jawMotion = new Matrix4();
  const previousHead = new Matrix4();
  const previousJaw = new Matrix4();
  const shoulderMotion = [new Matrix4(), new Matrix4()];
  const previousShoulders = [new Matrix4(), new Matrix4()];
  const shoulderBind = [new Matrix4().makeTranslation(-1, -10, -5), new Matrix4().makeTranslation(1, -10, -5)];
  const expressions: Record<string, number> = {};
  const expressionKeys = ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'browDownLeft', 'browDownRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'cheekSquintLeft', 'cheekSquintRight', 'cheekPuff', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'mouthFunnel', 'mouthStretchLeft', 'mouthStretchRight'];
  const restPoint = new Vector3();const movedHead = new Vector3();const movedJaw = new Vector3();
  const restNormal = new Vector3();const headNormal = new Vector3();const jawNormal = new Vector3();
  const movedShoulder = new Vector3();const shoulderNormal = new Vector3();
  let dirty = false;

  function bind(mesh: Mesh, originalRig: Rig) {
    const weights = attachmentWeights(mesh.name);
    if (!weights) return;
    // Decode used the manifest's old rig pivot. Bring vertices into bind-pose
    // torso space explicitly; matrixWorld may already be animated during loading.
    if (originalRig === 'head') mesh.geometry.translate(0, 21, -1);
    else if (originalRig === 'jaw') mesh.geometry.translate(0, 26, 0);
    rigs.torso.add(mesh);
    const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
    const normals = mesh.geometry.getAttribute('normal') as BufferAttribute;
    positions.setUsage(DynamicDrawUsage);normals.setUsage(DynamicDrawUsage);
    const rest = new Float32Array(positions.array);
    const restNormals = new Float32Array(normals.array);
    const headWeights = new Float32Array(positions.count);
    const jawWeights = new Float32Array(positions.count);
    const shoulderWeights = new Float32Array(positions.count);
    const name = mesh.name.toLowerCase();
    const side = name.endsWith('l') ? 0 : 1;
    const expression = /frontalis|orbicularis_oculi|orbicularis_oris|zygomaticus|levator_labii/.exec(name)?.[0] ?? '';
    for (let i = 0; i < positions.count; i++) {
      const [h, j] = weights(rest[i * 3], rest[i * 3 + 1] + 130, rest[i * 3 + 2]);
      headWeights[i] = h;jawWeights[i] = j;
      const x = Math.abs(rest[i * 3]), y = rest[i * 3 + 1] + 130;
      if (name.includes('deltoid')) shoulderWeights[i] = 1;
      else if (name.includes('pectoralis_major')) shoulderWeights[i] = ramp(x, 3, 18);
      else if (name.includes('trapezius')) shoulderWeights[i] = (1 - h) * ramp(x, 2, 11) * ramp(y, 125, 140);
      else if (name.includes('levator_scapulae')) shoulderWeights[i] = 1 - h;
      else if (name.includes('sternocleidomastoid')) shoulderWeights[i] = (1 - h) * ramp(x, .6, 4);
    }
    // Skip wholly fixed bundles after attachment evaluation (e.g. lower trapezius).
    if (!headWeights.some(w => w > 0) && !jawWeights.some(w => w > 0) && !shoulderWeights.some(w => w > 0)) return;
    mesh.geometry.computeBoundingSphere();
    if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius += 15;
    bindings.push({ mesh, positions, normals, rest, restNormals, headWeights, jawWeights, shoulderWeights, side, expression });
    dirty = true;
  }

  function update(blendshapes: Record<string, number> = {}) {
    rigs.head.updateMatrix();rigs.jaw.updateMatrix();
    headMotion.multiplyMatrices(rigs.head.matrix, inverseHeadBind);
    jawMotion.multiplyMatrices(rigs.head.matrix, rigs.jaw.matrix).multiply(inverseJawBind);
    [rigs.leftShoulder, rigs.rightShoulder].forEach((rig, i) => { rig.updateMatrix();shoulderMotion[i].multiplyMatrices(rig.matrix, shoulderBind[i]); });
    let expressionChanged = false;
    for (const key of expressionKeys) {
      const raw = blendshapes[key];
      const target = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
      const old = expressions[key] ?? 0;
      const next = Math.abs(target - old) < .0001 ? target : old + (target - old) * .25;
      if (next !== old) expressionChanged = true;
      expressions[key] = next;
    }
    const differs = (a: Matrix4, b: Matrix4) => a.elements.some((v, i) => Math.abs(v - b.elements[i]) > 1e-6);
    if (!dirty && !expressionChanged && !differs(headMotion, previousHead) && !differs(jawMotion, previousJaw) && !shoulderMotion.some((m, i) => differs(m, previousShoulders[i]))) return;
    dirty = false;previousHead.copy(headMotion);previousJaw.copy(jawMotion);
    shoulderMotion.forEach((m, i) => previousShoulders[i].copy(m));
    for (const binding of bindings) {
      const { positions, normals, rest, restNormals, headWeights, jawWeights, shoulderWeights, side, expression } = binding;
      const suffix = side === 0 ? 'Left' : 'Right';const sign = side === 0 ? 1 : -1;
      const value = (key: string) => expressions[key + suffix] ?? 0;
      const smile = value('mouthSmile'), frown = value('mouthFrown'), blink = value('eyeBlink'), squint = value('eyeSquint');
      for (let i = 0; i < positions.count; i++) {
        const h = headWeights[i], j = jawWeights[i], shoulder = shoulderWeights[i], fixed = 1 - h - j - shoulder;
        restPoint.fromArray(rest, i * 3);
        const y = restPoint.y + 130, x = Math.abs(restPoint.x);
        // Small facial morphs driven by visible expression scores. Skull anchors
        // stay fixed while brow, eyelid and mouth-side vertices shift.
        if (expression === 'frontalis') {
          const anchor = 1 - ramp(y, 160.5, 166.8), outer = ramp(x, .8, 4.7);
          restPoint.y += anchor * (expressions.browInnerUp * (1 - outer) * 1.6 + value('browOuterUp') * outer * 1.7 - value('browDown') * 1.2);
          restPoint.x -= sign * anchor * value('browDown') * .4 * (1 - outer);
        } else if (expression === 'orbicularis_oculi') {
          const center = 159.1;
          restPoint.y = center - 130 + (y - center) * Math.max(.08, 1 - blink * .88 - squint * .28 + value('eyeWide') * .25);
          restPoint.y += value('cheekSquint') * (1 - ramp(y, 157.5, 160)) * .65;
        } else if (expression === 'zygomaticus' || expression === 'levator_labii') {
          const mouthEnd = 1 - ramp(y, 153, 157.5);
          restPoint.y += mouthEnd * (smile * 1.4 - frown * .85 + value('cheekSquint') * .55);
          restPoint.x += sign * mouthEnd * smile * .7;
          restPoint.z += expressions.cheekPuff * .65 * (1 - mouthEnd * .5);
        } else if (expression === 'orbicularis_oris') {
          const corner = ramp(x, .4, 2.8);
          restPoint.y += corner * (smile * 1.1 - frown * .9);
          restPoint.x *= 1 + value('mouthStretch') * .2 - expressions.mouthPucker * .23 - expressions.mouthFunnel * .13;
          restPoint.z += expressions.mouthPucker * .8 + expressions.mouthFunnel * .5;
        }
        movedHead.copy(restPoint).applyMatrix4(headMotion);
        movedJaw.copy(restPoint).applyMatrix4(jawMotion);
        movedShoulder.copy(restPoint).applyMatrix4(shoulderMotion[side]);
        positions.setXYZ(i, restPoint.x * fixed + movedHead.x * h + movedJaw.x * j + movedShoulder.x * shoulder, restPoint.y * fixed + movedHead.y * h + movedJaw.y * j + movedShoulder.y * shoulder, restPoint.z * fixed + movedHead.z * h + movedJaw.z * j + movedShoulder.z * shoulder);
        // Rigs use rigid transforms; blending their rotated rest normals avoids
        // rebuilding triangle normals across the full anatomical dataset.
        restNormal.fromArray(restNormals, i * 3);
        headNormal.copy(restNormal).transformDirection(headMotion);
        jawNormal.copy(restNormal).transformDirection(jawMotion);
        shoulderNormal.copy(restNormal).transformDirection(shoulderMotion[side]);
        restNormal.multiplyScalar(fixed).addScaledVector(headNormal, h).addScaledVector(jawNormal, j).addScaledVector(shoulderNormal, shoulder).normalize();
        normals.setXYZ(i, restNormal.x, restNormal.y, restNormal.z);
      }
      positions.needsUpdate = true;normals.needsUpdate = true;
    }
  }
  return { bind, update };
}
