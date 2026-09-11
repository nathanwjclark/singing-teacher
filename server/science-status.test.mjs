import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,lstat,open,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scienceRoutes} from './science.mjs';

test('a fit that finishes while its status is being read is reported running, never interrupted',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'science-status-'));
 const saved={python:process.env.SINGING_PYTHON,release:process.env.SCIENCE_STATUS_TEST_RELEASE};
 try{
  // The job runs a real child process that waits for a release file, so the test decides when it exits.
  const release=join(dataRoot,'release'),job=join(dataRoot,'job.sh');
  await writeFile(job,'#!/bin/sh\nwhile [ ! -f "$SCIENCE_STATUS_TEST_RELEASE" ]; do sleep 0.02; done\n');await chmod(job,0o700);
  Object.assign(process.env,{SINGING_PYTHON:job,SCIENCE_STATUS_TEST_RELEASE:release});
  await mkdir(join(dataRoot,'capture'));await writeFile(join(dataRoot,'science-input.json'),JSON.stringify({sourceDirectory:'capture'}));
  let reply;const route=scienceRoutes({repo:process.cwd(),dataRoot,json:(_res,status,body)=>{reply={status,body};}});
  const call=async(method='GET',path='status')=>{await route({method,headers:{},socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost/api/science/'+path));return reply;};
  const started=await call('POST','run');assert.equal(started.status,202);
  const stale=await readFile(join(dataRoot,'science-current.json'),'utf8');
  // Hold the status read open on a FIFO while the job exits and publishes its result.
  const index=join(dataRoot,'science-current.json');await unlink(index);execFileSync('mkfifo',[index]);
  const pending=call();
  const writer=await open(index,'w');
  await writeFile(release,'');
  for(let i=0;i<1000&&!(await lstat(index)).isFile();i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(JSON.parse(await readFile(index,'utf8')).status,'succeeded');
  await new Promise(r=>setTimeout(r,20));
  await writer.write(stale);await writer.close();
  const during=await pending;
  assert.equal(during.body.status,'running');
  assert.notEqual((await call()).body.status,'interrupted');
 }finally{
  for(const [name,value] of [['SINGING_PYTHON',saved.python],['SCIENCE_STATUS_TEST_RELEASE',saved.release]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  await rm(dataRoot,{recursive:true,force:true});
 }
});
