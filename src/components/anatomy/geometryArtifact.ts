import { validateRecord, type CandidateAnatomy } from '../../contracts';

/** A file is displayed only after verification against the selected engine record. */
export async function verifyGeometry(file: File, candidate: CandidateAnatomy): Promise<ArrayBuffer> {
  const validation = validateRecord(candidate);
  if (!validation.valid) throw new Error(validation.errors[0]);
  if (candidate.availability !== 'available' || !candidate.geometry || candidate.provenance.kind !== 'engine-generated') {
    throw new Error('Mapped anatomy requires available engine-generated geometry.');
  }
  if (file.size > 64 * 1024 * 1024) throw new Error('Choose geometry smaller than 64 MB.');
  if (file.size !== candidate.geometry.byteLength) throw new Error('Geometry size does not match this candidate.');
  const bytes = await file.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (digest !== candidate.geometry.sha256) throw new Error('Geometry SHA-256 does not match this candidate.');
  const view = new DataView(bytes);
  let json: string;
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67) {
    if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Invalid GLB v2 geometry.');
    json = new TextDecoder().decode(bytes.slice(20, 20 + view.getUint32(12, true)));
  } else json = new TextDecoder().decode(bytes);
  const document = JSON.parse(json);
  for (const item of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (item.uri && !item.uri.startsWith('data:')) throw new Error('Use a self-contained GLB or glTF with embedded resources. External files are not fetched.');
  }
  return bytes;
}

