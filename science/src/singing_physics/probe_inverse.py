"""Finite shared-anatomy fitting of canonical PCM and external-drive responses."""
from copy import deepcopy
import math
import re

import numpy as np

from .engine import Engine, finite
from .pcm_inverse import _hash, fit_pcm
from .acoustic_probe import OPERATOR_VERSION, predict_external_probe

QUANTITY = 'recorded_pcm_per_digital_drive'
NUISANCE_LIMITS = {'gain': (.01, 100.), 'direct_gain': (0., 2.), 'coupling_gain': (0., 2.), 'delay_s': (-.01, .01)}


def _id(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Missing evidence or protocol identity')
    return value


def _sha(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError('Expected lowercase SHA256 source hash')
    return value


def _parse_record(record):
    if record.get('split', 'calibration') != 'calibration':
        raise ValueError('non_calibration_record_excluded')
    if record.get('channel') != 'oral_external':
        raise ValueError('unsupported_channel_no_observation_operator')
    if record.get('quantity') != QUANTITY or record.get('pose_state') != 'held-quiet':
        raise ValueError('unsupported_quantity_or_simultaneous_singing')
    if not isinstance(record.get('pose'), str):
        raise ValueError('Explicit probe pose required')
    flags = record.get('quality_flags')
    if not isinstance(flags, list) or any(not isinstance(f, str) for f in flags):
        raise ValueError('Explicit quality flags required')
    if set(flags) & {'clipping', 'discontinuity', 'processing_uncharacterized', 'invalid', 'low_snr'}:
        raise ValueError('probe_quality_rejected')
    f = np.asarray(record.get('frequency_hz'), float)
    mask = np.asarray(record.get('valid_mask'))
    real, imag = np.asarray(record.get('response_real'), float), np.asarray(record.get('response_imag'), float)
    if f.ndim != 1 or not 2 <= len(f) <= 512 or not np.isfinite(f).all() or np.any(np.diff(f) <= 0) or f[0] < 20 or f[-1] > 20000:
        raise ValueError('Invalid response frequency grid')
    if mask.shape != f.shape or mask.dtype != np.dtype(bool) or real.shape != f.shape or imag.shape != f.shape:
        raise ValueError('Response components and boolean mask must match frequency grid')
    if not np.isfinite(real[mask]).all() or not np.isfinite(imag[mask]).all():
        raise ValueError('Nonfinite active response components')
    bands = record.get('bands')
    if not isinstance(bands, list) or not 1 <= len(bands) <= 32:
        raise ValueError('Declare 1-32 correlated-frequency bands')
    assigned = np.zeros(len(f), bool)
    included, excluded = [], []
    for index, band in enumerate(bands):
        if not isinstance(band, dict) or set(band) != {'low_hz', 'high_hz', 'sigma', 'weight'}:
            raise ValueError('Invalid band definition')
        low, high, sigma, weight = [finite(band[k], k) for k in ('low_hz', 'high_hz', 'sigma', 'weight')]
        if not 0 <= low < high <= 20001 or sigma <= 0 or not 0 < weight <= 100:
            raise ValueError('Invalid band scale or weight')
        support = (f >= low) & (f < high)
        if np.any(assigned & support):
            raise ValueError('Bands overlap on response bins')
        assigned |= support
        active = support & mask
        if active.any():
            included.append((index, active, sigma, weight))
        else:
            excluded.append({'band': index, 'reason': 'no_valid_observed_bins'})
    active = assigned & mask
    if not active.any():
        raise ValueError('no_valid_observed_bands')
    mode = record.get('comparison')
    timing = record.get('timing')
    if mode not in ('magnitude', 'complex') or not isinstance(timing, dict) or type(timing.get('phase_verified')) is not bool:
        raise ValueError('Explicit comparison and timing support required')
    if mode == 'complex':
        uncertainty = finite(timing.get('uncertainty_s'), 'timing uncertainty')
        _id(timing.get('evidence_id'))
        if not timing['phase_verified'] or uncertainty < 0 or 2*math.pi*float(max(f[active]))*uncertainty > .1:
            raise ValueError('phase_not_supported_at_active_frequencies')
        if not isinstance(timing.get('source_hashes'), list) or not timing['source_hashes']:
            raise ValueError('Phase timing evidence hashes required')
        for digest in timing['source_hashes']:
            _sha(digest)
    elif timing.get('uncertainty_s') is not None and finite(timing['uncertainty_s'], 'timing uncertainty') < 0:
        raise ValueError('Negative timing uncertainty')
    source = record.get('source')
    if not isinstance(source, dict) or source.get('kind') not in ('synthetic-fixture', 'physical-reference', 'human-recording'):
        raise ValueError('Explicit probe source provenance required')
    for name in ('drive_artifact_id', 'received_artifact_id'):
        _id(source.get(name))
    for name in ('drive_sha256', 'received_sha256'):
        _sha(source.get(name))
    if source['drive_sha256'] == source['received_sha256'] or source['drive_artifact_id'] == source['received_artifact_id']:
        raise ValueError('Drive and received response identities must differ')
    calibration, placement = record.get('calibration'), record.get('placement')
    if not isinstance(calibration, dict) or not isinstance(placement, dict):
        raise ValueError('Explicit calibration and placement required')
    for key in ('calibration_id', 'route_id', 'placement_id'):
        _id(calibration.get(key))
    if not isinstance(calibration.get('source_hashes'), list) or not calibration['source_hashes']:
        raise ValueError('Calibration source hashes required')
    for digest in calibration['source_hashes']:
        _sha(digest)
    prior = record.get('nuisance_prior')
    if not isinstance(prior, dict) or not isinstance(prior.get('bounds'), dict) or set(prior['bounds']) != set(NUISANCE_LIMITS):
        raise ValueError('Explicit bounded nuisance prior required')
    _id(prior.get('prior_id'))
    if not isinstance(prior.get('source_hashes'), list) or not prior['source_hashes']:
        raise ValueError('Nuisance prior source hashes required')
    for digest in prior['source_hashes']:
        _sha(digest)
    if source['received_sha256'] in set(prior['source_hashes']+calibration['source_hashes']):
        raise ValueError('Received target cannot calibrate its own nuisance prior')
    for name, limits in NUISANCE_LIMITS.items():
        bounds = prior['bounds'][name]
        if not isinstance(bounds, (list, tuple)) or len(bounds) != 2:
            raise ValueError('Nuisance interval requires two endpoints')
        low, high = (finite(v, name) for v in bounds)
        if not limits[0] <= low <= high <= limits[1]:
            raise ValueError('Nuisance bounds exceed supported scalar domain')
    conditions = record.get('conditions')
    if not isinstance(conditions, dict) or set(conditions) != {'termination', 'termination_resistance_pa_s_m3', 'attenuation_np_per_m'}:
        raise ValueError('Declare boundary termination and propagation loss')
    return {'record': record, 'frequencies': f, 'observed': real+1j*imag, 'active': active,
            'bands': included, 'excluded_bands': excluded}


class _Operators:
    def __init__(self, engine, budget, pcm_per_model):
        self.engine, self.budget, self.pcm_per_model = engine, budget, pcm_per_model
        self.counts = {model: {'pcm_synthesis_calls': 0, 'probe_geometry_calls': 0, 'external_forward_calls': 0}
                       for model in ('joint', 'fixed_anatomy_baseline')}
        self.model = 'joint'

    def __getattr__(self, name):
        return getattr(self.engine, name)

    @property
    def calls(self):
        return sum(sum(c.values()) for c in self.counts.values())

    def count(self, kind, model):
        if self.calls >= self.budget:
            raise RuntimeError('Hard joint operator budget exhausted')
        self.counts[model][kind] += 1

    def synthesize(self, *args, **kwargs):
        model = 'joint' if self.counts['joint']['pcm_synthesis_calls'] < self.pcm_per_model else 'fixed_anatomy_baseline'
        self.count('pcm_synthesis_calls', model)
        return self.engine.synthesize(*args, **kwargs)

    def geometry(self, *args, **kwargs):
        self.count('probe_geometry_calls', self.model)
        return self.engine.geometry(*args, **kwargs)


def fit_probe_pcm(engine: Engine, pcm_document, probe_document, *, candidates,
                  max_native_calls=128, pcm_weight=1., probe_weight=1., node_binary=None):
    """Joint conditional score with explicit received-source and frequency support."""
    pcm, probes, candidates = deepcopy(pcm_document), deepcopy(probe_document), deepcopy(candidates)
    if type(max_native_calls) is not int or not 1 <= max_native_calls <= 4096:
        raise ValueError('Invalid operator budget')
    pcm_weight, probe_weight = finite(pcm_weight, 'PCM weight'), finite(probe_weight, 'probe weight')
    if not 0 < pcm_weight <= 100 or not 0 < probe_weight <= 100:
        raise ValueError('Modality weights must be positive and bounded')
    if not isinstance(pcm, dict) or not isinstance(pcm.get('trials'), list) or not 1 <= len(pcm['trials']) <= 10:
        raise ValueError('Canonical PCM calibration trials required')
    if not isinstance(probes, dict) or set(probes) != {'schema_version', 'kind', 'trials'} or probes.get('schema_version') != '0.1.0' or probes.get('kind') != 'external_probe_observations':
        raise ValueError('Unsupported internal probe observation document')
    if not isinstance(probes['trials'], list) or not 1 <= len(probes['trials']) <= 16:
        raise ValueError('Require 1-16 probe records')
    pcm_ids, pcm_hashes = set(), set()
    for trial in pcm['trials']:
        measurement = trial.get('measurement', {})
        pcm_ids.update(x for x in (trial.get('id'), measurement.get('id'), measurement.get('artifactId'), measurement.get('observationId')) if isinstance(x, str))
        pcm_hashes.update(measurement.get('provenance', {}).get('sourceHashes', []))
    excluded_ids, excluded_hashes = set(), set()
    for record in probes['trials']:
        if isinstance(record, dict) and record.get('split', 'calibration') != 'calibration':
            source = record.get('source', {})
            if isinstance(source, dict):
                excluded_ids.update(v for v in (record.get('id'), source.get('received_artifact_id')) if isinstance(v, str))
                if isinstance(source.get('received_sha256'), str):
                    excluded_hashes.add(source['received_sha256'])
    if pcm_ids & excluded_ids or pcm_hashes & excluded_hashes:
        raise ValueError('PCM calibration aliases excluded probe evidence')
    usable, reports, received_ids, received_hashes, drive_ids, drive_hashes = [], [], set(), set(), set(), set()
    seen_ids, calibration_ids = set(), {}
    for record in probes['trials']:
        if not isinstance(record, dict):
            raise ValueError('Probe record must be a mapping')
        identity = _id(record.get('id'))
        if identity in seen_ids:
            raise ValueError('Duplicate probe record id')
        seen_ids.add(identity)
        try:
            parsed = _parse_record(record)
            if record['pose'] not in engine.poses:
                raise ValueError('Unknown probe pose')
            source = record['source']
            outputs = {identity, source['received_artifact_id']}
            conditioning_hashes = set(record['calibration']['source_hashes'] + record['nuisance_prior']['source_hashes'] + record['timing'].get('source_hashes', []))
            if outputs & excluded_ids or ({source['received_sha256'], source['drive_sha256']} | conditioning_hashes) & excluded_hashes or source['drive_artifact_id'] in excluded_ids:
                raise ValueError('calibration_aliases_excluded_probe_evidence')
            if outputs & (pcm_ids | received_ids | drive_ids) or source['received_sha256'] in pcm_hashes | received_hashes | drive_hashes:
                raise ValueError('received_source_overlaps_existing_evidence')
            if source['drive_artifact_id'] in pcm_ids | received_ids or source['drive_sha256'] in pcm_hashes | received_hashes:
                raise ValueError('drive_aliases_received_evidence')
            calibration_id = record['calibration']['calibration_id']
            declaration = _hash({'calibration': record['calibration'], 'prior': record['nuisance_prior'], 'placement': record['placement']})
            if calibration_id in calibration_ids and calibration_ids[calibration_id] != declaration:
                raise ValueError('Conflicting shared calibration identity')
            calibration_ids[calibration_id] = declaration
            received_ids.update(outputs); received_hashes.add(source['received_sha256'])
            drive_ids.add(source['drive_artifact_id']); drive_hashes.add(source['drive_sha256'])
            usable.append(parsed)
            reports.append({'id': identity, 'captured': True, 'response_usable': True, 'included_in_fit': True,
                            'reason': 'supported_masked_external_response', 'excluded_bands': parsed['excluded_bands'],
                            'phase_used': record['comparison'] == 'complex'})
        except (ValueError, TypeError, KeyError) as exc:
            reports.append({'id': identity, 'captured': True, 'response_usable': False, 'included_in_fit': False,
                            'reason': str(exc), 'phase_used': False})
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 32:
        raise ValueError('Require 1-32 finite anatomical candidates')
    pcm_candidates = []
    all_probe_ids, usable_ids = set(seen_ids), {x['record']['id'] for x in usable}
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) != {'candidate_id', 'anatomy', 'trials', 'probe_trials'} or not isinstance(candidate['probe_trials'], dict):
            raise ValueError('Candidate requires PCM controls and explicit probe trials')
        if not usable_ids <= set(candidate['probe_trials']) <= all_probe_ids:
            raise ValueError('Probe nuisance controls must cover usable records only or all declared records')
        shared = {}
        for parsed in usable:
            record = parsed['record']; control = candidate['probe_trials'][record['id']]
            if not isinstance(control, dict) or set(control) != {'JA', *NUISANCE_LIMITS}:
                raise ValueError('Probe controls require JA and bounded scalar nuisances')
            if not -5 <= finite(control['JA'], 'probe JA') <= -1:
                raise ValueError('Probe JA outside supported range')
            for name, (low, high) in record['nuisance_prior']['bounds'].items():
                if not low <= finite(control[name], name) <= high:
                    raise ValueError('Candidate nuisance exceeds declared calibration prior')
            nuisance = {name: control[name] for name in NUISANCE_LIMITS}
            calibration_id = record['calibration']['calibration_id']
            if calibration_id in shared and shared[calibration_id] != nuisance:
                raise ValueError('Shared calibration requires shared scalar nuisance parameters')
            shared[calibration_id] = nuisance
        pcm_candidates.append({key: candidate[key] for key in ('candidate_id', 'anatomy', 'trials')})
    required = 2*len(candidates)*(len(pcm['trials'])+2*len(usable))
    if required > max_native_calls:
        raise ValueError('Declared joint and baseline operators exceed total budget')
    operators = _Operators(engine, max_native_calls, len(candidates)*len(pcm['trials']))
    saved = engine.anatomy()
    models = {'joint': [], 'fixed_anatomy_baseline': []}
    try:
        pcm_result = fit_pcm(operators, pcm, candidates=pcm_candidates,
            max_synthesis_calls=2*len(candidates)*len(pcm['trials']), node_binary=node_binary)
        for model in models:
            operators.model = model
            pcm_rows = {row['candidate_id']: row for row in pcm_result[model]['candidates']}
            for candidate in candidates:
                engine.set_anatomy(candidate['anatomy'] if model == 'joint' else {})
                scores, predictions, failures = [], [], []
                for parsed in usable:
                    record = parsed['record']; control = candidate['probe_trials'][record['id']]
                    operators.count('external_forward_calls', model)
                    try:
                        prediction = predict_external_probe(operators, pose=record['pose'], frequency_hz=record['frequency_hz'],
                            articulation={'JA': control['JA']}, placement=record['placement'], calibration=record['calibration'], **record['conditions'])
                        if prediction['operator_version'] != OPERATOR_VERSION or prediction['quantity'] != QUANTITY:
                            raise ValueError('External observation operator mismatch')
                        valid = np.asarray(prediction['valid_mask'], bool)
                        if not np.all(valid[parsed['active']]):
                            raise ValueError('Candidate does not support all active observed band frequencies')
                        direct = np.asarray(prediction['direct_response_real'], float)+1j*np.asarray(prediction['direct_response_imag'], float)
                        mouth = np.asarray(prediction['mouth_response_real'], float)+1j*np.asarray(prediction['mouth_response_imag'], float)
                        response = control['gain']*np.exp(-2j*np.pi*parsed['frequencies']*control['delay_s'])*(control['direct_gain']*direct+control['coupling_gain']*mouth)
                        band_scores = []
                        for index, active, sigma, weight in parsed['bands']:
                            residual = response[active]-parsed['observed'][active] if record['comparison'] == 'complex' else abs(response[active])-abs(parsed['observed'][active])
                            discrepancy = float(np.mean(np.abs(residual/sigma)**2))
                            if not math.isfinite(discrepancy):
                                raise ValueError('Nonfinite probe discrepancy')
                            band_scores.append({'band': index, 'weighted_discrepancy': discrepancy, 'weight': weight,
                                                'bins_aggregated': int(active.sum())})
                        score = sum(b['weighted_discrepancy']*b['weight'] for b in band_scores)/sum(b['weight'] for b in band_scores)
                        scores.append(score)
                        predictions.append({'probe_id': record['id'], 'score': score, 'bands': band_scores,
                            'native_prediction': prediction, 'nuisance': control,
                            'fitted_response_real': [float(z.real) if ok else None for z, ok in zip(response, valid)],
                            'fitted_response_imag': [float(z.imag) if ok else None for z, ok in zip(response, valid)]})
                    except (ValueError, RuntimeError) as exc:
                        failures.append({'probe_id': record['id'], 'reason': str(exc)})
                pcm_row = pcm_rows[candidate['candidate_id']]
                score = None
                if not failures and pcm_row['status'] == 'scored':
                    score = pcm_weight*pcm_row['weighted_mean_square_discrepancy'] + (probe_weight*float(np.mean(scores)) if scores else 0.)
                models[model].append({'candidate_id': candidate['candidate_id'], 'anatomy': engine.anatomy(),
                    'status': 'scored' if score is not None else 'missing_supported_prediction',
                    'joint_discrepancy': score, 'pcm_discrepancy': pcm_row['weighted_mean_square_discrepancy'],
                    'probe_discrepancy': float(np.mean(scores)) if scores and not failures else None,
                    'probe_failures': failures, 'probe_predictions': predictions, 'pcm_candidate': pcm_row})
    finally:
        engine.set_anatomy(saved)
    output = {}
    for model, rows in models.items():
        ranked = [row for row in rows if row['status'] == 'scored']
        output[model] = {'candidates': rows, 'best': min(ranked, key=lambda r: (r['joint_discrepancy'], r['candidate_id'])) if ranked else None,
                         'operator_counts': operators.counts[model]}
    used_ids = {p['probe_id'] for rows in models.values() for row in rows if row['status'] == 'scored' for p in row['probe_predictions']}
    for report in reports:
        report['included_in_fit'] = report['id'] in used_ids
        if report['response_usable'] and not report['included_in_fit']:
            report['reason'] = 'no_complete_scored_candidate_uses_response'
    equal = sum(operators.counts['joint'].values()) == sum(operators.counts['fixed_anatomy_baseline'].values())
    return {'schema_version': '0.1.0', 'kind': 'joint_pcm_external_probe_fit', **output, 'probe_records': reports,
        'pcm_only_fit': pcm_result, 'actual_operator_calls': operators.calls, 'max_native_calls': max_native_calls,
        'operator_counts': operators.counts, 'equal_actual_comparison_calls': equal,
        'comparison_status': 'complete_equal_calls' if equal else 'failed_or_unsupported_operator_imbalance',
        'status': 'joint_probe_evidence_used' if used_ids else ('no_complete_joint_prediction' if usable else 'pcm_only_no_supported_probe_records'),
        'weights': {'pcm': pcm_weight, 'probe': probe_weight}, 'pcm_observation_sha256': _hash(pcm),
        'probe_observation_sha256': _hash(probes), 'candidate_sha256': _hash(candidates),
        'native_provenance': deepcopy(engine.provenance), 'external_operator_version': OPERATOR_VERSION,
        'frequency_bins_are_independent_evidence': False, 'identifiability': 'not_established',
        'score_interpretation': 'weighted band-aggregated heuristic discrepancy, not calibrated likelihood',
        'source_artifact_bytes_verified': False, 'calibrated_posterior': False}
