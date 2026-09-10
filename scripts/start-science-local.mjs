/** Start the prototype's local app and scientific worker with an ephemeral secret. */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const python=process.env.SINGING_PYTHON||resolve(root,'science/.venv/bin/python');
const port=Number(process.env.SCIENCE_PORT||8766);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('SCIENCE_PORT must be an integer from 1024 to 65535');
if(!existsSync(resolve(root,'dist/index.html')))throw Error('Run npm run build before npm run science:local');
const token=randomBytes(32).toString('hex');
const env={...process.env,PYTHONPATH:[root,resolve(root,'science/src'),process.env.PYTHONPATH].filter(Boolean).join(':'),
  SINGING_SCIENCE_TOKEN:token,SCIENCE_TOKEN:token,SCIENCE_URL:`http://127.0.0.1:${port}`};
const children=[];let stopping=false;
function stop(code){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL')},2000).unref()}
function start(command,args){const child=spawn(command,args,{cwd:root,env,stdio:'inherit'});children.push(child);child.on('error',error=>{console.error(`Local service could not start: ${error.code||'process error'}`);stop(1)});child.on('exit',(code,signal)=>{if(!stopping)stop(code??(signal?1:0))});return child}
start(python,['-m','singing_physics.http_service','--root',resolve(root,process.env.SCIENCE_DATA_DIR||'.local-data/science-jobs'),'--port',String(port)]);
start(process.execPath,[process.env.PRIVATE_HTTPS==='1'?'scripts/start-local-https.mjs':'server/local.mjs']);
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
