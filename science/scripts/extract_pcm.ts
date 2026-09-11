/** Exact Lead-B PCM extractor and contract validator, callable from scientific Python. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractAudioMeasurement, AUDIO_EXTRACTOR_VERSION, audioFrameSize } from '../../src/lib/audio.ts';
import { validateRecord, CONTRACT_VERSION } from '../../src/contracts/index.ts';
let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
  if (text.length > 4_000_000) throw Error('PCM bridge input exceeds 4 MB');
}
const input = JSON.parse(text);
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const extractorSha256 = digest(await readFile(new URL('../../src/lib/audio.ts', import.meta.url)));
const contractsSha256 = digest(await readFile(new URL('../../src/contracts/index.ts', import.meta.url)));
// The Python caller checks this against the bridge hash it pinned at import, then drops it.
const bridgeSha256 = digest(await readFile(new URL(import.meta.url)));
const provenance = { extractorVersion: AUDIO_EXTRACTOR_VERSION, contractVersion: CONTRACT_VERSION, extractorSha256, contractsSha256, bridgeSha256 };
if (input.operation === 'validate') {
  if (!Array.isArray(input.records) || input.records.length > 100) throw Error('Expected bounded records');
  for (const record of input.records) {
    const check = validateRecord(record);
    if (!check.valid) throw Error(check.errors.join('; '));
    if (record.kind !== 'audio-measurement') throw Error('Expected audio-measurement');
  }
  if (!Array.isArray(input.sampleRates) || input.sampleRates.some((rate: unknown) => typeof rate !== 'number')) throw Error('Expected sample rates');
  process.stdout.write(JSON.stringify({ ...provenance, valid: true, audioProfiles: input.sampleRates.map((rate: number) => ({sampleRate: rate, frameSize: audioFrameSize(rate)})) }));
} else if (input.operation === 'extract') {
  if (!Array.isArray(input.pcm) || input.pcm.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) throw Error('Expected finite numeric PCM');
  if (input.pcm.length !== audioFrameSize(input.sampleRate)) throw Error('PCM must use canonical audioFrameSize');
  const waveform = Float32Array.from(input.pcm);
  if (waveform.some(v => !Number.isFinite(v))) throw Error('PCM overflows float32');
  const raw = Buffer.alloc(waveform.length * 4);
  waveform.forEach((v, i) => raw.writeFloatLE(v, i * 4));
  const measurement = extractAudioMeasurement(waveform, input.sampleRate, {
    ...input.metadata, sourceHashes: [digest(raw)],
    qualityFlags: [...(input.metadata.qualityFlags ?? []), ...(waveform.some(v => Math.abs(v) >= .995) ? ['clipping'] : [])],
  });
  const check = validateRecord(measurement);
  if (!check.valid) throw Error(check.errors.join('; '));
  process.stdout.write(JSON.stringify({ ...provenance, measurement, pcmFloat32Sha256: digest(raw) }));
} else throw Error('Unsupported PCM bridge operation');
