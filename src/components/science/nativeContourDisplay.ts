/** Signed antialiased pixel coverage change. The input contours are never
 * smoothed, reordered or rescaled independently; identical masks give zero. */
export function differenceCoverage(reference:Uint8ClampedArray,candidate:Uint8ClampedArray){
 if(reference.length!==candidate.length||reference.length%4)throw Error('Contour masks must have matching RGBA dimensions');
 for(let i=0;i<candidate.length;i+=4){
  const change=candidate[i+3]-reference[i+3];
  candidate[i]=change>0?32:255;candidate[i+1]=change>0?255:36;candidate[i+2]=change>0?99:78;candidate[i+3]=Math.abs(change);
 }
}
