import { createTongueTipTracker } from './tongueTip.ts';
import { inferLabeledTongueTip, validTongueProfile, type TongueProfile } from './tongueProfile.ts';
import type { Landmark, TongueObservation, TongueDiagnostic } from '../types';

/** Experimental segmentation of exposed pink tissue inside the inner lip
 * contour. This is not an internal tongue pose or a trained tongue detector. */
export function detectVisibleTongue(pixels: Uint8ClampedArray, width: number, height: number, face: Landmark[]): TongueObservation | undefined {
  const ids = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
  if (!ids.every(i => face[i])) return;
  const polygon = ids.map(i => ({x:face[i].x*width,y:face[i].y*height}));
  const minX=Math.min(...polygon.map(p=>p.x)), maxX=Math.max(...polygon.map(p=>p.x));
  const minY=Math.min(...polygon.map(p=>p.y)), maxY=Math.max(...polygon.map(p=>p.y));
  if (maxX-minX<12 || maxY-minY<5) return;
  const inside = (x:number,y:number) => {
    let result=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      if ((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) result=!result;
    }
    return result;
  };
  const mask=new Uint8Array(width*height);
  const interior=new Uint8Array(width*height);
  const mouthWidth=maxX-minX;
  const bottom=Math.min(height-1,maxY+mouthWidth*.45);
  let area=0;
  for(let y=Math.max(0,Math.ceil(minY+1));y<bottom;y++) {
    for(let x=Math.max(0,Math.ceil(minX+1));x<Math.min(width-1,maxX-1);x++) {
      // Erode the mouth boundary to reject lips, including lipstick.
      const inMouth=[[-1,0],[1,0],[0,-1],[0,1]].every(([dx,dy])=>inside(x+dx,y+dy));
      const belowMouth=y>=maxY-2 && Math.abs(x-(minX+maxX)/2)<mouthWidth*.34;
      if(!inMouth && !belowMouth)continue;
      if(inMouth){area++;interior[y*width+x]=1;}
      const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      // Reject dark mouth cavity and bright, nearly neutral teeth.
      if (r>50 && g>20 && b>18 && r>g*1.14 && r>b*1.04 && g>b*.65 && r-g>14) mask[y*width+x]=1;
    }
  }
  let largest:number[]=[];
  for(let i=0;i<mask.length;i++) {
    if(!mask[i]) continue;
    const component=[i];mask[i]=0;
    for(let at=0;at<component.length;at++) {
      const p=component[at];
      for(const q of [p-1,p+1,p-width,p+width]) if(q>=0&&q<mask.length&&mask[q]) {mask[q]=0;component.push(q);}
    }
    // An exposed component must originate inside the mouth; do not track an
    // isolated patch of chin, lip or clothing below it.
    const seeds=component.reduce((n,p)=>n+interior[p],0);
    if(seeds>=Math.max(6,area*.06) && component.length>largest.length)largest=component;
  }
  const fraction=Math.min(1,largest.length/Math.max(area,1));
  if(largest.length<8 || fraction<.06) return;
  const members=new Set(largest);
  const boundary=largest.filter(p=>[p-1,p+1,p-width,p+width].some(q=>!members.has(q)));
  const stride=Math.max(1,Math.ceil(boundary.length/100));
  const outline=boundary.filter((_,i)=>i%stride===0).map(p=>({x:(p%width)/width,y:Math.floor(p/width)/height}));
  const x=largest.reduce((sum,p)=>sum+p%width,0)/largest.length;
  const y=largest.reduce((sum,p)=>sum+Math.floor(p/width),0)/largest.length;
  // Follow the exposed tip, not blob area: area saturates when the tongue
  // fills the aperture even though the tip is still moving outside it.
  const lowest=Math.max(...largest.map(p=>Math.floor(p/width)));
  const tipPixels=largest.filter(p=>Math.floor(p/width)>=lowest-Math.max(2,mouthWidth*.06));
  const tipX=tipPixels.reduce((sum,p)=>sum+p%width,0)/tipPixels.length;
  const tipY=tipPixels.reduce((sum,p)=>sum+Math.floor(p/width),0)/tipPixels.length;
  return {x:x/width,y:y/height,
    lateral:Math.max(-1,Math.min(1,(x-(minX+maxX)/2)/mouthWidth)),
    lift:Math.max(0,Math.min(1,1-(y-minY)/(maxY-minY))),
    extension:Math.max(0,Math.min(1,(tipY-maxY)/(mouthWidth*.45))),
    elevation:Math.max(-1,Math.min(1,((minY+maxY)/2-y)/mouthWidth)),
    tip:{x:tipX/width,y:tipY/height},visibleFraction:fraction,outline};
}

export function createTongueTracker() {
  const tipTracker=createTongueTipTracker();
  let hits=0;
  let profile:TongueProfile|undefined;
  let profileStatus='Private labeled profile not loaded; select a visible tip';
  let diagnostic:TongueDiagnostic={state:'unselected',reason:profileStatus};
  let reference:{x:number;y:number}|undefined={x:0,y:0};
  let smooth:TongueObservation|undefined;
  const track = (pixels:Uint8ClampedArray,width:number,height:number,face:Landmark[]) => {
    let observed=detectVisibleTongue(pixels,width,height,face);
    let tip=face.length?tipTracker.update(pixels,width,height):undefined;
    diagnostic=tipTracker.diagnostic;
    if(face.length&&profile&&!tip){
      const result=inferLabeledTongueTip(profile,pixels,width,height);tip=result.point;
      diagnostic={state:tip?'tracking':'lost',reason:`Private labeled profile · ${result.reason}`,score:result.score};
    } else if(!tip&&!tipTracker.selected)diagnostic={state:'unselected',reason:profileStatus};
    if(!face.length){tipTracker.reset();diagnostic={state:'unselected',reason:profile?'Private labeled profile ready · show an open mouth':profileStatus};}
    // A tissue-color gate is not evidence that a selected image point was lost.
    if(!observed&&tip)observed={x:tip.x,y:tip.y,lateral:0,lift:.5,visibleFraction:0};
    if(!observed){hits=0;smooth=undefined;return undefined;}
    hits++;
    observed.trackingMode=tip?'tip':'region';
    observed.tip=tip;
    if(tip){
      const [left,right]=[face[78],face[308]].sort((a,b)=>a.x-b.x);
      const dx=(right.x-left.x)*width,dy=(right.y-left.y)*height,span=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/span,uy=dy/span;
      const cx=(left.x+right.x)*width/2,cy=face[14].y*height;
      const tx=tip.x*width-cx,ty=tip.y*height-cy;
      observed.x=tip.x;observed.y=tip.y;
      observed.lateral=(tx*ux+ty*uy)/span;
      observed.elevation=(tx*uy-ty*ux)/span;
      observed.extension=Math.max(0,Math.min(1,((tip.y-face[14].y)*height*ux-(tip.x-face[14].x)*width*uy)/(span*.45)));
    } else {observed.lateral=0;observed.elevation=0;}
    // The lower lip is the visible tongue-rest height; the aperture midpoint
    // incorrectly makes even a raised tongue appear below neutral. Mouth axes
    // at this lip reference are the default neutral. Only explicit Recenter captures a
    // user offset; automatic reacquisition must not zero a newly lifted tip.
    if(tip)reference??={x:observed.lateral,y:observed.elevation??0};
    observed.lateral=Math.max(-1,Math.min(1,(observed.lateral-(reference?.x??0))*6));
    observed.elevation=Math.max(-1,Math.min(1,((observed.elevation??0)-(reference?.y??0))*6));
    if(smooth) for(const key of ['x','y','lateral','lift','visibleFraction','extension','elevation'] as const) observed[key]=(smooth[key]??observed[key]??0)+((observed[key]??0)-(smooth[key]??0))*.45;
    smooth=observed;
    return tip || hits>=2 ? observed : undefined;
  };
  return Object.assign(track,{setProfile(value:unknown){if(!validTongueProfile(value)){profileStatus='Private profile is invalid; select the visible tip';return false;}profile=value;profileStatus=`Private labeled profile ready · ${profile.examples.length} examples`;return true;},profileUnavailable(){profileStatus='No private labeled profile; click Track tip to initialize';},diagnostics(){return {...diagnostic}},selectTip(x:number,y:number){tipTracker.select(x,y);reference={x:0,y:0};smooth=undefined;hits=0;},isTipSelected(){return tipTracker.selected},resetMotionReference(){reference=undefined;smooth=undefined;hits=0;}});
}
