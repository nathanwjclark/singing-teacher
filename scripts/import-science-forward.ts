/** Genuine native forward export -> KIT audio/geometry handoff. No fitted-human claims. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {validateRecord} from '../src/contracts/index.ts';
import {extractAudioMeasurement,audioFrameSize} from '../src/lib/audio.ts';
const [sourceArg,capArg,outArg]=process.argv.slice(2);
if(!sourceArg||!capArg||!outArg)throw Error('Usage: node --experimental-strip-types scripts/import-science-forward.ts FORWARD_DIR CAPABILITIES_JSON NEW_OUTPUT_DIR');
const source=resolve(sourceArg),output=resolve(outArg);
const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const manifestBytes=await readFile(resolve(source,'manifest.json'));
const manifest=JSON.parse(manifestBytes.toString());
const caps=JSON.parse(await readFile(resolve(capArg),'utf8'));
if(manifest.kind!=='synthetic_forward_export'||manifest.schema_version!=='0.1.0'||caps.schema_version!=='0.1.0')throw Error('Unsupported native producer version');
if(JSON.stringify(manifest.provenance)!==JSON.stringify(caps.provenance))throw Error('Capabilities and export native provenance differ');
const checked=new Map<string,Buffer>();
for(const [name,expected]of Object.entries(manifest.files)){
  if(basename(name)!==name||name==='..')throw Error('Manifest artifacts must be local filenames');
  const bytes=await readFile(resolve(source,name));if(hash(bytes)!==expected)throw Error(`Native artifact digest mismatch: ${name}`);checked.set(name,bytes);
}
for(const name of ['audio.wav','tract0.obj','surface-mesh.json'])if(!checked.has(name))throw Error(`Missing native artifact: ${name}`);
const surface=JSON.parse(checked.get('surface-mesh.json')!.toString());
if(surface.coordinate_unit!=='cm'||surface.meters_per_coordinate_unit!==.01)throw Error('Unsupported geometry units');
const vertices:number[][]=[],positions:number[]=[];
for(const line of checked.get('tract0.obj')!.toString().split('\n')){
  const p=line.trim().split(/\s+/);
  if(p[0]==='v'){const v=p.slice(1).map(Number);if(v.length!==3||v.some(x=>!Number.isFinite(x)))throw Error('Invalid native vertex');vertices.push(v.map(x=>x*.01));}
  if(p[0]==='f'){
    if(p.length!==4)throw Error('Only native triangular meshes supported');
    for(const token of p.slice(1)){const i=Number(token.split('/')[0]);if(!Number.isInteger(i)||i<1||i>vertices.length)throw Error('Invalid native face');positions.push(...vertices[i-1]);}
  }
}
if(!positions.length)throw Error('Empty native mesh');
const raw=Buffer.alloc(positions.length*4);positions.forEach((x,i)=>raw.writeFloatLE(x,i*4));
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];positions.forEach((x,i)=>{min[i%3]=Math.min(min[i%3],x);max[i%3]=Math.max(max[i%3],x)});
const gltf={asset:{version:'2.0',generator:'singing-teacher native OBJ adapter; geometry unchanged except cm to m'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.75,.36,.4,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{byteLength:raw.length,uri:`data:application/octet-stream;base64,${raw.toString('base64')}`}],bufferViews:[{buffer:0,byteOffset:0,byteLength:raw.length,target:34962}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min,max}]};
const geometry=Buffer.from(JSON.stringify(gltf));
const wav=checked.get('audio.wav')!;
if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Expected RIFF WAVE');
let format=0,channels=0,rate=0,bits=0,pcm:Buffer|undefined;
for(let at=12;at+8<=wav.length;){const name=wav.toString('ascii',at,at+4),size=wav.readUInt32LE(at+4),start=at+8;if(start+size>wav.length)throw Error('Truncated WAV');if(name==='fmt '){format=wav.readUInt16LE(start);channels=wav.readUInt16LE(start+2);rate=wav.readUInt32LE(start+4);bits=wav.readUInt16LE(start+14)}if(name==='data')pcm=wav.subarray(start,start+size);at=start+size+(size%2)}
if(format!==3||channels!==1||bits!==32||!pcm||rate!==manifest.sample_rate_hz)throw Error('Expected native mono float32 WAV with declared sample rate');
const audio=Float32Array.from({length:pcm.length/4},(_,i)=>pcm!.readFloatLE(i*4));
if(audio.some(x=>!Number.isFinite(x)))throw Error('Invalid PCM');
const prefix=`native-${hash(manifestBytes).slice(0,12)}`,createdAt=new Date().toISOString();
const provenance={kind:'engine-generated' as const,producer:'VocalTractLab/forward-kit-adapter',producerVersion:'0.1.0+kit1',sourceIds:[prefix],sourceHashes:[hash(manifestBytes),...Object.values(manifest.files)]};
const timebase={clockId:`${prefix}-samples`,origin:'session-start' as const,unit:'ms' as const,syncUncertaintyMs:0,referenceClockId:null,offsetToReferenceMs:null};
const artifact={id:`${prefix}-audio`,uri:'audio.wav',sha256:hash(wav),mediaType:'audio/wav',byteLength:wav.length};
const observation={schemaVersion:'1.0.0',kind:'observation',id:`${prefix}-observation`,createdAt,provenance,participantId:'synthetic-native-template',sessionId:prefix,trialId:prefix,predictionId:null,consentScope:['synthetic-no-participant'],task:`Native forward pose ${manifest.pose}; template-conditional anatomy`,artifacts:[artifact],streams:['audio','rgb','depth'].map(modality=>({modality,timebase,samples:modality==='audio'?[{captureMs:0,artifactId:artifact.id,sequence:0,quality:{flags:['synthetic-native'],missingReason:null}}]:[],missingReason:modality==='audio'?null:'not-captured',droppedSamples:0,settings:modality==='audio'?{sampleRate:rate}:{},calibration:{artifactId:null,missingReason:'not-calibrated'},depth:null}))};
const candidate={schemaVersion:'1.0.0',kind:'candidate-anatomy',id:`${prefix}-template`,createdAt,provenance,modelVersion:manifest.provenance.upstream_revision??'native-0.1.0',parentModelId:null,evidenceIds:[],availability:'available',missingReason:null,parameters:caps.anatomy_parameters.map((p:{name:string;unit:string;min:number;max:number})=>({name:p.name,value:manifest.anatomy[p.name],unit:p.unit,bounds:[p.min,p.max],role:'global',status:'fixed',interpretation:'Specified forward-simulation geometry; not inferred from this singer',simulatorMapping:p.name})),geometry:{id:`${prefix}-geometry`,uri:'geometry.gltf',sha256:hash(geometry),mediaType:'model/gltf+json',byteLength:geometry.length},solver:{name:'VocalTractLab forward synthesis',version:'0.1.0',configSha256:hash(manifestBytes)},uncertaintyMethod:'Not quantified; fixed synthetic forward parameters',mismatch:false};
const size=audioFrameSize(rate);
const measurements=[];
for(let start=0;start+size<=audio.length;start+=Math.round(rate*.1))measurements.push(extractAudioMeasurement(audio.slice(start,start+size),rate,{id:`${prefix}-window-${start}`,observationId:observation.id,artifactId:artifact.id,startMs:start/rate*1000,timebase,sourceKind:'engine-generated',sourceHashes:[artifact.sha256],qualityFlags:['synthetic-native','not-microphone-calibrated']}));
if(!measurements.length)throw Error('Native audio too short for canonical measurement; export at least 0.2 seconds');
for(const record of [observation,candidate,...measurements]){const result=validateRecord(record);if(!result.valid)throw Error(result.errors.join('; '))}
await mkdir(output,{recursive:false});
await writeFile(resolve(output,'geometry.gltf'),geometry);await copyFile(resolve(source,'audio.wav'),resolve(output,'audio.wav'));
for(const [name,value]of Object.entries({'candidate.json':candidate,'observation.json':observation,'measurements.json':measurements,'native-manifest.json':manifest,'handoff.json':{kind:'native-forward-kit-handoff',sourceManifestSha256:hash(manifestBytes),sourceKind:'synthetic-native',geometryTransform:'cm to m; triangles preserved; neutral display material',limitations:['Not fitted human anatomy','Not prospective evaluation','Transfer dB not treated as microphone dBFS'],records:['candidate.json','observation.json','measurements.json']}}))await writeFile(resolve(output,name),JSON.stringify(value,null,2));
console.log(`Validated native KIT handoff: ${output}; ${positions.length/9} triangles, ${measurements.length} canonical audio windows`);
