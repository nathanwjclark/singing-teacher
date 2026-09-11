"""App-operated cue-execution forecasts and scores from the delivered Astra cue and original native captures.

The forecast freezes the exact wording Astra delivered, the declared context and a
finite JA/F0 bank before the attempt. The score uses the next pulled original
capture. Neither phase changes the baseline anatomy model.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import time
from urllib.error import HTTPError

from live_capture_jobs import HTTPBackend
from app_source import capture, load, save

SEMITONE = 2 ** (1 / 12)
MAX_CALLS = 96
CONTEXT = {'capture_context_id': 'native-usb-pcm', 'level': 'comfortable', 'posture': 'not-instructed'}


def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def execute(backend, command):
    try: return backend.execute(command)['state']
    except HTTPError as error:
        try: reason = json.loads(error.read(4096)).get('error')
        except ValueError: reason = None
        raise ValueError(f"Scientific session rejected {command['action']}: {reason or error.code}") from None


def delivered_binding(root, directory, state, summary):
    """Binding for the current committed Astra decision: its verbatim cue, context and a fixed plus-shaped bank."""
    session_id, baseline = state['session_id'], state['snapshot']['model_id']
    if (directory / 'astra-rest.json').exists(): raise ValueError('Astra selected rest; obtain a new recording decision first')
    pointer = load(directory / 'astra-current.json')
    design = state['designs'].get(pointer.get('designId'))
    if pointer.get('sessionId') != session_id or pointer.get('modelId') != baseline or not design or design['status'] != 'committed' or design['data'] != pointer['forecast']:
        raise ValueError('Ask Astra for a current recording decision before freezing a cue-execution forecast')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', pointer.get('decisionId', '')): raise ValueError('Invalid Astra decision identity')
    decision = load(root / 'astra-decisions' / session_id / (pointer['decisionId'] + '.json'))
    if decision.get('status') != 'succeeded' or decision.get('decision', {}).get('action') != 'record' or decision.get('designId') != pointer['designId']:
        raise ValueError('The current Astra decision is not a completed recording decision')
    wording = decision['decision']['cue']
    experiment = next(r['experiment'] for r in design['data']['rankings'] if r['experiment']['experiment_id'] == design['data']['selected_experiment_id'])
    chosen = decision['decision'].get('cueBindingId')
    if chosen is not None:
        # Astra repeated a declared cue: reuse that binding verbatim so its history matches.
        declared = state.get('control_bindings', {}).get(chosen)
        if not declared or declared['cue']['wording'] != wording or declared['context']['vowel'] != experiment['pose']:
            raise ValueError('The repeated cue binding does not match the delivered wording and vowel')
        binding_id, binding = chosen, {key: declared[key] for key in ('cue', 'context', 'controls', 'gain')}
    else:
        pitches = [m['value'] for t in state['calibration']['trials'] for m in t['measurement']['measurements'] if m['name'] == 'pitchHz' and m['value'] is not None]
        if not pitches: raise ValueError('Calibration has no measured pitch to centre the F0 alternatives')
        pitch, ja = round(statistics.median(pitches), 1), experiment['JA']
        if not -4. <= ja <= -2.: raise ValueError('Selected experiment jaw angle leaves no room for the JA alternatives')
        lower, higher = round(pitch / SEMITONE, 1), round(pitch * SEMITONE, 1)
        if not (65. <= lower and higher <= 1000.): raise ValueError(f'Calibration pitch {pitch} Hz leaves no room for one-semitone F0 alternatives within 65-1000 Hz')
        controls = [{'control_id': 'selected', 'JA': ja, 'f0_hz': pitch}, {'control_id': 'jaw-less-open', 'JA': ja + 1, 'f0_hz': pitch},
                    {'control_id': 'jaw-more-open', 'JA': ja - 1, 'f0_hz': pitch},
                    {'control_id': 'pitch-lower', 'JA': ja, 'f0_hz': lower}, {'control_id': 'pitch-higher', 'JA': ja, 'f0_hz': higher}]
        binding = {'cue': {'cue_id': 'astra-delivered-cue', 'cue_version': '1', 'wording': wording,
                           'wording_sha256': hashlib.sha256(wording.encode()).hexdigest(), 'mode': 'elicited'},
                   'context': {**CONTEXT, 'source_kind': summary['source'], 'pitch_hz': pitch, 'vowel': experiment['pose']},
                   'controls': controls, 'gain': experiment['gain']}
        # Content-derived identity: the same wording, context and bank reuses one binding.
        binding_id = 'cue-' + hashlib.sha256(canonical(binding).encode()).hexdigest()[:32]
    calls = len(state['snapshot']['hypotheses']) * len(binding['controls'])
    if calls > MAX_CALLS: raise ValueError(f'{len(state["snapshot"]["hypotheses"])} retained anatomies need {calls} synthesis calls; the control bank budget is {MAX_CALLS}')
    return binding_id, binding, pointer, design['data']['profile']


def collect_pending(backend, state):
    """Wait for and collect an outstanding control job, including one left by an interrupted run."""
    pending = state['pending']
    if not pending or not pending.get('control_binding') or not pending.get('job_id'): return state
    deadline = time.monotonic() + 125
    while backend.status(pending['job_id'])['status'] not in ('succeeded', 'failed', 'cancelled'):
        if time.monotonic() > deadline: raise ValueError('Control job is still running; retry to recover')
        time.sleep(.15)
    return execute(backend, {'action': 'collect_job', 'command_id': 'control-collect-' + pending['job_id'], 'expected_version': state['version'], 'job_id': pending['job_id']})


def run(root, phase, output):
    current = load(root / 'science-current.json'); run_id = current.get('runId', '')
    if current.get('status') != 'succeeded' or not re.fullmatch(r'run-[A-Za-z0-9_-]+', run_id): raise ValueError('A completed voice model is required')
    directory = root / 'science-runs' / run_id; summary = load(directory / 'summary.json'); session_id = summary['sessionId']
    backend = HTTPBackend(os.environ['SCIENCE_URL'], os.environ['SCIENCE_TOKEN'], session_id)
    state = collect_pending(backend, execute(backend, {'action': 'state'}))
    if state['snapshot'] is None: raise ValueError('A fitted baseline model is required')
    baseline, identity = state['snapshot']['model_id'], 'control-app-' + output.name
    intent_path = output / 'intent.json'; existing = load(intent_path) if intent_path.exists() else None
    if existing:
        if existing['baselineModelId'] != baseline: raise ValueError('Control attempt belongs to an earlier baseline model')
        commands, receipt = existing['commands'], existing['receipt']
    elif phase == 'forecast':
        binding_id, binding, pointer, profile = delivered_binding(root, directory, state, summary)
        commands = [{'action': 'declare_control_binding', 'binding_id': binding_id, 'binding': binding},
                    {'action': 'forecast_control', 'binding_id': binding_id, 'target_id': identity,
                     'parameters': {'profile': profile, 'max_synthesis_calls': MAX_CALLS, 'timeout_s': 90.}}]
        receipt = {'bindingId': binding_id, 'forecastId': identity, 'decisionId': pointer['decisionId'], 'designId': pointer['designId'],
                   'deliveredCue': binding['cue']['wording']}
    elif phase in ('score', 'stop'):
        # The ledger keeps at most one committed control forecast.
        committed = [(k, v) for k, v in state.get('control_forecasts', {}).items() if v['status'] == 'committed' and v['baseline_model_id'] == baseline]
        if not committed: raise ValueError('Freeze a current cue-execution forecast before recording')
        target, frozen = committed[-1]; artifact = frozen['artifact']['artifact']
        receipt = {'bindingId': frozen['binding_id'], 'forecastId': target, 'forecastSha256': frozen['artifact']['sha256'], 'deliveredCue': artifact['cue']['wording']}
        if phase == 'stop':
            commands = [{'action': 'record_control_attempt', 'forecast_id': target, 'status': 'stopped', 'reason': 'Stopped by the learner in the app before scoring'}]
        else:
            trial, provenance = capture(root, output, session_id, target, frozen['committed_at'], artifact['profile']['sample_rate_hz'],
                                        artifact['context']['source_kind'], artifact['context']['vowel'])
            commands = [{'action': 'score_control', 'forecast_id': target, 'pcm': trial['pcm'], 'metadata': trial['metadata']}]
            receipt.update(provenance)
    else: raise ValueError('Unknown control operation')
    for index, command in enumerate(commands):
        # Each command is persisted with its identity and version before it runs, so a
        # retry replays the identical command and the session applies it at most once.
        if 'command_id' not in command:
            command.update(command_id=f'{identity}-{index}', expected_version=state['version'])
            save(intent_path, {'commands': commands, 'receipt': receipt, 'baselineModelId': baseline})
        state = execute(backend, command)
    if commands[-1]['action'] in ('forecast_control', 'score_control'):
        key = 'session:' + hashlib.sha256(canonical([session_id, commands[-1]['command_id']]).encode()).hexdigest()
        state = collect_pending(backend, state)
        job = next(j for j in state['jobs'] if j['key'] == key)
        receipt.update(jobId=job['job_id'], workerStatus=job['status'], workerError=job.get('error'), result=job['result'])
    control = next(r for r in reversed(state['control_receipts']) if r['forecast_id'] == receipt['forecastId'])
    save(output / 'result.json', {**receipt, 'phase': phase, 'status': control['status'], 'reason': control['reason'],
        'sessionId': session_id, 'baselineModelId': baseline, 'sessionVersion': state['version'], 'modelUpdated': False})
    if control['status'] in ('failed', 'cancelled', 'submission_failed', 'rejected'):
        raise ValueError(f"Control worker {control['status']} ({receipt.get('workerError')}); baseline retained; the attempt is preserved as failed")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--phase', choices=['forecast', 'score', 'stop'], required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); run(args.data_root.resolve(), args.phase, args.output.resolve())
