import {constants} from 'node:fs';
import {open,writeFile,mkdir,rename,readdir,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {probeSource} from '../src/contracts/probes.ts';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const limits={JA:[-5,-1],gain:[.01,100],direct_gain:[0,2],coupling_gain:[0,2],delay_s:[-.01,.01]};
async function bytes(path,limit=2*1024*1024){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();requireValue(stat.isFile()&&stat.size>0&&stat.size<=limit,'Invalid probe setup file size or type');const data=await file.readFile();requireValue(data.length===stat.size,'Probe setup file changed during read');return data;}finally{await file.close();}
}
async function read(path){try{return JSON.parse(await bytes(path));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
// Verification is capped at 60 s, so a staging or pending file this old is a crash leftover, not another process's save.
const STALE_MS=10*60*1000;
async function sweep(folder,matches){for(const name of await readdir(folder))if(matches(name)){const path=join(folder,name),info=await lstat(path).catch(()=>null);if(info&&Date.now()-info.mtimeMs>STALE_MS)await rm(path,{recursive:true,force:true});}}
async function write(path,value){await writeFile(path,Buffer.isBuffer(value)?value:JSON.stringify(value),{mode:0o600,flag:'wx'});}

export async function probeSetupStatus(dataRoot,importId){
 let pointer=null,setup=null,error=null;
 try{
  pointer=await read(join(dataRoot,'probe-setup-current.json'));
  if(pointer){
  requireValue(safeId(pointer.setupId),'Invalid saved probe setup identity');
  const folder=join(dataRoot,'probe-setups',pointer.setupId),receiptBytes=await bytes(join(folder,'summary.json'));
  requireValue(hash(receiptBytes)===pointer.receiptSha256,'Saved probe setup receipt hash mismatch');
  setup=JSON.parse(receiptBytes);
  for(const [name,key] of [['configuration.json','configurationSha256'],['profile.json','profileSha256']])requireValue(hash(await bytes(join(folder,name)))===setup[key],'Saved probe setup configuration hash mismatch');
  }
 }catch{setup=null;error='Saved calibration setup could not be verified. Save the setup again with its original evidence.';}
 let capture=null;
 if(importId){
  requireValue(safeId(importId),'Invalid imported probe identity');
  const folder=join(dataRoot,'probe-imports',importId),summary=await read(join(folder,'summary.json'));
  if(summary){
   requireValue(['capture','unpacked/sound'].includes(summary.captureDirectory),'Invalid original probe capture path');
   const manifestBytes=await bytes(join(folder,summary.captureDirectory,'manifest.json'));
   const manifest=JSON.parse(manifestBytes);
   const source=probeSource(manifest);
   capture={importId,captureId:manifest.captureId,manifestSha256:hash(manifestBytes),provenance:source.kind,declaredProvenance:source.declared,
    pose:manifest.pose??null,placementId:manifest.calibration?.placementId??null,routeSignature:manifest.calibration?.levelCheck?.routeSignature??null};
  }
 }
 return {setup,capture,legacyConfiguration:!pointer&&!error&&!!await read(join(dataRoot,'probe-science-config.json')),error};
}

export async function saveProbeSetup({repo,dataRoot,body,runProcess}){
 requireValue(body&&Object.keys(body).every(k=>['requestId','importId','manifestSha256','packageBase64','evidence','placement','profile','trialId','pose'].includes(k)),'Invalid probe setup request fields');
 requireValue(safeId(body.requestId)&&safeId(body.importId),'Invalid probe setup request identity');
 const status=await probeSetupStatus(dataRoot,body.importId),capture=status.capture;
 requireValue(capture&&capture.manifestSha256===body.manifestSha256,'Original probe changed; refresh setup before saving');
 const decode=(value,limit)=>{
  requireValue(typeof value==='string'&&value.length<=Math.ceil(limit/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'Invalid or oversized evidence encoding');
  const data=Buffer.from(value,'base64');requireValue(data.length>0&&data.length<=limit,'Empty or oversized calibration evidence');return data;
 };
 const packageBytes=decode(body.packageBase64,2*1024*1024),packageValue=JSON.parse(packageBytes);
 requireValue(packageValue.schema_version==='0.1.0'&&['probe_calibration_package','probe_science_import_configuration'].includes(packageValue.kind),'Upload a supported calibration package or existing probe configuration');
 const p=body.placement;
 requireValue(p&&Object.keys(p).length===5&&['placement_id','coordinate_frame'].every(k=>typeof p[k]==='string'&&p[k].trim().length>0&&p[k].length<=120)&&['source_m','microphone_m','mouth_m'].every(k=>Array.isArray(p[k])&&p[k].length===3&&p[k].every(v=>finite(v)&&Math.abs(v)<=10)),'Declare placement identity, coordinate frame and three metric positions (within 10 m)');
 for(const [a,b] of [['source_m','mouth_m'],['microphone_m','mouth_m'],['source_m','microphone_m']]){
  const distance=Math.hypot(...p[a].map((v,i)=>v-p[b][i]));requireValue(distance>=.005&&distance<=5,'Source, microphone and mouth distances must be between 0.005 and 5 metres');
 }
 requireValue(safeId(body.trialId)&&typeof body.pose==='string'&&body.pose.trim()&&body.pose.length<=120,'Declare a trial ID and held-quiet pose');
 requireValue(body.profile&&Object.keys(body.profile).length===5&&Object.entries(limits).every(([k,[low,high]])=>finite(body.profile[k])&&body.profile[k]>=low&&body.profile[k]<=high),'Declare all five controls within their supported bounds');
 for(const key of ['gain','direct_gain','coupling_gain','delay_s']){
  const bounds=packageValue.nuisance_prior?.bounds?.[key];
  requireValue(Array.isArray(bounds)&&bounds.length===2&&bounds.every(finite)&&body.profile[key]>=bounds[0]&&body.profile[key]<=bounds[1],`${key} must remain within the calibration package nuisance prior`);
 }
 requireValue(Array.isArray(packageValue.evidence)&&packageValue.evidence.length>0&&packageValue.evidence.length<=32&&Array.isArray(body.evidence)&&body.evidence.length===packageValue.evidence.length,'Upload every original calibration evidence file');
 const supplied=new Map();let total=0;
 for(const item of body.evidence){
  requireValue(item&&Object.keys(item).length===2&&typeof item.name==='string'&&/^[\w][\w.-]{0,119}$/.test(item.name)&&!['configuration.json','profile.json','summary.json','package.json','verification'].includes(item.name)&&!supplied.has(item.name),'Evidence filenames must be unique safe basenames');
  const data=decode(item.base64,16*1024*1024);total+=data.length;requireValue(total<=16*1024*1024,'Calibration evidence exceeds 16 MB total');supplied.set(item.name,data);
 }
 const expectedNames=new Set();
 for(const descriptor of packageValue.evidence){
  requireValue(descriptor&&typeof descriptor.path==='string'&&!expectedNames.has(descriptor.path),'Calibration evidence paths must be unique');expectedNames.add(descriptor.path);
  const data=supplied.get(descriptor.path);requireValue(data&&data.length===descriptor.byteCount&&hash(data)===descriptor.sha256,'Calibration evidence filename, SHA-256 or byte count mismatch');
 }
 const configuration={schema_version:'0.1.0',kind:'probe_science_import_configuration',trial_id:body.trialId,pose:body.pose,pose_state:'held-quiet',placement:p,
  ...Object.fromEntries(['comparison','selected_indices','bands','calibration','nuisance_prior','conditions','processing','evidence'].map(k=>[k,packageValue[k]])),
  capture_binding:{manifest_sha256:capture.manifestSha256,pose:body.pose,placement_id:p.placement_id,route_id:packageValue.calibration?.route_id,
   ...(capture.routeSignature?{native_route_signature:capture.routeSignature}:{})}};
 const root=join(dataRoot,'probe-setups'),folder=join(root,body.requestId);
 const requestSha256=hash(Buffer.from(JSON.stringify(body)));
 await mkdir(root,{recursive:true,mode:0o700});
 await sweep(root,name=>name.startsWith('.staging-'));await sweep(dataRoot,name=>name.startsWith('probe-setup-')&&name.endsWith('.pending'));
 const previous=await read(join(folder,'summary.json'));
 if(previous){requireValue(previous.requestSha256===requestSha256&&status.setup?.setupId===body.requestId,'Setup attempt already exists; refresh and submit a new attempt');return previous;}
 requireValue(!await lstat(folder).catch(()=>null),'A setup folder with this request ID exists without a saved receipt; submit a new attempt');
 // Build and verify in a staging folder; only a verified setup is renamed into place, so a
 // failed attempt leaves none of its (up to 16 MB) evidence behind.
 const staging=join(root,`.staging-${randomUUID()}`);await mkdir(staging,{mode:0o700});
 try{
  await write(join(staging,'package.json'),packageBytes);
  await write(join(staging,'configuration.json'),configuration);await write(join(staging,'profile.json'),body.profile);
  for(const [name,data] of supplied)await write(join(staging,name),data);
  const imported=await read(join(dataRoot,'probe-imports',body.importId,'summary.json'));
  await runProcess(process.execPath,['--experimental-strip-types',join(repo,'science/scripts/import_probe_science.ts'),join(dataRoot,'probe-imports',body.importId,imported.captureDirectory),join(staging,'verification'),join(staging,'configuration.json')],{cwd:repo,timeout:60000,maxBuffer:65536});
  const verified=await read(join(staging,'verification/probe-science-receipt.json'));
  requireValue(verified?.eligible_for_fit,`Calibration is not eligible: ${(verified?.reasons??['verification unavailable']).join('; ')}`);
  const receipt={setupId:body.requestId,importId:body.importId,createdAt:new Date().toISOString(),requestSha256,configurationSha256:hash(await bytes(join(staging,'configuration.json'))),profileSha256:hash(await bytes(join(staging,'profile.json'))),packageSha256:hash(packageBytes),manifestSha256:capture.manifestSha256,
   provenance:capture.provenance,calibrationKind:configuration.calibration.kind,calibrationId:configuration.calibration.calibration_id,routeId:configuration.calibration.route_id,placement:p,profile:body.profile,pose:body.pose,trialId:body.trialId,
   frequencyHz:configuration.calibration.frequency_hz,comparison:configuration.comparison,evidence:configuration.evidence,eligible:true,includedInFit:false,calibrationAuthenticityVerified:false};
  await write(join(staging,'summary.json'),receipt);
  await rename(staging,folder);
  const pointer={setupId:body.requestId,receiptSha256:hash(await bytes(join(folder,'summary.json')))},temporary=join(dataRoot,`probe-setup-${randomUUID()}.pending`);
  await write(temporary,pointer);await rename(temporary,join(dataRoot,'probe-setup-current.json'));
  return receipt;
 }catch(error){
  await rm(staging,{recursive:true,force:true});
  if(!error.stderr)throw error;
  throw Error(`Canonical probe verification failed: ${/^Error: (.+)$/m.exec(error.stderr)?.[1]??'check calibration arrays, route, source evidence and native capture bindings.'}`);
 }
}
