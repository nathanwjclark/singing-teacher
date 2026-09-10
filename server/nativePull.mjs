import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const run = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const archiveName = /^(capture|probe|session)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/i;
const limit = 512 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const options = timeout => ({ timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
async function digest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function fileStat(file) { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function message(error) {
  const details = `${error.message ?? ''} ${error.stderr ?? ''} ${error.stdout ?? ''}`;
  if (/locked|protected|permission denied|not permitted|unlock|deviceislocked/i.test(details)) return 'Unlock the connected iPhone, leave it unlocked, then click Pull iPhone again.';
  if (/timed out|timeout|killed|unavailable|not found|not connected|no device|could not find/i.test(details)) return 'The iPhone could not be reached. Connect it by USB, unlock it, accept Trust if prompted, and try again.';
  return 'USB transfer did not finish. Keep the iPhone connected and unlocked, then try again. Existing captures were preserved.';
}

/** Fixed private device configuration; no client paths, device IDs, or shell commands.
 * Wire before the API fallback: if (await routes(req,res,url)) return;
 */
export function createNativePullRoutes({ repo, dataRoot, json }) {
  let inFlight = false;
  const receiptFile = join(dataRoot, 'native-pull-latest.json');
  async function pull() {
    let config;
    try { config = JSON.parse(await readFile(join(dataRoot, 'iphone-device.json'), 'utf8')); }
    catch { throw fail('This Mac has no configured iPhone. Set its private iphone-device.json deviceId first.', 503); }
    if (!uuid.test(config.deviceId ?? '')) throw fail('The private iPhone device configuration is invalid.', 503);
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const job = await mkdtemp(join(dataRoot, 'usb-pull-'));
    await chmod(job, 0o700);
    const listFile = join(job, 'device-files.json');
    const device = ['--device', config.deviceId, '--domain-type', 'appDataContainer', '--domain-identifier', 'com.singingteacher.depth'];
    try {
      await run('xcrun', ['devicectl', 'device', 'info', 'files', ...device, '--subdirectory', 'Documents', '--no-recurse', '--timeout', '20', '--json-output', listFile], options(25_000));
    } catch (error) { throw fail(message(error), 503); }
    const listing = JSON.parse(await readFile(listFile, 'utf8'));
    const files = listing.result?.files;
    if (!Array.isArray(files)) throw fail('The iPhone file list was unavailable. Unlock it and try again.', 503);
    const selected = files.filter(item => archiveName.test(item.name ?? '') && item.relativePath === item.name
      && item.resources?.isDirectory === false && item.resources?.isSymbolicLink === false
      && Number.isSafeInteger(item.metadata?.size) && item.metadata.size > 0 && item.metadata.size <= limit
      && Number.isFinite(Date.parse(item.metadata?.lastModDate)))
      .sort((a, b) => Date.parse(b.metadata.lastModDate) - Date.parse(a.metadata.lastModDate) || a.name.localeCompare(b.name))[0];
    if (!selected) throw fail('No completed capture ZIP is on the iPhone yet. Finish and save a capture, then try again.', 404);
    const imports = join(dataRoot, 'usb-imports');
    await mkdir(imports, { recursive: true, mode: 0o700 });
    const target = join(imports, selected.name), existing = await fileStat(target);
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.size !== selected.metadata.size)) {
      throw fail('The existing local capture disagrees with the phone file size. Both originals were left unchanged; review the local file before importing again.', 409);
    }
    if (!existing) {
      const temporary = join(job, selected.name);
      try {
        await run('xcrun', ['devicectl', 'device', 'copy', 'from', ...device, '--source', `Documents/${selected.name}`, '--destination', temporary, '--timeout', '80', '--json-output', join(job, 'copy-result.json')], options(85_000));
      } catch (error) { throw fail(message(error), 503); }
      const copied = await fileStat(temporary);
      if (!copied?.isFile() || copied.isSymbolicLink() || copied.size !== selected.metadata.size) throw fail('The transferred size does not match the phone. The incomplete download is retained privately; try again.', 502);
      await chmod(temporary, 0o600);
      await rename(temporary, target);
    }
    const receipt = {
      name: selected.name, bytes: selected.metadata.size, phoneModifiedAt: selected.metadata.lastModDate,
      receivedAt: new Date().toISOString(), reused: !!existing, sha256: await digest(target),
      verification: 'downloaded-only', source: 'configured-iphone-app-container',
      message: 'Saved privately. This archive has not yet been validated for model use.',
    };
    if (selected.name.startsWith('capture-')) {
      let python = join(repo, 'science', '.venv', 'bin', 'python');
      try { await access(python); } catch { python = '/usr/bin/python3'; }
      try {
        const reportFile = join(job, 'depth-review.json');
        await run(python, [join(repo, 'scripts', 'review-native-depth.py'), target, '--output', reportFile], options(80_000));
        const report = JSON.parse(await readFile(reportFile, 'utf8'));
        if (report.kind !== 'native-depth-coverage-review' || !Number.isSafeInteger(report.callbacks)
          || String(report.capture_id).toUpperCase() !== selected.name.slice(8, -4).toUpperCase()) throw new Error('Invalid review result or capture ID');
        receipt.verification = 'native-rgbd-verified';
        receipt.captureId = report.capture_id;
        receipt.frames = report.callbacks;
        receipt.depthFrames = report.frames_with_depth;
        receipt.rgbFrames = report.frames_with_rgb;
        receipt.audioChunks = report.verified_audio_chunks;
        receipt.message = `${existing ? 'Already here; reverified' : 'Pulled and verified'} ${report.callbacks} frames and ${report.verified_audio_chunks} audio chunks. Depth coverage still needs review.`;
      } catch {
        receipt.message = 'Saved privately, but native validation did not pass. The original ZIP is retained; do not use it as verified model input yet.';
      }
    } else if (selected.name.startsWith('session-')) {
      receipt.message = 'Linked video/sound session downloaded. Its original nested archives still need validation before model use.';
    } else {
      receipt.message = 'Sound capture downloaded. Import it in Acoustic mapping to validate and analyze the response.';
    }
    const pending = join(job, 'receipt.json');
    await writeFile(pending, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(pending, receiptFile);
    return receipt;
  }
  return async function nativePullRoutes(req, res, url) {
    if (!['/api/native-captures/pull', '/api/native-captures/latest'].includes(url.pathname)) return false;
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    let hostAllowed = false, originAllowed = false;
    try {
      hostAllowed = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname);
      originAllowed = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;
    } catch { /* Reject malformed origin/host. */ }
    if (!['127.0.0.1', '::1'].includes(remote) || !hostAllowed || !originAllowed) {
      json(res, 403, { error: 'Pull captures from this Mac using its localhost page.' }); return true;
    }
    if (url.search || Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding']) {
      json(res, 400, { error: 'This action takes no parameters.' }); return true;
    }
    if (url.pathname.endsWith('/latest') && req.method === 'GET') {
      let receipt = null;
      try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); } catch { /* No previous receipt. */ }
      json(res, 200, { inFlight, receipt }); return true;
    }
    if (!url.pathname.endsWith('/pull') || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return true; }
    if (inFlight) { json(res, 409, { error: 'An iPhone pull is already running. Keep the phone unlocked until it finishes.' }); return true; }
    inFlight = true;
    try { json(res, 200, { receipt: await pull() }); }
    catch (error) { json(res, error.status ?? 500, { error: error.status ? error.message : 'The private import could not finish. Existing files were preserved.' }); }
    finally { inFlight = false; }
    return true;
  };
}
