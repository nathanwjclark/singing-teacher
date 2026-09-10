import type { Landmark, TongueObservation } from '../types';

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
  let area=0;
  for(let y=Math.max(0,Math.ceil(minY+1));y<Math.min(height-1,maxY-1);y++) {
    for(let x=Math.max(0,Math.ceil(minX+1));x<Math.min(width-1,maxX-1);x++) {
      // Erode the mouth boundary to reject lips, including lipstick.
      if (![[-1,0],[1,0],[0,-1],[0,1]].every(([dx,dy])=>inside(x+dx,y+dy))) continue;
      area++;
      const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      // Reject dark mouth cavity and bright, nearly neutral teeth.
      if (r>65 && g>25 && b>22 && r>g*1.18 && r>b*1.08 && g>b*.65 && r-g>18) mask[y*width+x]=1;
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
    if(component.length>largest.length)largest=component;
  }
  const fraction=largest.length/Math.max(area,1);
  if(largest.length<8 || fraction<.12 || fraction>.85) return;
  const x=largest.reduce((sum,p)=>sum+p%width,0)/largest.length;
  const y=largest.reduce((sum,p)=>sum+Math.floor(p/width),0)/largest.length;
  return {x:x/width,y:y/height,lateral:Math.max(-1,Math.min(1,((x-minX)/(maxX-minX)-.5)*2)),lift:1-(y-minY)/(maxY-minY),visibleFraction:fraction};
}

export function createTongueTracker() {
  let hits=0;
  let smooth:TongueObservation|undefined;
  return (pixels:Uint8ClampedArray,width:number,height:number,face:Landmark[]) => {
    const observed=detectVisibleTongue(pixels,width,height,face);
    if(!observed){hits=0;smooth=undefined;return undefined;}
    hits++;
    if(smooth) for(const key of ['x','y','lateral','lift','visibleFraction'] as const) observed[key]=smooth[key]+(observed[key]-smooth[key])*.3;
    smooth=observed;
    return hits>=3 ? observed : undefined;
  };
}
