"""Bounded read-only numerical replay of retained scoring inputs, never session actions."""
from __future__ import annotations

import signal
import time

# As a verifier process it ends itself (SIGALRM default action) at this deadline,
# armed before the scientific imports. The server allows 300 seconds from spawn
# (server/sessionRecompute.mjs), so the process is gone before the server stops
# trusting its pid.
HARD_SECONDS = 290
PROCESS_STARTED = time.monotonic()
if __name__ == '__main__':
    signal.alarm(HARD_SECONDS)

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

import numpy as np

from science.scripts.live_capture_jobs import HTTPBackend
from science.scripts.recompute_session_score import digest, load, recompute, verify_replay
from singing_physics.prediction import Artifact, _encode

ROOT = Path(__file__).resolve().parents[2]
SCORING = {'update_pcm', 'score_visual_forecast', 'score_phonation', 'score_phonation_bank'}
MAX_OPERATIONS = 16
# Each retained job lands in exactly one outcome: matched (recomputed score agrees),
# failed (score differs or retained evidence is internally inconsistent), unavailable
# (original score, media or receipt absent), unsupported (not a score, or a policy or
# runtime this process cannot reproduce) or skipped (operation or time budget only).
OUTCOMES = {'verified': 'matched', 'legacy_version_unverified': 'matched', 'numerical_disagreement': 'failed',
            'invalid_evidence': 'failed', 'missing_media': 'unavailable', 'missing_artifacts': 'unavailable',
            'version_mismatch': 'unsupported', 'runtime_unavailable': 'unsupported'}
# A scoring row is bounded by its subprocess timeouts: up to three 30-second
# extractor bridge calls plus numerical work. A row starts only while it can still
# finish before HARD_SECONDS; later rows are skipped with time_limit.
ROW_RESERVE_SECONDS = 100
MAX_SECONDS = HARD_SECONDS - ROW_RESERVE_SECONDS
# Faults of this computer's scoring runtime (missing Node, extractor timeout, native
# engine failure) say nothing about the retained evidence.
RUNTIME_FAULTS = (RuntimeError, OSError, subprocess.TimeoutExpired)


def now():
    return datetime.now(timezone.utc).isoformat()


def without_clock(value):
    return {key: item for key, item in value.items() if key not in ('received_at', 'evidence_at')}


def compared(agrees):
    if agrees:
        return {'status': 'verified', 'numerical_agreement': True}
    return {'status': 'numerical_disagreement', 'numerical_agreement': False, 'reason': 'Recomputed score differs from the recorded result.'}


def visual_score(job):
    from singing_physics.visual_likelihood import _policy, score_visual_forecast
    params = job['request']['parameters']; original = job['result']
    if digest(original['artifact']) != original['sha256']:
        raise ValueError('Visual result digest mismatch')
    forecast = Artifact(_encode(params['forecast']))
    if forecast.sha256 != params['expected_digest'] or original['artifact']['forecast_sha256'] != forecast.sha256:
        raise ValueError('Visual score does not bind the retained forecast')
    if original['artifact']['annotations'] != params['annotations'] or original['artifact']['annotation_sha256'] != digest(params['annotations']):
        raise ValueError('Visual annotation digest mismatch')
    # Only a forecast bound to its recorded score can be unsupported rather than forged.
    if params['forecast']['policy'] != _policy():
        return {'status': 'version_mismatch', 'reason': 'Frozen visual scoring policy differs from the available implementation.'}
    fresh = score_visual_forecast(forecast, expected_digest=params['expected_digest'], annotations=params['annotations']).data
    left, right = without_clock(original['artifact']), without_clock(fresh)
    return {**compared(left == right), 'policy_verification': 'verified', 'scoring_policy': params['forecast']['policy'],
            'forecast_sha256': forecast.sha256,
            'annotation_sha256': digest(params['annotations']), 'original_scientific_result': left,
            'recomputed_scientific_result': right, 'canonical_extractions': 0,
            'evidence_scope': 'Retained annotation numbers and frozen projections; original video is not redecoded or correspondence revalidated.'}


def source_score(job):
    from singing_physics import phonation
    params = job['request']['parameters']; original = job['result']; frozen = params['frozen']
    if digest(frozen['forecast']) != frozen['sha256'] or original.get('forecast_sha256') != frozen['sha256']:
        raise ValueError('Source result does not bind the retained forecast')
    if params.get('pcm') is None:
        return {'status': 'missing_media', 'reason': 'Original controller request no longer contains its source frame.'}
    if not original.get('observation'):
        return {'status': 'missing_artifacts', 'reason': 'Original source score has no received observation receipt.'}
    pcm = np.asarray(params['pcm'], dtype='<f4')
    if pcm.ndim != 1 or not 1 <= len(pcm) <= 8192 or not np.isfinite(pcm).all():
        raise ValueError('Invalid retained source frame')
    frame_hash = hashlib.sha256(pcm.tobytes()).hexdigest()
    if frame_hash != original['observation']['frameSha256']:
        raise ValueError('Retained source PCM differs from original frame receipt')
    bank = job['request']['operation'] == 'score_phonation_bank'
    fresh = (phonation.score_phonation_bank if bank else phonation.score_phonation_forecast)(frozen, pcm, params['metadata'])
    # The scorer checks its own frozen policy and extractor signature and reports
    # 'unsupported' without measuring when either differs from this runtime.
    if fresh['status'] == 'unsupported':
        return {'status': 'version_mismatch', 'reason': fresh['reason']}
    left, right = without_clock(original), without_clock(fresh)
    return {**compared(left == right), 'policy_verification': 'verified', 'scoring_policy': frozen['forecast']['scoring_policy'],
            'frame_sha256': frame_hash, 'forecast_sha256': frozen['sha256'],
            'original_scientific_result': left, 'recomputed_scientific_result': right, 'canonical_extractions': 1,
            'evidence_scope': 'Exact received float32 frame retained in the controller request; no full-recording or capture-clock verification.'}


def recompute_session(replay, *, session_id, max_operations=MAX_OPERATIONS, started=None):
    """Compare retained scores; `started` is the monotonic time the wall budget counts from."""
    if type(max_operations) is not int or not 1 <= max_operations <= MAX_OPERATIONS:
        raise ValueError('Choose between one and sixteen scoring operations')
    started = time.monotonic() if started is None else started
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
        'budget': {'maximumScoringOperations': max_operations, 'rowAdmissionSeconds': MAX_SECONDS, 'hardDeadlineSeconds': HARD_SECONDS,
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
               'numericalAgreement': None, 'policyVerification': 'unverified'}
        if operation not in SCORING:
            row.update(outcome='unsupported', status='unsupported_operation', reason='This operation fits, freezes or synthesizes; this read-only verifier recomputes scores only.')
        elif job['status'] != 'succeeded':
            row.update(outcome='unavailable', status='missing_artifacts', reason='No successful original score is available.')
        elif job['job_id'] not in selected:
            row.update(outcome='skipped', status='operation_limit', reason='Operation limit: this run verifies the most recent selected scoring operations.')
        elif time.monotonic() - started > MAX_SECONDS:
            row.update(outcome='skipped', status='time_limit', reason='Wall-time budget reached before this scoring operation.')
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
            except (KeyError, TypeError, ValueError) as exc:
                result = {'status': 'invalid_evidence', 'reason': str(exc)}
            except RUNTIME_FAULTS as exc:
                result = {'status': 'runtime_unavailable', 'reason': 'Scoring runtime unavailable: '+(str(exc) or type(exc).__name__)}
            row.update(outcome=OUTCOMES[result['status']], status=result['status'], numericalAgreement=result.get('numerical_agreement'),
                policyVerification=result.get('policy_verification', 'unverified'), details=result)
            if result.get('reason'):
                row['reason'] = result['reason']
            report['budget']['canonicalExtractions'] += result.get('canonical_extractions', 0)
        report['operations'].append(row)
    rows = report['operations']
    report['counts'] = {'total': len(jobs), 'scoring': sum(j['request']['operation'] in SCORING for j in jobs),
        **{outcome: sum(r['outcome'] == outcome for r in rows) for outcome in ('matched', 'failed', 'unavailable', 'unsupported', 'skipped')},
        'policyVerified': sum(r['outcome'] == 'matched' and r['policyVerification'] == 'verified' for r in rows),
        'legacyVersionUnverified': sum(r['outcome'] == 'matched' and r['policyVerification'] == 'legacy_version_unverified' for r in rows)}
    report['budget']['elapsedSeconds'] = round(time.monotonic() - started, 3)
    if digest(replay) != original_digest:
        raise ValueError('Read-only verifier changed the captured state')
    return report


def run(data_root, output, *, max_operations=MAX_OPERATIONS, started=None):
    root = Path(data_root); output = Path(output)
    request = load(output/'request.json')
    current = load(root/'science-current.json')
    if current['status'] != 'succeeded' or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', current['runId']):
        raise ValueError('Complete a baseline voice model first')
    summary = load(root/'science-runs'/current['runId']/'summary.json')
    if request != {'runId': current['runId'], 'sessionId': summary['sessionId'], 'maxOperations': max_operations}:
        raise ValueError('Current session changed before replay capture; start a new verification')
    backend = HTTPBackend(os.environ.get('SCIENCE_URL'), os.environ.get('SCIENCE_TOKEN'), summary['sessionId'])
    # The worker's read-only ledger path: unlike the 'replay' session action it never
    # dispatches a pending job or registers a model. No private replay or PCM is
    # written to the artifact directory.
    replay = backend.ledger()
    report = recompute_session(replay, session_id=summary['sessionId'], max_operations=max_operations, started=started)
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
        report = run(args.data_root, args.output, max_operations=args.max_operations, started=PROCESS_STARTED)
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
