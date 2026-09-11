import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scienceRoutes} from './science.mjs';

test('fit requests accept only an allowlisted scoring objective and record it',async()=>{
  const dataRoot=await mkdtemp(join(tmpdir(),'science-run-'));
  let result;
  const route=scienceRoutes({repo:process.cwd(),dataRoot,bodyTimeoutMs:200,json:(_,status,body)=>{result={status,body}}});
  const post=async(body,{type='application/json',length,query=''}={})=>{
    const bytes=body===undefined?Buffer.alloc(0):Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const headers={'content-length':String(length??bytes.length),...(type?{'content-type':type}:{})};
    await route({method:'POST',headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(bytes.length)yield bytes}},{},new URL('http://localhost/api/science/run'+query));
    return result;
  };
  const oldPython=process.env.SINGING_PYTHON;
  try{
    for(const [body,options] of [[{objective:'unknown-v9'}],[{objective:'multires-log-spectrum-v1',budget:1000}],[['multires-log-spectrum-v1']],
      ['objective=multires-log-spectrum-v1',{type:'application/x-www-form-urlencoded'}],[{objective:'x'.repeat(300)}],['{"objective":',{}]]){
      const response=await post(body,options);
      assert.equal(response.status,400,JSON.stringify(body));
    }
    assert.match((await post({objective:'unknown-v9'})).body.error,/canonical-coarse-v1 or multires-log-spectrum-v1/);
    assert.equal((await post({objective:'canonical-coarse-v1'},{query:'?objective=x'})).status,400);
    assert.equal((await post({objective:'canonical-coarse-v1'},{length:999})).status,400);
    // A client that declares a body and never sends it gets a timeout and does not hold the start slot.
    const stalled=route({method:'POST',headers:{'content-length':'40','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},
      [Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{})})},{},new URL('http://localhost/api/science/run'));
    const meanwhile=await post({objective:'canonical-coarse-v1'});
    assert.equal(meanwhile.status,409);assert.match(meanwhile.body.error,/No verified local voice capture/);
    await stalled;
    assert.equal(result.status,400);assert.match(result.body.error,/not received in time/);
    // A valid request passes validation and then needs a prepared capture.
    const unprepared=await post({objective:'multires-log-spectrum-v1'});
    assert.equal(unprepared.status,409);assert.match(unprepared.body.error,/No verified local voice capture/);
    await writeFile(join(dataRoot,'science-input.json'),JSON.stringify({sourceDirectory:'prepared-voice/example',evidenceKind:'development-fixture'}));
    // Dispatch identity only; the real capture pipeline runs in the browser and Python app tests.
    process.env.SINGING_PYTHON='/usr/bin/true';
    for(const [body,objective] of [[{objective:'multires-log-spectrum-v1'},'multires-log-spectrum-v1'],[undefined,'canonical-coarse-v1']]){
      const started=await post(body,body===undefined?{type:null}:{});
      assert.equal(started.status,202);assert.equal(started.body.objective,objective);
      for(let attempt=0;attempt<500;attempt++){
        const persisted=JSON.parse(await readFile(join(dataRoot,'science-current.json'),'utf8'));
        if(persisted.status!=='running')break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      const persisted=JSON.parse(await readFile(join(dataRoot,'science-current.json'),'utf8'));
      assert.equal(persisted.runId,started.body.runId);assert.equal(persisted.objective,objective);
    }
  }finally{
    if(oldPython===undefined)delete process.env.SINGING_PYTHON;else process.env.SINGING_PYTHON=oldPython;
    await rm(dataRoot,{recursive:true,force:true});
  }
});
