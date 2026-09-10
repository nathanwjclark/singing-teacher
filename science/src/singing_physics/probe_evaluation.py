"""Independent raw-byte replay and residual scoring of a sealed external probe forecast."""
from datetime import datetime, timezone
import base64
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np

from .prediction import Artifact, _encode, _timestamp
from .probe_inverse import _parse_record


def evaluate_probe(forecast, *, expected_digest, document, receipt, configuration_json,
                   original_artifacts, supplemental_artifacts, capture_started_at):
    """Re-run canonical DSP from supplied bytes; report errors, never update anatomy.

    Capture time is a caller assertion, not hardware-authenticated chronology.
    Artifact maps contain relative paths to base64 bytes, never filesystem paths.
    """
    if not isinstance(forecast, Artifact) or forecast.sha256 != expected_digest:
        raise ValueError('Stale forecast digest')
    prior = forecast.data
    if _encode(prior) != forecast.content or prior.get('kind') != 'frozen_external_probe_prediction':
        raise ValueError('Expected canonical external probe forecast')
    received_at = datetime.now(timezone.utc).isoformat()
    if not _timestamp(prior['sealed_at']) < _timestamp(capture_started_at) <= _timestamp(received_at):
        raise ValueError('Capture must follow forecast seal and precede receipt')
    if prior['configuration_sha256'] != hashlib.sha256(_encode(prior['configuration'])).hexdigest():
        raise ValueError('Forecast configuration digest mismatch')
    # Reusing the importer verifies media, calibration evidence, quality, DSP and
    # exact selected bins together instead of trusting editable receipt claims.
    script = Path(__file__).resolve().parents[2] / 'scripts/import_probe_science.ts'
    node = shutil.which('node')
    if node is None:
        raise ValueError('Node runtime required for canonical probe importer')
    with tempfile.TemporaryDirectory(prefix='probe-score-') as directory:
        root = Path(directory); capture = root / 'capture'; capture.mkdir()
        for destination, artifacts in ((capture, original_artifacts), (root, supplemental_artifacts)):
            if not isinstance(artifacts, dict) or not artifacts:
                raise ValueError('Original media and supplemental evidence bytes required')
            for name, encoded in artifacts.items():
                path = Path(name)
                if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] in {'capture','output','config.json'}:
                    raise ValueError('Artifact names must be safe relative paths')
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except (ValueError, TypeError) as exc:
                    raise ValueError('Invalid base64 artifact') from exc
                if len(raw) > 16_000_000:
                    raise ValueError('Artifact exceeds 16 MB')
                target = destination / path; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
        (root / 'config.json').write_text(configuration_json)
        run = subprocess.run([node, str(script), str(capture), str(root/'output'), str(root/'config.json')],
                             capture_output=True, text=True, timeout=60)
        if run.returncode:
            raise ValueError('Canonical probe import rejected supplied bytes: ' + run.stderr[-2000:])
        verified = json.loads((root/'output/probe-science-document.json').read_text())
        verified_receipt = json.loads((root/'output/probe-science-receipt.json').read_text())
    if verified != document or verified_receipt != receipt:
        raise ValueError('Imported document or receipt does not match verified original bytes')
    if not verified_receipt['eligible_for_fit'] or verified is None:
        raise ValueError('Captured probe unavailable for numerical scoring')
    trial = verified['trials'][0]
    parsed = _parse_record(trial)
    config = prior['configuration']
    if trial['id'] != prior['target_evidence_id']:
        raise ValueError('Heldout target identity mismatch')
    old_ids = prior['fitting_evidence_ids'] + prior['calibration_evidence_ids']
    old_hashes = prior['fitting_evidence_hashes'] + prior['calibration_evidence_hashes']
    if trial['id'] in old_ids or trial['source']['received_artifact_id'] in old_ids or trial['source']['received_sha256'] in old_hashes:
        raise ValueError('Heldout response overlaps fitted or calibration evidence')
    for key in ('pose','frequency_hz','placement','calibration'):
        if trial[key] != config[key]:
            raise ValueError('Frozen forecast binding mismatch: ' + key)
    if trial['comparison'] != prior['comparison'] or trial['conditions'] != {k:config[k] for k in ('termination','termination_resistance_pa_s_m3','attenuation_np_per_m')}:
        raise ValueError('Frozen comparison or conditions mismatch')
    if config['articulation']:
        raise ValueError('Imported response has no verified articulatory-control binding')
    if prior['comparison'] == 'complex' and (not prior['phase_comparison_supported'] or not trial['timing']['phase_verified']):
        raise ValueError('Unsupported phase comparison')
    if not prior['predictions']:
        raise ValueError('Empty hypothesis forecast')
    common = np.logical_and.reduce([np.asarray(p['operator_prediction']['valid_mask'], dtype=bool) for p in prior['predictions']])
    if common.tolist() != prior['common_valid_mask']:
        raise ValueError('Forecast common support mismatch')
    scores = []
    for prediction in prior['predictions']:
        operator = prediction['operator_prediction']
        if operator['native_provenance'] != prior['native_provenance'] or operator['frequency_hz'] != trial['frequency_hz']:
            raise ValueError('Candidate operator lineage mismatch')
        mask = parsed['active'] & common
        error = [None] * len(mask)
        for i in np.flatnonzero(mask):
            predicted = complex(operator['response_real'][i], operator['response_imag'][i])
            observed = parsed['observed'][i]
            error[i] = float(abs(predicted-observed) if prior['comparison']=='complex' else abs(abs(predicted)-abs(observed)))
        bands = []
        for index, active, _, _ in parsed['bands']:
            values = [error[i] for i in np.flatnonzero(mask & active)]
            bands.append({'band':index,'valid_bins':len(values),'rmse':float(np.sqrt(np.mean(np.square(values)))) if values else None})
        values = [x for x in error if x is not None]
        scores.append({'hypothesis_id':prediction['hypothesis_id'],'absolute_error':error,'bands':bands,
                       'valid_bins':len(values),'missing_bins':int(np.count_nonzero(parsed['active'] & ~common)),
                       'rmse':float(np.sqrt(np.mean(np.square(values)))) if values else None,
                       'status':'scored' if values else 'unavailable'})
    return Artifact(_encode({'kind':'external_probe_forecast_evaluation','schema_version':'0.1.0',
        'forecast_sha256':forecast.sha256,'prediction_id':prior['prediction_id'],'model_id':prior['model_id'],
        'hypothesis_snapshot_sha256':prior['hypothesis_snapshot_sha256'],'target_evidence_id':trial['id'],
        'source':trial['source'],'receipt_sha256':hashlib.sha256(_encode(receipt)).hexdigest(),
        'capture_started_at':capture_started_at,'received_at':received_at,'forecast_sealed_at':prior['sealed_at'],
        'quantity':prior['quantity'],'comparison':prior['comparison'],'scores':scores,'model_updated':False,
        'limitations':['Raw residuals only: no posthoc acceptance threshold, posterior or anatomical rejection.',
          'Caller-asserted capture time is not authenticated hardware timing.',
          'Bytes and canonical DSP verified; physical calibration and exact execution remain unverified.']}))
