import { BufferAttribute, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { TongueObservation } from '../types';

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
  let lateral=0,lift=0,exposure=0;
  return {
    mesh,
    update(observation?:TongueObservation) {
      lateral+=((observation?.lateral??0)-lateral)*.18;
      lift+=((observation ? (observation.lift-.5)*1.2 : 0)-lift)*.18;
      exposure+=((observation?.visibleFraction??0)-exposure)*.18;
      for(let i=0;i<positions.count;i++) {
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        const tip=Math.max(0,Math.min(1,(z+3.1)/6.2));
        positions.setXYZ(i,x+lateral*1.4*tip*tip,y+lift*tip,z+exposure*2.5*tip*tip);
      }
      positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
    },
    dispose(){geometry.dispose();mesh.material.dispose();},
  };
}
