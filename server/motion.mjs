import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {validateLearningRecord} from '../src/contracts/learning.ts';

const JSON_LIMIT=4*1024*1024,MEDIA_LIMIT=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const identifier=/^[a-f0-9]{64}$/;

export function createMotionRoutes({dataRoot,json}){
 let importing=false;
 const root=join(dataRoot,'motion-captures'),latest=join(dataRoot,'motion-latest.json');
 async function capture(id){
  if(!identifier.test(id??''))throw Error('Invalid motion capture identifier');
  const summary=await optional(join(root,id,'summary.json'));
  if(!summary)throw Error('Motion capture not found');
  const record=await readFile(join(root,id,'record.json'));
  if(hash(record)!==summary.recordSha256)throw Error('Stored motion JSON integrity mismatch');
  return {summary,record};
 }
 return async(req,res,url)=>{
  if(!['/api/motion/import','/api/motion/status','/api/motion/record','/api/motion/media'].includes(url.pathname))return false;
  let local=false;
  try{local=['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
  if(!local){json(res,403,{error:'Use this Mac’s localhost page to retain private motion evidence.'});return true;}
  if(req.method==='GET'){
   try{
    if(url.pathname.endsWith('/status')){
     const pointer=await optional(latest);
     if(!pointer){json(res,200,{busy:importing,capture:null,record:null});return true;}
     const value=await capture(pointer.id);
     json(res,200,{busy:importing,capture:value.summary,record:JSON.parse(value.record)});return true;
    }
    if(!url.pathname.endsWith('/record')&&!url.pathname.endsWith('/media')){json(res,405,{error:'Method not allowed'});return true;}
    const id=url.searchParams.get('id'),value=await capture(id),isMedia=url.pathname.endsWith('/media');
    const bytes=isMedia?await readFile(join(root,id,'media')):value.record;
    if(isMedia&&(hash(bytes)!==value.summary.mediaSha256||bytes.length!==value.summary.mediaByteLength))throw Error('Stored companion media integrity mismatch');
    res.writeHead(200,{'Content-Type':isMedia?value.summary.mimeType.split(';')[0]:'application/json','Content-Length':bytes.length,
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
     'Content-Disposition':`attachment; filename="motion-${id}.${isMedia?(value.summary.mimeType.startsWith('video/mp4')?'mp4':'webm'):'json'}"`});
    res.end(bytes);return true;
   }catch(error){json(res,409,{error:error.code?'Private motion evidence could not be read.':error.message});return true;}
  }
  if(req.method!=='POST'||!url.pathname.endsWith('/import')){json(res,405,{error:'Method not allowed'});return true;}
  if(importing){json(res,409,{error:'A motion import is already running.'});return true;}
  importing=true;
  let staging;
  try{
   const contentType=req.headers['content-type']??'';
   if(url.search||!contentType.startsWith('multipart/form-data;'))throw Error('Send the original motion JSON and companion media as multipart files.');
   const limit=JSON_LIMIT+MEDIA_LIMIT+65536,length=Number(req.headers['content-length']);
   if(Number.isFinite(length)&&length>limit)throw Error('Motion upload exceeds the 68 MiB limit.');
   let count=0;const chunks=[];
   for await(const chunk of req){count+=chunk.length;if(count>limit)throw Error('Motion upload exceeds the 68 MiB limit.');chunks.push(chunk);}
   const form=await new Request('http://localhost/upload',{method:'POST',headers:{'content-type':contentType},body:Buffer.concat(chunks)}).formData();
   if([...form.keys()].sort().join(',')!=='media,record')throw Error('Exactly one record file and one media file are required.');
   const recordFile=form.get('record'),mediaFile=form.get('media');
   if(typeof recordFile==='string'||typeof mediaFile==='string'||!recordFile||!mediaFile)throw Error('Choose both original files.');
   if(recordFile.size<1||recordFile.size>JSON_LIMIT||mediaFile.size<1||mediaFile.size>MEDIA_LIMIT)throw Error('Motion JSON must be at most 4 MiB and companion media at most 64 MiB.');
   const recordBytes=Buffer.from(await recordFile.arrayBuffer()),mediaBytes=Buffer.from(await mediaFile.arrayBuffer());
   const record=JSON.parse(recordBytes.toString('utf8')),checked=validateLearningRecord(record);
   if(!checked.valid||record.kind!=='motion-observation')throw Error('Invalid motion observation: '+checked.errors.slice(0,4).join('; '));
   const media=record.media;
   if(!media||!identifier.test(media.sha256??'')||!Number.isSafeInteger(media.byteLength))throw Error('This recording lacks its original media integrity binding; export a new capture.');
   if(!/^video\/(webm|mp4)(?:;[^\r\n]*)?$/.test(media.mimeType))throw Error('Only recorded WebM or MP4 companion media is supported.');
   if(mediaBytes.length!==media.byteLength||hash(mediaBytes)!==media.sha256)throw Error('Companion media does not match the motion JSON hash and byte length.');
   if(!record.provenance.sourceHashes.includes(media.sha256))throw Error('Motion provenance does not bind the companion media hash.');
   const recordSha256=hash(recordBytes),id=hash(Buffer.from(recordSha256+media.sha256));
   const summary={id,observationId:record.id,attemptId:record.attemptId,recordSha256,mediaSha256:media.sha256,
    mediaByteLength:mediaBytes.length,mimeType:media.mimeType,sampleCount:record.samples.length,
    timingGaps:record.samples.filter(sample=>sample.gapBefore).length,
    unsuccessfulMarkers:record.markers.filter(marker=>marker.type==='unsuccessful').length,
    syncUncertaintyMs:record.timebase.syncUncertaintyMs,missing:record.missing,
    status:'retained-byte-verified',includedInPhysicalFit:false,
    interpretation:'Original 2D tracking estimates and media retained; no calibrated depth, inferred articulation or anatomical limits established.'};
   await mkdir(root,{recursive:true,mode:0o700});
   const existing=await optional(join(root,id,'summary.json'));
   if(existing){
    const saved=await capture(id),original=await readFile(join(root,id,'media'));
    if(JSON.stringify(existing)!==JSON.stringify(summary)||!saved.record.equals(recordBytes)||!original.equals(mediaBytes))throw Error('Existing motion evidence changed; original files were preserved.');
   }else{
    staging=join(root,'.incoming-'+randomUUID());await mkdir(staging,{mode:0o700});
    for(const [name,bytes] of [['record.json',recordBytes],['media',mediaBytes],['summary.json',JSON.stringify(summary)]])await writeFile(join(staging,name),bytes,{mode:0o600,flag:'wx'});
    await rename(staging,join(root,id));staging=null;
   }
   const pointer=latest+'.'+randomUUID();await writeFile(pointer,JSON.stringify({id}),{mode:0o600,flag:'wx'});await rename(pointer,latest);
   json(res,200,{capture:summary,reused:!!existing});
  }catch(error){json(res,400,{error:error instanceof SyntaxError?'Invalid motion JSON.':error.code?'Motion import failed; existing evidence was preserved.':error.message});}
  finally{if(staging)await rm(staging,{recursive:true,force:true});importing=false;}
  return true;
 };
}
