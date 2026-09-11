"""Seed the source-bank browser check with the app and worker data of the native
integration test (science/tests/test_app_source_loop.py): a baseline and source
model fitted through the app, two frozen banks scored against later captures and a
recovered bank. Then, as an installation without the optional runner would, the
app attempts one more forecast and records it as failed, so the browser check
freezes the next bank itself. The app data is <root>/app and the worker data
<root>/worker.

Generated synthetic evidence only; no vocal-fold contact or anatomy is measured.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'science/tests'))
from test_app_source_loop import BOOTSTRAP, app_runtime, run_source_loop, wait_source

# The worker starts its jobs with multiprocessing 'spawn', which re-imports this script.
if __name__ == '__main__':
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True)
    run_source_loop(root)
    absent = root/'without-optional-source-runner'
    absent.mkdir(exist_ok=True)
    with app_runtime(root, BOOTSTRAP) as (data, call, restart):
        restart(source_repo=absent)
        call('/api/source/forecast', False, expected=202)
        wait_source(call, 'forecast', terminal='unsupported')
