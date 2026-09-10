import { CUE_LIBRARY } from './library.ts';
import type { TeachingCue } from './types.ts';
import type { LearningMemory, LearningMemoryEntry } from '../../components/coach/learningMemoryClient.ts';

export function reviewedMemoryCandidate(memory: LearningMemory, entry: LearningMemoryEntry, taskConfirmed: boolean): TeachingCue {
  if (!taskConfirmed) throw new Error('Confirm that this exact cue is for the comfortable sustained ah task; other maneuvers are not enabled here.');
  if (!memory.entries.some(row => row.id === entry.id) || !entry.cue?.trim() || !entry.decisionId ||
    ![memory.sessionId, entry.runId, entry.modelId, entry.designId, entry.attemptId, entry.id].every(value => typeof value === 'string' && value.length > 0)) {
    throw new Error('Select a saved sensation linked to an actual Astra decision and scientific experiment.');
  }
  const baseline = CUE_LIBRARY.find(cue => cue.id === 'easy-ah')!;
  return { ...baseline, id: `astra-memory-${entry.id}`, title: 'Saved Astra cue · comfortable ah review',
    variant: entry.cue, review: null,
    hypothesis: 'Test whether this personally experienced wording helps reproduce the same comfortable pitch task. No physiological effect is assumed.',
    evidenceLevel: 'Actual saved Astra wording with a subjective sensation report; both exact wordings still require specialist review for this learner and context.',
    lineage: { sessionId: memory.sessionId, runId: entry.runId, modelId: entry.modelId, designId: entry.designId,
      decisionId: entry.decisionId, attemptId: entry.attemptId, memoryId: entry.id, sensation: entry.text, recordedAt: entry.createdAt } };
}
