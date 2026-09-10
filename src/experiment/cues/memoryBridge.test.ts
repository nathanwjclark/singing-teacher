/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewedMemoryCandidate } from './memoryBridge.ts';
import { freezeLearningProtocol } from '../../evaluation/learning/index.ts';
import { exportLearningInterchange, learningInstruction } from './interchange.ts';
import type { LearningMemory } from '../../components/coach/learningMemoryClient.ts';

const memory: LearningMemory = { kind:'subjective-cue-memory',scope:'subjective_not_physiological_evidence',sessionId:'source-session',entries:[{
  id:'memory-1',attemptId:'attempt-1',modelId:'model-1',runId:'run-1',designId:'design-1',decisionId:'decision-1',
  cue:'Greet gently with ah and sustain the comfortable note.',text:'A light buzzing sensation.',createdAt:'2026-09-10T12:00:00Z',
}] };

test('actual saved wording and all origin IDs survive freeze/export; recall hides cue and sensation', async () => {
  const cue = reviewedMemoryCandidate(memory,memory.entries[0],true);
  assert.equal(cue.variant,memory.entries[0].cue);
  assert.equal(cue.review,null);
  assert.equal(cue.lineage?.sensation,memory.entries[0].text);
  const input = {schema:'singing-teacher/learning/1' as const,id:'protocol-1',frozenAt:'2026-09-10T13:00:00Z',cue,
    targetHz:220,toleranceCents:50,context:'comfortable ah',phrase:'Hello again',retentionHours:24,minimumVoicedWindows:5,
    minimumVoicedFraction:.3,scoring:'median-absolute-cents/1' as const,sessionId:'learning-session'};
  await assert.rejects(freezeLearningProtocol(input),/review/);
  const protocol = await freezeLearningProtocol({...input,cue:{...cue,review:{reviewer:'Example Reviewer',role:'Voice teacher',evidence:'Reviewed both exact wordings for this task.',reviewedAt:input.frozenAt}}});
  assert.equal(learningInstruction(protocol,'variant','prompted'),cue.variant);
  for(const phase of ['recall','transfer','retention'] as const){
    const instruction=learningInstruction(protocol,'variant',phase);
    assert.ok(!instruction.includes(cue.variant));assert.ok(!instruction.includes(memory.entries[0].text));
  }
  const exported=await exportLearningInterchange([protocol],[]);
  assert.equal(exported.omissions.length,0);
  const definition=exported.records.find(row=>row.kind==='cue-definition');
  assert.ok(definition?.provenance.sourceIds.includes('decision-1'));
  assert.equal(definition?.context.sourceModelId,'model-1');
  assert.equal(definition?.context.sourceDesignId,'design-1');
});

test('no inference from prose: missing decision, unselected record and unconfirmed task reject', () => {
  assert.throws(()=>reviewedMemoryCandidate(memory,memory.entries[0],false),/comfortable sustained ah/);
  assert.throws(()=>reviewedMemoryCandidate(memory,{...memory.entries[0],decisionId:null},true),/actual Astra/);
  assert.throws(()=>reviewedMemoryCandidate(memory,{...memory.entries[0],id:'unknown'},true),/actual Astra/);
});
