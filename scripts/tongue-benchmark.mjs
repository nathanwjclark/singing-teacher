import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const box=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&b[2]>b[0]&&b[3]>b[1];
const bounds=p=>[Math.min(...p.map(q=>q.x)),Math.min(...p.map(q=>q.y)),Math.max(...p.map(q=>q.x)),Math.max(...p.map(q=>q.y))];
export function boxOverlap(reference,predicted){if(!predicted)return 0;const intersect=Math.max(0,Math.min(reference[2],predicted[2])-Math.max(reference[0],predicted[0]))*Math.max(0,Math.min(reference[3],predicted[3])-Math.max(reference[1],predicted[1]));const area=b=>(b[2]-b[0])*(b[3]-b[1]);return intersect/(area(reference)+area(predicted)-intersect);}
function polygon(p){return Array.isArray(p)&&p.length>=3&&p.length<=1000&&p.every(point);}
function inside(x,y,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[i],b=poly[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}return hit;}
export function overlap(reference,predicted,resolution=128){
 let intersection=0,union=0;
 for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
  const a=inside((x+.5)/resolution,(y+.5)/resolution,reference);
  const b=predicted?inside((x+.5)/resolution,(y+.5)/resolution,predicted):false;
  intersection+=Number(a&&b);union+=Number(a||b);
 }
 return union?intersection/union:null;
}
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function benchmark(review,predictions,reviewSha256){
 if(review.schema!=='tongue-tip-review/v1'||!Array.isArray(review.samples)||review.samples.length>10000)throw Error('Expected a tongue-tip-review/v1 export');
 const {width,height}=review.cropPixels||{};
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Missing crop pixel dimensions');
 if(predictions&&(predictions.schema!=='tongue-predictions/v1'||predictions.reviewSha256!==reviewSha256||!Array.isArray(predictions.samples)||typeof predictions.modelId!=='string'||!predictions.modelId.trim()))throw Error('Prediction file must identify its model and exact review SHA-256');
 const byIndex=new Map();
 for(const row of predictions?.samples||[]){
  if(!Number.isInteger(row.index)||row.index<0||row.index>=review.samples.length||byIndex.has(row.index))throw Error('Invalid or duplicate prediction index');
  if(row.tip!=null&&!point(row.tip))throw Error('Invalid predicted tip');
  if(row.region!=null&&!box(row.region))throw Error('Invalid predicted region');
  if(row.surface!=null&&!polygon(row.surface))throw Error('Invalid predicted outline');
  byIndex.set(row.index,row);
 }
 const errors=[],ious=[],regionIous=[],rows=[];let regionFound=0,falseRegion=0,visible=0,tipFound=0,hidden=0,falseTip=0,surfaces=0,surfaceFound=0,absent=0,falseSurface=0;
 for(const [index,s] of review.samples.entries()){
  if(s.label!==undefined&&s.label!==null&&!point(s.label))throw Error(`Invalid tip label at ${index}`);
  if(s.surface!==undefined&&s.surface!==null&&!polygon(s.surface))throw Error(`Invalid surface label at ${index}`);
  const image=/^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(s.image||'');
  if(!image)throw Error(`Missing original crop at ${index}`);
  const imageSha256=hash(Buffer.from(image[1],'base64'));
  const predicted=predictions?byIndex.get(index):{tip:s.prediction??null,region:s.regionPrediction};
  if(predicted?.region!=null&&!box(predicted.region))throw Error(`Invalid recorded region at ${index}`);
  if(predicted?.imageSha256&&predicted.imageSha256!==imageSha256)throw Error(`Prediction image mismatch at ${index}`);
  if(predicted?.tip!=null&&!point(predicted.tip))throw Error(`Invalid recorded tip at ${index}`);
  const row={index,imageSha256,tipReviewed:s.label!==undefined,surfaceReviewed:s.surface!==undefined,tipDetected:!!predicted?.tip,surfaceDetected:!!predicted?.surface,regionDetected:!!predicted?.region,predictionObservedAt:s.predictionObservedAt??null};
  if(s.label){visible++;if(predicted?.tip){tipFound++;const e=Math.hypot((s.label.x-predicted.tip.x)*width,(s.label.y-predicted.tip.y)*height);errors.push(e);row.tipErrorPixels=e;}}
  else if(s.label===null){hidden++;falseTip+=Number(!!predicted?.tip);}
  if(s.surface){regionFound+=Number(!!predicted?.region);const regionIoU=boxOverlap(bounds(s.surface),predicted?.region);row.regionBoxIoU=regionIoU;regionIous.push(regionIoU);surfaces++;surfaceFound+=Number(!!predicted?.surface);const iou=overlap(s.surface,predicted?.surface);row.surfaceIoU=iou;if(iou!==null)ious.push(iou);}
  else if(s.surface===null){falseRegion+=Number(!!predicted?.region);absent++;falseSurface+=Number(!!predicted?.surface);}
  rows.push(row);
 }
 return {schema:'tongue-benchmark/v1',reviewSha256,sessionId:review.sessionId??null,modelId:predictions?.modelId??'recorded-live-observations',
  modelSha256:predictions?.modelSha256??null,sampleCount:rows.length,
  tip:{visibleLabeled:visible,detected:tipFound,coverage:visible?tipFound/visible:null,meanErrorOnDetectionsPixels:mean(errors),hiddenLabeled:hidden,falseDetectionsOnHidden:falseTip},
  region:{available:predictions?predictions.samples.some(s=>Object.hasOwn(s,'region')):review.samples.some(s=>Object.hasOwn(s,'regionPrediction')),visibleSurfaceReferences:surfaces,detected:regionFound,meanBoxIoUIncludingMisses:(predictions?predictions.samples.some(s=>Object.hasOwn(s,'region')):review.samples.some(s=>Object.hasOwn(s,'regionPrediction')))?mean(regionIous):null,absentSurfaceReferences:absent,falseDetectionsOnAbsent:falseRegion},
  surface:{available:!!predictions?.samples.some(s=>Object.hasOwn(s,'surface')),visibleLabeled:surfaces,detected:surfaceFound,meanIoUIncludingMisses:predictions?.samples.some(s=>Object.hasOwn(s,'surface'))?mean(ious):null,absentLabeled:absent,falseDetectionsOnAbsent:falseSurface,rasterResolution:128},
  limitations:['Region IoU compares bounding boxes of manual visible-surface labels, not segmentation masks.','Recorded observations may lag the image; predictionObservedAt preserves acquisition time when available.','Manual labels require review.','Frames from one clip are correlated; split by recording session before training.','Tip error excludes misses; always read coverage alongside error.','Surface IoU uses a 128-square raster and includes abstentions as zero overlap.','Neither visible outlines nor tip detection establish hidden anatomy or depth.'],rows};
}
async function main(){
 const [reviewPath,predictionPath,outputPath]=process.argv.slice(2);
 if(!reviewPath)throw Error('Usage: node scripts/tongue-benchmark.mjs review.json [predictions.json|-] [report.json]');
 const bytes=await readFile(reviewPath);if(bytes.length>64*1024*1024)throw Error('Review exceeds 64 MiB');
 const predicted=predictionPath&&predictionPath!=='-'?JSON.parse(await readFile(predictionPath,'utf8')):undefined;
 const report=benchmark(JSON.parse(bytes),predicted,hash(bytes));
 const text=JSON.stringify(report,null,2)+'\n';
 if(outputPath)await writeFile(outputPath,text,{mode:0o600,flag:'wx'});else process.stdout.write(text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
