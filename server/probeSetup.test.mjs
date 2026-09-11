import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,readdir,mkdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProbeRoutes} from './probe.mjs';
import {createProbeSetupFixture} from '../tests/helpers/probe-setup-fixture.mjs';
import {DECLARED_CALIBRATION_REASON} from '../science/scripts/import_probe_science.ts';

async function poll(call){
 for(let i=0;i<200;i++){
  const result=await call('status');
  // An error response has no busy field; it must fail here, not read as finished.
  assert.equal(result.status,200,JSON.stringify(result.body));
  if(!result.body.busy)return result.body;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 throw Error('Probe processing did not complete');
}

// Real probe routes over HTTP with the real importer, Python preparation and setup verification.
async function serve(t,options){
 const root=await mkdtemp(join(tmpdir(),'probe-setup-route-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const fixture=await createProbeSetupFixture(root,options);
 const routes=createProbeRoutes({repo:process.cwd(),dataRoot:fixture.dataRoot,json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}});
 const server=http.createServer(async(req,res)=>{if(!await routes(req,res,new URL(req.url,'http://localhost')))res.end();});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api/probe/`;
 async function call(action,body){const response=await fetch(base+action,{method:body!==undefined?'POST':'GET',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 return {fixture,call,setups:()=>readdir(join(fixture.dataRoot,'probe-setups')).catch(()=>[])};
}
// A package that declares measured calibration, characterized processing and typed placement for a device capture.
function declaredMeasured(fixture,importId){
 const pkg=structuredClone(fixture.calibration);pkg.calibration.kind='measured';pkg.processing.kind='characterized-measurement';
 return {...fixture.request,requestId:'declared-measured',importId,packageBase64:Buffer.from(JSON.stringify(pkg)).toString('base64')};
}
const device=provenance=>({manifest:{provenance,pose:'a',calibration:{placementId:'fixture-placement',levelCheck:{routeSignature:'declared-route'}}}});

test('actual route verifies original calibration, atomically saves setup and reimports with immutable lineage',async t=>{
 const {fixture,call,setups}=await serve(t);
 assert.equal((await call('import',{requestId:'import-first'})).status,202);
 let status=await poll(call);assert.equal(status.import.eligible,false);assert.equal(status.setup.capture.provenance,'software-fixture');
 const request={...fixture.request,importId:status.import.importId};
 const missing=await call('setup',{...request,evidence:[]});assert.equal(missing.status,400);assert.match(missing.body.error,/every original/);
 const changed=await call('setup',{...request,evidence:[{name:fixture.descriptor.path,base64:Buffer.from('incorrect').toString('base64')}]});assert.equal(changed.status,400);assert.match(changed.body.error,/SHA-256/);
 assert.equal((await call('setup',{...request,profile:{...request.profile,gain:2}})).status,400);
 const notJson=await call('setup',{...request,packageBase64:Buffer.from('not json').toString('base64')});
 assert.equal(notJson.status,400);assert.match(notJson.body.error,/supported calibration package/);
 assert.equal((await call('setup',{...request,evidence:[{name:'../evidence',base64:fixture.evidence.toString('base64')}]})).status,400);
 const wrong=structuredClone(fixture.calibration);wrong.calibration.frequency_hz[0]+=1;
 const grid=await call('setup',{...request,requestId:'wrong-grid',packageBase64:Buffer.from(JSON.stringify(wrong)).toString('base64')});
 assert.equal(grid.status,400);assert.match(grid.body.error,/verification failed: Selected full-response grid differs from calibration/);
 assert.equal((await call('setup',{...request,requestId:'reserved',evidence:[{name:'verification',base64:fixture.evidence.toString('base64')}]})).status,400);
 // Failed attempts, including one that failed during verification, leave no setup folder or evidence copy.
 assert.deepEqual(await setups(),[]);
 await assert.rejects(readFile(join(fixture.dataRoot,'probe-setup-current.json')),error=>error.code==='ENOENT');
 // Crash leftovers older than any verification are swept; a recent staging folder may be another process's save.
 const setupsRoot=join(fixture.dataRoot,'probe-setups'),old=new Date(Date.now()-3600e3);
 for(const name of ['.staging-stale','.staging-recent'])await mkdir(join(setupsRoot,name),{recursive:true});
 await writeFile(join(fixture.dataRoot,'probe-setup-stale.pending'),'{}');
 await utimes(join(setupsRoot,'.staging-stale'),old,old);await utimes(join(fixture.dataRoot,'probe-setup-stale.pending'),old,old);
 await mkdir(join(setupsRoot,'leftover'));
 const leftover=await call('setup',{...request,requestId:'leftover'});assert.equal(leftover.status,400);assert.match(leftover.body.error,/exists without a saved receipt/);
 await rm(join(setupsRoot,'leftover'),{recursive:true});
 assert.deepEqual((await readdir(setupsRoot)).sort(),['.staging-recent']);await assert.rejects(readFile(join(fixture.dataRoot,'probe-setup-stale.pending')),{code:'ENOENT'});
 await rm(join(setupsRoot,'.staging-recent'),{recursive:true});
 const saved=await call('setup',request);assert.equal(saved.status,200);assert.equal(saved.body.setup.eligible,true);assert.equal(saved.body.setup.includedInFit,false);assert.equal(saved.body.setup.calibrationAuthenticityVerified,false);
 assert.equal((await call('setup',request)).status,200);
 status=(await call('status')).body;assert.equal(status.setup.setup.setupId,'setup-one');assert.equal(status.import.eligible,false);assert.equal(status.canFit,false);
 assert.equal((await call('import',{requestId:'import-calibrated'})).status,202);
 status=await poll(call);assert.equal(status.import.eligible,true);assert.equal(status.import.setupId,'setup-one');assert.equal(status.import.setupConfigurationSha256,saved.body.setup.configurationSha256);assert.equal(status.measurement.includedInFit.value,false);assert.equal(status.currentModelId,null);
 const imported=JSON.parse(await readFile(join(fixture.dataRoot,'probe-imports',status.import.importId,'science/probe-science-document.json')));assert.equal(imported.trials[0].source.kind,'synthetic-fixture');assert.deepEqual(imported.trials[0].calibration.frequency_hz,fixture.calibration.calibration.frequency_hz);
 const original=await readFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'));await writeFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'),'{}');
 status=(await call('status')).body;assert.match(status.setup.error,/could not be verified/);
 await writeFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'),original);
 assert.deepEqual(await setups(),['setup-one']);
});

test('a human recording stays ineligible whether a declared-measured package arrives through setup or a private configuration',async t=>{
 const {fixture,call,setups}=await serve(t,device('human-recording'));
 assert.equal((await call('import',{requestId:'import-human'})).status,202);
 let status=await poll(call);assert.equal(status.setup.capture.provenance,'human-recording');assert.equal(status.import.eligible,false);assert.match(status.fitBlockedReason,/Human recordings cannot be fitted/);
 assert.match((await call('setup',null)).body.error,/Probe import changed/);
 const refused=await call('setup',declaredMeasured(fixture,status.import.importId));
 assert.equal(refused.status,400);assert.equal(refused.body.error,`Calibration is not eligible: ${DECLARED_CALIBRATION_REASON}`);
 assert.deepEqual(await setups(),[]);await assert.rejects(readFile(join(fixture.dataRoot,'probe-setup-current.json')),{code:'ENOENT'});
 // The same package hand-written as the legacy private configuration hits the same importer gate.
 const pkg=JSON.parse(Buffer.from(declaredMeasured(fixture).packageBase64,'base64'));
 await writeFile(join(fixture.dataRoot,fixture.descriptor.path),fixture.evidence);
 await writeFile(join(fixture.dataRoot,'probe-science-config.json'),JSON.stringify({...pkg,kind:'probe_science_import_configuration',trial_id:'fixture-probe',pose:'a',pose_state:'held-quiet',placement:fixture.placement,
  capture_binding:{manifest_sha256:status.setup.capture.manifestSha256,pose:'a',placement_id:fixture.placement.placement_id,route_id:'fixture-route',native_route_signature:'declared-route'}}));
 assert.equal((await call('import',{requestId:'import-legacy'})).status,202);
 status=await poll(call);assert.equal(status.import.eligible,false);assert.deepEqual(status.import.reasons,[DECLARED_CALIBRATION_REASON]);assert.equal(status.canFit,false);
});

test('a reference-object capture still freezes a declared-measured setup and imports eligible',async t=>{
 const {fixture,call}=await serve(t,device('physical-reference'));
 assert.equal((await call('import',{requestId:'import-reference'})).status,202);
 let status=await poll(call);
 const saved=await call('setup',declaredMeasured(fixture,status.import.importId));
 assert.equal(saved.status,200);assert.equal(saved.body.setup.provenance,'physical-reference');assert.equal(saved.body.setup.calibrationAuthenticityVerified,false);
 assert.equal((await call('import',{requestId:'import-reference-calibrated'})).status,202);
 status=await poll(call);assert.equal(status.import.eligible,true);assert.equal(status.import.setupId,'declared-measured');
});

test('an iPhone-shaped capture relabelled as a software fixture is reported and refused as a human recording',async t=>{
 const {fixture,call,setups}=await serve(t,{manifest:{provenance:'software-fixture',route:{output:'Speaker'},calibration:{placementId:'fixture-placement',deviceResponseCalibrated:false}}});
 assert.equal((await call('import',{requestId:'import-relabelled'})).status,202);
 const status=await poll(call);
 assert.equal(status.setup.capture.provenance,'human-recording');assert.equal(status.setup.capture.declaredProvenance,'software-fixture');assert.equal(status.measurement.provenance,'human-recording');
 const refused=await call('setup',{...fixture.request,importId:status.import.importId});
 assert.equal(refused.status,400);assert.match(refused.body.error,/declared, not measured.*Manifest says software-fixture but carries iPhone recorder fields \(route, calibration.deviceResponseCalibrated\)/);
 assert.deepEqual(await setups(),[]);
});
