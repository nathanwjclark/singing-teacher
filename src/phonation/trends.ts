export type AcousticSample = { pitch: number; periodicity: number; slope: number | null; flatness: number | null }
export type Reference = { samples: AcousticSample[]; processingKey?: string }
export const REFERENCE_WINDOWS = 5

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

/** A repeatability comparison, not a calibrated clinical significance test. */
export function compareToReference(reference: Reference, current: AcousticSample): string {
  if (reference.samples.length < REFERENCE_WINDOWS) return `Building your reference: ${reference.samples.length}/${REFERENCE_WINDOWS} usable windows.`
  const pitch = average(reference.samples.map(sample => sample.pitch))
  if (Math.abs(1200 * Math.log2(current.pitch / pitch)) > 100) return 'Match the reference pitch before comparing tone.'
  const values = reference.samples.map(sample => sample.periodicity)
  const mean = average(values)
  const sd = Math.sqrt(average(values.map(value => (value - mean) ** 2)))
  const difference = current.periodicity - mean
  if (Math.abs(difference) <= Math.max(0.03, 2 * sd)) return 'Periodicity is within your reference variation. This does not establish vocal-fold closure.'
  return `The sound is ${difference > 0 ? 'more' : 'less'} periodic than your reference. Keep the vowel, microphone position and comfortable level consistent; this is an acoustic change, not a closure measurement.`
}

export function addReferenceSample(reference: Reference, sample: AcousticSample): Reference {
  if (reference.samples.length >= REFERENCE_WINDOWS) return reference
  if (reference.samples.length && Math.abs(1200 * Math.log2(sample.pitch / average(reference.samples.map(item => item.pitch)))) > 100) return reference
  return { ...reference, samples: [...reference.samples, sample] }
}

export function referenceForProcessing(reference: Reference, processingKey: string): Reference {
  return reference.processingKey === processingKey ? reference : { samples: [], processingKey }
}
