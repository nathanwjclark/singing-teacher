import { Group, Mesh, Quaternion, Vector3 } from 'three';

type Rigs = Record<'torso' | 'head' | 'leftShoulder' | 'rightShoulder', Group>;

/** Rigid anatomical attachments. Cervical bones progressively follow the head,
 * while shoulder bones share exactly the joints that drive their muscles. */
export function createBoneMotion(rigs: Rigs) {
  const neck: { joint: Group; weight: number }[] = [];
  const neutral = new Quaternion();
  const pivot = new Vector3(0, 21, -1);
  return {
    bind(mesh: Mesh) {
      if (/^(Clavicle|Scapula|Humerus)[lr]$/.test(mesh.name)) {
        const side = mesh.name.endsWith('l') ? 1 : -1;
        mesh.geometry.translate(-side, -10, -5);
        (side === 1 ? rigs.leftShoulder : rigs.rightShoulder).add(mesh);
        return;
      }
      const cervical = /^Vertebra_C([3-7])$/.exec(mesh.name);
      if (!cervical && mesh.name !== 'Hyoid_bone') return;
      const joint = new Group();
      joint.position.copy(pivot);
      mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      joint.add(mesh);
      rigs.torso.add(joint);
      // Retain a stable base at C7 and a continuous transition toward C1/C2,
      // which already belong to the head. Each bone remains a rigid mesh.
      neck.push({ joint, weight: cervical ? (8 - Number(cervical[1])) / 6 : .8 });
    },
    update() {
      for (const { joint, weight } of neck) {
        joint.quaternion.slerpQuaternions(neutral, rigs.head.quaternion, weight);
      }
    },
  };
}
