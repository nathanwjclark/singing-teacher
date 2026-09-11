import test from 'node:test';
import assert from 'node:assert/strict';
import {importFeature} from './importFeature.ts';

test('a loaded feature module is returned unchanged',async()=>{
 const module={toDataURL:()=>'data:'};
 assert.equal(await importFeature('QR codes',async()=>module),module);
});

test('a failed feature import asks for a reload and keeps the browser error',async()=>{
 const fetchError=new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/chunk.js');
 await assert.rejects(importFeature('Camera tracking',()=>Promise.reject(fetchError)),error=>{
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Camera tracking could not be loaded. Reload the page to try again.');
  assert.equal(error.cause,fetchError);
  return true;
 });
});
