import './environment.mjs';
import {createMotionRoutes} from './motion.mjs';
import {createSessionExportRoutes} from './sessionExport.mjs';
import {createProbeRoutes} from './probe.mjs';
import {createAstraRoutes} from './astra.mjs';
import {createLearningRoutes} from './learningMemory.mjs';
import http from 'node:http';
import {createAstraReviewRoutes} from './astraReview.mjs';
import {scienceRoutes} from './science.mjs';
import {createVoiceCaptureRoutes} from './voiceCapture.mjs';
import {createNativePullRoutes} from './nativePull.mjs';
import https from 'node:https';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {networkInterfaces,hostname} from 'node:os';
import {createScienceProxy} from './science-proxy.mjs';
import {tongueSnapshotError} from './tongueSnapshot.mjs';

const port=Number(process.env.PORT||5173),host=process.env.HOST||'127.0.0.1';
const root=resolve(import.meta.dirname,'../dist'),dataRoot=resolve(process.env.LOCAL_DATA_DIR||'.local-data');
const sessions=new Map();
const scienceProxy=createScienceProxy({url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN});
const localAddresses=new Set(['127.0.0.1','::1',...Object.values(networkInterfaces()).flat().filter(Boolean).map(n=>n.address)]);
const allowedHosts=new Set(['localhost','[::1]',hostname().toLowerCase(),hostname().toLowerCase()+'.local',...localAddresses,...(process.env.PHONE_BASE_URL?[new URL(process.env.PHONE_BASE_URL).hostname]:[])]);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.bin':'application/octet-stream','.md':'text/plain','.wasm':'application/wasm','.mp4':'video/mp4'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
const handleScience=scienceRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleVoiceCapture=createVoiceCaptureRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleNativePull=createNativePullRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleAstraReview=createAstraReviewRoutes({dataRoot,json});
const handleLearning=createLearningRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleAstra=createAstraRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleProbe=createProbeRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});
const handleSessionExport=createSessionExportRoutes({dataRoot,json});
const handleMotion=createMotionRoutes({dataRoot,json});
let handlePhonation;
let handleSource;
let handleLidar;
let handleVisual;
try{const {createVisualLikelihoodRoutes}=await import('./visualLikelihood.mjs');handleVisual=createVisualLikelihoodRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});}
catch{handleVisual=async(req,res,url)=>{if(!url.pathname.startsWith('/api/visual/'))return false;json(res,req.method==='GET'?200:503,{enabled:false,busy:false,reason:'Optional visual comparison is unavailable',baselinePreserved:true});return true;};}
let handleTeaching;
try{const {createTeachingRoutes}=await import('./teaching.mjs');handleTeaching=createTeachingRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});}
catch{handleTeaching=async(req,res,url)=>{if(!url.pathname.startsWith('/api/teaching/'))return false;json(res,req.method==='GET'?200:503,{enabled:false,busy:false,reason:'Optional model illustration unavailable; general explanations remain available'});return true;};}
try{const {createLidarRoutes}=await import('./lidar.mjs');handleLidar=createLidarRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});}
catch{handleLidar=async(req,res,url)=>{if(!url.pathname.startsWith('/api/lidar/'))return false;json(res,req.method==='GET'?200:503,{enabled:false,running:false,reason:'Optional LiDAR module is unavailable',baselinePreserved:true});return true;};}
try{const {createSourceInferenceRoutes}=await import('./sourceInference.mjs');handleSource=createSourceInferenceRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});}
catch{handleSource=async(req,res,url)=>{if(!url.pathname.startsWith('/api/source/'))return false;json(res,req.method==='GET'?200:503,{enabled:false,running:false,reason:'Optional source module is unavailable',baselinePreserved:true});return true;};}
try{const {createPhonationRoutes}=await import('./phonation.mjs');handlePhonation=createPhonationRoutes({repo:resolve(import.meta.dirname,'..'),dataRoot,json});}
catch{handlePhonation=async(req,res,url)=>{if(!url.pathname.startsWith('/api/phonation/'))return false;json(res,req.method==='GET'?200:503,{measurement:{status:'unsupported',reason:'Optional phonation module is unavailable'},inference:{status:'disabled'},coaching:{status:'disabled'},baselineScoring:'unchanged'});return true;};}
const engineAvailable=await access(process.env.SINGING_PYTHON||resolve(import.meta.dirname,'../science/.venv/bin/python')).then(()=>true).catch(()=>false);
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}}
function phoneBase(value){if(!value)return null;const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname))throw Object.assign(Error('Use a phone-reachable trusted HTTPS URL, not localhost'),{status:400});return u.origin}
const serverHandler=async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(!allowedHosts.has(new URL('http://'+req.headers.host).hostname.toLowerCase()))return json(res,403,{error:'Unrecognized local host. Configure PHONE_BASE_URL for this hostname.'});
  // Refuse cross-origin browser writes; pairing tokens authorize phone routes.
  if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Cross-origin write refused'});
  if(await handleAstraReview(req,res,url))return;
  if(await handleLearning(req,res,url))return;
  if(await handleAstra(req,res,url))return;
  if(await handleProbe(req,res,url))return;
  if(await handleSessionExport(req,res,url))return;
  if(await handlePhonation(req,res,url))return;
  if(await handleSource(req,res,url))return;
  if(await handleLidar(req,res,url))return;
  if(await handleVisual(req,res,url))return;
  if(await handleTeaching(req,res,url))return;
  if(await handleMotion(req,res,url))return;
  if(await handleScience(req,res,url))return;
  if(await handleVoiceCapture(req,res,url))return;
  if(await handleNativePull(req,res,url))return;
  if(url.pathname.startsWith('/api/science/')){
    if(!scienceProxy)return json(res,503,{error:'Scientific service is not configured'});
    return await scienceProxy(req,res);
  }
  if(url.pathname==='/api/status')return json(res,200,{local:true,https:!!process.env.HTTPS_CERT,phoneBaseUrl:process.env.PHONE_BASE_URL||null,engineAvailable,scienceConfigured:!!scienceProxy,scienceHealthPath:scienceProxy?'/api/science/health':null,phoneSetupUrl:process.env.PHONE_SETUP_URL||null,certificateFingerprint:process.env.PHONE_CA_FINGERPRINT||null});
  if(url.pathname==='/api/pair'&&req.method==='POST'){
    const remote=req.socket.remoteAddress;
    if(!localAddresses.has(remote?.replace(/^::ffff:/,'')))return json(res,403,{error:'Create pairing from this computer'});
    const input=await body(req),base=phoneBase(input.baseUrl||process.env.PHONE_BASE_URL);
    const sessionId=randomUUID(),token=randomBytes(24).toString('hex');
    const session={sessionId,token,createdAt:new Date().toISOString(),expiresAt:Date.now()+12*3600_000,snapshots:[],signals:[],sequence:0};sessions.set(sessionId,session);
    return json(res,201,{sessionId,token,pairUrl:base?`${base}/phone?session=${sessionId}&token=${token}`:'',secure:!!base,connectionHint:base?'Phone and computer must reach this HTTPS address.':'Set a phone-reachable trusted HTTPS URL. No public server is required on the same Wi-Fi.'});
  }
  const route=/^\/api\/pair\/([a-zA-Z0-9-]+)(?:\/(snapshots|signals))?$/.exec(url.pathname);
  if(route){const session=sessions.get(route[1]);if(!session||session.expiresAt<Date.now())return json(res,404,{error:'Pairing expired. Create a new QR code.'});
    const token=url.searchParams.get('token')||req.headers.authorization?.replace(/^Bearer /,'');if(!equal(token,session.token))return json(res,403,{error:'Invalid pairing token'});
    const summary=()=>({sessionId:session.sessionId,createdAt:session.createdAt,snapshotCount:session.snapshots.length,snapshots:session.snapshots});
    if(!route[2]&&req.method==='GET')return json(res,200,summary());
    if(route[2]==='signals'){
      if(req.method==='GET'){const role=url.searchParams.get('role'),after=Number(url.searchParams.get('after')||0);if(!['desktop','phone'].includes(role))return json(res,400,{error:'Invalid role'});return json(res,200,{messages:session.signals.filter(m=>m.from!==role&&m.id>after).map(({id,signal})=>({id,signal}))})}
      if(req.method==='POST'){const input=await body(req);if(!['desktop','phone'].includes(input.from)||!input.signal||JSON.stringify(input.signal).length>100_000)return json(res,400,{error:'Invalid signal'});session.signals.push({id:++session.sequence,from:input.from,signal:input.signal});session.signals=session.signals.slice(-200);return json(res,201,{ok:true})}
    }
    if(route[2]==='snapshots'&&req.method==='POST'){
      const input=await body(req);const match=/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(input.imageDataUrl||'');if(!match||typeof input.stepId!=='string')return json(res,400,{error:'Expected a captured JPEG/PNG image and step ID'});
      const region=input.visibleTongueRegion,tongueError=tongueSnapshotError(input.landmarks?.tongue,region);if(tongueError)return json(res,400,{error:tongueError});
      const id=randomUUID(),dir=resolve(dataRoot,'captures',session.sessionId);await mkdir(dir,{recursive:true});const file=`${id}.${match[1]==='jpeg'?'jpg':'png'}`;await writeFile(resolve(dir,file),Buffer.from(match[2],'base64'));
      const snapshot={id,stepId:input.stepId,capturedAt:input.capturedAt,width:input.width,height:input.height,landmarks:input.landmarks,visibleTongueRegion:region??null,source:'phone-rgb',evidence:input.evidence,depth:{available:false,reason:'Browser capture does not expose measured hardware depth'},file};
      await writeFile(resolve(dir,`${id}.json`),JSON.stringify(snapshot,null,2));session.snapshots.push(snapshot);return json(res,201,{snapshot,...summary()});
    }
    return json(res,405,{error:'Method not allowed'});
  }
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'Unknown API route'});
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  let file=resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==root&&!file.startsWith(root+'/'))return json(res,403,{error:'Invalid path'});
  if(!extname(file))file=resolve(root,'index.html');
  let content;try{content=await readFile(file)}catch{return json(res,404,{error:'File not found. Run npm run build first.'})}
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:content);
}catch(error){json(res,error.status||500,{error:error.status?error.message:'Local request failed'});if(!error.status)console.error(error.message)}};
await mkdir(dataRoot,{recursive:true});
const server=process.env.HTTPS_CERT&&process.env.HTTPS_KEY?https.createServer({cert:await readFile(process.env.HTTPS_CERT),key:await readFile(process.env.HTTPS_KEY)},serverHandler):http.createServer(serverHandler);
server.listen(port,host,()=>console.log(`Local singing teacher: ${process.env.HTTPS_CERT?'https':'http'}://${host}:${server.address().port}`));
setInterval(()=>{for(const [id,s] of sessions)if(s.expiresAt<Date.now())sessions.delete(id)},60_000).unref();

if(process.env.DESKTOP_PORT)http.createServer(serverHandler).listen(Number(process.env.DESKTOP_PORT),'127.0.0.1',()=>console.log(`Desktop: http://127.0.0.1:${process.env.DESKTOP_PORT}`));
if(process.env.PHONE_SETUP_PORT){
  const profile=await readFile(process.env.PHONE_PROFILE);
  const setupPath=`/setup/${process.env.PHONE_SETUP_TOKEN}`;
  const page=`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Singing Teacher private HTTPS</title><style>body{font:17px system-ui;line-height:1.55;max-width:600px;padding:24px;margin:auto;color:#e3efdc;background:#14221b}a{color:#c5ef9c}li{margin:18px 0}code{overflow-wrap:anywhere;font-size:11px}</style><h1>Set up your phone</h1><p>Stay on the same Wi-Fi as your computer. This installs only its local certificate, not device management.</p><ol><li><a href="${setupPath}/certificate.mobileconfig">Download the certificate profile</a> and allow the download.</li><li>Open Settings → General → VPN &amp; Device Management. Install <b>Singing Teacher Local HTTPS</b>.</li><li>Open Settings → General → About → Certificate Trust Settings. Enable full trust for <b>Singing Teacher Local CA</b>.</li><li>Return to the computer’s <b>Connect phone / QR</b> window and scan the pairing QR.</li></ol><p><a href="https://support.apple.com/102390">Apple’s certificate instructions</a></p><p>Certificate SHA-256:<br><code>${process.env.PHONE_CA_FINGERPRINT}</code></p><p>You can remove the profile in VPN &amp; Device Management when you stop using this local setup.</p></html>`;
  http.createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);res.end();return}
    if(req.url===setupPath+'/certificate.mobileconfig'){res.writeHead(200,{'Content-Type':'application/x-apple-aspen-config','Content-Disposition':'attachment; filename="singing-teacher.mobileconfig"','Cache-Control':'no-store'});res.end(profile)}
    else if(req.url===setupPath){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page)}
    else{res.writeHead(404);res.end('Not found')}
  }).listen(Number(process.env.PHONE_SETUP_PORT),host,()=>console.log(`Phone certificate setup: ${process.env.PHONE_SETUP_URL}`));
}
