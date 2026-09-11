"""Cue-execution learning in the session ledger: immutable delivered-cue bindings and ledger-owned history.

Forecasts receive attempt history only from score receipts this ledger collected
from its own jobs, never from the caller. The baseline anatomy model is never
changed by these operations.
"""
from copy import deepcopy

from .control_pcm import bank_binding
from .prediction import Artifact, _encode
from .session_source import _hash, _identity, _metadata, _now, _time

FORECAST_PARAMETERS = {'profile', 'feature_scales', 'max_synthesis_calls', 'timeout_s'}


def ensure_fields(state):
    state.setdefault('control_bindings', {})
    state.setdefault('control_forecasts', {})
    state.setdefault('control_receipts', [])


def _content(binding): return {key: binding[key] for key in ('cue', 'context', 'controls', 'gain')}


def history(state, binding):
    """Score receipts this ledger collected for bindings with the same content.

    Other bindings can never match the compatibility key, so omitting them keeps the
    worker request bounded; the ledger itself rejects reused evidence across bindings."""
    rows, content = [], _content(binding)
    for receipt in state['control_receipts']:
        if receipt['operation'] == 'score_control_pcm' and receipt['result'] is not None and _content(state['control_bindings'][receipt['binding_id']]) == content:
            if _hash(receipt['result']) != receipt['result_sha256']: raise ValueError('Control score receipt integrity mismatch')
            rows.append(deepcopy(receipt['result']))
    return rows


def invalidate_stale(state):
    baseline = (state.get('snapshot') or {}).get('model_id')
    for forecast in state.get('control_forecasts', {}).values():
        if forecast['status'] == 'committed' and forecast['baseline_model_id'] != baseline: forecast['status'] = 'stale'


def _declare(state, command):
    identity, binding = _identity(command['binding_id']), command['binding']
    if not isinstance(binding, dict) or set(binding) != {'cue', 'context', 'controls', 'gain'}:
        raise ValueError('Control binding requires cue, context, controls and gain')
    normalized = bank_binding(**binding)
    existing = state['control_bindings'].get(identity)
    if existing is None: state['control_bindings'][identity] = {**normalized, 'declared_at': _now()}
    elif {key: existing[key] for key in normalized} != normalized: raise ValueError('Control binding identity cannot be rebound')


def _record(state, command):
    forecast = state['control_forecasts'].get(command['forecast_id'])
    if command['status'] not in ('stopped', 'failed') or not isinstance(command['reason'], str) or not 1 <= len(command['reason'].strip()) <= 2000:
        raise ValueError('Explicit stopped/failed control attempt and reason required')
    if not forecast or forecast['status'] != 'committed': raise ValueError('Only a committed control forecast can record a stopped or failed attempt')
    forecast['status'] = command['status']
    state['control_receipts'].append({'operation': 'record_control_attempt', 'status': command['status'], 'reason': command['reason'],
        'forecast_id': command['forecast_id'], 'binding_id': forecast['binding_id'], 'baseline_model_id': forecast['baseline_model_id'],
        'result': None, 'received_at': _now()})


def prepare(state, action, command):
    """Apply synchronous declarations, or return (operation, parameters, launch binding) for a worker job."""
    ensure_fields(state)
    if action == 'declare_control_binding': return _declare(state, command)
    if action == 'record_control_attempt': return _record(state, command)
    if state.get('pending'): raise ValueError('Session already has an outstanding job')
    if state.get('snapshot') is None: raise ValueError('Cue-execution learning requires a baseline model')
    baseline = state['snapshot']['model_id']
    if action == 'forecast_control':
        binding = state['control_bindings'].get(command['binding_id'])
        if binding is None: raise ValueError('Declare the delivered cue binding before forecasting')
        target, params = _identity(command['target_id']), command['parameters']
        if target in state['control_forecasts'] or target in state['snapshot']['evidence_ids']:
            raise ValueError('Control forecast requires an unused target identity')
        # Only bounded runtime options are accepted; history and the snapshot come from this ledger.
        if not isinstance(params, dict) or set(params) - FORECAST_PARAMETERS: raise ValueError('Invalid control forecast parameters')
        snapshot = Artifact(_encode(state['snapshot']))
        return 'forecast_control_pcm', {**deepcopy(params), 'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
            **deepcopy(_content(binding)), 'target_id': target, 'history': history(state, binding)}, {
            'binding_id': command['binding_id'], 'forecast_id': target, 'baseline_model_id': baseline, 'snapshot_sha256': snapshot.sha256}
    if action != 'score_control': raise ValueError('Unknown control action')
    forecast = state['control_forecasts'].get(command['forecast_id'])
    if not forecast or forecast['status'] != 'committed' or forecast['baseline_model_id'] != baseline:
        raise ValueError('Control score requires a current committed forecast')
    if _hash(forecast['artifact']['artifact']) != forecast['artifact']['sha256']: raise ValueError('Control forecast integrity mismatch')
    metadata = command['metadata']; _metadata(metadata, state['session_id'], prospective=True)
    if metadata['observationId'] != command['forecast_id'] or _time(metadata['evidenceAt']) <= _time(forecast['committed_at']):
        raise ValueError('Control capture must match its target and follow session commitment')
    used = {h for receipt in state['control_receipts'] for h in receipt.get('observation_hashes', [])}
    if set(metadata['sourceHashes']) & (used | set(state['snapshot']['evidence_hashes'])): raise ValueError('Control attempt evidence was already used')
    forecast['status'] = 'score_pending'
    return 'score_control_pcm', {'frozen': deepcopy(forecast['artifact']), 'pcm': deepcopy(command['pcm']), 'metadata': deepcopy(metadata)}, {
        'binding_id': forecast['binding_id'], 'forecast_id': command['forecast_id'], 'baseline_model_id': baseline,
        'observation_hashes': list(metadata['sourceHashes'])}


def _forecast_bound(state, binding, artifact):
    declared = state['control_bindings'][binding['binding_id']]
    expected = [_hash(h['anatomy']) + ':' + c['control_id'] for h in state['snapshot']['hypotheses'] for c in declared['controls']]
    return (artifact.get('kind') == 'frozen-control-pcm' and artifact.get('target_id') == binding['forecast_id']
            and artifact.get('snapshot_sha256') == binding['snapshot_sha256'] and artifact.get('model_updated') is False
            and all(artifact.get(key) == declared[key] for key in ('cue', 'context', 'controls', 'gain')) and [row.get('alternative_id') for row in artifact.get('alternatives', [])] == expected)


def _score_bound(binding, artifact, frozen):
    return (artifact.get('kind') == 'scored-control-pcm' and artifact.get('forecast_sha256') == frozen['sha256']
            and artifact.get('model_updated') is False and set(binding['observation_hashes']) <= set(artifact.get('observation_hashes', []))
            and [row.get('alternative_id') for row in artifact.get('alternatives', [])] == [row['alternative_id'] for row in frozen['artifact']['alternatives']])


def collect(state, pending, job_status, result):
    """Publish only results bound to the declared binding and every committed alternative.

    A malformed or unbound result is kept as a rejected receipt rather than raised, so a
    faulty worker reply cannot leave the session with a pending job it can never collect."""
    ensure_fields(state)
    binding, operation = pending['control_binding'], pending['request']['operation']
    receipt = {'operation': operation, 'job_id': pending['job_id'], 'received_at': _now(), **binding, 'result': None,
               'status': job_status if job_status != 'succeeded' else 'rejected', 'reason': 'Control worker ' + job_status}
    sealed = result if job_status == 'succeeded' and isinstance(result, dict) and set(result) == {'artifact', 'sha256'} else None
    artifact = sealed['artifact'] if sealed and isinstance(sealed['artifact'], dict) and _hash(sealed['artifact']) == sealed['sha256'] else None
    if job_status == 'succeeded' and artifact is None: receipt['reason'] = 'Control worker returned no intact sealed artifact'
    if operation == 'forecast_control_pcm':
        if artifact and _forecast_bound(state, binding, artifact):
            # One committed control forecast at a time, so the cue shown to the learner is
            # the one the next recording is scored against.
            for identity, other in state['control_forecasts'].items():
                if other['status'] == 'committed':
                    other['status'] = 'superseded'
                    state['control_receipts'].append({'operation': 'supersede_control_forecast', 'status': 'superseded', 'forecast_id': identity,
                        'binding_id': other['binding_id'], 'baseline_model_id': other['baseline_model_id'], 'result': None, 'received_at': _now(),
                        'reason': 'A newer control forecast was committed before this one was recorded'})
            state['control_forecasts'][binding['forecast_id']] = {'artifact': deepcopy(sealed), 'status': 'committed', 'committed_at': _now(),
                'baseline_model_id': binding['baseline_model_id'], 'binding_id': binding['binding_id']}
            receipt.update(status=artifact['status'], reason=None, forecast_sha256=sealed['sha256'])
        elif artifact: receipt['reason'] = 'Control forecast did not retain every alternative of the declared binding'
    else:
        forecast = state['control_forecasts'][binding['forecast_id']]
        if artifact and _score_bound(binding, artifact, forecast['artifact']):
            forecast.update(status='unscorable' if artifact['status'] == 'unscorable' else 'scored', score_sha256=sealed['sha256'])
            receipt.update(status=artifact['status'], reason=artifact['reason'], result=deepcopy(sealed), result_sha256=_hash(sealed))
        else:
            if artifact: receipt['reason'] = 'Control score did not retain every committed alternative and its forecast binding'
            forecast['status'] = 'failed'
    state['control_receipts'].append(receipt)
