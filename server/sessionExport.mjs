import {verifiedVisualForecasts} from './visualContext.mjs';
import {open, readdir, realpath} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 100;
const sensitive = /^(authorization|api[_-]?key|openai_api_key|science_token|token|access_token|refresh_token|password|secret|credential)$/i;
const media = /^(pcm|base64|pcm_base64|audio_base64|data_base64|imageDataUrl|audioDataUrl)$/i;

function local(req) {
  try {
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    const host = req.headers.host;
    return ['127.0.0.1', '::1'].includes(remote) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + host).hostname)
      && (!req.headers.origin || ['http://' + host, 'https://' + host].includes(req.headers.origin));
  } catch { return false; }
}

async function responseBytes(response) {
  if (!response.body) throw Error('Worker returned no replay');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw Error('Worker replay exceeds export size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createSessionExportRoutes({dataRoot, json, fetchImpl = fetch, env = process.env}) {
  return async (req, res, url) => {
    if (url.pathname !== '/api/session-export') return false;
    if (!local(req)) { json(res, 403, {error: 'Open session replay on this computer’s localhost page.'}); return true; }
    if (req.method !== 'GET' || url.search) { json(res, 405, {error: 'Session export is a read-only action without parameters.'}); return true; }
    try {
      const root = await realpath(dataRoot);
      let totalBytes = 0;
      async function read(source) {
        const path = await realpath(resolve(root, source));
        if (path !== root && !path.startsWith(root + sep)) throw Error('Artifact leaves private data root');
        const handle = await open(path, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_BYTES) throw Error('Artifact exceeds export size limit');
          const buffer = Buffer.alloc(stat.size + 1);
          const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead !== stat.size) throw Error('Artifact changed during export');
          const bytes = buffer.subarray(0, bytesRead);
          totalBytes += bytesRead;
          return {source, sha256: hash(bytes), byteLength: bytesRead, data: JSON.parse(bytes.toString('utf8'))};
        } finally { await handle.close(); }
      }
      const index = await read('science-current.json');
      if (index.data.status !== 'succeeded' || !safeId(index.data.runId)) throw Error('A completed current model run is required.');
      const runId = index.data.runId, prefix = 'science-runs/' + runId;
      const original = await read(prefix + '/summary.json');
      const sessionId = original.data.sessionId;
      if (!safeId(sessionId)) throw Error('Current model run has no valid session identity.');
      const artifacts = [index, original], missing = [], omissions = [];
      async function optional(source, belongs = () => true) {
        if (artifacts.length >= MAX_FILES) { missing.push({source, reason: 'Artifact count limit reached'}); return; }
        try {
          const artifact = await read(source);
          if (belongs(artifact.data)) artifacts.push(artifact);
          else missing.push({source, reason: 'Artifact belongs to another session or run; excluded'});
        } catch (error) { missing.push({source, reason: error.code === 'ENOENT' ? 'Not recorded' : 'Unavailable, invalid or exceeds bounded export size'}); }
      }
      async function folders(source) {
        try {
          const path = await realpath(resolve(root, source));
          if (!path.startsWith(root + sep)) throw Error('Invalid artifact directory');
          const names = (await readdir(path, {withFileTypes: true})).filter(row => row.isDirectory() && safeId(row.name)).map(row => row.name).sort();
          if (names.length > MAX_FILES) missing.push({source, reason: 'Directory exceeds artifact limit; only first 100 folders inspected'});
          return names.slice(0, MAX_FILES);
        } catch { return []; }
      }
      let replay = null, workerLedgerSha256 = null, workerBase = null;
      try {
        const base = new URL(env.SCIENCE_URL || 'http://invalid');
        if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !env.SCIENCE_TOKEN) throw Error('Shared worker unavailable');
        workerBase = base;
        const response = await fetchImpl(new URL(`/sessions/${sessionId}/replay`, base), {headers: {Authorization: 'Bearer ' + env.SCIENCE_TOKEN}, redirect: 'error', signal: AbortSignal.timeout(15000)});
        if (!response.ok) { await response.body?.cancel(); throw Error('Worker rejected replay'); }
        const bytes = await responseBytes(response);
        replay = JSON.parse(bytes.toString('utf8'));
        if (replay.state?.session_id !== sessionId || !Number.isSafeInteger(replay.state.version) || !Array.isArray(replay.events) || !/^[a-f0-9]{64}$/.test(replay.ledger_sha256 || '')) throw Error('Worker replay identity is invalid');
        workerLedgerSha256 = replay.ledger_sha256;
      } catch { replay = null; missing.push({source: 'worker/session-replay', reason: 'Authoritative worker replay unavailable or invalid. Saved receipts are historical; current model and event chain are unconfirmed.'}); }
      const inSession = value => value.sessionId === sessionId;
      await optional(prefix + '/astra-current.json', inSession);
      await optional(prefix + '/astra-rest.json', inSession);
      await optional('learning-memory/' + sessionId + '.json', inSession);
      try {
        const names = (await readdir(resolve(root, 'astra-decisions', sessionId))).filter(name => /^[A-Za-z0-9_-]{1,160}\.json$/.test(name)).sort();
        if (names.length > MAX_FILES) missing.push({source: 'astra-decisions', reason: 'Decision receipt count exceeds export limit'});
        for (const name of names.slice(0, MAX_FILES)) await optional(`astra-decisions/${sessionId}/${name}`, value => inSession(value) && value.runId === runId);
      } catch { missing.push({source: 'astra-decisions', reason: 'No retained Astra decision receipts available'}); }
      for (const name of await folders(prefix + '/outcomes')) await optional(`${prefix}/outcomes/${name}/summary.json`, inSession);
      for (const name of await folders('probe-fits')) {
        const source = `probe-fits/${name}/summary.json`;
        // Probe fits can span sessions. Only matching receipts belong in this export.
        try { const artifact = await read(source); if (inSession(artifact.data) && artifacts.length < MAX_FILES) artifacts.push(artifact); } catch { /* Incomplete optional probe fits remain represented by the authoritative job ledger. */ }
      }
      const state = replay?.state;
      const knownModels = new Set([original.data.modelId, state?.snapshot?.model_id,
        ...(replay?.events || []).map(event => event.state?.snapshot?.model_id)].filter(Boolean));
      let verifiedMotionBytes = 0, inspectedMotionAnalyses = 0;
      const verifiedCaptures = new Map();
      async function digestOriginal(source, limit) {
        const path = await realpath(resolve(root, source));
        if (!path.startsWith(root + sep)) throw Error('Original leaves private root');
        const handle = await open(path, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > limit || verifiedMotionBytes + stat.size > 128 * 1024 * 1024) throw Error('Original verification size limit');
          verifiedMotionBytes += stat.size;
          const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
          let size = 0;
          for (;;) {
            const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            size += bytesRead;
            if (size > stat.size) throw Error('Original changed while verifying');
            digest.update(buffer.subarray(0, bytesRead));
          }
          if (size !== stat.size) throw Error('Original changed while verifying');
          return {sha256: digest.digest('hex'), byteLength: size};
        } finally { await handle.close(); }
      }
      for (const captureId of await folders('motion-analyses')) {
        if (!/^[a-f0-9]{64}$/.test(captureId)) continue;
        for (const analysisId of await folders('motion-analyses/' + captureId)) {
          if (++inspectedMotionAnalyses > MAX_FILES || artifacts.length >= MAX_FILES) {
            missing.push({source: 'motion-analyses', reason: 'Motion analysis receipt count exceeds export limit'}); break;
          }
          const source = `motion-analyses/${captureId}/${analysisId}/summary.json`;
          try {
            const artifact = await read(source), result = artifact.data;
            // The unbound 2D capture and decoder failures carry no session identity.
            // Only an actual audio-analysis receipt can associate this evidence.
            if (result.sessionId !== sessionId) continue;
            if (result.kind !== 'motion-pcm-fit-1' || result.captureId !== captureId || !knownModels.has(result.modelId)
              || result.modelUpdated !== false) throw Error('Motion analysis session/model binding invalid');
            let receipt = verifiedCaptures.get(captureId);
            if (!receipt) {
              receipt = await read(`motion-captures/${captureId}/summary.json`);
              const record = await digestOriginal(`motion-captures/${captureId}/record.json`, 4 * 1024 * 1024);
              const media = await digestOriginal(`motion-captures/${captureId}/media`, 64 * 1024 * 1024);
              if (receipt.data.id !== captureId || receipt.data.recordSha256 !== record.sha256 || receipt.data.mediaSha256 !== media.sha256
                || receipt.data.mediaByteLength !== media.byteLength || hash(record.sha256 + media.sha256) !== captureId) throw Error('Motion original evidence mismatch');
              verifiedCaptures.set(captureId, receipt);
            }
            if (result.sourceHashes?.receipt !== receipt.sha256 || result.sourceHashes?.record !== receipt.data.recordSha256
              || result.sourceHashes?.media !== receipt.data.mediaSha256) throw Error('Motion source hashes mismatch');
            const binding = {sessionId, modelId: result.modelId, captureId,
              current: state?.snapshot ? result.modelId === state.snapshot.model_id : null,
              role: 'conditional-motion-audio-analysis', originalBytesVerified: true, modelUpdated: false};
            artifacts.push({...artifact, binding});
            if (!artifacts.some(a => a.source === receipt.source)) {
              if (artifacts.length < MAX_FILES) artifacts.push({...receipt, binding: {...binding, current: null, role: 'original-motion-capture-receipt'}});
              else missing.push({source: receipt.source, reason: 'Artifact count limit reached'});
            }
          } catch { missing.push({source, reason: 'Motion analysis or original hashes are invalid, unavailable or exceed verification bounds; excluded'}); }
        }
        if (inspectedMotionAnalyses > MAX_FILES || artifacts.length >= MAX_FILES) break;
      }
      for (const fitId of await folders('lidar-fits')) {
        const source = `lidar-fits/${fitId}/summary.json`;
        if (artifacts.length >= MAX_FILES) { missing.push({source, reason: 'Artifact count limit reached'}); break; }
        try {
          const artifact = await read(source), result = artifact.data;
          if (result.sessionId !== sessionId) continue;
          const job = state?.jobs?.find(row => row.job_id === result.jobId && row.request?.operation === 'rank_lidar_hypotheses');
          const adoption = state?.lidar_fusions?.find(row => row.job_id === result.jobId);
          if (!job || !adoption || !isDeepStrictEqual(job.result, result.result) || !isDeepStrictEqual(adoption, result.adoption)
              || result.fitId !== fitId || !knownModels.has(result.modelId) || !/^[a-f0-9]{64}$/.test(result.importId)) throw Error('LiDAR receipt is not bound to authoritative session');
          const original = await digestOriginal(`lidar-imports/${result.importId}/original.zip`, 128 * 1024 * 1024);
          if (original.sha256 !== result.archiveSha256 || original.sha256 !== result.importId) throw Error('Original LiDAR archive changed');
          artifacts.push({...artifact, binding: {sessionId, modelId: result.modelId, current: result.modelId === state.snapshot?.model_id,
            role: 'experimental-lidar-fusion', originalBytesVerified: true, modelUpdated: adoption.model_updated === true}});
          const declarationSource = `lidar-fits/${fitId}/experimental-declaration.json`;
          try {
            const declaration = await read(declarationSource);
            const annotation = job.result.annotation;
            if (!annotation?.registration?.source_hashes?.includes(declaration.sha256)
                || !annotation?.correspondence?.source_hashes?.includes(declaration.sha256)) throw Error('Declaration changed');
            if (artifacts.length < MAX_FILES) artifacts.push(declaration);
            else missing.push({source: declarationSource, reason: 'Artifact count limit reached'});
          } catch { missing.push({source: declarationSource, reason: 'Declaration is unavailable or does not match the frozen annotation hashes'}); }
        } catch { missing.push({source, reason: 'LiDAR receipt, original archive or authoritative lineage unavailable or exceeds verification bounds; excluded'}); }
      }
      const verifiedVisual = verifiedVisualForecasts(state);
      for (const visualId of await folders('visual-runs')) {
        const source = `visual-runs/${visualId}/summary.json`;
        if (artifacts.length >= MAX_FILES) { missing.push({source, reason: 'Artifact count limit reached'}); break; }
        try {
          const artifact = await read(source), result = artifact.data;
          if (result.sessionId !== sessionId) continue;
          const verified = verifiedVisual.find(v => v.forecastId === result.forecastId);
          const envelope = result.operation === 'freeze' ? verified?.entry.artifact : result.operation === 'score' ? verified?.score : null;
          if (!envelope || !isDeepStrictEqual(envelope, result.result) || result.modelUpdated !== false
              || result.baselineModelId !== verified.entry.baseline_model_id || !/^[a-f0-9]{64}$/.test(result.captureId)) throw Error('Unbound visual result');
          const prefix = `motion-captures/${result.captureId}`;
          const receipt = await read(`${prefix}/summary.json`);
          const record = await digestOriginal(`${prefix}/record.json`, 4 * 1024 * 1024);
          const media = await digestOriginal(`${prefix}/media`, 64 * 1024 * 1024);
          if (receipt.sha256 !== result.sourceHashes?.receipt || record.sha256 !== result.sourceHashes?.record
              || media.sha256 !== result.sourceHashes?.media || receipt.data.recordSha256 !== record.sha256
              || receipt.data.mediaSha256 !== media.sha256 || receipt.data.mediaByteLength !== media.byteLength
              || hash(record.sha256 + media.sha256) !== result.captureId) throw Error('Changed original visual evidence');
          artifacts.push({...artifact,binding:{sessionId,modelId:result.baselineModelId,
            current:result.baselineModelId === state.snapshot?.model_id,role:'conditional-visual-annotation-holdout',originalBytesVerified:true,modelUpdated:false}});
        } catch { missing.push({source,reason:'Visual receipt or original video does not match authoritative session; excluded'}); }
      }
      const summary = {
        modelId: state?.snapshot?.model_id || null,
        sessionVersion: state?.version ?? null,
        eventCount: replay?.events.length || 0,
        decisionCount: artifacts.filter(a => a.source.startsWith('astra-decisions/')).length,
        attemptCount: state?.attempts?.length || 0,
        scoreCount: (state?.jobs || []).filter(job => job.result?.scores).length,
        probeFitCount: artifacts.filter(a => a.source.startsWith('probe-fits/')).length,
        lidarFusionCount: (state?.lidar_fusions || []).filter(row => row.status === 'adopted').length,
        sourceBankScoreCount: (state?.source_receipts || []).filter(row => row.operation === 'score_phonation_bank').length,
        visualResultCount: artifacts.filter(a => a.binding?.role === 'conditional-visual-annotation-holdout').length,
        motionAnalysisCount: artifacts.filter(a => a.binding?.role === 'conditional-motion-audio-analysis').length,
      };
      // Recheck the app pointer after asynchronous collection; never mix two active runs.
      const finalIndex = await read('science-current.json');
      if (finalIndex.data.runId !== runId || finalIndex.data.status !== 'succeeded') { json(res, 409, {error: 'Current model run changed during export. Refresh and export again.'}); return true; }
      if (replay) {
        try {
          const response = await fetchImpl(new URL(`/sessions/${sessionId}/state`, workerBase), {headers: {Authorization: 'Bearer ' + env.SCIENCE_TOKEN}, redirect: 'error', signal: AbortSignal.timeout(15000)});
          if (!response.ok) { await response.body?.cancel(); throw Error('Worker state unavailable'); }
          const finalState = JSON.parse((await responseBytes(response)).toString('utf8'));
          if (finalState.state?.session_id !== sessionId || finalState.ledger_sha256 !== workerLedgerSha256 || finalState.state.version !== state.version) {
            json(res, 409, {error: 'Scientific session changed during export. Refresh and export again.'}); return true;
          }
        } catch { json(res, 409, {error: 'Could not confirm the scientific session stayed current during export. Refresh and export again.'}); return true; }
      }
      const secrets = [env.OPENAI_API_KEY, env.SCIENCE_TOKEN].filter(value => typeof value === 'string' && value.length >= 8);
      function redact(value, path = '', depth = 0) {
        if (depth > 80) { omissions.push({path, reason: 'Nested value exceeds export depth limit'}); return null; }
        if (typeof value === 'string') {
          if (value.includes(root + sep)) { omissions.push({path, reason: 'Private data-root path replaced'}); value = value.replaceAll(root + sep, '[private-data-root]/'); }
          if (/^data:(audio|video|image)\//.test(value) || secrets.some(secret => value.includes(secret))) { omissions.push({path, reason: 'Media or credential value omitted'}); return null; }
          // Embedded scientific request JSON also contains PCM; parse and redact it rather than leak media inside a string.
          if (value.startsWith('{') || value.startsWith('[')) { try { const parsed = JSON.parse(value); return JSON.stringify(redact(parsed, path + ':json', depth + 1)); } catch { /* Ordinary free-form text stays text. */ } }
          return value;
        }
        if (Array.isArray(value)) return value.map((item, i) => redact(item, path + '/' + i, depth + 1));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
          const child = path + '/' + key;
          if (sensitive.test(key) || media.test(key)) {
            omissions.push({path: child, reason: sensitive.test(key) ? 'Credential field omitted' : 'Raw media omitted; retain original recording separately'});
            return [key, {omitted: true, ...(media.test(key) ? {jsonValueSha256: hash(JSON.stringify(item))} : {})}];
          }
          return [key, redact(item, child, depth + 1)];
        }));
      }
      const cleanReplay = redact(replay, '/replay');
      const cleanArtifacts = artifacts.map((artifact, i) => ({...artifact, data: redact(artifact.data, '/artifacts/' + i + '/data')}));
      const result = {
        schemaVersion: 'singing-session-export/1', exportedAt: new Date().toISOString(), runId, sessionId,
        status: missing.length ? 'partial' : 'complete', summary, missing, replay: cleanReplay,
        artifacts: cleanArtifacts, omissions, workerLedgerSha256,
        limits: {rawMediaIncluded: false, scientificAccuracyValidated: false,
          interpretation: 'Inspection replay of the authoritative session and saved receipts. Original artifact and ledger hashes refer to retained originals; redacted payloads cannot reproduce their original hashes. Keep original media separately for numerical reruns.'},
      };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) { json(res, 413, {error: 'Session metadata exceeds the 24 MiB export limit. Original evidence remains retained.'}); return true; }
      json(res, 200, result); return true;
    } catch { json(res, 409, {error: 'Current scientific session metadata is unavailable or invalid. Complete a model run before exporting.'}); return true; }
  };
}
