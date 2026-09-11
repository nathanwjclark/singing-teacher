"""Bounded read-only numerical replay of retained scoring inputs, never session actions."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import subprocess
import time

import numpy as np

from science.scripts.live_capture_jobs import HTTPBackend
from science.scripts.recompute_session_score import digest, load, recompute, verify_replay
from singing_physics.prediction import Artifact, _encode

ROOT = Path(__file__).resolve().parents[2]
SCORING = {'update_pcm', 'score_visual_forecast', 'score_phonation', 'score_phonation_bank'}
MAX_OPERATIONS = 16
MAX_SECONDS = 240


def now():
    return datetime.now(timezone.utc).isoformat()


def without_clock(value):
    return {key: item for key, item in value.items() if key not in ('received_at', 'evidence_at')}


def visual_score(job):
    from singing_physics.visual_likelihood import _policy, score_visual_forecast
    params = job['request']['parameters']; original = job['result']
    if digest(original['artifact']) != original['sha256']:
        raise ValueError('Visual result digest mismatch')
    if params['forecast']['policy'] != _policy():
        return {'status': 'version_mismatch', 'reason': 'Frozen visual scoring policy differs from the available implementation.'}
    forecast = Artifact(_encode(params['forecast']))
    if forecast.sha256 != params['expected_digest'] or original['artifact']['forecast_sha256'] != forecast.sha256:
        raise ValueError('Visual score does not bind the retained forecast')
    if original['artifact']['annotations'] != params['annotations'] or original['artifact']['annotation_sha256'] != digest(params['annotations']):
        raise ValueError('Visual annotation digest mismatch')
    fresh = score_visual_forecast(forecast, expected_digest=params['expected_digest'], annotations=params['annotations']).data
    left, right = without_clock(original['artifact']), without_clock(fresh)
    return {'status': 'verified', 'policy_verification': 'verified', 'scoring_policy': params['forecast']['policy'],
            'numerical_agreement': left == right, 'forecast_sha256': forecast.sha256,
            'annotation_sha256': digest(params['annotations']), 'original_scientific_result': left,
            'recomputed_scientific_result': right, 'canonical_extractions': 0,
            'evidence_scope': 'Retained annotation numbers and frozen projections; original video is not redecoded or correspondence revalidated.'}


def source_score(job):
    from singing_physics import phonation
    params = job['request']['parameters']; original = job['result']; frozen = params['frozen']
    if digest(frozen['forecast']) != frozen['sha256'] or original.get('forecast_sha256') != frozen['sha256']:
        raise ValueError('Source result does not bind the retained forecast')
    bank = job['request']['operation'] == 'score_phonation_bank'
    policy = phonation._bank_policy() if bank else {'version': 'phonation-score-1', 'features': phonation.FEATURES,
        'source_model_version': phonation.SOURCE_VERSION, 'source_adapter_sha256': phonation.digest(Path(phonation.__file__))}
    if digest(frozen['forecast'].get('scoring_policy')) != digest(policy) or frozen['forecast']['extractor_signature'] != phonation.extractor_signature():
        return {'status': 'version_mismatch', 'reason': 'Frozen source scorer or extractor differs from the available implementation.'}
    if not original.get('observation'):
        return {'status': 'missing_artifacts', 'reason': 'Original source score has no received observation receipt.'}
    pcm = np.asarray(params['pcm'], dtype='<f4')
    if pcm.ndim != 1 or not 1 <= len(pcm) <= 8192 or not np.isfinite(pcm).all():
        raise ValueError('Invalid retained source frame')
    frame_hash = hashlib.sha256(pcm.tobytes()).hexdigest()
    if frame_hash != original['observation']['frameSha256']:
        raise ValueError('Retained source PCM differs from original frame receipt')
    fresh = (phonation.score_phonation_bank if bank else phonation.score_phonation_forecast)(frozen, pcm, params['metadata'])
    left, right = without_clock(original), without_clock(fresh)
    return {'status': 'verified', 'policy_verification': 'verified', 'scoring_policy': policy,
            'numerical_agreement': left == right, 'frame_sha256': frame_hash, 'forecast_sha256': frozen['sha256'],
            'original_scientific_result': left, 'recomputed_scientific_result': right, 'canonical_extractions': 1,
            'evidence_scope': 'Exact received float32 frame retained in the controller request; no full-recording or capture-clock verification.'}


def recompute_session(replay, *, session_id, max_operations=MAX_OPERATIONS):
    if type(max_operations) is not int or not 1 <= max_operations <= MAX_OPERATIONS:
        raise ValueError('Choose between one and sixteen scoring operations')
    started = time.monotonic()
    original_digest = digest(replay)
    verify_replay(replay, session_id, replay['ledger_sha256'])
    state = replay['state']
    if state['session_id'] != session_id:
        raise ValueError('Replay belongs to another session')
    raw = _encode(replay)
    if len(raw) > 64 * 1024 * 1024:
        raise ValueError('Authoritative replay exceeds 64 MiB verification limit')
    jobs = state['jobs']
    if len(jobs) > 2000 or len({row['job_id'] for row in jobs}) != len(jobs):
        raise ValueError('Replay job inventory is excessive or ambiguous')
    report = {'schemaVersion': 'session-recomputation/1', 'sessionId': session_id, 'createdAt': now(),
        'status': 'completed', 'sessionVersion': state['version'], 'modelId': state.get('snapshot', {}).get('model_id'),
        'workerLedgerSha256': replay['ledger_sha256'], 'originalReplaySha256': hashlib.sha256(raw).hexdigest(),
        'originalReplayHashScope': 'Python canonical JSON of one authoritative replay response',
        'modelUpdated': False, 'rawMediaIncluded': False, 'operations': [],
        'budget': {'maximumScoringOperations': max_operations, 'maximumWallSeconds': MAX_SECONDS,
                   'synthesisCalls': 0, 'geometryCalls': 0, 'canonicalExtractions': 0},
        'limitations': ['Recomputes retained scoring operations, not model fitting, synthesis, capture processing, or the complete causal session.',
            'An internally consistent private ledger is not independent authentication of historical events.',
            'Numerical agreement does not establish anatomical accuracy or coaching effectiveness.',
            'Received PCM frames are retained request bytes; original full recordings and capture clocks are not recovered.'],
        'verificationPolicy': {'version': 'bounded-score-replay/1', 'pythonSources': {name: hashlib.sha256((ROOT/'science/scripts'/name).read_bytes()).hexdigest()
            for name in ('app_recompute.py', 'recompute_session_score.py')}}}
    selected = {row['job_id'] for row in [j for j in jobs if j['request']['operation'] in SCORING and j['status'] == 'succeeded'][-max_operations:]}
    document = {'schemaVersion': 'singing-session-export/1', 'sessionId': session_id,
                'workerLedgerSha256': replay['ledger_sha256'], 'replay': replay}
    for job in jobs:
        operation = job['request']['operation']
        row = {'jobId': job['job_id'], 'operation': operation, 'originalStatus': job['status'],
               'requestSha256': digest(job['request']), 'originalResultSha256': digest(job.get('result')),
               'status': 'skipped', 'numericalAgreement': None, 'policyVerification': 'unverified'}
        if operation not in SCORING:
            row['reason'] = 'This operation fits or freezes a model; it is outside this read-only score verifier.'
        elif job['status'] != 'succeeded':
            row['reason'] = 'No successful original score is available.'
        elif job['job_id'] not in selected:
            row['reason'] = 'Operation limit: this run verifies the most recent selected scoring operations.'
        elif time.monotonic() - started > MAX_SECONDS - 35:
            row['reason'] = 'Wall-time budget reached before this scoring operation.'
        else:
            try:
                if operation == 'update_pcm':
                    params = job['request']['parameters']
                    if params.get('pcm') is None:
                        result = {'status': 'missing_media', 'reason': 'Original controller request no longer contains its PCM frame.'}
                    else:
                        values = np.asarray(params['pcm'], dtype='<f4')
                        if values.ndim != 1 or not 1 <= len(values) <= 8192 or not np.isfinite(values).all():
                            raise ValueError('Invalid retained PCM frame')
                        result, _ = recompute(document, job['job_id'], values.tobytes(), original_replay=replay)
                        result['canonical_extractions'] = result['budget']['actual_canonical_extractions']
                        result.pop('limitations', None)
                        result.pop('export_sha256', None)
                elif operation == 'score_visual_forecast':
                    result = visual_score(job)
                else:
                    result = source_score(job)
                row.update(status=result['status'], numericalAgreement=result.get('numerical_agreement'),
                    policyVerification=result.get('policy_verification', 'unverified'), details=result)
                if result.get('reason'):
                    row['reason'] = result['reason']
                report['budget']['canonicalExtractions'] += result.get('canonical_extractions', 0)
            except (KeyError, TypeError, ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                row.update(status='invalid_evidence', reason=str(exc))
        report['operations'].append(row)
    report['counts'] = {'total': len(jobs), 'scoring': sum(j['request']['operation'] in SCORING for j in jobs),
        'compared': sum(r['numericalAgreement'] is not None for r in report['operations']),
        'agreed': sum(r['numericalAgreement'] is True for r in report['operations']),
        'disagreed': sum(r['numericalAgreement'] is False for r in report['operations']),
        'skipped': sum(r['status'] == 'skipped' for r in report['operations']),
        'unavailable': sum(r['status'] not in ('verified', 'version_unverified', 'skipped') for r in report['operations']),
        'policyVerified': sum(r['policyVerification'] == 'verified' for r in report['operations'])}
    report['budget']['elapsedSeconds'] = round(time.monotonic() - started, 3)
    if digest(replay) != original_digest:
        raise ValueError('Read-only verifier changed the captured state')
    return report


def run(data_root, output, *, max_operations=MAX_OPERATIONS):
    root = Path(data_root); output = Path(output)
    request = load(output/'request.json')
    current = load(root/'science-current.json')
    if current['status'] != 'succeeded' or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', current['runId']):
        raise ValueError('Complete a baseline voice model first')
    summary = load(root/'science-runs'/current['runId']/'summary.json')
    if request != {'runId': current['runId'], 'sessionId': summary['sessionId'], 'maxOperations': max_operations}:
        raise ValueError('Current session changed before replay capture; start a new verification')
    backend = HTTPBackend(os.environ.get('SCIENCE_URL'), os.environ.get('SCIENCE_TOKEN'), summary['sessionId'])
    replay = backend.execute({'action': 'replay'})
    # No private replay or PCM is written to the artifact directory. A private
    # scratch working directory bounds any numerical adapter temporary files.
    with tempfile.TemporaryDirectory(prefix='session-score-replay-') as scratch:
        previous = Path.cwd()
        try:
            os.chdir(scratch)
            report = recompute_session(replay, session_id=summary['sessionId'], max_operations=max_operations)
        finally:
            os.chdir(previous)
    report.update(runId=current['runId'], attemptId=output.name)
    raw = _encode(report)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('Verification report exceeds 8 MiB')
    with (output/'report.json').open('xb') as handle:
        os.chmod(handle.name, 0o600); handle.write(raw)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-operations', type=int, default=MAX_OPERATIONS)
    args = parser.parse_args()
    try:
        report = run(args.data_root, args.output, max_operations=args.max_operations)
        print(json.dumps({'status': report['status'], 'counts': report['counts']}))
        return 0
    except (KeyError, TypeError, ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        output = Path(args.output)
        with (output/'failure.json').open('x') as handle:
            os.chmod(handle.name, 0o600)
            json.dump({'status': 'failed', 'reason': str(exc)}, handle)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
