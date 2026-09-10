/** Small, selected image-patch tracker. Selection supplies the anatomical
 * meaning; correlation follows texture, not the centroid of pink pixels. */
export function createTongueTipTracker() {
  const radius=7,side=radius*2+1;
  let template:Float32Array|undefined;
  let point:{x:number;y:number}|undefined;
  let pending:{x:number;y:number}|undefined;
  let selected=false;
  function patch(pixels:Uint8ClampedArray,w:number,h:number,x:number,y:number) {
    if(x<radius||y<radius||x>=w-radius||y>=h-radius)return;
    const values=new Float32Array(side*side);let sum=0,square=0;
    for(let dy=-radius,k=0;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++,k++) {
      const i=((y+dy)*w+x+dx)*4;
      const v=pixels[i]*.3+pixels[i+1]*.59+pixels[i+2]*.11;
      values[k]=v;sum+=v;
    }
    const mean=sum/values.length;
    for(let i=0;i<values.length;i++){values[i]-=mean;square+=values[i]*values[i];}
    if(Math.sqrt(square/values.length)<2.5)return;
    const norm=Math.sqrt(square);for(let i=0;i<values.length;i++)values[i]/=norm;
    return values;
  }
  return {
    select(x:number,y:number){pending={x,y};template=undefined;point=undefined;selected=true},
    reset(){template=undefined;point=undefined;pending=undefined;selected=false},
    get selected(){return selected},
    update(pixels:Uint8ClampedArray,w:number,h:number) {
      if(pending){point={x:Math.round(pending.x*w),y:Math.round(pending.y*h)};pending=undefined;template=patch(pixels,w,h,point.x,point.y);return template?{x:point.x/w,y:point.y/h}:undefined;}
      if(!template||!point)return;
      let best=-1,second=-1,bestPoint=point,bestPatch:Float32Array|undefined;
      const candidates:{score:number;x:number;y:number;values:Float32Array}[]=[];
      for(let y=point.y-20;y<=point.y+20;y++)for(let x=point.x-20;x<=point.x+20;x++) {
        const values=patch(pixels,w,h,x,y);if(!values)continue;
        let score=0;for(let i=0;i<values.length;i++)score+=values[i]*template[i];
        candidates.push({score,x,y,values});
        if(score>best){best=score;bestPoint={x,y};bestPatch=values;}
      }
      for(const c of candidates)if(Math.hypot(c.x-bestPoint.x,c.y-bestPoint.y)>5)second=Math.max(second,c.score);
      // Ambiguous or vanished texture is loss, not permission to jump elsewhere.
      if(best<.72||best-second<.025||!bestPatch){template=undefined;point=undefined;return;}
      point=bestPoint;
      // Keep the initial patch identity while allowing modest lighting/shape change.
      let norm=0;for(let i=0;i<template.length;i++){template[i]=template[i]*.95+bestPatch[i]*.05;norm+=template[i]*template[i];}
      norm=Math.sqrt(norm);for(let i=0;i<template.length;i++)template[i]/=norm;
      return {x:point.x/w,y:point.y/h};
    },
  };
}
