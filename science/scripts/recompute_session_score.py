"""Recompute one exported PCM update from its separately retained original frame.

No synthesis, model publication, media reconstruction, or historical-policy claim.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine
from singing_physics.pcm_design import SCORER_PIN, _extractor, _profile, _require_pin, update_pcm
from singing_physics.prediction import Artifact, _encode

ROOT = Path(__file__).resolve().parents[2]


def digest(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: '+key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Nonfinite JSON: '+x)))


def projection(result):
    return {'status': result['status'], 'scores': result['scores'],
            'missing_reason': result['missing_reason'],
            'retained_hypothesis_ids': [r['hypothesis_id'] for r in result['updated_snapshot']['hypotheses']]}


def evidence(value, limit):
    """Load a file or an already captured JSON object without changing its numbers."""
    if isinstance(value, dict):
        raw = _encode(value)
        if len(raw) > limit:
            raise ValueError('Evidence exceeds size limit')
        return value, raw
    path = Path(value)
    if path.stat().st_size > limit:
        raise ValueError('Evidence exceeds size limit')
    return load(path), path.read_bytes()


def verify_replay(replay, session_id, expected_ledger):
    previous = '0'*64
    for version, row in enumerate(replay['events'], 1):
        event = dict(row); expected = event.pop('sha256')
        if digest(event) != expected or event['previous_sha256'] != previous or event['session_id'] != session_id or event['state']['version'] != version:
            raise ValueError('Original replay event hash-chain mismatch')
        previous = expected
    if not replay['events'] or digest(replay['events'][-1]['state']) != digest(replay['state']) or previous != replay['ledger_sha256'] or previous != expected_ledger:
        raise ValueError('Original replay does not bind the exported ledger')
    return previous


def recompute(export_path, job_id, frame_path, *, original_replay=None, node_binary=None):
    report = {'schema_version': 'session-score-recomputation/1', 'job_id': job_id,
              'status': 'invalid_evidence', 'numerical_agreement': None,
              'budget': {'maximum_synthesis_calls': 0, 'actual_synthesis_calls': 0,
                         'maximum_canonical_extractions': 1, 'actual_canonical_extractions': 0,
                         'extractor_subprocess_timeout_s': 30},
              'policy_verification': 'unverified',
              'limitations': [
                  'Designs sealed before scorer implementation pins do not bind the historical scoring code. Their agreement is conditional on the current scorer.',
                  'Redacted export ledger and original artifact hashes cannot be authenticated from the export alone.',
                  'The supplied frame verifies the received float32 scoring input, not a complete recording, crop location, or capture clock.',
                  'No model or session state is updated. Numerical agreement is not anatomical accuracy.']}
    fresh = None
    try:
        document, document_raw = evidence(export_path, 64*1024*1024)
        report['export_sha256'] = hashlib.sha256(document_raw).hexdigest()
        if document['schemaVersion'] != 'singing-session-export/1':
            raise ValueError('Unsupported export schema')
        if original_replay is None or not isinstance(original_replay, dict) and not Path(original_replay).is_file():
            report.update(status='missing_artifacts', reason='Retain and supply the unredacted original controller replay; JS export serialization cannot preserve Python canonical hashes.')
            return report, None
        replay, replay_raw = evidence(original_replay, 64*1024*1024)
        verify_replay(replay, document['sessionId'], document['workerLedgerSha256'])
        report['original_replay_sha256'] = hashlib.sha256(replay_raw).hexdigest()
        state = replay['state']
        if state['session_id'] != document['sessionId']:
            raise ValueError('Export session identity mismatch')
        jobs = [j for j in state['jobs'] if j.get('job_id') == job_id]
        if len(jobs) != 1 or jobs[0]['status'] != 'succeeded':
            raise ValueError('Select one unique succeeded job')
        exported_jobs = [j for j in document['replay']['state']['jobs'] if j.get('job_id') == job_id]
        if len(exported_jobs) != 1 or exported_jobs[0].get('result') != jobs[0].get('result'):
            raise ValueError('Exported result differs from original ledger result')
        job = jobs[0]; request = job['request']; params = dict(request['parameters'])
        exported_request = exported_jobs[0]['request']
        for key in ('operation', 'session_id', 'model_id'):
            if request[key] != exported_request[key]:
                raise ValueError('Exported request identity differs from original ledger')
        exported_params = dict(exported_request['parameters'])
        if set(exported_params) != set(params):
            raise ValueError('Exported parameter fields differ from original ledger')
        for key, value in params.items():
            if key == 'pcm':
                continue
            exported_value = exported_params[key]
            if key in ('snapshot_json', 'design_json'):
                value, exported_value = json.loads(value), json.loads(exported_value)
            if value != exported_value:
                raise ValueError('Exported parameter differs from original ledger: '+key)
        if request['operation'] != 'update_pcm' or request['session_id'] != document['sessionId']:
            raise ValueError('Selected job is not a PCM update for this session')
        original = job['result']; receipt = original['observation_receipt']
        if original['kind'] != 'conditional_pcm_support_update':
            raise ValueError('Unsupported update result')
        if digest(receipt) != original['observation_receipt_sha256'] or digest(original['updated_snapshot']) != original['updated_snapshot_sha256']:
            raise ValueError('Original result receipt/snapshot digest mismatch')
        snapshot = Artifact(params.pop('snapshot_json').encode())
        design = Artifact(params.pop('design_json').encode())
        if snapshot.sha256 != params['expected_snapshot_digest'] or design.sha256 != params['expected_design_digest']:
            raise ValueError('Frozen input digest mismatch')
        if original['parent_snapshot_sha256'] != snapshot.sha256 or original['design_sha256'] != design.sha256 or receipt['design_sha256'] != design.sha256:
            raise ValueError('Result does not bind frozen scoring inputs')
        if request['model_id'] != snapshot.data['model_id']:
            raise ValueError('Request model identity mismatch')
        for key in ('observation_id', 'artifact_id', 'observed_at'):
            if params[key] != receipt[key]:
                raise ValueError('Request/receipt mismatch: '+key)
        profile = _profile(design.data['profile'])
        if receipt['profile'] != profile:
            raise ValueError('Receipt profile differs from frozen design')
        if receipt['hash_scope'] != 'little-endian-float32-frame-bytes':
            raise ValueError('Unsupported original frame hash scope')
        report['frame_sha256'] = receipt['frame_sha256']
        if frame_path is None or not isinstance(frame_path, bytes) and not Path(frame_path).is_file():
            report.update(status='missing_media', reason='Supply the separately retained original little-endian float32 scoring frame.')
            return report, None
        raw = frame_path if isinstance(frame_path, bytes) else Path(frame_path).read_bytes()
        if len(raw) != profile['frame_size']*4:
            raise ValueError('Original frame byte length does not match frozen profile')
        if hashlib.sha256(raw).hexdigest() != receipt['frame_sha256']:
            raise ValueError('Original frame SHA-256 mismatch')
        pcm = np.frombuffer(raw, dtype='<f4')
        if not np.isfinite(pcm).all():
            raise ValueError('Original frame is nonfinite')
        if np.asarray(params['pcm'], dtype='<f4').tobytes() != raw:
            raise ValueError('Original request PCM does not match supplied frame')
        # The request's redacted JSON hash may encode pre-float32 precision; it
        # cannot be recovered from the stored float32 receipt and is not claimed verified.
        params['pcm'] = pcm
        with Engine() as engine:
            current_native = engine.provenance
        if current_native != snapshot.data['provenance'] or current_native != design.data['provenance']:
            report.update(status='version_mismatch', reason='Certified native provenance differs from frozen inputs.')
            return report, None
        if _extractor(node_binary, profile) != design.data['extractor']:
            report.update(status='version_mismatch', reason='Canonical extractor/contracts differ from frozen design.')
            return report, None
        try:
            pin_status = _require_pin(design.data)
        except ValueError as exc:
            report.update(status='version_mismatch', reason=str(exc))
            return report, None
        report['policy_verification'] = pin_status
        report['current_scorer_implementation_pin'] = SCORER_PIN
        report['native_provenance'] = current_native
        fresh = update_pcm(design, snapshot, node_binary=node_binary, **params).data
        report['budget']['actual_canonical_extractions'] = 1
        report['objective'] = fresh['objective']
        report['original_scientific_result'] = projection(original)
        report['recomputed_scientific_result'] = projection(fresh)
        report['numerical_agreement'] = projection(original) == projection(fresh)
        if not report['numerical_agreement']:
            report.update(status='numerical_disagreement', reason='Recomputed score differs from the recorded result.')
        elif pin_status == 'verified':
            report.update(status='verified', reason='Frozen scorer implementation pin matches this runtime and the recomputed score agrees.')
        else:
            report.update(status='legacy_version_unverified', reason='Legacy design has no scorer implementation pin; agreement is with the current implementation only.')
    except (KeyError, TypeError, ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        report.update(status='invalid_evidence', reason=str(exc))
    return report, fresh


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', required=True, dest='export_path')
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--original-replay', help='Unredacted original controller replay.json, required for canonical hash verification.')
    parser.add_argument('--frame', help='Original little-endian mono float32 received frame; never reconstructed.')
    parser.add_argument('--output', required=True, help='Fresh report directory (must not exist).')
    args = parser.parse_args()
    output = Path(args.output); output.mkdir(mode=0o700, parents=True, exist_ok=False)
    report, fresh = recompute(args.export_path, args.job_id, args.frame, original_replay=args.original_replay)
    for name, data in [('report.json', report), ('recomputed-update.json', fresh)]:
        if data is not None:
            path = output/name
            with path.open('xb') as handle:
                path.chmod(0o600); handle.write(_encode(data))
    print(json.dumps({'status': report['status'], 'numerical_agreement': report['numerical_agreement'], 'output': str(output)}))
    return 0 if report['status'] in ('verified', 'legacy_version_unverified') else 2


if __name__ == '__main__':
    raise SystemExit(main())
