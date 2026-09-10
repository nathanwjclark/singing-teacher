import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const files=new Set(['space-diff.json','tract0.obj','tract0.mtl','tract.svg','geometry.json','manifest.json','fit.json','forecast.json','summary.json']);
const types={obj:'text/plain',mtl:'text/plain',svg:'image/svg+xml',json:'application/json'};
export function scienceRoutes({repo,dataRoot,json}) {
  let running=null,starting=false;
  const index=resolve(dataRoot,'science-current.json');
  const save=async value=>{const temporary=index+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,index)};
  async function status(){try{return JSON.parse(await readFile(index,'utf8'))}catch{return {status:'not-run'}}}
  const terminate=()=>{if(running){try{process.kill(-running.pid,'SIGTERM')}catch{/* already exited */}}};
  process.once('exit',terminate);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{terminate();process.exit(0)});
  return async(req,res,url)=>{
    if(url.pathname!=='/api/tongue-profile'&&!url.pathname.startsWith('/api/tongue-neural/')&&!url.pathname.startsWith('/api/science'))return false;
    if(!['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))){json(res,403,{error:'Private model data is available only on this Mac'});return true}
    if(url.pathname.startsWith('/api/tongue-neural/')&&req.method==='GET'){
      const name={'/api/tongue-neural/model':'tongue.onnx','/api/tongue-neural/manifest':'manifest.json'}[url.pathname];
      if(!name){json(res,404,{error:'Unknown tongue model artifact'});return true;}
      try{const data=await readFile(resolve(dataRoot,'tongue-neural/current',name));res.writeHead(200,{'Content-Type':name.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)}catch{json(res,404,{error:'Personal tongue model unavailable'})}return true;
    }
    if(url.pathname==='/api/tongue-profile'&&req.method==='GET'){
      try{const profile=JSON.parse(await readFile(resolve(dataRoot,'tongue-review/live-tip-profile.json'),'utf8'));json(res,200,profile)}catch{json(res,404,{error:'No private tongue profile installed'})}return true;
    }
    if(url.pathname==='/api/science/status'&&req.method==='GET'){
      const state=await status();if(state.status==='running'&&!running)state.status='interrupted';
      if(state.status==='succeeded'&&state.runId){try{state.result=JSON.parse(await readFile(resolve(dataRoot,'science-runs',state.runId,'summary.json'),'utf8'))}catch{state.status='failed';state.error='Published result unavailable'}}
      json(res,200,state);return true;
    }
    if(url.pathname==='/api/science/asset'&&req.method==='GET'){
      const run=url.searchParams.get('run'),name=url.searchParams.get('name');
      if(!/^[A-Za-z0-9-]{1,100}$/.test(run||'')||!files.has(name)){json(res,400,{error:'Unknown model artifact'});return true}
      try{const data=await readFile(resolve(dataRoot,'science-runs',run,name));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(data)}catch{json(res,404,{error:'Artifact unavailable'})}return true;
    }
    if(url.pathname==='/api/science/run'&&req.method==='POST'){
      if(running||starting){json(res,409,{error:'A scientific job is already running'});return true}
      if(url.search||Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding']){json(res,400,{error:'This action takes no parameters'});return true}
      starting=true;try{
      let config;try{config=JSON.parse(await readFile(resolve(dataRoot,'science-input.json'),'utf8'))}catch{json(res,409,{error:'No verified local voice capture configured'});return true}
      const source=resolve(dataRoot,config.sourceDirectory||'');
      if(!source.startsWith(dataRoot+'/')){json(res,400,{error:'Voice source must remain in the private data directory'});return true}
      const runId='run-'+Date.now()+'-'+randomUUID().slice(0,8),output=resolve(dataRoot,'science-runs',runId);
      await mkdir(resolve(dataRoot,'science-runs'),{recursive:true,mode:0o700});
      const record={status:'running',runId,startedAt:new Date().toISOString()};await save(record);
      const python=process.env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python');
      const child=spawn(python,[resolve(repo,'science/scripts/live_capture_jobs.py'),'--source',source,'--output',output],{cwd:repo,env:{...process.env,PYTHONPATH:repo+':'+resolve(repo,'science/src')},detached:true,stdio:['ignore','pipe','pipe']});running=child;
      let logs='',launchError=false;for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-100_000)});
      const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{/* exited */}},570_000);timer.unref();
      child.once('error',()=>{launchError=true});
      child.once('close',async code=>{clearTimeout(timer);running=null;await mkdir(output,{recursive:true,mode:0o700});await writeFile(resolve(output,'process.log'),logs,{mode:0o600});await save({...record,status:code===0?'succeeded':'failed',finishedAt:new Date().toISOString(),...(code===0?{}:{error:launchError?'Scientific Python could not start':'Scientific job failed; private output and process.log retained'})})});
      json(res,202,record);return true;
      }finally{starting=false}
    }
    json(res,405,{error:'Method not allowed'});return true;
  };
}
