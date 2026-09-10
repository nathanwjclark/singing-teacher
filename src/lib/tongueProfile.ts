/** Private, user-labeled appearance examples. Images/features never ship in Git.
 * Whole-mouth context chooses a labeled pose; local correlation transfers its
 * actual point label. It is not a color centroid, depth estimate or probability.
 */
export type TongueProfile={schema:'tongue-tip-profile/v1';width:80;height:64;trainingFrames:number[];examples:{gray:number[];tip:{x:number;y:number}}[]};
type Point={x:number;y:number};
const W=80,H=64,R=9;
export function validTongueProfile(value:unknown):value is TongueProfile {
 const p=value as TongueProfile;return p?.schema==='tongue-tip-profile/v1'&&p.width===W&&p.height===H&&Array.isArray(p.examples)&&p.examples.length>0&&p.examples.length<=80&&p.examples.every(e=>e&&e.tip&&Array.isArray(e.gray)&&e.gray.length===W*H&&e.gray.every(v=>Number.isFinite(v)&&v>=0&&v<=255)&&Number.isFinite(e.tip.x)&&Number.isFinite(e.tip.y)&&e.tip.x>=0&&e.tip.x<=1&&e.tip.y>=0&&e.tip.y<=1);
}
function correlation(a:ArrayLike<number>,b:ArrayLike<number>){let sa=0,sb=0,aa=0,bb=0,ab=0;for(let i=0;i<a.length;i++){const x=a[i],y=b[i];sa+=x;sb+=y;aa+=x*x;bb+=y*y;ab+=x*y;}const n=a.length;return (ab-sa*sb/n)/Math.max(1,Math.sqrt(Math.max(0,(aa-sa*sa/n)*(bb-sb*sb/n))));}
function patch(gray:ArrayLike<number>,x:number,y:number){if(x<R||x>=W-R||y<R||y>=H-R)return;const out=new Float32Array((R*2+1)**2);for(let dy=-R,k=0;dy<=R;dy++)for(let dx=-R;dx<=R;dx++,k++)out[k]=gray[(y+dy)*W+x+dx];return out;}
export function profileGray(pixels:Uint8ClampedArray,w:number,h:number){const gray=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const ix=Math.min(w-1,Math.floor((x+.5)*w/W)),iy=Math.min(h-1,Math.floor((y+.5)*h/H)),i=(iy*w+ix)*4;gray[y*W+x]=pixels[i]*.3+pixels[i+1]*.59+pixels[i+2]*.11;}return gray;}
export function inferLabeledTongueTip(profile:TongueProfile,pixels:Uint8ClampedArray,w:number,h:number):{point?:Point;score:number;reason:string}{
 if(!w||!h)return {score:0,reason:'No mouth image'};
 const gray=profileGray(pixels,w,h);
 const contexts=profile.examples.map(e=>({e,score:correlation(gray,e.gray)})).sort((a,b)=>b.score-a.score).slice(0,3);
 let best:{point:Point;score:number;context:number;local:number}|undefined;
 for(const {e,score:context} of contexts){
  if(context<.72)continue;
  const ex=Math.round(e.tip.x*W),ey=Math.round(e.tip.y*H),template=patch(e.gray,ex,ey);if(!template)continue;
  let localBest=-1,point={x:ex,y:ey};
  for(let y=Math.max(R,ey-12);y<=Math.min(H-R-1,ey+12);y++)for(let x=Math.max(R,ex-12);x<=Math.min(W-R-1,ex+12);x++){
   const candidate=patch(gray,x,y)!;const local=correlation(candidate,template)-Math.hypot(x-ex,y-ey)*.0015;
   if(local>localBest){localBest=local;point={x,y};}
  }
  const score=context*.75+localBest*.25;
  if(localBest>=.82&&(!best||score>best.score))best={point:{x:point.x/W,y:point.y/H},score,context,local:localBest};
 }
 if(!best)return {score:contexts[0]?.score??0,reason:'Mouth appearance is outside the labeled examples; tip withheld'};
 return {point:best.point,score:best.score,reason:'Tip transferred from a labeled mouth example and localized on visible texture'};
}
