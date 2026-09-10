import * as THREE from 'three';
import {ATLAS_WIDTH,ATLAS_HEIGHT} from '../../lib/atlasMotion';
import type {NativeSpaceDiff,Point2} from './modelAdjustments';
function polygon(points:Point2[]){const path=new Path2D();points.forEach(([x,y],i)=>{if(i===0)path.moveTo(x,y);else path.lineTo(x,y)});path.closePath();return path}
/** Both native shapes use one fixed atlas registration, never independently fit. */
export function createModelTractOverlay(diff:NativeSpaceDiff,showDiff=true){
 const canvas=document.createElement('canvas');canvas.width=ATLAS_WIDTH;canvas.height=ATLAS_HEIGHT;
 const context=canvas.getContext('2d');if(!context)throw Error('Unable to draw model comparison');
 const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
 const mask=layer.getContext('2d');if(!mask)throw Error('Unable to draw model mask');
 const transform=(ctx:CanvasRenderingContext2D)=>ctx.setTransform(-1.85,0,0,2.12,535,750);
 for(const name of ['tongue','airway'] as const){
  const reference=polygon(diff.reference[name]),candidate=polygon(diff.candidate[name]);
  transform(context);context.fillStyle=name==='tongue'?'#214da6e6':'#3988e6d9';context.fill(reference);
  if(showDiff){
   for(const [first,second,color] of [[candidate,reference,'#20ff63'],[reference,candidate,'#ff244e']] as const){
    mask.resetTransform();mask.clearRect(0,0,layer.width,layer.height);transform(mask);
    mask.globalCompositeOperation='source-over';mask.fillStyle=color;mask.fill(first);
    mask.globalCompositeOperation='destination-out';mask.fill(second);
    context.resetTransform();context.drawImage(layer,0,0);
   }
  }else{transform(context);context.fillStyle=name==='tongue'?'#214da6':'#3988e6';context.fill(candidate)}
  transform(context);context.lineWidth=.9;context.strokeStyle='#d4ecff';context.stroke(candidate);
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
