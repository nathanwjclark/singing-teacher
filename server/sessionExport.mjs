import {open, readdir, realpath} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';

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
      const summary = {
        modelId: state?.snapshot?.model_id || null,
        sessionVersion: state?.version ?? null,
        eventCount: replay?.events.length || 0,
        decisionCount: artifacts.filter(a => a.source.startsWith('astra-decisions/')).length,
        attemptCount: state?.attempts?.length || 0,
        scoreCount: (state?.jobs || []).filter(job => job.result?.scores).length,
        probeFitCount: artifacts.filter(a => a.source.startsWith('probe-fits/')).length,
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
