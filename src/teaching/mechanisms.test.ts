import assert from 'node:assert/strict'
import test from 'node:test'
import { EVIDENCE_MODES, MECHANISMS, TEACHING_VERSION, getCue, getMechanism } from './mechanisms.ts'

test('untrusted selections require exact demonstration and cue identities', () => {
  for (const value of [null, {}, [], '__proto__', 'cricothyroid', ' cricothyroid-pitch']) assert.equal(getMechanism(value), undefined)
  assert.equal(getCue('cricothyroid-pitch', 'vowel-contrast'), undefined)
  assert.equal(getCue('source-filter', null), undefined)
  assert.equal(getCue('source-filter', 'tone-at-one-note')?.id, 'tone-at-one-note')
})

test('every teaching mechanism has explicit evidence limits and traceable reference links', () => {
  assert.equal(new Set(MECHANISMS.map(item => item.id)).size, 4)
  assert.deepEqual(Object.keys(EVIDENCE_MODES).sort(), ['general-explanation', 'model-prediction', 'recorded-result'])
  for (const item of MECHANISMS) {
    assert.equal(item.version, TEACHING_VERSION)
    assert.equal(item.defaultEvidenceMode, 'general-explanation')
    assert.equal(item.review.specialistApproval, false)
    assert.equal(item.review.learningEfficacyValidated, false)
    assert.match(item.comfort, /Stop/)
    assert.ok(item.limits.length >= 2)
    assert.ok(item.sources.every(source => new URL(source.url).protocol === 'https:' && source.scope && source.rights))
    assert.equal(new Set(item.cues.map(cue => cue.id)).size, item.cues.length)
  }
})
