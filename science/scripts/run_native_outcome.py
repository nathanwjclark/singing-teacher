"""Resume a verified later native capture into its existing HTTP scientific session."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.error import HTTPError

from live_capture_jobs import HTTPBackend, ROOT


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path, limit=64_000_000):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        import stat
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > limit:
            raise ValueError('Invalid private input file type/size')
        with os.fdopen(fd, 'rb', closefd=False) as file:
            raw = file.read(limit + 1)
        if len(raw) != st.st_size:
            raise ValueError('Input changed during read')
        return raw
    finally:
        os.close(fd)


def seal(path, value):
    """Atomic immutable JSON: a crash cannot leave a partially written receipt."""
    raw = encode(value)
    if path.exists():
        if read(path) != raw:
            raise ValueError('Immutable receipt differs: ' + path.name)
        return
    fd, tmp = tempfile.mkstemp(prefix='.seal-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.link(tmp, path)
    finally:
        os.unlink(tmp)


def sources(source):
    manifest = read(source / 'manifest.json')
    native = json.loads(manifest)
    files = {'manifest.json': sha(manifest)}
    def walk(value):
        if isinstance(value, list):
            for child in value: walk(child)
        elif isinstance(value, dict):
            if 'path' in value:
                name = value['path']
                if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][\w.-]*', name):
                    raise ValueError('Unsafe native artifact name')
                raw = read(source / name)
                if len(raw) != value.get('bytes') or sha(raw) != value.get('sha256'):
                    raise ValueError('Original native artifact hash/size mismatch')
                files[name] = sha(raw)
            for child in value.values(): walk(child)
    walk(native)
    return files


def run(run_directory, source, output, config_path, *, timeout_s=180., node_binary='node'):
    run_directory, source, output, config_path = map(lambda p: Path(p).absolute(), (run_directory, source, output, config_path))
    if output.is_symlink(): raise ValueError('Outcome output cannot be a symlink')
    output.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(output, 0o700)
    lock = os.open(output / '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _run(run_directory, source, output, config_path, timeout_s, node_binary)
    finally:
        os.close(lock)


def _run(run_directory, source, output, config_path, timeout_s, node_binary):
    summary_raw, config_raw = read(run_directory / 'summary.json'), read(config_path, 2_000_000)
    summary, config = json.loads(summary_raw), json.loads(config_raw)
    if not isinstance(config, dict) or set(config) - {'pose','segment_index','frame_start_sample','evidence_kind','participant_id','design_id','experiment_id','observation_id','recording_kind','contains_external_excitation'}:
        raise ValueError('Unsupported outcome runner configuration')
    if not isinstance(config.get('pose'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', config['pose']):
        raise ValueError('Explicit user-declared pose required')
    if config.get('recording_kind') != 'ordinary-singing' or config.get('contains_external_excitation') is not False:
        raise ValueError('Explicit ordinary singing without excitation required')
    if config.get('evidence_kind') not in ('human-observation','development-fixture'):
        raise ValueError('Explicit outcome evidence_kind required')
    if not isinstance(config.get('participant_id'),str) or not config['participant_id'].strip():
        raise ValueError('Explicit participant_id required')
    if type(config.get('segment_index')) is not int or config['segment_index'] < 0:
        raise ValueError('Explicit source segment_index required')
    session_id = summary.get('sessionId')
    if not isinstance(session_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',session_id):
        raise ValueError('Invalid saved run sessionId')
    backend = HTTPBackend(os.environ.get('SCIENCE_URL',''), os.environ.get('SCIENCE_TOKEN',''), session_id)
    inputs = {'run_directory':str(run_directory),'source_directory':str(source),'run_summary_sha256':sha(summary_raw),
              'configuration_sha256':sha(config_raw),'native_sources':sources(source),'session_id':session_id}
    native_manifest = read(source / 'manifest.json')
    if sha(native_manifest) != inputs['native_sources']['manifest.json']:
        raise ValueError('Source manifest changed during lineage capture')
    source_capture_id = json.loads(native_manifest).get('capture_id')
    def retain_result(value):
        return finish(output, {**value, 'sourceCaptureId': source_capture_id,
                               'sourceManifestSha256': inputs['native_sources']['manifest.json']})
    seal(output / 'inputs.json', inputs)
    if (output / 'completed.json').exists():
        completed = json.loads(read(output / 'completed.json'))
        for name, digest in completed['artifacts'].items():
            if sha(read(output / name)) != digest: raise ValueError('Completed outcome artifact changed')
        return completed['summary']
    if not (output / 'prepared.json').exists():
        if not (output / 'session-before.json').exists():
            seal(output / 'session-before.json', backend.execute({'action':'state'}))
        state_export = json.loads(read(output / 'session-before.json')); state = state_export['state']
        design_id = config.get('design_id', summary.get('designId'))
        design = state['designs'].get(design_id)
        if state['session_id'] != session_id or not design or design['status'] != 'committed':
            raise ValueError('Saved run design is not committed in its authoritative session')
        experiment = design['data']['selected_experiment_id']; target = design['data']['target_observation_id']
        for key,value in (('experiment_id',experiment),('observation_id',target)):
            if key in config and config[key] != value: raise ValueError('Explicit target/experiment differs from committed design')
        start = design['data']['profile']['frame_start_sample']
        if 'frame_start_sample' in config and config['frame_start_sample'] != start:
            raise ValueError('Explicit window differs from frozen profile')
        key = sha(encode(inputs))[:24]
        importer_config = {'kind':'singing_outcome_import_configuration','schema_version':'0.1.0',
            'command_id':'native-outcome-'+key,'expected_version':state['version'],'participant_id':config['participant_id'],
            'session_id':session_id,'design_id':design_id,'experiment_id':experiment,'observation_id':target,
            'artifact_id':'native-frame-'+key,'pose':config['pose'],'segment_index':config['segment_index'],
            'frame_start_sample':start,'recording_kind':'ordinary-singing','contains_external_excitation':False,
            'evidence_kind':config['evidence_kind'],'source_manifest_sha256':inputs['native_sources']['manifest.json'],
            'session_state_artifact':{'path':'session-before.json','sha256':sha(read(output/'session-before.json')),'byteCount':len(read(output/'session-before.json'))}}
        seal(output / 'import-config.json', importer_config)
        # A stopped preparation leaves immutable attempts; select a fresh importer directory on retry.
        index = 0
        while (output / f'import-{index}').exists(): index += 1
        imported = output / f'import-{index}'
        subprocess.run([node_binary,'--experimental-strip-types',str(ROOT/'science/scripts/import_singing_outcome.ts'),str(source),str(imported),str(output/'import-config.json')], check=True, capture_output=True, timeout=60)
        command = json.loads(read(imported/'singing-outcome-command.json'))
        receipt = json.loads(read(imported/'singing-outcome-receipt.json'))
        seal(output / 'prepared.json', {'command':command,'receipt':receipt,'import_directory':imported.name})
    prepared = json.loads(read(output/'prepared.json')); command = prepared['command']
    if command is None:
        seal(output/'replay.json',backend.execute({'action':'replay'}))
        return retain_result({'status':'ineligible','sessionId':session_id,'runId':summary.get('runId'),'reasons':prepared['receipt']['reasons'],'submitted':False})
    # Retrying this exact durable command is safe even if its earlier HTTP response was lost.
    state = backend.execute(command)['state']
    operation_key = 'session:' + sha(encode([session_id,command['command_id']]))
    rows = ([state['pending']] if state.get('pending') else []) + state['jobs']
    matching = [row for row in rows if row['key'] == operation_key]
    if len(matching) != 1: raise ValueError('Submitted outcome job missing or ambiguous in session')
    job = matching[0]
    if not job.get('job_id'):
        seal(output/'replay.json',backend.execute({'action':'replay'}))
        return retain_result({'status':'failed','sessionId':session_id,'runId':summary.get('runId'),'error':job.get('error'),'submitted':True})
    job_id = job['job_id']; seal(output/'job.json',{'job_id':job_id,'command_id':command['command_id']})
    deadline = time.monotonic()+timeout_s
    while True:
        status = backend.status(job_id)
        if status['status'] in ('succeeded','failed','cancelled'): break
        if time.monotonic() >= deadline: raise TimeoutError('Outcome still running; resume this output directory')
        time.sleep(.1)
    seal(output/'job-status.json',status)
    result = backend.result(job_id) if status['status']=='succeeded' else None
    seal(output/'result.json',result)
    for retry in range(4):
        latest = backend.execute({'action':'state'})['state']
        if not latest.get('pending') or latest['pending']['job_id'] != job_id:
            if not any(j.get('job_id') == job_id for j in latest['jobs']):
                raise ValueError('Outcome job no longer belongs to session')
            break
        collect = {'action':'collect_job','command_id':command['command_id']+'-collect-v'+str(latest['version']),
                   'expected_version':latest['version'],'job_id':job_id}
        seal(output/('collect-v'+str(latest['version'])+'.json'), collect)
        try:
            backend.execute(collect)
            break
        except HTTPError as exc:
            detail = exc.read(1_000_000).decode(errors='replace')
            if 'stale_session_version' not in detail: raise
            if retry == 3: raise RuntimeError('Session changed repeatedly during collection; resume safely') from exc
    replay = json.loads(read(output/'replay.json')) if (output/'replay.json').exists() else backend.execute({'action':'replay'})
    seal(output/'replay.json',replay)
    authoritative = [row for row in replay['state']['jobs'] if row.get('job_id') == job_id]
    if len(authoritative) != 1: raise ValueError('Outcome disposition missing from authoritative replay')
    disposition = authoritative[0]
    applied = disposition.get('status') == 'succeeded' and disposition.get('result') is not None
    if applied and disposition['result'] != result: raise ValueError('Collected result differs from worker result')
    return retain_result({'status':disposition['status'],'sessionId':session_id,'runId':summary.get('runId'),'jobId':job_id,
        'designId':command['design_id'],'observationId':command['parameters']['observation_id'],'submitted':True,
        'scientificStatus':result.get('status') if applied else None,'modelUpdated':applied,
        'scores':result.get('scores',[]) if applied else [],
        'missingReason':result.get('missing_reason') if applied else None,
        'retainedHypotheses':len(result['updated_snapshot']['hypotheses']) if applied else None,
        'previousHypotheses':len(json.loads(read(output/'session-before.json'))['state']['snapshot']['hypotheses']),
        'modelId':replay['state']['snapshot']['model_id'], 'workerStatus':status['status'],
        'source':config['evidence_kind'],'anatomyValidated':False,'error':disposition.get('error')})



def finish(output, summary):
    seal(output/'summary.json',summary)
    artifacts = {str(p.relative_to(output)):sha(read(p)) for p in output.rglob('*') if p.is_file() and p.name not in ('.lock','completed.json') and not p.name.startswith('.seal-')}
    seal(output/'completed.json',{'summary':summary,'artifacts':artifacts})
    return summary


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('run','source','output','config'): parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(run(args.run,args.source,args.output,args.config),indent=2))
