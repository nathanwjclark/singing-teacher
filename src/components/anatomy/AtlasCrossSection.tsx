import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import {getModelAdjustments,useModelAdjustments} from '../science/modelAdjustments';
import {createModelTractOverlay} from '../science/modelSpaceTexture';
import { createTractOverlay } from './tractOverlay';
import { createAtlasSurface } from '../../lib/atlasSurface';
import { createOralOverlay } from './oralOverlay';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import { ATLAS_WIDTH as W, ATLAS_HEIGHT as H, deformAtlasPoint, nativeTongueRig, referenceTongueRig } from '../../lib/atlasMotion';

// Original image remains intact on disk. A silhouette mask and deformable texture
// display the licensed medical plate without its rectangular white background.
const outline = 'M440 1357 L1122 1357 C1070 1310 992 1160 973 1060 C954 954 1003 817 1060 743 C1118 666 1148 574 1143 481 C1141 279 997 86 792 65 C617 53 519 48 401 93 C255 145 181 278 146 400 C132 443 161 463 150 494 C135 535 81 590 46 640 C19 676 5 698 26 721 C41 740 89 750 107 766 L109 796 C91 821 88 841 107 853 L136 865 C110 875 91 890 99 910 C114 931 121 946 124 976 C109 1010 112 1047 139 1068 C191 1104 260 1108 354 1103 C383 1100 395 1132 401 1171 C419 1236 439 1308 440 1357 Z';

export function AtlasCrossSection({ motion }: { motion: RefObject<AnatomyMotionState> }) {
  const mount = useRef<HTMLDivElement>(null);
  const model=useModelAdjustments();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch {
      // Report an external WebGL initialization failure, not derived render state.
      // eslint-disable-next-line react/set-state-in-effect
      setStatus('error'); return;
    }
    let disposed = false;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x172720, 0);
    renderer.domElement.setAttribute('aria-label', 'Unified vocal tract and faded head and neck illustration; independent tongue and airway layers with coordinated jaw and head motion');
    renderer.domElement.setAttribute('role', 'img');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, W, 0, -H, .1, 10);
    camera.position.z = 2;
    const plateSurface = createAtlasSurface('structure');
    const airwaySurface = createAtlasSurface('structure');
    const tongueSurface = createAtlasSurface('tongue');
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(plateSurface.geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    let appliedModel = getModelAdjustments();
    let tongueRig=appliedModel?nativeTongueRig(appliedModel.diff.reference.tongue):referenceTongueRig;
    let markerRig=appliedModel?nativeTongueRig(appliedModel.diff.candidate.tongue):referenceTongueRig;
    const layers = ([['airway', airwaySurface], ['tongue', tongueSurface]] as const).map(([part, surface], index) => {
      const map = appliedModel ? createModelTractOverlay(appliedModel.diff, appliedModel.showDiff, part) : createTractOverlay(part);
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(surface.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = 1 + index * .1;
      scene.add(mesh);
      return {part, surface, material};
    });
    const oral = createOralOverlay(); scene.add(oral.group);
    const tipMarker=new THREE.Mesh(new THREE.CircleGeometry(7,20),new THREE.MeshBasicMaterial({color:0x75ffc1,depthTest:false}));tipMarker.renderOrder=5;scene.add(tipMarker);
    let texture: THREE.CanvasTexture | undefined;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const context = canvas.getContext('2d');
      if (!context) { setStatus('error'); return; }
      context.drawImage(image, 0, 0);
      context.globalCompositeOperation = 'destination-in';
      context.fill(new Path2D(outline));
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture; material.needsUpdate = true;
      setStatus('ready');
    };
    image.onerror = () => { if (!disposed) setStatus('error'); };
    image.src = '/anatomy/reference/lynch-head-sagittal.jpg';
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const viewHeight = Math.max(H + 90, (W + 140) * height / width);
      const viewWidth = viewHeight * width / height;
      camera.left = W / 2 - viewWidth / 2; camera.right = W / 2 + viewWidth / 2;
      camera.top = -H / 2 + viewHeight / 2; camera.bottom = -H / 2 - viewHeight / 2;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    const lost = (event: Event) => { event.preventDefault(); setStatus('error'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    renderer.setAnimationLoop(() => {
      if (!texture) return;
      const state = motion.current;
      oral.update(state);
      const nextModel=getModelAdjustments();
      if(nextModel!==appliedModel){
        appliedModel=nextModel;
        tongueRig=nextModel?nativeTongueRig(nextModel.diff.reference.tongue):referenceTongueRig;
        markerRig=nextModel?nativeTongueRig(nextModel.diff.candidate.tongue):referenceTongueRig;
        for (const layer of layers) {
          layer.material.map?.dispose();
          layer.material.map=nextModel?createModelTractOverlay(nextModel.diff,nextModel.showDiff,layer.part):createTractOverlay(layer.part);
          layer.material.needsUpdate=true;
        }
      }
      plateSurface.update(state);
      airwaySurface.update(state);
      tongueSurface.update(state,tongueRig);
      const tip=deformAtlasPoint(markerRig.tipX,markerRig.tipY,state,tongueRig);tipMarker.position.set(W-tip[0],-tip[1],.1);tipMarker.visible=state.tongue.visible;
      host.dataset.tipPosition=JSON.stringify([W-tip[0],-tip[1]]);
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true; image.onload = null; image.onerror = null;
      observer.disconnect(); renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      tipMarker.geometry.dispose();tipMarker.material.dispose();
      oral.dispose(); plateSurface.dispose(); material.dispose();
      for (const layer of layers) { layer.surface.dispose(); layer.material.map?.dispose(); layer.material.dispose(); }
      texture?.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [motion]);
  return <div className="atlas-cross-section" ref={mount} data-atlas-status={status} data-atlas-opacity="0.2" data-unified-tract="true">
    {model&&<div className="model-diff-legend" data-model-run={model.runId}><span>BLUE · native reference</span>{model.showDiff&&<><b>GREEN · added</b><em>RED · removed</em></>}<small>Same-pose model comparison · illustrative atlas placement{model.jawPreview?' · fixed jaw preview':''}</small></div>}
    {status === 'loading' && <span className="atlas-message">Loading anatomy plate…</span>}
    {status === 'error' && <div className="atlas-fallback"><img src="/anatomy/reference/lynch-head-sagittal.jpg" alt="Head and mouth anatomical reference by Patrick J. Lynch"/><span>Animation unavailable · reference image</span></div>}
  </div>;
}
