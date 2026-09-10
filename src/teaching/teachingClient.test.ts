import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonRows, getTeachingStatus, prepareTeaching, teachingAssetBlob} from './teachingClient.ts';
test('teaching client uses existing identities and keeps unavailable status explicit', async () => {
  const original = globalThis.fetch; const calls: {url: unknown; init?: RequestInit}[] = [];
  globalThis.fetch = (async (url, init) => {calls.push({url, init}); return Response.json({enabled:false,audioEnabled:false,status:'disabled',current:false});}) as typeof fetch;
  try {assert.equal((await getTeachingStatus()).status,'disabled'); await prepareTeaching('tongue-jaw-vowels','model','design');
    assert.deepEqual(JSON.parse(calls[1].init!.body as string),{demonstrationId:'tongue-jaw-vowels',modelId:'model',designId:'design'});
    globalThis.fetch=(async()=>Response.json({status:'succeeded',current:true,result:{schemaVersion:'wrong'}})) as typeof fetch;
    await assert.rejects(getTeachingStatus(),/incomplete/);
  } finally {globalThis.fetch=original;}
});
test('acoustic comparison never subtracts different units or missing measures',()=>{
  const before={measurement:{measurements:[{name:'pitch',value:180,unit:'Hz'},{name:'level',value:-20,unit:'dBFS'}]}};
  const after={measurement:{measurements:[{name:'pitch',value:190,unit:'Hz'},{name:'level',value:1,unit:'Pa'}]}};
  assert.deepEqual(comparisonRows(before,after).map(row=>row.difference),[10,null]);
});
test('local media requires exact size/hash and rejects remote or corrupt artifacts',async()=>{
  const original=globalThis.fetch,bytes=new TextEncoder().encode('verified-wave');
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const asset={name:'before.wav',url:'/api/teaching/asset?attempt=a&name=before.wav',byteLength:bytes.length,sha256};
  let calls=0;globalThis.fetch=(async()=>{calls++;return new Response(bytes);}) as typeof fetch;
  try {
    assert.equal((await teachingAssetBlob(asset)).type,'audio/wav');
    await assert.rejects(teachingAssetBlob({...asset,url:'https://foreign.example/audio'}),/provenance/);assert.equal(calls,1);
    await assert.rejects(teachingAssetBlob({...asset,sha256:'f'.repeat(64)}),/hash/);
    await assert.rejects(teachingAssetBlob({...asset,byteLength:2}),/size/);
  }finally{globalThis.fetch=original;}
});
