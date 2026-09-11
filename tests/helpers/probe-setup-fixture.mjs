import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile);
const hash=b=>createHash('sha256').update(b).digest('hex');
/** Generated probe archive in `dataRoot` plus a calibration package whose evidence is a text file.
 * `manifest` overrides native manifest fields (for example provenance) before the archive is built. */
export async function createProbeSetupFixture(root,{repo=process.cwd(),dataRoot=join(root,'private-data'),manifest={}}={}){
 const capture=join(root,'generated-capture');
 await execute(process.execPath,['--experimental-strip-types','--input-type=module','-e',"import {makeFixture} from './scripts/acoustic-probe-fixture.ts'; await makeFixture(process.argv[1]);",capture],{cwd:repo});
 const native={...JSON.parse(await readFile(join(capture,'manifest.json'))),captureId:'12345678-1234-1234-1234-123456789abc',...manifest};
 await writeFile(join(capture,'manifest.json'),JSON.stringify(native));
 await mkdir(join(dataRoot,'usb-imports'),{recursive:true});
 const name=`probe-${native.captureId}.zip`;
 await execute('python3',['-c',"import pathlib,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n for p in pathlib.Path(sys.argv[1]).iterdir(): z.write(p,p.name)",capture,join(dataRoot,'usb-imports',name)]);
 const archive=await readFile(join(dataRoot,'usb-imports',name));
 await writeFile(join(dataRoot,'native-pull-latest.json'),JSON.stringify({name,sha256:hash(archive),bytes:archive.length}));
 const evidence=Buffer.from('Generated FIR calibration test evidence; not measured hardware or a human recording.');
 const descriptor={path:'calibration-evidence.txt',sha256:hash(evidence),byteCount:evidence.length};
 const placement={placement_id:'fixture-placement',coordinate_frame:'fixture-metres',source_m:[.15,0,0],microphone_m:[.12,.05,0],mouth_m:[0,0,0]};
 const profile={JA:-3,gain:1,direct_gain:1,coupling_gain:1,delay_s:0};
 const calibration={schema_version:'0.1.0',kind:'probe_calibration_package',comparison:'complex',selected_indices:[80,100,128],evidence:[descriptor],
  calibration:{calibration_id:'fixture-calibration',route_id:'fixture-route',placement_id:placement.placement_id,kind:'synthetic-fixture',frequency_hz:[80,100,128].map(i=>i*16000/4096),source_volume_velocity_real:[1e-5,1e-5,1e-5],source_volume_velocity_imag:[0,0,0],microphone_gain_real:[.01,.01,.01],microphone_gain_imag:[0,0,0],source_hashes:[descriptor.sha256],delay_s:0},
  processing:{kind:'declared-software-fixture',evidence_id:'known-fir',route_id:'fixture-route',source_hashes:[descriptor.sha256]},
  nuisance_prior:{prior_id:'fixture-prior',source_hashes:[descriptor.sha256],bounds:{gain:[1,1],direct_gain:[1,1],coupling_gain:[1,1],delay_s:[0,0]}},
  bands:[{low_hz:300,high_hz:501,sigma:.01,weight:1}],conditions:{termination:'rigid',termination_resistance_pa_s_m3:null,attenuation_np_per_m:.5}};
 const packageBytes=Buffer.from(JSON.stringify(calibration));await writeFile(join(root,'calibration-package.json'),packageBytes);await writeFile(join(root,descriptor.path),evidence);
 return {dataRoot,capture,native,placement,profile,calibration,packageBytes,evidence,descriptor,
  request:{requestId:'setup-one',importId:'review',manifestSha256:hash(await readFile(join(capture,'manifest.json'))),packageBase64:packageBytes.toString('base64'),evidence:[{name:descriptor.path,base64:evidence.toString('base64')}],placement,profile,trialId:'fixture-probe',pose:'a'}};
}
