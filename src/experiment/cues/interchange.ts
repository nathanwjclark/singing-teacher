import { LEARNING_VERSION, validateLearningRecord } from '../../contracts/learning.ts'
import type { LearningBase, LearningRecord, CueDefinition, TransferEvaluation } from '../../contracts/learning.ts'
import { evaluateLearning } from '../../evaluation/learning/index.ts'
import type { LearningAttempt, LearningProtocol, LearningArm } from './types.ts'

export function learningInstruction(protocol: LearningProtocol, arm: LearningArm, phase: LearningAttempt['phase']) {
  if (phase === 'prompted') return arm === 'baseline' ? protocol.cue.wording : protocol.cue.variant
  return phase === 'transfer'
    ? `Sing “${protocol.phrase}” on the same single target note, recalling the practiced quality without a cue.`
    : 'Repeat the practiced vowel and target note from memory, without consulting your cue or mnemonic.'
}
/** Export genuine available observations into KIT. No control model or motion is invented. */
export async function exportLearningInterchange(protocols: LearningProtocol[], attempts: LearningAttempt[]) {
  const records: LearningRecord[] = [], omissions: string[] = []
  const seen = new Set<string>()
  for (const protocol of protocols) {
    if (seen.has(protocol.id)) continue
    seen.add(protocol.id)
    const group = attempts.filter(attempt => attempt.protocolId === protocol.id)
    const scores = await evaluateLearning(protocol, group)
    const cueId = (arm: LearningArm) => `${protocol.id}/cue/${arm}`
    const lineage = protocol.cue.lineage
    const originIds = lineage ? [lineage.sessionId,lineage.runId,lineage.modelId,lineage.designId,lineage.decisionId,lineage.attemptId,lineage.memoryId] : []
    const context = { declaredContext: protocol.context, phrase: protocol.phrase, targetHz: String(protocol.targetHz), toleranceCents: String(protocol.toleranceCents), protocolDigest: protocol.digest, acousticErrorUnit: 'cents', scoring: protocol.scoring, reviewEvidence: protocol.cue.review?.evidence || 'not supplied', reviewerRole: protocol.cue.review?.role || 'not supplied', physiologicalAgreement: 'not measured', ...(lineage ? { sourceSessionId:lineage.sessionId,sourceRunId:lineage.runId,sourceModelId:lineage.modelId,sourceDesignId:lineage.designId,sourceDecisionId:lineage.decisionId,sourceAttemptId:lineage.attemptId,sourceMemoryId:lineage.memoryId,sourceRecordedAt:lineage.recordedAt,cueOrigin:'historical Astra decision; source IDs are not current learning predictions' } : {}) }
    const base = (id: string, createdAt: string, kind: LearningBase['provenance']['kind'], sourceIds: string[], sourceHashes: string[] = []): LearningBase => ({ schemaVersion: LEARNING_VERSION, id, createdAt, provenance: { kind, producer: 'singing-teacher/learning', producerVersion: '1.0.0', sourceIds:[...new Set([...sourceIds,...originIds])], sourceHashes } })
    for (const arm of ['baseline', 'variant'] as const) {
      const definition: CueDefinition = { ...base(cueId(arm), protocol.frozenAt, 'human-observation', [protocol.id]), kind: 'cue-definition', version: String(protocol.cue.version), wording: learningInstruction(protocol, arm, 'prompted'), allowedVariants: [], familiarAction: protocol.cue.title, hypothesis: protocol.cue.hypothesis, supportedEngineVariables: [], expectedObservables: [protocol.cue.observable], sources: [{ url: protocol.cue.source, evidenceLevel: protocol.cue.evidenceLevel }], review: { status: protocol.cue.review ? 'reviewed' : 'candidate', reviewer: protocol.cue.review?.reviewer ?? null, reviewedAt: protocol.cue.review?.reviewedAt ?? null }, context: { ...context, comparisonArm: arm, reviewProvenance: 'user-supplied specialist review; credentials not independently verified' }, effortRule: 'Comfortable effort only', restRule: 'Rest between attempts and after discomfort', stopRules: [protocol.cue.stopRule], alternatives: protocol.cue.alternatives }
      records.push(definition)
    }
    group.forEach((attempt, index) => {
      const evidenceIds = [protocol.id, ...(attempt.recordingId ? [attempt.recordingId] : []), ...(attempt.artifactId ? [attempt.artifactId] : [])]
      const evidenceHashes = attempt.artifactHash ? [attempt.artifactHash] : []
      const createdAt = attempt.endedAt || attempt.startedAt
      const attemptContext = { ...context, comparisonArm: attempt.arm, learningStage: attempt.phase, sessionId: attempt.sessionId, contextConfirmed: String(attempt.contextConfirmed), mnemonicAssistance: attempt.phase === 'prompted' ? 'available' : 'hidden', modelStatus: 'not connected', predictionStatus: 'not connected' }
      records.push({ ...base(attempt.id, createdAt, 'human-observation', evidenceIds, evidenceHashes), kind: 'cue-attempt', cueId: cueId(attempt.arm), cueVersion: String(protocol.cue.version), deliveredWording: attempt.phase === 'prompted' ? attempt.deliveredWording : learningInstruction(protocol, attempt.arm, attempt.phase), goal: `Reproduce ${protocol.targetHz} Hz within ${protocol.toleranceCents} cents in the frozen task`, modelId: null, predictionId: null, context: attemptContext, startedAt: attempt.startedAt, endedAt: attempt.endedAt || null, repetition: index + 1, captureIds: attempt.recordingId ? [attempt.recordingId] : [], executionDeviations: [attempt.deviations, attempt.failureReason].filter((s): s is string => !!s?.trim()), outcome: attempt.outcome === 'failed' ? 'unsuccessful' : attempt.outcome })
      if (attempt.reportFinalized !== false && attempt.sensation.words.trim()) records.push({ ...base(`${attempt.id}/sensation`, createdAt, 'human-observation', [attempt.id]), kind: 'sensation-report', attemptId: attempt.id, words: attempt.sensation.words, bodyRegions: attempt.sensation.bodyRegion.trim() ? [attempt.sensation.bodyRegion] : [], ease: null, effort: attempt.sensation.effort, discomfort: attempt.sensation.discomfort ? 'Learner reported discomfort or strain' : 'Learner did not report discomfort', confidence: attempt.sensation.confidence / 5, recognizable: attempt.sensation.recognizable, interpretation: 'subjective-self-report' })
      else omissions.push(`${attempt.id}: no verbal sensation report; optional ratings and mnemonic remain in local export`)
      if (attempt.phase !== 'prompted') {
        const score = scores.find(s => s.attemptId === attempt.id)!
        const stage: TransferEvaluation['stage'] = attempt.phase === 'recall' ? 'cue-free-recall' : attempt.phase === 'transfer' ? 'phrase-transfer' : 'later-session-retention'
        records.push({ ...base(`${attempt.id}/evaluation`, new Date().toISOString(), 'derived-measurement', [attempt.id, ...evidenceIds], evidenceHashes), kind: 'transfer-evaluation', protocolId: protocol.id, frozenScoringId: protocol.digest, baselineCueId: cueId('baseline'), variantCueId: cueId('variant'), context: attemptContext, attemptIds: [attempt.id], stage, acousticError: score.errorCents, movementAgreement: null, effort: attempt.reportFinalized === false ? null : attempt.sensation.effort, outcome: score.status === 'excluded' ? 'insufficient-evidence' : score.status, missingReasons: [...score.reasons, 'Movement agreement unavailable: no fitted motion observation'], independentlyScored: true })
      }
    })
  }
  attempts.filter(attempt => !seen.has(attempt.protocolId)).forEach(attempt => omissions.push(`${attempt.id}: frozen protocol unavailable; retained in local export`))
  const validated: LearningRecord[] = []
  for (const record of records) {
    const result = validateLearningRecord(record)
    if (result.valid) validated.push(record)
    else omissions.push(`${record.id}: KIT validation rejected record: ${result.errors.join('; ')}`)
  }
  return { schema: 'singing-teacher/learning-interchange/1', records: validated, omissions, unavailable: ['ControlProfile: no fitted control producer connected', 'MotionObservation: this study did not capture geometric trajectories'] }
}
