"""Prepare the latest verified USB ordinary-voice archive for fixed app inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from import_session_bundle import _archive, _phase, _json


def prepare(data_root, purpose, pose, contains_external_excitation):
    root = Path(data_root).resolve()
    if purpose not in ('calibration', 'outcome') or pose not in ('a','e','i','o','u') or contains_external_excitation is not False:
        raise ValueError('Declare an ordinary singing vowel without external excitation')
    if purpose == 'calibration' and pose != 'a':
        raise ValueError('Initial calibration requires the vowel a')
    if purpose == 'outcome':
        current = _json((root/'science-current.json').read_bytes())
        run_id = current.get('runId','')
        if current.get('status') != 'succeeded' or not re.fullmatch(r'[A-Za-z0-9_-]+',run_id):
            raise ValueError('A completed model run is required before recording its outcome')
        summary = _json((root/'science-runs'/run_id/'summary.json').read_bytes())
        forecast = summary.get('forecast',{})
        selected = forecast.get('selected_experiment_id')
        experiment = next((r['experiment'] for r in forecast.get('rankings',[]) if r.get('experiment',{}).get('experiment_id') == selected),None)
        if not experiment or experiment.get('pose') != pose:
            raise ValueError('Declared vowel differs from the selected frozen experiment')
    receipt = _json((root/'native-pull-latest.json').read_bytes())
    name = receipt.get('name','')
    if not re.fullmatch(r'capture-[0-9a-fA-F-]{36}\.zip',name):
        raise ValueError('Pull an ordinary video/voice capture; probe and linked sessions are unsupported here')
    path = root/'usb-imports'/name
    fd = os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as source:
        size = os.fstat(source.fileno()).st_size
        if not 0<size<=512*1024*1024 or size != receipt.get('bytes'):
            raise ValueError('USB capture byte count mismatch')
        raw=source.read(size+1)
    digest=hashlib.sha256(raw).hexdigest()
    if len(raw)!=size or digest!=receipt.get('sha256'):
        raise ValueError('USB capture hash mismatch')
    files=_archive(raw,[512*1024*1024])
    manifest=_phase(files,'videoDepth')
    if manifest.get('capture_id','').upper()!=name[8:-4].upper():
        raise ValueError('Capture identity does not match USB filename')
    if manifest.get('drive') or manifest.get('protocol') or manifest.get('containsProbe') or manifest.get('contains_external_excitation') or manifest.get('audio',{}).get('containsProbe'):
        raise ValueError('External excitation cannot enter ordinary singing input')
    if manifest.get('pose') is not None and manifest['pose']!=pose:
        raise ValueError('Native declared vowel differs from requested vowel')
    if not any(row.get('artifact') for row in manifest.get('audio',{}).get('samples',[])):
        raise ValueError('Capture contains no recorded voice chunks')
    parent=root/'prepared-voice';parent.mkdir(mode=0o700,exist_ok=True)
    destination=parent/digest
    if destination.exists():
        if destination.is_symlink() or not destination.is_dir() or {p.name for p in destination.iterdir()}!=set(files):
            raise ValueError('Prepared capture changed; original archive preserved')
        for name,data in files.items():
            p=destination/name
            if p.is_symlink() or p.read_bytes()!=data:
                raise ValueError('Prepared capture hash mismatch')
    else:
        destination.mkdir(mode=0o700)
        for name,data in files.items():
            with os.fdopen(os.open(destination/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:output.write(data)
    relative=str(destination.relative_to(root))
    config={'sourceDirectory':relative,'evidenceKind':'human-observation'} if purpose=='calibration' else {
        'sourceDirectory':relative,'pose':pose,'segment_index':0,'evidence_kind':'human-observation',
        'participant_id':'local','recording_kind':'ordinary-singing','contains_external_excitation':False}
    config_file=root/('science-input.json' if purpose=='calibration' else 'science-outcome-input.json')
    fd,temporary=tempfile.mkstemp(prefix='.voice-config-',dir=root)
    with os.fdopen(fd,'w') as output:json.dump(config,output)
    os.replace(temporary,config_file)
    return {'prepared':True,'purpose':purpose,'pose':pose,'captureId':manifest['capture_id'],
        'archiveSha256':digest,'sourceDirectory':relative,'evidenceKind':'human-observation',
        'message':'Original voice bytes verified and prepared. Modality analysis and frozen-outcome checks run next.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-root',required=True);p.add_argument('--purpose',required=True);p.add_argument('--pose',required=True)
    a=p.parse_args();print(json.dumps(prepare(a.data_root,a.purpose,a.pose,False)))
