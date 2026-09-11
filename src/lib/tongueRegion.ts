/** box is null when no valid box reaches the threshold; score is then the best score below it (0 when there is none). */
export type TongueRegion={box:[number,number,number,number]|null;score:number};
/** TongueSAM's prompt detector outputs boxes, never a tongue contour or tip. */
export function selectTongueRegion(data:ArrayLike<number>,threshold:number):TongueRegion{
 if(data.length%5)throw Error('Invalid tongue detector output');
 let best:{box:[number,number,number,number];score:number}|undefined;
 for(let i=0;i<data.length;i+=5){
  const [x1,y1,x2,y2,score]=Array.from({length:5},(_,j)=>data[i+j]);
  if(![x1,y1,x2,y2,score].every(Number.isFinite)||score>1||score<=(best?.score??0))continue;
  const box:[number,number,number,number]=[Math.max(0,x1),Math.max(0,y1),Math.min(1,x2),Math.min(1,y2)];
  if(box[2]<=box[0]||box[3]<=box[1])continue;
  best={box,score};
 }
 return best&&best.score>=threshold?best:{box:null,score:best?.score??0};
}
