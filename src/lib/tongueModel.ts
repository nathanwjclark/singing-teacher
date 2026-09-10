import { BufferAttribute, Mesh, MeshStandardMaterial, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
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
  mesh.name='Tongue · illustrative surface';mesh.position.set(0,-2.5,4.7);
  // A visible endpoint marker is attached to the actual deformed vertex, not
  // a second animation. Its coordinates can be inspected independently.
  const marker=new Mesh(new SphereGeometry(.28,12,8),new MeshBasicMaterial({color:0x75ffc1,depthTest:false,depthWrite:false}));
  marker.name='Tongue tip endpoint';marker.renderOrder=20;mesh.add(marker);
  let tipIndex=0;for(let i=1;i<positions.count;i++)if(rest[i*3+2]>rest[tipIndex*3+2])tipIndex=i;
  return {
    mesh, tipPosition:()=>marker.position.clone(),
    applyPose(pose:TonguePose) {
      for(let i=0;i<positions.count;i++) {
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        const tip=Math.max(0,Math.min(1,(z+3.1)/6.2));
        const displacement=tongueDisplacement(tip,pose);
        positions.setXYZ(i,x+displacement.x,y+displacement.y,z+displacement.z);
      }
      marker.position.copy(new Vector3().fromBufferAttribute(positions,tipIndex));marker.visible=pose.visible;
      mesh.userData.tipPosition=marker.position.toArray();
      positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
    },
    dispose(){geometry.dispose();mesh.material.dispose();marker.geometry.dispose();marker.material.dispose();},
  };
}
