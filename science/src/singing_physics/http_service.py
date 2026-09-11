"""Authenticated loopback HTTP transport for durable scientific jobs."""
from __future__ import annotations

import argparse
from concurrent.futures import Future
import base64
import hashlib
import stat
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import multiprocessing as mp
import os
import re
import threading
from urllib.parse import urlsplit

from .service import JobService


def _native_capabilities(connection):
    try:
        from .engine import Engine
        with Engine() as engine:
            connection.send({'capabilities': engine.capabilities()})
    except Exception as exc:
        connection.send({'error': str(exc)})
    finally:
        connection.close()


def capabilities(timeout_s=30):
    context = mp.get_context('spawn')
    reader, writer = context.Pipe(duplex=False)
    process = context.Process(target=_native_capabilities, args=(writer,), daemon=True)
    try:
        process.start(); writer.close()
        if not reader.poll(timeout_s):
            raise RuntimeError('Native capabilities timed out')
        result = reader.recv()
        if 'error' in result:
            raise RuntimeError('Native capabilities unavailable: '+result['error'])
        return result['capabilities']
    finally:
        reader.close(); writer.close()
        if process.pid is not None:
            process.join(timeout=1)
            if process.is_alive():
                process.terminate(); process.join(timeout=1)
            if process.is_alive():
                process.kill(); process.join()
            process.close()


class ScientificHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, root, token, *, host='127.0.0.1', port=0, max_body_bytes=2_000_000,
                 max_workers=1, timeout_s=180.):
        if host != '127.0.0.1':
            raise ValueError('Scientific HTTP service binds only IPv4 loopback')
        if not isinstance(token, str) or len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
            raise ValueError('Supply a nonwhitespace ASCII bearer token of at least 32 characters')
        if type(port) is not int or not 0 <= port <= 65535:
            raise ValueError('Invalid port')
        if type(max_body_bytes) is not int or not 1 <= max_body_bytes <= 2_000_000:
            raise ValueError('Invalid HTTP request-size bound')
        self.token, self.max_body_bytes = token, max_body_bytes
        self.native_capabilities = capabilities()
        self.jobs = JobService(root, max_workers=max_workers, timeout_s=timeout_s)
        self.session_lock = threading.RLock()
        self.session_read_lock = threading.Lock()
        self.session_reads = {}
        try:
            super().__init__((host, port), Handler)
        except BaseException:
            self.jobs.close()
            raise

    def read_session(self, identity, action):
        """Share only concurrently executing verified reads; never cache past completion.

        GET and POST read commands use the same flight. Writes keep the existing
        session lock; a completed read cannot conceal a later committed mutation.
        """
        from .session import SessionController
        key = (identity, action)
        with self.session_read_lock:
            future = self.session_reads.get(key)
            leader = future is None
            if leader:
                future = Future()
                self.session_reads[key] = future
        if not leader:
            return future.result(timeout=30)
        try:
            with self.session_lock:
                controller = SessionController(self.jobs.root / 'sessions', self.jobs, identity)
                result = controller.execute({'action': action})
                content = json.dumps(result, allow_nan=False, separators=(',', ':')).encode()
                # Publish before releasing the writer lock, so a post-write read
                # can never join a previously completed state.
                with self.session_read_lock:
                    self.session_reads.pop(key, None)
                    future.set_result(content)
            return content
        except BaseException as error:
            with self.session_read_lock:
                self.session_reads.pop(key, None)
                future.set_exception(error)
            raise

    def exports(self, identity):
        result = self.jobs.result(identity)
        if result.get('kind') != 'synthetic_forward_export':
            raise ValueError('Geometry exports require a completed forward job')
        destination = self.jobs.root / 'artifacts' / identity
        manifest_raw = (destination / 'manifest.json').read_bytes()
        if hashlib.sha256(manifest_raw).hexdigest() != self.jobs.status(identity)['manifest_hash']:
            raise RuntimeError('Artifact manifest integrity failure')
        manifest = json.loads(manifest_raw)
        names = ('tract0.obj', 'tract0.mtl', 'tract.svg', 'geometry.json', 'manifest.json', 'audio.wav')
        files, total = {}, 0
        for name in names:
            path = destination / 'forward' / name
            expected = manifest['files'].get('forward/'+name)
            if not isinstance(expected, str):
                raise RuntimeError('Forward export missing from verified artifact manifest')
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, 'rb') as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or total + info.st_size > 16*1024*1024:
                    raise OverflowError('Forward exports exceed response bound')
                raw = handle.read(info.st_size+1)
            actual = hashlib.sha256(raw).hexdigest()
            if len(raw) != info.st_size or actual != expected:
                raise RuntimeError('Forward export integrity failure')
            total += len(raw)
            files[name] = {'base64': base64.b64encode(raw).decode('ascii'),
                           'byteLength': len(raw), 'sha256': actual}
        return {'job_id': identity, 'files': files}

    def server_close(self):
        super().server_close()
        self.jobs.close()


class Handler(BaseHTTPRequestHandler):
    server: ScientificHTTPServer
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        # Request URLs/bodies may identify private research records.
        pass

    def _respond(self, status, value):
        content = json.dumps(value, allow_nan=False, separators=(',', ':')).encode()
        self._respond_bytes(status, content)

    def _respond_bytes(self, status, content):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(content)
        self.close_connection = True

    def _authorize(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        if self.headers.get_all('Host', []) != [expected]:
            self._respond(403, {'error': 'invalid_host'}); return False
        if self.headers.get('Origin') is not None:
            self._respond(403, {'error': 'browser_origin_not_allowed'}); return False
        auth = self.headers.get_all('Authorization', [])
        if len(auth) != 1 or not auth[0].isascii() or not hmac.compare_digest(auth[0], 'Bearer '+self.server.token):
            self._respond(401, {'error': 'unauthorized'}); return False
        return True

    def _body(self):
        if self.headers.get('Transfer-Encoding') is not None:
            raise ValueError('Transfer encoding is unsupported')
        length = self.headers.get_all('Content-Length', [])
        if len(length) != 1 or not length[0].isdigit():
            raise ValueError('Exactly one valid Content-Length is required')
        count = int(length[0])
        if count > self.server.max_body_bytes:
            raise OverflowError('Request body too large')
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip() != 'application/json':
            raise ValueError('Content-Type must be application/json')
        raw = self.rfile.read(count)
        if len(raw) != count:
            raise ValueError('Incomplete JSON body')
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('Duplicate JSON object key')
                result[key] = value
            return result
        def invalid(_):
            raise ValueError('Nonfinite JSON numbers are unsupported')
        value = json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)
        if not isinstance(value, dict):
            raise ValueError('Request body must be a JSON object')
        return value

    def _handle(self, method):
        if not self._authorize():
            return
        try:
            path = urlsplit(self.path)
            if path.query or path.fragment or path.scheme or path.netloc or '%' in path.path:
                raise ValueError('Only literal route paths are supported')
            body = self._body() if method == 'POST' else None
            if method == 'GET' and path.path == '/health':
                self._respond(200, {'status': 'ready', 'transport': 'private-loopback-science-v1'}); return
            if method == 'GET' and path.path == '/capabilities':
                self._respond(200, self.server.native_capabilities); return
            if method == 'POST' and path.path == '/jobs':
                if set(body) != {'request', 'idempotency_key'}:
                    raise ValueError('Submit requires request and idempotency_key only')
                identity = self.server.jobs.submit(body['request'], idempotency_key=body['idempotency_key'])
                self._respond(202, self.server.jobs.status(identity)); return
            if method == 'POST' and path.path == '/models':
                if set(body) != {'session_id', 'model_id'}:
                    raise ValueError('Model registration requires session_id and model_id')
                self.server.jobs.register_model(**body)
                self._respond(200, {'registered': True}); return
            session = re.fullmatch(r'/sessions/([A-Za-z0-9_-]{1,160})(?:/(commands|state|replay|ledger))?', path.path)
            if session:
                from .session import SessionController, read_ledger
                identity, operation = session.groups()
                if method == 'GET' and operation == 'ledger':
                    self._respond(200, read_ledger(self.server.jobs.root / 'sessions', identity)); return
                if method == 'GET' and operation in (None, 'state', 'replay'):
                    command = {'action': 'replay' if operation == 'replay' else 'state'}
                elif method == 'POST' and operation == 'commands':
                    command = body
                else:
                    self._respond(404, {'error': 'unknown_route'}); return
                if isinstance(command, dict) and command in ({'action': 'state'}, {'action': 'replay'}):
                    content = self.server.read_session(identity, command['action'])
                    self._respond_bytes(200, content); return
                with self.server.session_lock:
                    controller = SessionController(self.server.jobs.root / 'sessions', self.server.jobs, identity)
                    result = controller.execute(command)
                self._respond(200, result); return
            match = re.fullmatch(r'/jobs/([a-f0-9]{32})(?:/(result|cancel|exports))?', path.path)
            if match:
                identity, operation = match.groups()
                if method == 'GET' and operation is None:
                    self._respond(200, self.server.jobs.status(identity)); return
                if method == 'GET' and operation == 'exports':
                    self._respond(200, self.server.exports(identity)); return
                if method == 'GET' and operation == 'result':
                    self._respond(200, self.server.jobs.result(identity)); return
                if method == 'POST' and operation == 'cancel':
                    if body:
                        raise ValueError('Cancel body must be empty object')
                    self._respond(200, {'cancelled': self.server.jobs.cancel(identity)}); return
            self._respond(404, {'error': 'unknown_route'})
        except OverflowError:
            self._respond(413, {'error': 'request_too_large'})
        except KeyError:
            self._respond(404, {'error': 'not_found'})
        except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
            self._respond(409 if str(exc) in ('stale_model', 'stale_session_version') else 400, {'error': str(exc)})
        except RuntimeError as exc:
            self._respond(409, {'error': str(exc)})
        except (OSError, EOFError):
            self._respond(503, {'error': 'service_io_failure'})

    def do_GET(self):
        self._handle('GET')

    def do_POST(self):
        self._handle('POST')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='Local durable job directory; never accepted through HTTP')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    token = os.environ.get('SINGING_SCIENCE_TOKEN', '')
    with ScientificHTTPServer(args.root, token, port=args.port) as server:
        print(json.dumps({'host': '127.0.0.1', 'port': server.server_port, 'status': 'ready'}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
