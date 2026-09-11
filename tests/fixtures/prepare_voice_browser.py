"""Publish one generated native voice capture into a private app data root.

The capture is synthesized by the native engine at the reference anatomy (development
fixture, not human evidence) and published the way a USB pull leaves it: a zip under
usb-imports and native-pull-latest.json. The app's own preparation route verifies it.

    prepare_voice_browser.py DATA_ROOT            first calibration capture (vowel a)
    prepare_voice_browser.py DATA_ROOT --later E  later capture of vowel E
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'science/tests'))
from test_live_capture_jobs import capture

parser = argparse.ArgumentParser(); parser.add_argument('root', type=Path); parser.add_argument('--later', choices=['a', 'e', 'i', 'o', 'u'])
args = parser.parse_args()
root = args.root.resolve(); root.mkdir(parents=True, exist_ok=bool(args.later))
with tempfile.TemporaryDirectory(dir=root) as work:
    source = capture(Path(work), args.later or 'a')
    manifest = json.loads((source/'manifest.json').read_text())
    manifest['capture_id'] = '00000000-0000-4000-8000-00000000a00'+('2' if args.later else '1')
    manifest['created_at'] = datetime.now(timezone.utc).isoformat()
    (source/'manifest.json').write_text(json.dumps(manifest))
    imports = root/'usb-imports'; imports.mkdir(exist_ok=True)
    archive = imports/('capture-'+manifest['capture_id']+'.zip')
    with zipfile.ZipFile(archive, 'x') as zipped:
        for file in source.iterdir(): zipped.write(file, file.name)
(root/'native-pull-latest.json').write_text(json.dumps({'name': archive.name, 'bytes': archive.stat().st_size,
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
print(json.dumps({'capture': manifest['capture_id'], 'archive': archive.name}))
