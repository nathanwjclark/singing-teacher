import { BufferAttribute, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { TonguePose } from './anatomyState';
import { tongueDisplacement } from './tongueKinematics';

/** Original simplified tongue surface; an illustrative reference, not a scan. */
export function createTongueModel() {
  const geometry=new SphereGeometry(1,40,24);
  geometry.scale(1.85,.65,3.1);
  const positions=geometry.getAttribute('position') as BufferAttribute;
  // A shallow dorsal groove, with a broad root and rounded anterior tip.
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
    if(y>0)positions.setY(i,y-.10*Math.exp(-x*x*8));
    positions.setX(i,x*(1-.12*Math.max(0,z/3.1)));
  }
  const rest=new Float32Array(positions.array);
  const mesh=new Mesh(geometry,new MeshStandardMaterial({color:0xc96e83,roughness:.66}));
  mesh.name='Tongue · illustrative surface';mesh.position.set(0,-3.9,4.7);
  return {
    mesh,
    applyPose(pose:TonguePose) {
      for(let i=0;i<positions.count;i++) {
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        const tip=Math.max(0,Math.min(1,(z+3.1)/6.2));
        const displacement=tongueDisplacement(tip,pose);
        positions.setXYZ(i,x+displacement.x,y+displacement.y,z+displacement.z);
      }
      positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
    },
    dispose(){geometry.dispose();mesh.material.dispose();},
  };
}
