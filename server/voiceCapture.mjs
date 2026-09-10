import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const run=promisify(execFile);
export function createVoiceCaptureRoutes({repo,dataRoot,json}){
 let busy=false;
 return async(req,res,url)=>{
  if(url.pathname!=='/api/science/use-latest-capture')return false;
  let local=false;try{local=['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host)}catch{}
  if(!local){json(res,403,{error:'Use this action from the local app'});return true}
  if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true}
  if(busy){json(res,409,{error:'Capture preparation is already running'});return true}
  busy=true;
  try{
   if(url.search||req.headers['transfer-encoding']||!/^application\/json(?:;|$)/.test(req.headers['content-type']||''))throw Error('Expected a small JSON declaration');
   const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<1||length>1024)throw Error('Invalid declaration size');
   const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>1024)throw Error('Declaration too large');chunks.push(chunk)}
   if(count!==length)throw Error('Incomplete declaration');
   const body=JSON.parse(Buffer.concat(chunks).toString());
   if(!body||Object.keys(body).sort().join(',')!=='contains_external_excitation,pose,purpose'||body.contains_external_excitation!==false||!['calibration','outcome'].includes(body.purpose)||!['a','e','i','o','u'].includes(body.pose))throw Error('Declare purpose, vowel and no external excitation');
   const python=process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
   const result=await run(python,[join(repo,'science/scripts/prepare_voice_capture.py'),'--data-root',dataRoot,'--purpose',body.purpose,'--pose',body.pose],{cwd:repo,timeout:90000,maxBuffer:1024*1024});
   json(res,200,JSON.parse(result.stdout));
  }catch(error){const reason=error.stderr?.trim().split('\n').at(-1)?.replace(/^ValueError: /,'')||error.message;json(res,409,{error:reason})}finally{busy=false}
  return true;
 };
}
