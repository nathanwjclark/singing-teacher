import { BufferAttribute, DynamicDrawUsage, Group, Matrix4, Mesh, Vector3 } from 'three';

type Rig = 'torso' | 'head' | 'jaw';
type Rigs = Record<Rig, Group>;
type Binding = {
  mesh: Mesh;
  positions: BufferAttribute;
  normals: BufferAttribute;
  rest: Float32Array;
  restNormals: Float32Array;
  headWeights: Float32Array;
  jawWeights: Float32Array;
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
  const restPoint = new Vector3();const movedHead = new Vector3();const movedJaw = new Vector3();
  const restNormal = new Vector3();const headNormal = new Vector3();const jawNormal = new Vector3();
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
    for (let i = 0; i < positions.count; i++) {
      const [h, j] = weights(rest[i * 3], rest[i * 3 + 1] + 130, rest[i * 3 + 2]);
      headWeights[i] = h;jawWeights[i] = j;
    }
    // Skip wholly fixed bundles after attachment evaluation (e.g. lower trapezius).
    if (!headWeights.some(w => w > 0) && !jawWeights.some(w => w > 0)) return;
    mesh.geometry.computeBoundingSphere();
    if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius += 15;
    bindings.push({ mesh, positions, normals, rest, restNormals, headWeights, jawWeights });
    dirty = true;
  }

  function update() {
    rigs.head.updateMatrix();rigs.jaw.updateMatrix();
    headMotion.multiplyMatrices(rigs.head.matrix, inverseHeadBind);
    jawMotion.multiplyMatrices(rigs.head.matrix, rigs.jaw.matrix).multiply(inverseJawBind);
    const differs = (a: Matrix4, b: Matrix4) => a.elements.some((v, i) => Math.abs(v - b.elements[i]) > 1e-6);
    if (!dirty && !differs(headMotion, previousHead) && !differs(jawMotion, previousJaw)) return;
    dirty = false;previousHead.copy(headMotion);previousJaw.copy(jawMotion);
    for (const binding of bindings) {
      const { positions, normals, rest, restNormals, headWeights, jawWeights } = binding;
      for (let i = 0; i < positions.count; i++) {
        const h = headWeights[i], j = jawWeights[i], fixed = 1 - h - j;
        restPoint.fromArray(rest, i * 3);
        movedHead.copy(restPoint).applyMatrix4(headMotion);
        movedJaw.copy(restPoint).applyMatrix4(jawMotion);
        positions.setXYZ(i, restPoint.x * fixed + movedHead.x * h + movedJaw.x * j, restPoint.y * fixed + movedHead.y * h + movedJaw.y * j, restPoint.z * fixed + movedHead.z * h + movedJaw.z * j);
        // Rigs use rigid transforms; blending their rotated rest normals avoids
        // rebuilding triangle normals across the full anatomical dataset.
        restNormal.fromArray(restNormals, i * 3);
        headNormal.copy(restNormal).transformDirection(headMotion);
        jawNormal.copy(restNormal).transformDirection(jawMotion);
        restNormal.multiplyScalar(fixed).addScaledVector(headNormal, h).addScaledVector(jawNormal, j).normalize();
        normals.setXYZ(i, restNormal.x, restNormal.y, restNormal.z);
      }
      positions.needsUpdate = true;normals.needsUpdate = true;
    }
  }
  return { bind, update };
}
