import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {useScienceStatus,verifiedScienceAsset} from './scienceClient';
import './ScientificModel.css';
export function ScientificGeometry(){
 const status=useScienceStatus(),result=status.result;const mount=useRef<HTMLDivElement>(null);const [error,setError]=useState('');
 useEffect(()=>{const host=mount.current;if(!host||!result)return;let disposed=false;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true})}catch{setTimeout(()=>setError('WebGL unavailable'),0);return}
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Native scientific vocal tract hypothesis; not measured anatomy');const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x243a2d,3));const camera=new THREE.PerspectiveCamera(40,1,.01,10000);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
 const observer=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}});observer.observe(host);
 void verifiedScienceAsset(result,'tract0.obj').then(bytes=>{if(disposed)return;const object=new OBJLoader().parse(new TextDecoder().decode(bytes));object.traverse(o=>{if(o instanceof THREE.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material=new THREE.MeshStandardMaterial({color:o.name.includes('TONGUE')?0xdb879c:o.name.includes('TEETH')?0xf2efcf:0x93bdac,side:THREE.DoubleSide,transparent:!o.name.includes('TONGUE'),opacity:o.name.includes('COVER')?.22:.9,roughness:.75,depthWrite:!o.name.includes('COVER')})}});scene.add(object);const box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size*.7,size*.1,size*1.2));camera.near=size/10000;camera.far=size*100;camera.updateProjectionMatrix();controls.update()}).catch(e=>{if(!disposed)setError(String(e))});renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});
 return()=>{disposed=true;observer.disconnect();controls.dispose();renderer.setAnimationLoop(null);scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}});renderer.dispose();renderer.domElement.remove()};
 },[result]);
 return <div className="scientific-geometry"><div className="scientific-native-view" ref={mount}>{(!result||error)&&<p>{error||'Run the local model in Experiments to view its geometry.'}</p>}</div><p>Native predicted vocal tract · pose “a”, jaw −3° · drag to rotate. Static hypothesis, not live measured anatomy.</p></div>
}
export function ScientificSideView(){
 const {result}=useScienceStatus();const [image,setImage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(!result)return;let active=true,url='';void verifiedScienceAsset(result,'tract.svg').then(bytes=>{if(active){url=URL.createObjectURL(new Blob([bytes],{type:'image/svg+xml'}));setImage(url)}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false;if(url)URL.revokeObjectURL(url)}},[result]);
 return <div className="scientific-side">{image&&<img src={image} alt="Native scientific sagittal vocal tract prediction"/>}<p>{error||'Scientific geometry snapshot · same hypothesis as the 3D model. Pose “a”, jaw −3°. Choose Default to return to camera-driven anatomy.'}</p></div>
}
