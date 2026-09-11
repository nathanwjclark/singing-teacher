"""Resolve immutable app setup bytes, retaining legacy configuration support."""
import hashlib
import json
import os
from pathlib import Path
import re


def _read(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        size = os.fstat(stream.fileno()).st_size
        if not 0 < size <= 2 * 1024 * 1024:
            raise ValueError('Invalid probe setup file size')
        raw = stream.read(size + 1)
    if len(raw) != size:
        raise ValueError('Probe setup changed during read')
    return raw


def resolve_setup(root, setup_id=None, *, legacy=False):
    root = Path(root)
    if legacy:
        return root / 'probe-science-config.json', root / 'probe-fit-profile.json', None
    pointer = root / 'probe-setup-current.json'
    if setup_id is None and not pointer.exists():
        return resolve_setup(root, legacy=True)
    current = json.loads(_read(pointer)) if setup_id is None else None
    identity = setup_id or current.get('setupId', '')
    if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identity):
        raise ValueError('Invalid probe setup identity')
    folder = root / 'probe-setups' / identity
    receipt_bytes = _read(folder / 'summary.json')
    if current and hashlib.sha256(receipt_bytes).hexdigest() != current.get('receiptSha256'):
        raise ValueError('Probe setup receipt hash mismatch')
    receipt = json.loads(receipt_bytes)
    if not isinstance(receipt, dict) or receipt.get('setupId') != identity or receipt.get('eligible') is not True:
        raise ValueError('Probe setup was not verified')
    if not all(isinstance(receipt.get(key), str) and re.fullmatch(r'[0-9a-f]{64}', receipt[key])
               for key in ('configurationSha256', 'profileSha256', 'manifestSha256')):
        raise ValueError('Probe setup receipt lacks its configuration, controls or capture hash')
    for name, key in [('configuration.json', 'configurationSha256'), ('profile.json', 'profileSha256')]:
        if hashlib.sha256(_read(folder / name)).hexdigest() != receipt.get(key):
            raise ValueError('Probe setup configuration hash mismatch')
    return folder / 'configuration.json', folder / 'profile.json', receipt
