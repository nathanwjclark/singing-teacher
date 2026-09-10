/** Desktop-only transport to the private scientific worker; never exposes its token. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_REQUEST = 2_000_000, MAX_RESPONSE = 16_000_000;
function reply(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}
export function createScienceProxy({url, token, timeoutMs = 30_000, fetchImpl = fetch} = {}) {
  if (!url && !token) return null;
  const upstream = new URL(url);
  if (upstream.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(upstream.hostname) ||
      upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash ||
      typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) {
    throw Error('Scientific service requires a loopback HTTP origin and private token of at least 32 characters');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw Error('Invalid scientific timeout');
  return async function scienceProxy(req, res) {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return reply(res, 403, {error: 'Scientific tools are available only from this computer'});
    // Protect reads as well as writes: a LAN or cross-site browser may not use
    // the local server as a credentialed proxy. Non-browser local CLI is allowed.
    try {
      const local = new URL(`http://${req.headers.host}`);
      if (!['127.0.0.1', '[::1]', 'localhost'].includes(local.hostname)) return reply(res, 403, {error: 'Use the desktop localhost address for scientific tools'});
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== local.host || origin.protocol !== (req.socket.encrypted ? 'https:' : 'http:')) return reply(res, 403, {error: 'Cross-origin scientific access refused'});
      }
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return reply(res, 403, {error: 'Cross-site scientific access refused'});
    } catch { return reply(res, 403, {error: 'Invalid desktop origin'}); }
    const path = req.url.slice('/api/science'.length);
    if (!/^\/(health|capabilities|models|jobs(?:\/[A-Za-z0-9_-]+(?:\/(?:result|cancel))?)?|sessions(?:\/[A-Za-z0-9_-]+(?:\/(?:commands|state|replay))?)?)$/.test(path)) return reply(res, 404, {error: 'Unknown scientific route'});
    if (!['GET', 'POST'].includes(req.method)) return reply(res, 405, {error: 'Method not allowed'});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      let body;
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, {error: 'Expected JSON'});
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_REQUEST) return reply(res, 413, {error: 'Scientific request exceeds 2 MB'});
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const response = await fetchImpl(new URL(path, upstream), {method: req.method, body,
        headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
        redirect: 'error', signal: controller.signal});
      let size = 0; const chunks = [];
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > MAX_RESPONSE) { controller.abort(); throw Error('Oversized upstream response'); }
        chunks.push(Buffer.from(chunk));
      }
      // Do not pass through upstream headers, error tracebacks, or credentials.
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      return reply(res, response.status, payload);
    } catch {
      if (!res.destroyed) return reply(res, controller.signal.aborted ? 504 : 502,
        {error: 'Scientific service unavailable; inspect its local job log'});
    } finally { clearTimeout(timeout); res.off('close', abort); }
  };
}
