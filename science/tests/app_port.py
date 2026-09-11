"""Read the port an app server was assigned by the operating system.

Tests start the app with PORT=0. Reserving a free port in Python and closing it
before Node binds it lets a parallel test take the same port; the losing
server then fails to bind while its readiness check reaches the other test's
server.
"""
import re
import time

# The startup lines of the test bootstraps ('App: ') and of server/local.mjs.
_LISTENING = re.compile(rb'^(?:App|Local singing teacher): https?://127\.0\.0\.1:(\d+)$', re.M)


def listening_port(process, log_path, offset=0, timeout=10.):
    """Return the port the app announced in its log after ``offset`` bytes."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with open(log_path, 'rb') as log:
            log.seek(offset)
            match = _LISTENING.search(log.read())
        if match:
            return int(match[1])
        assert process.poll() is None, log_path.read_text(errors='replace')
        time.sleep(.05)
    raise AssertionError('Application did not start')
