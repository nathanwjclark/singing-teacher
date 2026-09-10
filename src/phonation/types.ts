export type CapabilityStatus = 'disabled' | 'unsupported' | 'insufficient-quality' | 'timed-out' | 'failed' | 'available';
export interface PhonationCapability { status: CapabilityStatus; reason: string | null; evidenceAt: string | null }
export interface PhonationMetadata {
 observationId: string; sessionId: string; attemptId: string; artifactId: string;
 sourceHashes: string[]; evidenceAt: string | null; windowStartSample: number; clockId: string;
 syncUncertaintyMs: number | null; sourceKind: 'human-observation' | 'engine-generated' | 'development-fixture';
 processing: { automaticGainControl: boolean | null; noiseSuppression: boolean | null; echoCancellation: boolean | null };
}
export interface Descriptor { value: number | null; unit: string; reason: string | null }
export interface PhonationObservation {
 schemaVersion: 'phonation-observation-1.0.0'; extractorVersion: string; configurationVersion: string;
 observationId: string; sessionId: string; attemptId: string; artifactId: string;
 sourceHashes: string[]; frameSha256: string | null; hashScope: 'little-endian-float32-frame-bytes';
 evidenceAt: string | null; sourceKind: PhonationMetadata['sourceKind']; processing: PhonationMetadata['processing'];
 window: { sampleRateHz: number; startSample: number; sampleCount: number; clockId: string; syncUncertaintyMs: number | null };
 capabilities: { measurement: PhonationCapability; sourceInference: PhonationCapability; coaching: PhonationCapability };
 descriptors: { pitchHz: Descriptor; periodicity: Descriptor; spectralFlatness: Descriptor; harmonicSpectralSlopeDbOctave: Descriptor };
 qualityFlags: string[]; limitations: string[];
}
