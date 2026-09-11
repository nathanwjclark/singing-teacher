export type TongueRegion={box:[number,number,number,number]|null;score:number};
/** TongueSAM's prompt detector outputs boxes, never a tongue contour or tip. */
export function selectTongueRegion(data:ArrayLike<number>,threshold=.7):TongueRegion{
 if(data.length%5)throw Error('Invalid tongue detector output');
 let result:TongueRegion={box:null,score:0};
 for(let i=0;i<data.length;i+=5){
  const [x1,y1,x2,y2,score]=Array.from({length:5},(_,j)=>data[i+j]);
  if(![x1,y1,x2,y2,score].every(Number.isFinite)||score<Math.max(threshold,result.score)||score>1)continue;
  const box:[number,number,number,number]=[Math.max(0,x1),Math.max(0,y1),Math.min(1,x2),Math.min(1,y2)];
  if(box[2]<=box[0]||box[3]<=box[1])continue;
  result={box,score};
 }
 return result;
}
