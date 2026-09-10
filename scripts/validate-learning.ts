/** Validate revision-6 learning records and their declared within-package references. */
import {readFile} from 'node:fs/promises';
import {validateLearningRecord} from '../src/contracts/learning.ts';
import type {LearningRecord} from '../src/contracts/learning.ts';
if(process.argv.length<3)throw Error('Usage: node --experimental-strip-types scripts/validate-learning.ts EXPORT_JSON...');
let failed=false;
for(const file of process.argv.slice(2)){
 try{
  const bytes=await readFile(file);if(bytes.length>20_000_000)throw Error('Use metadata exports under 20 MB');
  const value=JSON.parse(bytes.toString());
  const records:LearningRecord[]=Array.isArray(value)?value:value.kit?.records??value.records??[value];
  const ids=new Set<string>();
  for(const record of records){const result=validateLearningRecord(record);if(!result.valid)throw Error(result.errors.join('; '));if(ids.has(record.id))throw Error(`Duplicate ID ${record.id}`);ids.add(record.id)}
  for(const record of records){
   if(record.kind==='cue-attempt'&&!records.some(r=>r.kind==='cue-definition'&&r.id===record.cueId&&r.version===record.cueVersion))throw Error(`${record.id}: include the referenced cue definition/version`);
   if(record.kind==='sensation-report'&&!records.some(r=>r.kind==='cue-attempt'&&r.id===record.attemptId))throw Error(`${record.id}: include the referenced cue attempt`);
   if(record.kind==='transfer-evaluation'&&record.attemptIds.some(id=>!records.some(r=>r.kind==='cue-attempt'&&r.id===id)))throw Error(`${record.id}: include the evaluated attempts`);
  }
  console.log(`VALID ${file}: ${records.length} records. Structure and references only; not credential, media, or scientific acceptance.`);
 }catch(error){failed=true;console.error(`${file}: ${error instanceof Error?error.message:String(error)}`)}
}
if(failed)process.exitCode=1;
