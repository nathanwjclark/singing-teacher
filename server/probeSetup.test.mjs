import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProbeRoutes} from './probe.mjs';
import {createProbeSetupFixture} from '../tests/helpers/probe-setup-fixture.mjs';

async function poll(call){
 for(let i=0;i<200;i++){
  const result=await call('status');
  if(!result.body.busy)return result.body;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 throw Error('Probe processing did not complete');
}

test('actual route verifies original calibration, atomically saves setup and reimports with immutable lineage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'probe-setup-route-'));let server;
 try{
  const fixture=await createProbeSetupFixture(root);
  const routes=createProbeRoutes({repo:process.cwd(),dataRoot:fixture.dataRoot,json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}});
  server=http.createServer(async(req,res)=>{if(!await routes(req,res,new URL(req.url,'http://localhost')))res.end();});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/probe/`;
  async function call(action,body){const response=await fetch(base+action,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
  assert.equal((await call('import',{requestId:'import-first'})).status,202);
  let status=await poll(call);assert.equal(status.import.eligible,false);assert.equal(status.setup.capture.provenance,'software-fixture');
  const request={...fixture.request,importId:status.import.importId};
  const missing=await call('setup',{...request,evidence:[]});assert.equal(missing.status,400);assert.match(missing.body.error,/every original/);
  const changed=await call('setup',{...request,evidence:[{name:fixture.descriptor.path,base64:Buffer.from('incorrect').toString('base64')}]});assert.equal(changed.status,400);assert.match(changed.body.error,/SHA-256/);
  assert.equal((await call('setup',{...request,profile:{...request.profile,gain:2}})).status,400);
  assert.equal((await call('setup',{...request,evidence:[{name:'../evidence',base64:fixture.evidence.toString('base64')}]})).status,400);
  const wrong=structuredClone(fixture.calibration);wrong.calibration.frequency_hz[0]+=1;
  assert.equal((await call('setup',{...request,requestId:'wrong-grid',packageBase64:Buffer.from(JSON.stringify(wrong)).toString('base64')})).status,400);
  await assert.rejects(readFile(join(fixture.dataRoot,'probe-setup-current.json')),error=>error.code==='ENOENT');
  const saved=await call('setup',request);assert.equal(saved.status,200);assert.equal(saved.body.setup.eligible,true);assert.equal(saved.body.setup.includedInFit,false);assert.equal(saved.body.setup.calibrationAuthenticityVerified,false);
  assert.equal((await call('setup',request)).status,200);
  status=(await call('status')).body;assert.equal(status.setup.setup.setupId,'setup-one');assert.equal(status.import.eligible,false);assert.equal(status.canFit,false);
  assert.equal((await call('import',{requestId:'import-calibrated'})).status,202);
  status=await poll(call);assert.equal(status.import.eligible,true);assert.equal(status.import.setupId,'setup-one');assert.equal(status.import.setupConfigurationSha256,saved.body.setup.configurationSha256);assert.equal(status.measurement.includedInFit.value,false);assert.equal(status.currentModelId,null);
  const imported=JSON.parse(await readFile(join(fixture.dataRoot,'probe-imports',status.import.importId,'science/probe-science-document.json')));assert.equal(imported.trials[0].source.kind,'synthetic-fixture');assert.deepEqual(imported.trials[0].calibration.frequency_hz,fixture.calibration.calibration.frequency_hz);
  const original=await readFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'));await writeFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'),'{}');
  status=(await call('status')).body;assert.match(status.setup.error,/could not be verified/);
  await writeFile(join(fixture.dataRoot,'probe-setups/setup-one/profile.json'),original);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
