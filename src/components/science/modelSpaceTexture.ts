import * as THREE from 'three';
import {ATLAS_WIDTH,ATLAS_HEIGHT} from '../../lib/atlasMotion';
import type {NativeSpaceDiff,Point2} from './modelAdjustments';
import {differenceCoverage} from './nativeContourDisplay';
function path(points:Point2[],closed=false){
 const result=new Path2D();points.forEach(([x,y],i)=>{if(i===0)result.moveTo(x,y);else result.lineTo(x,y)});if(closed)result.closePath();return result;
}
const transform=(ctx:CanvasRenderingContext2D)=>ctx.setTransform(-1.85,0,0,2.12,535,750);
/** Source SVG traces include external lip/teeth/uvula boundaries. They are not
 * a watertight lumen. Keep those traces open instead of filling an invented fan.
 * Both models retain the same fixed registration and original native vertices. */
export function createModelTractOverlay(diff:NativeSpaceDiff,showDiff=true,part:'tongue'|'airway'|'combined'='combined'){
 const canvas=document.createElement('canvas');canvas.width=ATLAS_WIDTH;canvas.height=ATLAS_HEIGHT;
 const context=canvas.getContext('2d');if(!context)throw Error('Unable to draw model comparison');
 const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
 const mask=layer.getContext('2d',{willReadFrequently:true});if(!mask)throw Error('Unable to draw model mask');
 for(const name of ['airway','tongue'] as const){
  if(part!=='combined'&&part!==name)continue;
  const reference=path(diff.reference[name],true),candidate=path(diff.candidate[name],true);
  // The reference supplies the common base only when a difference is requested.
  // With differences off, show the candidate alone (no leftover reference fill).
  const base=showDiff?diff.reference:diff.candidate;
  transform(context);context.lineJoin='round';context.lineCap='round';context.miterLimit=1;
  if(name==='tongue'){
   const shading=context.createLinearGradient(0,0,30,160);
   shading.addColorStop(0,'#6a99dce6');shading.addColorStop(.45,'#477bc5e6');shading.addColorStop(1,'#254c86e6');
   context.fillStyle=shading;context.fill(path(base.tongue,true));
  }else{
   // Preserve the native open traces, including the epiglottis omitted by the
   // historical envelope mask. A legacy export without traces stays outline-only.
   const traces=base.outlines?.length>=7?base.outlines.slice(0,6):[base.airway];
   for(const points of traces){const trace=path(points);context.strokeStyle='#579dd92b';context.lineWidth=5;context.stroke(trace);context.strokeStyle='#91c5e0';context.lineWidth=1.15;context.stroke(trace)}
  }
  if(showDiff){
   const coverage=(shape:Path2D)=>{mask.resetTransform();mask.clearRect(0,0,layer.width,layer.height);transform(mask);mask.fillStyle='#fff';mask.fill(shape);return mask.getImageData(0,0,layer.width,layer.height)};
   const before=coverage(reference),after=coverage(candidate);
   // Subtract coverage once. destination-out on two antialiased edges leaves a
   // colored halo even when both contours are identical; this does not.
   differenceCoverage(before.data,after.data);
   mask.resetTransform();mask.putImageData(after,0,0);context.resetTransform();context.drawImage(layer,0,0);
  }
  transform(context);context.lineWidth=.8;context.strokeStyle=name==='tongue'?'#b9d7ee':'#b9daf088';
  if(name==='tongue')context.stroke(candidate);
  else if(showDiff){const traces=diff.candidate.outlines?.length>=7?diff.candidate.outlines.slice(0,6):[diff.candidate.airway];for(const points of traces)context.stroke(path(points))}
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.userData.interpretation='Native open sagittal boundaries and closed tongue surface; colors compare exported envelopes, not measured lumen or muscle changes.';
 return texture;
}
