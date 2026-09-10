import type {Landmark} from '../types';
/** A square in sensor pixels, not normalized x/y units. Covers extreme lateral
 * and raised tips on both portrait phones and landscape webcams. */
export function tongueCrop(face:Landmark[],width:number,height:number){
 if(!face[308]||!face[13]||!width||!height)return;
 const left=Math.min(face[78].x,face[308].x)*width,mouth=Math.abs(face[78].x-face[308].x)*width;
 const side=mouth*2.2,x=Math.max(0,left-mouth*.6),y=Math.max(0,face[13].y*height-mouth*.5);
 return {x:x/width,y:y/height,width:Math.min(width-x,side)/width,height:Math.min(height-y,side)/height};
}
