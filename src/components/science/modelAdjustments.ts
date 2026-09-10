import {useSyncExternalStore} from 'react';
import type {AnatomyMotionState} from '../../lib/anatomyState';
export type Point2 = [number,number];
export interface NativeContours {airway:Point2[];tongue:Point2[];outlines:Point2[][]}
export interface NativeSpaceDiff {
 schemaVersion:'native-space-diff-1';coordinateFrame:string;role:string;pose:string;
 anatomy:Record<string,number>;referenceAnatomy:Record<string,number>;
 articulation:Record<string,{applied:number;requested:number}>;
 referenceArticulation:Record<string,{applied:number;requested:number}>;
 candidate:NativeContours;reference:NativeContours;
}
interface AppliedModel {runId:string;diff:NativeSpaceDiff;showDiff:boolean;jawPreview:boolean}
let applied:AppliedModel|null=null;
const listeners=new Set<()=>void>();
export const getModelAdjustments=()=>applied;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export const useModelAdjustments=()=>useSyncExternalStore(subscribe,getModelAdjustments,getModelAdjustments);
export function setModelAdjustments(value:AppliedModel|null){applied=value;for(const listener of listeners)listener()}
export function parseSpaceDiff(bytes:ArrayBuffer):NativeSpaceDiff {
 const value=JSON.parse(new TextDecoder().decode(bytes));
 if(value.schemaVersion!=='native-space-diff-1'||!value.articulation||!value.referenceArticulation)throw Error('Unsupported model comparison');
 for(const side of ['candidate','reference'])for(const name of ['airway','tongue']){
  const points=value[side]?.[name];
  if(!Array.isArray(points)||points.length<3||points.length>1000||!points.every((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<10000)))throw Error('Invalid model contours');
 }
 if(!Number.isFinite(value.articulation.JA?.applied)||value.articulation.JA.applied>0||value.articulation.JA.applied< -45)throw Error('Unsupported jaw angle');
 return value;
}
/** Optional declared native pose, not a fitted jaw correction. Shared by all rigs. */
export function applyModelJaw(state:AnatomyMotionState){
 if(applied?.jawPreview)state.jawOpen=-applied.diff.articulation.JA.applied*Math.PI/180;
}
