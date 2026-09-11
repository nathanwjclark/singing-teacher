import type { TrackingFrame, TongueTipObservation } from '../types';
export type TonguePose={lateral:number;lift:number;extension:number;curl:number;visible:boolean};
export type AnatomyMotionState={torso:{x:number;y:number;z:number};head:{x:number;y:number;z:number};jawOpen:number;tongue:TonguePose;frame:TrackingFrame|null;demo:boolean};
export const emptyAnatomyState=():AnatomyMotionState=>({torso:{x:0,y:0,z:0},head:{x:0,y:0,z:0},jawOpen:0,tongue:{lateral:0,lift:0,extension:0,curl:0,visible:false},frame:null,demo:false});
const bound=(n:number|undefined,lo:number,hi:number)=>Number.isFinite(n)?Math.max(lo,Math.min(hi,n!)):0;
/** One smoothed pose feeds every anatomical view; renderers only project it. */
export function createAnatomyMotion(){
 const state=emptyAnatomyState();let lastTime:number|undefined,lastSeen=-Infinity,lastTongue:TongueTipObservation|undefined,lastFrameTimestamp:number|undefined,lastDemo:boolean|undefined;
 return {state,update(frame:TrackingFrame|null,demo:boolean,time:number){
  const dt=lastTime===undefined?1/60:bound((time-lastTime)/1000,0,.1);lastTime=time;
  const ease=(from:number,to:number,alpha:number)=>from+(to-from)*(1-Math.pow(1-alpha,dt*60));
  const m=frame?.metrics,rad=Math.PI/180;
  const shoulders=[11,12].every(i=>frame?.pose[i]&&(frame.pose[i].visibility??1)>=.65);
  const world=frame?.worldPose;
  const sw=world?.[11]&&world?.[12]?Math.max(.15,Math.abs(world[11].x-world[12].x)):.36;
  const hips=shoulders&&world?.[23]&&world?.[24]&&(world[23].visibility??1)>.65&&(world[24].visibility??1)>.65;
  const width=hips?Math.max(.12,Math.abs(world[23].x-world[24].x)):sw;
  const depth=hips?(world[23].z??0)-(world[24].z??0):shoulders?bound(m?.shoulderDepth,-.5,.5):0;
  state.torso.z=ease(state.torso.z,-bound(m?.torsoLean??(shoulders?(m?.shoulderTilt??0)*.45:0),-20,20)*rad,.1);
  state.torso.y=ease(state.torso.y,bound(Math.atan2(depth,width),-.75,.75),.1);
  state.head.x=ease(state.head.x,bound(m?.headPitch,-35,35)*rad-state.torso.x,.14);
  state.head.y=ease(state.head.y,bound(m?.headYaw,-55,55)*rad-state.torso.y,.14);
  state.head.z=ease(state.head.z,-bound(m?.headTilt,-30,30)*rad-state.torso.z,.14);
  state.jawOpen=ease(state.jawOpen,bound(m?.mouthOpen,0,1)*.5,.18);
  if(lastDemo!==undefined && demo!==lastDemo){lastTongue=undefined;lastSeen=-Infinity;lastFrameTimestamp=undefined;}
  lastDemo=demo;
  const observed=frame?.tongue?.trackingMode==='region'?undefined:frame?.tongue;
  // A cached frame must not refresh an old tip forever when the camera stalls.
  if(observed && (demo || (observed.observedAt??frame?.timestamp)!==lastFrameTimestamp)){lastTongue=observed;lastSeen=time;}
  lastFrameTimestamp=observed?.observedAt??frame?.timestamp;
  const visible=frame && time-lastSeen<200?lastTongue:undefined;
  const elevation=visible?bound(visible.elevation??(visible.lift-.5)*2,-1,1):0;
  const alpha=1-Math.exp(-dt/.085),t=state.tongue;
  t.lateral+=(bound(visible?.lateral,-1,1)*3-t.lateral)*alpha;
  t.lift+=(elevation*3.8-t.lift)*alpha;
  // Height is observed independently of bend. No hidden curl is invented from a raised tip.
  t.curl+=(bound(visible?.curl,-.85,.85)-t.curl)*alpha;
  t.extension+=(bound(visible?.extension,-1,1)*4.5-t.extension)*alpha;
  t.visible=!!visible;state.frame=frame;state.demo=demo;return state;
 }};
}
