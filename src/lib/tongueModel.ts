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
  let lateral=0,lift=0,extension=0,curl=0;
  let lastSeen=-Infinity,lastTime:number|undefined;
  let lastObservation:TongueObservation|undefined;
  const bounded=(n:number|undefined,limit:number)=>Number.isFinite(n)?Math.max(-limit,Math.min(limit,n!)):0;
  return {
    mesh,
    update(observation?:TongueObservation,now=performance.now()) {
      const dt=lastTime===undefined?1/60:Math.max(0,Math.min(.1,(now-lastTime)/1000));lastTime=now;
      if(observation){lastObservation=observation;lastSeen=now;}
      // Bridge brief detector gaps without snapping the surface back behind
      // the teeth between inference frames. Sustained loss returns to rest.
      const visible=observation ?? (now-lastSeen<200 ? lastObservation : undefined);
      const alpha=1-Math.exp(-dt/.085);
      lateral+=(bounded(visible?.lateral,1)*3-lateral)*alpha;
      lift+=((visible ? bounded(visible.elevation??(visible.lift-.5)*2,1)*3.8 : 0)-lift)*alpha;
      curl+=((visible ? bounded(visible.elevation??(visible.lift-.5)*2,1)*.85 : 0)-curl)*alpha;
      const targetExtension=visible ? .8+Math.max(0,bounded(visible.extension??visible.visibleFraction*.5,1))*5 : 0;
      extension+=(targetExtension-extension)*alpha;
      for(let i=0;i<positions.count;i++) {
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        const tip=Math.max(0,Math.min(1,(z+3.1)/6.2));
        // Raise/lower and curl the anterior surface while retaining the root.
        // The curl is illustrative, driven by the exposed tip height only.
        const bend=curl*tip*tip;
        const forward=(z+3.1)*.45;
        positions.setXYZ(i,x+lateral*tip*tip,y+lift*tip*tip+Math.sin(bend)*forward,z+extension*tip*tip+(Math.cos(bend)-1)*forward);
      }
      positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
    },
    dispose(){geometry.dispose();mesh.material.dispose();},
  };
}
