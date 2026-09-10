/** Actual desktop server -> HTTP transport -> isolated native job. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const p=server.address().port;await new Promise(resolve=>server.close(resolve));return p}
test('desktop proxy executes native jobs and session commands without exposing token', {timeout:60_000},async()=>{
  const root=process.cwd(),data=await mkdtemp(join(tmpdir(),'science-http-integration-'));
  const sciencePort=await port(),appPort=await port(),token=randomBytes(32).toString('hex');
  const python=process.env.SINGING_PYTHON||resolve(root,'science/.venv/bin/python');
  const children=[],logs=[];
  const run=(program,args,env)=>{const child=spawn(program,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',b=>logs.push(b.toString()));child.stderr.on('data',b=>logs.push(b.toString()));return child};
  const base=`http://127.0.0.1:${appPort}`;
  async function call(path,body){const response=await fetch(base+'/api/science'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()}}
  try{
    run(python,['-m','singing_physics.http_service','--root',join(data,'science'),'--port',String(sciencePort)],{PYTHONPATH:`${root}:${root}/science/src`,SINGING_SCIENCE_TOKEN:token});
    run(process.execPath,['server/local.mjs'],{PORT:String(appPort),HOST:'127.0.0.1',LOCAL_DATA_DIR:join(data,'app'),SCIENCE_URL:`http://127.0.0.1:${sciencePort}`,SCIENCE_TOKEN:token});
    let ready=false;
    for(let i=0;i<100;i++){try{if((await call('/health')).status===200){ready=true;break}}catch{}await pause(100)}
    assert.ok(ready,'Scientific server did not become ready');
    // B's app routes and A's worker routes must coexist under the same prefix.
    assert.deepEqual((await call('/status')).data,{status:'not-run'});
    assert.equal((await call('/outcome')).status,409);
    const unconfiguredRun=await fetch(base+'/api/science/run',{method:'POST'});
    assert.equal(unconfiguredRun.status,409);
    assert.match((await unconfiguredRun.json()).error,/No verified local voice/);
    const missingAsset=await fetch(base+'/api/science/asset?run=missing&name=geometry.json');
    assert.equal(missingAsset.status,404);
    assert.equal((await fetch(base+'/api/tongue-profile')).status,404);
    const appStatus=await fetch(base+'/api/status').then(r=>r.json());
    assert.equal(appStatus.scienceConfigured,true);
    assert.equal(appStatus.scienceHealthPath,'/api/science/health');
    const created=await call('/jobs',{request:{operation:'forward',parameters:{pose:'a',duration_s:.1}},idempotency_key:'real-forward'});
    assert.equal(created.status,202,JSON.stringify(created.data));
    const id=created.data.id ?? created.data.job_id;
    assert.ok(id,JSON.stringify(created.data));
    let state;
    for(let i=0;i<100;i++){state=await call(`/jobs/${id}`);if(['succeeded','failed','cancelled'].includes(state.data.status))break;await pause(100)}
    assert.equal(state.data.status,'succeeded',JSON.stringify(state.data));
    const result=await call(`/jobs/${id}/result`);assert.equal(result.status,200);
    assert.ok(JSON.stringify(result.data).includes('sample_rate_hz'));
    const exports=await call(`/jobs/${id}/exports`);assert.equal(exports.status,200);
    assert.equal(exports.data.job_id,id);
    assert.ok(exports.data.files['tract0.obj'].byteLength>0);
    const session=await call('/sessions/demo/state');assert.equal(session.status,200);
    const rejected=await call('/sessions/demo/commands',{action:'ingest_calibration',command_id:'bad',expected_version:999,document:{}});
    assert.equal(rejected.status,409);
    assert.ok(!JSON.stringify({created,result,session}).includes(token));
    assert.ok(!logs.join('').includes(token));
  }finally{
    for(const child of children){child.kill('SIGTERM')}
    await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve()},2000).unref()})));
    await rm(data,{recursive:true,force:true});
  }
});
