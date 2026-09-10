import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModelHair, disposeModelHairTextures } from '../lib/modelHair';
import { createMuscleMotion } from '../lib/muscleMotion';
import { createShoulderMotion } from '../lib/shoulderMotion';
import type { BodyRegion, TrackingFrame } from '../types';
import './AnatomyPanel.css';

type Props = { frame: TrackingFrame | null; activeRegion?: BodyRegion; activeMuscles?: string[]; demo: boolean };
type Part = { name: string; kind: 'bone' | 'muscle'; muscleId: string; region: BodyRegion; rig: 'head' | 'jaw' | 'torso'; positionOffset: number; positionCount: number; indexOffset: number; indexCount: number; min: number[]; size: number[] };
type AnatomyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const regionMuscles: Record<BodyRegion, string[]> = {
  jaw: ['Masseter', 'Digastric'], lips: ['Orbicularis oris'], neck: ['Sternocleidomastoid'],
  shoulders: ['Trapezius', 'Levator scapulae'], chest: ['Pectoralis major'],
  torso: ['External oblique', 'Erector spinae'], general: [],
};
const displayName = (name: string) => name.replace(/([a-z])[lr]$/, '$1').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const bounded = (value: number | undefined, min: number, max: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value! : 0, min, max);

export function AnatomyPanel({ frame, activeRegion = 'jaw', activeMuscles, demo }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef({ frame, activeRegion, activeMuscles, demo, bones: true, muscles: true, xray: false });
  const reset = useRef<() => void>(() => {});
  const [bones, setBones] = useState(true);
  const [muscles, setMuscles] = useState(true);
  const [xray, setXray] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hovered, setHovered] = useState('');
  const [meshCount, setMeshCount] = useState(0);
  useEffect(() => { latest.current = { frame, activeRegion, activeMuscles, demo, bones, muscles, xray }; }, [frame, activeRegion, activeMuscles, demo, bones, muscles, xray]);
  const focused = activeMuscles?.length ? activeMuscles : regionMuscles[activeRegion];

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { queueMicrotask(() => setStatus('error')); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x14231e, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D anatomical reference. Drag to orbit, scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08;
    controls.enablePan = false; controls.minDistance = 35; controls.maxDistance = 185;
    controls.minPolarAngle = .3; controls.maxPolarAngle = Math.PI - .3;
    // Front-facing head and shoulders crop, with room above the skull for hair.
    const restore = () => {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update(); // Consume any remaining orbit momentum before restoring.
      camera.position.set(0, 152.5, 76);
      controls.target.set(0, 152.5, 0);
      controls.update();
      controls.enableDamping = damping;
    };
    reset.current = restore; restore();
    scene.add(new THREE.HemisphereLight(0xe8fff0, 0x303325, 2.2));
    const key = new THREE.DirectionalLight(0xffefd5, 3.2);key.position.set(-40,190,80);scene.add(key);
    const rim = new THREE.DirectionalLight(0x78d6c0, 2.7);rim.position.set(50,160,-50);scene.add(rim);
    const fill = new THREE.DirectionalLight(0xe9c3b4, .8);fill.position.set(25,110,60);scene.add(fill);
    // Camera landmarks describe the unmirrored sensor image. Reflect the entire
    // physical rig once, matching the webcam's scaleX(-1), including yaw and roll.
    // Reflect geometry rather than the canvas so picking and orbit drag stay in
    // normal screen coordinates. Do not invert the metric signs a second time.
    const mirror = new THREE.Group();mirror.scale.x = -1;scene.add(mirror);
    const torso = new THREE.Group();torso.position.set(0,130,0);mirror.add(torso);
    const head = new THREE.Group();head.position.set(0,21,-1);torso.add(head);
    const jaw = new THREE.Group();jaw.position.set(0,5,1);head.add(jaw);
    const rigPivots = { torso: new THREE.Vector3(0,130,0), head: new THREE.Vector3(0,151,-1), jaw: new THREE.Vector3(0,156,0) };
    const leftShoulder = new THREE.Group();leftShoulder.position.set(1, 10, 5);torso.add(leftShoulder);
    const rightShoulder = new THREE.Group();rightShoulder.position.set(-1, 10, 5);torso.add(rightShoulder);
    const shoulderPose = createShoulderMotion();
    const rigs = { torso, head, jaw, leftShoulder, rightShoulder };
    const muscleMotion = createMuscleMotion(rigs);
    const meshes: AnatomyMesh[] = [];
    const decorative: THREE.Mesh[] = [];
    const eyes: THREE.Group[] = [];
    const hair = createModelHair();
    head.add(hair);
    // Deliberately cartoon eyes; the surrounding anatomical surfaces come from the dataset.
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();eye.position.set(side * 3.15,8,8.1);head.add(eye);eyes.push(eye);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.62,24,18),new THREE.MeshStandardMaterial({color:0xfffff6,roughness:.3}));eye.add(ball);decorative.push(ball);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(.78,20,16),new THREE.MeshStandardMaterial({color:0x49a58a,roughness:.3}));iris.scale.z=.32;iris.position.set(0,-.03,1.48);eye.add(iris);decorative.push(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(.41,16,12),new THREE.MeshStandardMaterial({color:0x10231e,roughness:.15}));pupil.scale.z=.3;pupil.position.set(0,-.03,1.69);eye.add(pupil);decorative.push(pupil);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(.17,10,8),new THREE.MeshBasicMaterial({color:0xffffff}));glint.position.set(-.17,.24,1.83);eye.add(glint);decorative.push(glint);
    }
    let disposed = false;
    const abort = new AbortController();
    const base = `${import.meta.env.BASE_URL}models/`;
    Promise.all([
      fetch(`${base}upper-body.json`,{signal:abort.signal}).then(r => {if(!r.ok) throw Error('Model manifest unavailable');return r.json() as Promise<{meshes:Part[]}>;}),
      fetch(`${base}upper-body.bin`,{signal:abort.signal}).then(r => {if(!r.ok) throw Error('Anatomy data unavailable');return r.arrayBuffer();}),
    ]).then(([manifest, binary]) => {
      if (disposed) return;
      for (const part of manifest.meshes) {
        const quantized = new Uint16Array(binary, part.positionOffset, part.positionCount);
        const positions = new Float32Array(part.positionCount);
        const pivot = rigPivots[part.rig].toArray();
        for(let i=0;i<positions.length;i++) { const axis=i%3;positions[i]=part.min[axis]+quantized[i]/65535*part.size[axis]-pivot[axis]; }
        const geometry = new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary,part.indexOffset,part.indexCount),1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
        const material = new THREE.MeshStandardMaterial({color:part.kind==='bone'?0xe8dbc0:0xa56556,roughness:part.kind==='bone'?.68:.57,metalness:0,side:THREE.DoubleSide});
        const mesh = new THREE.Mesh(geometry,material);mesh.name=part.name;mesh.userData=part;
        rigs[part.rig].add(mesh);
        if (part.kind === 'bone' && /^(Clavicle|Scapula|Humerus)[lr]$/.test(part.name)) {
          const shoulder = part.name.endsWith('l') ? leftShoulder : rightShoulder;
          mesh.geometry.translate(part.name.endsWith('l') ? -1 : 1, -10, -5);
          shoulder.add(mesh);
        }
        if(part.kind === 'muscle') muscleMotion.bind(mesh, part.rig);
        meshes.push(mesh);
      }
      setMeshCount(meshes.length);setStatus('ready');
    }).catch(error => { if(!disposed && error.name!=='AbortError') { console.error('Anatomical model could not load',error);setStatus('error'); } });
    const resize = () => { const w=container.clientWidth; const h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize);observer.observe(container);resize();
    const raycaster = new THREE.Raycaster();const pointer = new THREE.Vector2();
    const inspect = (event: PointerEvent) => {
      if(event.buttons) return;
      const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(meshes.filter(m=>m.visible),false)[0];setHovered(hit?displayName(hit.object.name):'');
    };
    const leave = () => setHovered('');
    renderer.domElement.addEventListener('pointermove',inspect);renderer.domElement.addEventListener('pointerleave',leave);
    const contextLost = (event: Event) => {event.preventDefault();setStatus('error');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
    const radians = Math.PI/180;
    let lastAppearance = '';
    renderer.setAnimationLoop((time) => {
      const props=latest.current;const m=props.frame?.metrics;
      hair.visible=props.muscles;
      const simulation=props.demo&&!props.frame;
      // Shoulder tilt belongs to the independent shoulder joints. Torso roll
      // comes from the hip/shoulder midline; do not apply shoulder tilt twice.
      const shoulderRoll=bounded(m?.torsoLean,-20,20)*radians;
      const world = props.frame?.worldPose;
      const shoulderWidth = world?.[11] && world?.[12] ? Math.max(.15, Math.abs(world[11].x-world[12].x)) : .36;
      const hipsVisible=world?.[23]&&world?.[24]&&(world[23].visibility??1)>.65&&(world[24].visibility??1)>.65;
      const hipWidth=hipsVisible?Math.max(.12,Math.abs(world[23].x-world[24].x)):shoulderWidth;
      const torsoDepth=hipsVisible?(world[23].z??0)-(world[24].z??0):bounded(m?.shoulderDepth,-.5,.5);
      const torsoYaw=THREE.MathUtils.clamp(Math.atan2(torsoDepth,hipWidth),-.75,.75);
      torso.rotation.z=THREE.MathUtils.lerp(torso.rotation.z,-shoulderRoll,.1);
      torso.rotation.y=THREE.MathUtils.lerp(torso.rotation.y,-torsoYaw,.1);
      torso.rotation.x=0;
      const shoulderTargets=shoulderPose.update(props.frame,torso.rotation);
      [leftShoulder,rightShoulder].forEach((shoulder,i)=>{
        const side=i===0?1:-1;const target=shoulderTargets[i];
        shoulder.rotation.z=THREE.MathUtils.lerp(shoulder.rotation.z,side*Math.atan2(target.lift,17),.18);
        shoulder.rotation.y=THREE.MathUtils.lerp(shoulder.rotation.y,-side*Math.atan2(target.depth,17),.18);
        shoulder.position.x=THREE.MathUtils.lerp(shoulder.position.x,side+target.spread*.35,.18);
      });
      const yaw=bounded(m?.headYaw,-55,55)*radians+(simulation?Math.sin(time*.00032)*.075:0);
      head.rotation.y=THREE.MathUtils.lerp(head.rotation.y,-yaw-torso.rotation.y,.14);
      head.rotation.z=THREE.MathUtils.lerp(head.rotation.z,-bounded(m?.headTilt,-30,30)*radians-torso.rotation.z,.14);
      head.rotation.x=THREE.MathUtils.lerp(head.rotation.x,bounded(m?.headPitch,-35,35)*radians-torso.rotation.x,.14);
      const mouth=bounded(m?.mouthOpen,0,1)||(simulation?.17+Math.sin(time*.0018)*.08:0);
      jaw.rotation.x=THREE.MathUtils.lerp(jaw.rotation.x,mouth*.5,.18);
      const appearance=JSON.stringify([props.activeMuscles,props.activeRegion,props.bones,props.muscles,props.xray]);
      if(appearance!==lastAppearance) {
        lastAppearance=appearance;const selected=(props.activeMuscles?.length?props.activeMuscles:regionMuscles[props.activeRegion]).map(normalize);
        for(const mesh of meshes) {
          const part=mesh.userData as Part;const highlighted=part.kind==='muscle'&&selected.includes(part.muscleId);
          mesh.visible=part.kind==='bone'?props.bones:props.muscles;
          mesh.material.color.setHex(highlighted?0xff8769:part.kind==='bone'?0xe8dbc0:0x995d50);
          mesh.material.emissive.setHex(highlighted?0x7c2510:0x000000);mesh.material.emissiveIntensity=highlighted?.3:0;
          mesh.material.transparent=part.kind==='muscle'&&props.xray&&!highlighted;mesh.material.opacity=mesh.material.transparent?.19:1;
          mesh.material.depthWrite=!mesh.material.transparent;mesh.material.needsUpdate=true;
        }
      }
      muscleMotion.update(props.frame?.blendshapes);
      const blink=props.frame?.blendshapes;
      eyes.forEach((eye,i)=>{const value=blink?.[i===0?'eyeBlinkRight':'eyeBlinkLeft']??0;eye.scale.y=1-bounded(value,0,.95)*.8;});
      controls.update();renderer.render(scene,camera);
    });
    return () => {
      disposed=true;abort.abort();observer.disconnect();renderer.setAnimationLoop(null);controls.dispose();
      renderer.domElement.removeEventListener('pointermove',inspect);renderer.domElement.removeEventListener('pointerleave',leave);renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}
      disposeModelHairTextures(hair);
      for(const mesh of decorative){mesh.geometry.dispose();const mat=mesh.material;if(Array.isArray(mat))mat.forEach(m=>m.dispose());else mat.dispose();}
      renderer.dispose();renderer.domElement.remove();reset.current=()=>{};
    };
  }, []);

  return <section className="anatomy-panel" aria-label="Interactive anatomical movement model">
    <div className="anatomy-heading"><span className="anatomy-kicker">ANATOMY IN MOTION</span><span className="anatomy-view">MIRRORED · 3D</span></div>
    <div className="anatomy-toolbar" aria-label="Anatomy layers">
      <button type="button" aria-pressed={bones} onClick={()=>setBones(!bones)}>Bones</button>
      <button type="button" aria-pressed={muscles} onClick={()=>setMuscles(!muscles)}>Muscles</button>
      <button type="button" aria-pressed={xray} onClick={()=>{setXray(!xray);setMuscles(true);}}>See through</button>
      <button type="button" className="anatomy-reset" onClick={()=>reset.current()} aria-label="Reset anatomy camera">↺</button>
    </div>
    <div className="anatomy-stage">
      <div className="anatomy-canvas" ref={mount}/>
      {status==='loading'&&<div className="anatomy-loading" role="status"><span/>Loading anatomical meshes…</div>}
      {status==='error'&&<div className="anatomy-loading" role="alert">The 3D model could not load.<br/>Reload with WebGL enabled to try again.</div>}
      <div className="anatomy-orbit-hint">DRAG TO ROTATE · SCROLL TO ZOOM</div>
      {hovered&&<div className="anatomy-hover-label">{hovered}</div>}
      <span className="anatomy-model-tag">{status==='ready'?`${meshCount} DATASET MESHES`:'Z-ANATOMY'} / UPPER BODY</span>
    </div>
    <div className="anatomy-focus"><span className="anatomy-focus-dot"/><div><span>RELATED MUSCLES</span><strong>{focused.length?focused.join(' · '):'Full movement reference'}</strong></div></div>
    <p className="anatomy-disclaimer">Reference anatomy follows estimated visible movement.<br/>Muscle highlights are teaching cues, not measured tension.</p>
    <div className="anatomy-credits"><a className="anatomy-attribution" href={`${import.meta.env.BASE_URL}models/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Anatomy · Z-Anatomy / BodyParts3D ↗</a><a className="anatomy-attribution" href={`${import.meta.env.BASE_URL}models/hair/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Hair · MakeHuman CC0 ↗</a></div>
  </section>;
}
export default AnatomyPanel;
