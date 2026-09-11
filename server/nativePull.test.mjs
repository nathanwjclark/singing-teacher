import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createNativePullRoutes} from './nativePull.mjs';

// Input data only: devicectl cannot run on a Mac without full Xcode, so the injected runner writes the JSON files
// devicectl writes, in the shape Flutter's core_devices.dart and appium/node-devicectl parse. Identities are fictional.
const deviceId='0B1C2D3E-4F50-4A6B-8C7D-9E0F1A2B3C4D',name='probe-12345678-1234-1234-1234-123456789abc.zip';
const archive=Buffer.from('generated archive bytes for the native pull route test');
const phone={capabilities:[],identifier:deviceId,visibilityClass:'default',
 connectionProperties:{authenticationType:'manualPairing',isMobileDeviceOnly:false,pairingState:'paired',potentialHostnames:[],transportType:'wired',tunnelState:'connected',tunnelTransportProtocol:'tcp'},
 deviceProperties:{bootState:'booted',developerModeStatus:'enabled',name:'Test iPhone',osBuildUpdate:'23A100',osVersionNumber:'26.0'},
 hardwareProperties:{deviceType:'iPhone',ecid:1234567890123456,hardwareModel:'D83AP',platform:'iOS',productType:'iPhone16,1',serialNumber:'TESTSERIAL1',udid:'00008130-000A1B2C3D4E5F60'}};
const other={...phone,identifier:'9F8E7D6C-5B4A-4392-8170-6F5E4D3C2B1A',hardwareProperties:{...phone.hardwareProperties,udid:'00008130-0001112223334445'}};
const listing=(devices)=>({info:{arguments:['devicectl','list','devices'],commandType:'devicectl.list.devices',jsonVersion:2,outcome:'success',version:'477.29'},result:{devices}});
const files={info:{commandType:'devicectl.device.info.files',outcome:'success'},result:{files:[{name,relativePath:name,resources:{isDirectory:false,isSymbolicLink:false},metadata:{size:archive.length,lastModDate:'2026-09-10T12:00:00Z'}}]}};

async function serve(t,devices,{config={deviceId:deviceId.toLowerCase()},copied=archive}={}){
 const dataRoot=await mkdtemp(join(tmpdir(),'native-pull-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}));
 await writeFile(join(dataRoot,'iphone-device.json'),JSON.stringify(config));
 const calls=[];
 async function runProcess(command,args){
  calls.push([command,...args]);
  const output=args[args.indexOf('--json-output')+1];
  if(args[1]==='list'){if(devices instanceof Error)throw devices;await writeFile(output,typeof devices==='string'?devices:JSON.stringify(listing(devices)));}
  else if(args[2]==='info')await writeFile(output,JSON.stringify(files));
  else if(args[2]==='copy'){await writeFile(args[args.indexOf('--destination')+1],copied);await writeFile(output,'{}');}
  else throw Error(`Unexpected command ${command} ${args.join(' ')}`);
  return {stdout:'',stderr:''};
 }
 const routes=createNativePullRoutes({repo:process.cwd(),dataRoot,runProcess,json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}});
 const server=http.createServer(async(req,res)=>{if(!await routes(req,res,new URL(req.url,'http://localhost')))res.end();});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api/native-captures/`;
 const call=async(action,method='GET')=>{const response=await fetch(base+action,{method});return {status:response.status,body:await response.json()};};
 const jobs=async()=>(await readdir(dataRoot)).filter(name=>name.startsWith('usb-pull-'));
 return {dataRoot,calls,call,jobs};
}

test('a pull records the configured device, its connection and the container beside the existing receipt fields',async t=>{
 const {dataRoot,calls,call,jobs}=await serve(t,[other,phone]);
 const pulled=await call('pull','POST');assert.equal(pulled.status,200,JSON.stringify(pulled.body));
 const receipt=JSON.parse(await readFile(join(dataRoot,'native-pull-latest.json'),'utf8'));
 assert.equal(receipt.schemaVersion,'native-pull-receipt-2');
 assert.deepEqual(receipt.acquisition,{transport:'devicectl',connection:{transportType:'wired',tunnelState:'connected'},
  container:{domainType:'appDataContainer',bundleId:'com.singingteacher.depth',path:`Documents/${name}`},
  device:{coreDeviceId:deviceId,udid:'00008130-000A1B2C3D4E5F60',productType:'iPhone16,1',osVersion:'26.0'}});
 assert.deepEqual(receipt.signature,{status:'not-provided'});
 // Fields astra.mjs, lidar.mjs, controlLearning.mjs, astraReview.mjs and prepare_*.py read are unchanged.
 assert.equal(receipt.name,name);assert.equal(receipt.bytes,archive.length);assert.equal(receipt.sha256,createHash('sha256').update(archive).digest('hex'));
 assert.equal(receipt.phoneModifiedAt,'2026-09-10T12:00:00Z');assert.equal(receipt.reused,false);assert.equal(receipt.verification,'downloaded-only');assert.equal(receipt.source,'configured-iphone-app-container');
 assert.ok(Number.isFinite(Date.parse(receipt.receivedAt)));assert.match(receipt.message,/Import it in Acoustic mapping/);
 // Both HTTP responses leave out the device identity; everything else matches the receipt on disk.
 const {device:_,...shown}=receipt.acquisition;assert.deepEqual(pulled.body.receipt,{...receipt,acquisition:shown});
 assert.deepEqual((await call('latest')).body,{inFlight:false,receipt:pulled.body.receipt});
 for(const body of [pulled.body,(await call('latest')).body])assert.equal(JSON.stringify(body).includes('00008130'),false);
 assert.deepEqual(await readFile(join(dataRoot,'usb-imports',name)),archive);
 assert.deepEqual(calls[0].slice(0,6),['xcrun','devicectl','list','devices','--timeout','20']);
 assert.deepEqual(calls.map(c=>c.slice(1,4).join(' ')),['devicectl list devices','devicectl device info','devicectl device copy']);
 // The device list names every device paired with this Mac; it is deleted once the configured entry is read.
 const [job]=await jobs();assert.ok(job);assert.equal((await readdir(join(dataRoot,job))).includes('devices.json'),false);
 // A second pull of the same archive reuses the local copy and records the device again.
 const again=(await call('pull','POST')).body.receipt;assert.equal(again.reused,true);assert.deepEqual(again.acquisition,pulled.body.receipt.acquisition);
});

test('a missing configured device refuses the pull with 503 before any file is listed or copied',async t=>{
 const {dataRoot,calls,call,jobs}=await serve(t,[other]);
 const refused=await call('pull','POST');
 assert.equal(refused.status,503);assert.match(refused.body.error,/configured iPhone is not connected/);
 assert.equal(calls.length,1);assert.deepEqual((await call('latest')).body,{inFlight:false,receipt:null});
 assert.equal((await readdir(dataRoot)).includes('usb-imports'),false);assert.deepEqual(await jobs(),[]);
});

test('a wireless pull records its transport and leaves absent fields null',async t=>{
 const sparse={identifier:deviceId,connectionProperties:{transportType:'localNetwork'},hardwareProperties:{productType:'iPhone16,1'}};
 const {dataRoot,call}=await serve(t,[sparse]);
 assert.equal((await call('pull','POST')).status,200);
 const receipt=JSON.parse(await readFile(join(dataRoot,'native-pull-latest.json'),'utf8'));
 assert.deepEqual(receipt.acquisition.connection,{transportType:'localNetwork',tunnelState:null});
 assert.deepEqual(receipt.acquisition.device,{coreDeviceId:deviceId,udid:null,productType:'iPhone16,1',osVersion:null});
});

test('an unreadable or failed device list refuses the pull with 503',async t=>{
 for(const devices of ['not json',JSON.stringify({info:{outcome:'failed'}}),Object.assign(Error('devicectl timed out'),{stderr:'timed out'})]){
  const {call,calls,jobs}=await serve(t,devices);
  const refused=await call('pull','POST');assert.equal(refused.status,503,String(devices));assert.equal(calls.length,1);assert.deepEqual(await jobs(),[]);
 }
});

test('a malformed device configuration is refused with 503 before devicectl runs',async t=>{
 for(const config of [{deviceId:[deviceId]},{deviceId:12345},null,{}]){
  const {call,calls,jobs}=await serve(t,[phone],{config});
  const refused=await call('pull','POST');
  assert.equal(refused.status,503,JSON.stringify(config));assert.equal(refused.body.error,'The private iPhone device configuration is invalid.');
  assert.equal(calls.length,0);assert.deepEqual(await jobs(),[]);
 }
});

test('a transfer whose size differs from the phone is refused and the partial download discarded',async t=>{
 const {dataRoot,call,jobs}=await serve(t,[phone],{copied:archive.subarray(1)});
 const refused=await call('pull','POST');
 assert.equal(refused.status,502);assert.match(refused.body.error,/incomplete download was discarded/);
 assert.deepEqual(await jobs(),[]);assert.deepEqual(await readdir(join(dataRoot,'usb-imports')),[]);
});
