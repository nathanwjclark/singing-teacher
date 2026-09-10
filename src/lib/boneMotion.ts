import { Group, Mesh, Quaternion, Vector3 } from 'three';

type Rigs = Record<'torso' | 'head' | 'leftShoulder' | 'rightShoulder', Group>;

/** Illustrative cervical chain: distribute the measured head rotation along
 * the neck, keeping each vertebra rigid and the skull attached to its tip. */
export function createBoneMotion(rigs: Rigs) {
  const neck: { joint: Group; center: Vector3; weight: number }[] = [];
  const neutral = new Quaternion();
  const rotation = new Quaternion();
  const base = new Vector3(0, 14, -4);
  const headBind = new Vector3(0, 21, -1);
  const step = new Vector3();
  const delta = new Vector3();
  const curved = new Vector3();

  // Integrate along the neck rather than rotating every vertebra about the
  // skull pivot (which left the upper vertebrae almost stationary).
  function bend(center: Vector3, weight: number, output: Vector3) {
    step.copy(center).sub(base).multiplyScalar(1 / 12);
    output.copy(base);
    for (let i = 0; i < 12; i++) {
      rotation.slerpQuaternions(neutral, rigs.head.quaternion, weight * (i + .5) / 12);
      output.add(delta.copy(step).applyQuaternion(rotation));
    }
    return output;
  }
  return {
    bind(mesh: Mesh) {
      if (/^(Clavicle|Scapula|Humerus)[lr]$/.test(mesh.name)) {
        const side = mesh.name.endsWith('l') ? 1 : -1;
        mesh.geometry.translate(-side, -10, -5);
        (side === 1 ? rigs.leftShoulder : rigs.rightShoulder).add(mesh);
        return;
      }
      if (mesh.name === 'Hyoid_bone') {
        mesh.geometry.translate(-headBind.x, -headBind.y, -headBind.z);
        rigs.head.add(mesh);
        return;
      }
      if (!/^Vertebra_C[3-7]$/.test(mesh.name)) return;
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox!.getCenter(new Vector3());
      const weight = Math.max(0, Math.min(1, (center.y - base.y) / (headBind.y - base.y)));
      const joint = new Group();
      joint.position.copy(center);
      mesh.geometry.translate(-center.x, -center.y, -center.z);
      joint.add(mesh);
      rigs.torso.add(joint);
      neck.push({ joint, center, weight });
    },
    update() {
      bend(headBind, 1, curved);
      rigs.head.position.copy(curved);
      for (const { joint, center, weight } of neck) {
        joint.quaternion.slerpQuaternions(neutral, rigs.head.quaternion, weight);
        bend(center, weight, joint.position);
      }
    },
  };
}
