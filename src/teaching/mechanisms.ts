/** Original educational text; cited sources are linked, not redistributed.
 * Availability here grants no personalized operator capability. */
export const TEACHING_VERSION = 'visual-teaching-1' as const
export type DemonstrationId = 'cricothyroid-pitch' | 'soft-palate-coupling' | 'tongue-jaw-vowels' | 'source-filter'
export type EvidenceMode = 'general-explanation' | 'model-prediction' | 'recorded-result'

export const EVIDENCE_MODES: Readonly<Record<EvidenceMode, { label: string; explanation: string }>> = {
  'general-explanation': { label: 'General explanation', explanation: 'An educational illustration, not a measurement of your anatomy.' },
  'model-prediction': { label: "Your model’s prediction", explanation: 'A supported simulation of a current hypothesis; hidden anatomy and achievable movement remain uncertain.' },
  'recorded-result': { label: 'Your recorded result', explanation: 'A compatible measurement of your attempt. An acoustic change does not confirm the illustrated internal movement.' },
}
export const COMFORT_CUE = 'Keep the attempt small and comfortable. Stop if it hurts, strains, or feels difficult; return to an easy voice or rest. Never press or move your throat with your hands.'

export interface TeachingSource {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly scope: string
  readonly rights: string
}
export interface Mechanism {
  readonly id: DemonstrationId
  readonly version: typeof TEACHING_VERSION
  readonly title: string
  readonly cues: readonly { readonly id: string; readonly text: string; readonly notice: string }[]
  readonly mechanism: string
  readonly limits: readonly string[]
  readonly sources: readonly TeachingSource[]
  readonly illustration: { readonly view: string; readonly before: string; readonly after: string; readonly movement: string; readonly caption: string }
  readonly defaultEvidenceMode: 'general-explanation'
  readonly comfort: string
  readonly review: { readonly status: 'reference-checked'; readonly checkedOn: string; readonly specialistApproval: false; readonly learningEfficacyValidated: false }
}
const rights = 'Reference link only; no source figures, audio, or article text redistributed.'
const larynx: TeachingSource = { id: 'farley-1996', title: 'Farley (1996): A biomechanical laryngeal model of voice F0 and glottal width control', url: 'https://pubmed.ncbi.nlm.nih.gov/8969481/', scope: 'Biomechanical model of interacting muscle controls; not an exercise trial.', rights }
const joint: TeachingSource = { id: 'storck-2011', title: 'Storck et al. (2011): The role of the cricothyroid joint anatomy in cricothyroid approximation surgery', url: 'https://pubmed.ncbi.nlm.nih.gov/20971613/', scope: 'Cadaver joint motion and elongation; surgical mechanics do not prescribe singing technique.', rights }
const acoustics: TeachingSource = { id: 'unsw-voice', title: 'UNSW Music Acoustics: Voice acoustics', url: 'https://www.phys.unsw.edu.au/jw/voice.html', scope: 'Articulators, vowels and oral/nasal pathways; general acoustics, not a learner diagnosis.', rights }
const sourceFilter: TeachingSource = { id: 'wolfe-2016', title: 'Wolfe et al. (2016): An experimentally measured source–filter model', url: 'https://www.phys.unsw.edu.au/jw/reprints/Source-Filter.pdf', scope: 'Separate measurements of source, tract gain and output from a physical model; not an individual singer.', rights }
const common = { version: TEACHING_VERSION, defaultEvidenceMode: 'general-explanation' as const, comfort: COMFORT_CUE,
  review: { status: 'reference-checked' as const, checkedOn: '2026-09-10', specialistApproval: false as const, learningEfficacyValidated: false as const } }

export const MECHANISMS: readonly Mechanism[] = [
  { ...common, id: 'cricothyroid-pitch', title: 'How pitch coordination changes',
    cues: [
      { id: 'small-glide', text: 'On an easy “oo,” glide a little higher and back without getting louder.', notice: 'Notice whether the pitch moves easily. A small glide is enough.' },
      { id: 'nearby-note', text: 'Sing an easy “oo,” then a nearby higher note at a comfortable level.', notice: 'Compare the pitch and effort; do not reach for the top of your range.' },
    ],
    mechanism: 'The cricothyroid muscle links two laryngeal cartilages: thyroid and cricoid. Their relative motion can separate the vocal-fold attachments and lengthen the folds. Pitch reflects coordinated stiffness, length, effective vibrating mass and pressure, with several muscles involved.',
    limits: ['Length alone does not determine pitch. A longer fold is not automatically a higher note.', 'This is relative cartilage motion, not head tilt or whole-larynx height. Do not try to move cartilage directly.', 'Fold thinning may accompany elongation; neither thinning nor muscle activation is measured here.'],
    sources: [larynx, joint],
    illustration: { view: 'Side view of the larynx; schematic and not to scale', before: 'Reference attachment separation', after: 'Illustrative greater separation with changed stiffness', movement: 'Relative thyroid–cricoid motion; vocal-fold attachments separate', caption: 'Slow motion illustrates a possible coordination. It does not show your muscles or measure your vibration.' },
  },
  { ...common, id: 'soft-palate-coupling', title: 'The mouth–nose connection',
    cues: [
      { id: 'ng-to-ah', text: 'Gently sustain “ng” as in “sing,” then release to an easy “ah.”', notice: 'Listen for a change in sound and notice the tongue release. Several structures change together.' },
      { id: 'repeat-release', text: 'Repeat one comfortable “ng–ah” and compare it with your previous attempt.', notice: 'Notice the difference without trying to force a particular palate position.' },
    ],
    mechanism: 'The velum, or soft palate, helps control the opening to the nasal pathway. Raising it can reduce nasal coupling, changing resonances and cancellations in the sound.',
    limits: ['More space is not automatically better resonance. Brightness is not the same as nasality.', 'No single palate position suits every vowel or goal. A yawn-like cue changes multiple structures.', 'Hearing a difference does not recover the opening’s shape or prove palate motion.'],
    sources: [acoustics],
    illustration: { view: 'Side cutaway of oral and nasal pathways', before: 'More open nasal connection', after: 'Reduced nasal connection', movement: 'Soft palate approaches the rear wall; the nasal opening narrows', caption: 'General pathway illustration; no measured opening size or personalized nasal prediction.' },
  },
  { ...common, id: 'tongue-jaw-vowels', title: 'Vowel shape and tone',
    cues: [
      { id: 'small-jaw-release', text: 'On an easy “ah,” allow a small jaw release while keeping the note comfortable.', notice: 'Listen for a tone change; keep pitch and level similar if you can.' },
      { id: 'vowel-contrast', text: 'At an easy pitch, alternate a gentle “ee” and “ah.”', notice: 'Compare vowel colour. Your tongue, lips and jaw may all move.' },
    ],
    mechanism: 'Tongue and jaw positions change tract constrictions. These alter which frequencies are reinforced, contributing to vowel differences.',
    limits: ['Visible jaw motion is not a measurement of the internal tongue.', 'A tract comparison assumes matched source and pitch; real attempts may change both. Fixed template surfaces are not fitted anatomy.'],
    sources: [acoustics],
    illustration: { view: 'Side cutaway of the mouth and throat', before: 'Reference tract shape', after: 'Illustrative changed tongue and jaw configuration', movement: 'Jaw and tongue positions change the passage', caption: 'General vowel illustration. A supported model comparison must identify its actual changed parameters.' },
  },
  { ...common, id: 'source-filter', title: 'Pitch and tone are different controls',
    cues: [
      { id: 'tone-at-one-note', text: 'Keep an easy note while gently changing “oo” toward “ah.”', notice: 'Listen for tone colour changing even if the note stays similar.' },
      { id: 'pitch-at-one-vowel', text: 'Keep an easy “oo” and try a small pitch glide.', notice: 'Compare a pitch change with the vowel change; neither trial isolates every structure.' },
    ],
    mechanism: 'Vocal-fold vibration supplies excitation. The vocal tract filters that sound, emphasizing some frequency regions. In a simplified model, source repetition sets the fundamental frequency and tract shape affects the spectral envelope.',
    limits: ['Source and filter interact in real voices; their separation is an approximation.', 'Tract gain is not the microphone spectrum. Compare like quantities from the same supported measurement method.', 'Conceptual waves and slowed vibration are illustrations. Numerical curves or audio require a declared operator and evidence.'],
    sources: [sourceFilter],
    illustration: { view: 'Source beside tract filter and radiated sound', before: 'Reference source and tract', after: 'Illustrative filter change with source held fixed', movement: 'Highlight the tract separately from the vibrating source', caption: 'Conceptual source–filter view; no measured wave propagation. Model synthesis, when available, is not your future voice.' },
  },
]

/** Exact allow-list lookup for untrusted coaching IDs; no fallback to an unrelated mechanism. */
export function getMechanism(id: unknown): Mechanism | undefined {
  return typeof id === 'string' ? MECHANISMS.find(item => item.id === id) : undefined
}
export function getCue(demonstrationId: unknown, cueId: unknown) {
  return typeof cueId === 'string' ? getMechanism(demonstrationId)?.cues.find(cue => cue.id === cueId) : undefined
}
