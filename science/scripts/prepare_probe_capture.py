"""Verify the latest private USB probe archive and run the canonical importer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from science.scripts.import_session_bundle import _archive, _phase, _json, import_session_bundle
from science.scripts.probe_setup import resolve_setup

ROOT = Path(__file__).resolve().parents[2]


def write(path, value):
    """Publish a new file whole: readers never see it empty or partly written."""
    raw = value if isinstance(value, bytes) else json.dumps(value, allow_nan=False).encode()
    pending = path.with_name(path.name + '.pending')
    with os.fdopen(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as target:
        target.write(raw)
    try:
        os.link(pending, path)  # Fails if path exists, as O_EXCL did.
    finally:
        os.unlink(pending)


def prepare(data_root, output):
    root, output = Path(data_root), Path(output)
    receipt = _json((root/'native-pull-latest.json').read_bytes())
    name = receipt.get('name', '')
    if not re.fullmatch(r'(probe|session)-[0-9a-fA-F-]{36}\.zip', name):
        raise ValueError('Pull a sound probe or linked video/sound session first')
    source = root/'usb-imports'/name
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        size = os.fstat(stream.fileno()).st_size
        if not 0 < size <= 512*1024*1024 or size != receipt.get('bytes'):
            raise ValueError('USB probe archive byte count mismatch')
        raw = stream.read(size+1)
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != receipt.get('sha256'):
        raise ValueError('USB probe archive hash mismatch')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    write(output/'original.zip', raw)
    write(output/'usb-receipt.json', receipt)
    if name.startswith('session-'):
        import_session_bundle(output/'original.zip', output/'unpacked')
        capture = output/'unpacked/sound'
    else:
        files = _archive(raw, [512*1024*1024])
        manifest = _phase(files, 'sound')
        if str(manifest.get('captureId', '')).upper() != name[6:-4].upper():
            raise ValueError('Probe capture identity differs from archive filename')
        capture = output/'capture'; capture.mkdir(mode=0o700)
        for filename, data in files.items(): write(capture/filename, data)
    setup_error = None
    try:
        configuration, _, setup = resolve_setup(root)
    except (ValueError, OSError):
        configuration, setup = None, None
        setup_error = 'Saved calibration setup could not be verified; upload its original evidence again in Calibration setup.'
    # A new capture needs its own explicit binding; retain an uncalibrated review
    # so the next setup can be completed in-app instead of failing import.
    if setup and setup['manifestSha256'] != hashlib.sha256((capture/'manifest.json').read_bytes()).hexdigest():
        configuration = None
    if configuration and configuration.exists():
        subprocess.run(['node', '--experimental-strip-types', str(ROOT/'science/scripts/import_probe_science.ts'),
                        str(capture), str(output/'science'), str(configuration)], check=True, stdout=subprocess.DEVNULL)
        bridge = _json((output/'science/probe-science-receipt.json').read_bytes())
        result = {'eligible': bridge['eligible_for_fit'], 'reasons': bridge.get('reasons', []),
                  'measurementPath': 'science/b-import/probe-measurement.json'}
        if setup:
            result.update(setupId=setup['setupId'], setupConfigurationSha256=setup['configurationSha256'],
                          setupProfileSha256=setup['profileSha256'])
    else:
        subprocess.run(['node', '--experimental-strip-types', str(ROOT/'scripts/import-acoustic-probe.ts'),
                        str(capture), str(output/'review')], check=True, stdout=subprocess.DEVNULL)
        result = {'eligible': False, 'reasons': ['Measured route calibration, placement and processing evidence are required before joint fitting.'],
                  'measurementPath': 'review/probe-measurement.json'}
        if setup_error:
            result['reasons'].append(setup_error)
    result.update(importId=output.name, archiveSha256=receipt['sha256'], includedInFit=False,
                  captureDirectory=str(capture.relative_to(output)))
    write(output/'summary.json', result)
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--data-root', required=True); p.add_argument('--output', required=True)
    args = p.parse_args(); print(json.dumps(prepare(args.data_root, args.output)))
