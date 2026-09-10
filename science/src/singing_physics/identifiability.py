"""Bounded numerical discrimination of explicit anatomy/articulation hypotheses."""
from __future__ import annotations

from itertools import combinations

import numpy as np

from .engine import Engine, finite
from .prediction import Artifact, _encode, _identity, _timestamp


def freeze_hypotheses(*, model_id, evidence_ids, provenance, hypotheses, frozen_at):
    _identity(model_id, 'model_id')
    _timestamp(frozen_at)
    if not isinstance(evidence_ids, list) or not evidence_ids:
        raise ValueError('Nonempty fitting evidence IDs required')
    for identity in evidence_ids:
        _identity(identity, 'evidence_id')
    if len(set(evidence_ids)) != len(evidence_ids):
        raise ValueError('Duplicate fitting evidence')
    if not isinstance(provenance, dict) or not provenance:
        raise ValueError('Native provenance required')
    if not isinstance(hypotheses, list) or not 2 <= len(hypotheses) <= 64:
        raise ValueError('Supply 2-64 retained hypotheses')
    ids = []
    for hypothesis in hypotheses:
        if not isinstance(hypothesis, dict) or set(hypothesis) != {'hypothesis_id', 'anatomy', 'articulation'}:
            raise ValueError('Each hypothesis requires identity, anatomy and articulation')
        ids.append(_identity(hypothesis['hypothesis_id'], 'hypothesis_id'))
        for name in ('anatomy', 'articulation'):
            if not isinstance(hypothesis[name], dict):
                raise ValueError(f'{name} must be a mapping')
            for key, value in hypothesis[name].items():
                _identity(key, name)
                finite(value, key)
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate hypothesis IDs')
    return Artifact(_encode({'schema_version': 'internal-identifiability-0.1',
        'kind': 'frozen_anatomy_articulation_hypotheses', 'model_id': model_id,
        'evidence_ids': evidence_ids, 'provenance': provenance, 'hypotheses': hypotheses,
        'frozen_at': frozen_at}))


def rank_interventions(snapshot, *, expected_digest, ranking_id, target_evidence_id,
                       generated_at, interventions, noise_sigma_db, noise_assumption,
                       frequency_band_hz=(100., 6000.), bins=512, max_native_calls=256,
                       separation_threshold=1.):
    """Rank simulator experiments by the worst retained-pair standardized RMS.

    This score is neither information gain nor a statistical significance test.
    Uniform frequency weighting makes no independent-bin likelihood claim.
    """
    if not isinstance(snapshot, Artifact) or snapshot.sha256 != expected_digest:
        raise ValueError('Hypothesis digest mismatch')
    try:
        data = snapshot.data
    except (ValueError, UnicodeError) as exc:
        raise ValueError('Invalid hypothesis JSON') from exc
    keys = ('model_id', 'evidence_ids', 'provenance', 'hypotheses', 'frozen_at')
    if not isinstance(data, dict) or not set(keys) <= set(data):
        raise ValueError('Invalid hypothesis fields')
    canonical = freeze_hypotheses(**{key: data[key] for key in keys})
    if canonical.content != snapshot.content:
        raise ValueError('Invalid hypothesis schema or noncanonical content')
    _identity(ranking_id, 'ranking_id')
    _identity(target_evidence_id, 'target_evidence_id')
    if target_evidence_id in data['evidence_ids']:
        raise ValueError('Held-out target leaks into fitting evidence')
    if _timestamp(generated_at) < _timestamp(data['frozen_at']):
        raise ValueError('Ranking precedes hypothesis freeze')
    sigma = finite(noise_sigma_db, 'noise_sigma_db')
    threshold = finite(separation_threshold, 'separation_threshold')
    if sigma <= 0 or threshold <= 0:
        raise ValueError('Noise SD and separation threshold must be positive')
    _identity(noise_assumption, 'noise_assumption')
    if not isinstance(frequency_band_hz, (list, tuple)) or len(frequency_band_hz) != 2:
        raise ValueError('Frequency band needs lower and upper Hz')
    lower, upper = [finite(value, 'frequency_hz') for value in frequency_band_hz]
    if not 0 <= lower < upper:
        raise ValueError('Invalid frequency band')
    if type(bins) is not int or bins < 128 or bins > 16384 or bins & (bins - 1):
        raise ValueError('bins must be a power of two in [128, 16384]')
    if type(max_native_calls) is not int or not 1 <= max_native_calls <= 4096:
        raise ValueError('max_native_calls must be in [1, 4096]')
    if not isinstance(interventions, list) or not interventions or len(interventions) > 32:
        raise ValueError('Supply 1-32 predeclared interventions')
    count = len(interventions) * len(data['hypotheses'])
    if count > max_native_calls:
        raise ValueError('Native spectrum budget exceeded')
    ids = []
    for intervention in interventions:
        if not isinstance(intervention, dict) or set(intervention) != {'intervention_id', 'kind', 'pose', 'articulation'}:
            raise ValueError('Invalid intervention fields')
        ids.append(_identity(intervention['intervention_id'], 'intervention_id'))
        if intervention['kind'] != 'named_pose':
            raise ValueError('Unsupported simulator intervention; nasal occlusion is unsupported')
        _identity(intervention['pose'], 'pose')
        if not isinstance(intervention['articulation'], dict):
            raise ValueError('Intervention articulation must be a mapping')
        for key, value in intervention['articulation'].items():
            _identity(key, 'articulation')
            finite(value, key)
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate intervention IDs')
    results = []
    with Engine() as engine:
        if engine.provenance != data['provenance']:
            raise ValueError('Native provenance mismatch')
        if upper > engine.sample_rate / 2:
            raise ValueError('Frequency band exceeds native Nyquist')
        frequency = np.arange(bins // 2 + 1) * engine.sample_rate / bins
        mask = (frequency >= lower) & (frequency <= upper)
        if not mask.any():
            raise ValueError('Frequency band contains no native bins')
        for intervention in interventions:
            predictions = []
            for hypothesis in data['hypotheses']:
                anatomy = engine.set_anatomy(hypothesis['anatomy'])
                control = {**hypothesis['articulation'], **intervention['articulation']}
                _, applied = engine.pose(intervention['pose'], control)
                _, magnitude, _ = engine.spectrum(intervention['pose'], control, bins=bins)
                predictions.append({'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy': anatomy,
                    'native_controls': applied, 'magnitude_db': magnitude[mask].tolist()})
            pairs = []
            for left, right in combinations(predictions, 2):
                rms = float(np.sqrt(np.mean((np.array(left['magnitude_db']) - right['magnitude_db']) ** 2)))
                pairs.append({'hypothesis_ids': [left['hypothesis_id'], right['hypothesis_id']],
                              'rms_difference_db': rms, 'standardized_rms': rms / sigma})
            worst, best = min(p['standardized_rms'] for p in pairs), max(p['standardized_rms'] for p in pairs)
            status = ('all_retained_pairs_exceed_threshold' if worst >= threshold else
                      'some_retained_pairs_exceed_threshold' if best >= threshold else
                      'no_separated_pair_at_threshold')
            results.append({'intervention': intervention, 'predictions': predictions, 'pairs': pairs,
                'worst_pair_standardized_rms': worst, 'best_pair_standardized_rms': best, 'status': status})
    results.sort(key=lambda row: (-row['worst_pair_standardized_rms'], row['intervention']['intervention_id']))
    return Artifact(_encode({'schema_version': 'internal-identifiability-0.1',
        'kind': 'frozen_numerical_intervention_ranking', 'ranking_id': ranking_id,
        'model_id': data['model_id'], 'hypothesis_snapshot_sha256': snapshot.sha256,
        'fitting_evidence_ids': data['evidence_ids'], 'target_evidence_id': target_evidence_id,
        'generated_at': generated_at, 'hypotheses_frozen_at': data['frozen_at'], 'provenance': data['provenance'],
        'predeclared_interventions': interventions, 'noise_sigma_db': sigma, 'noise_assumption': noise_assumption,
        'frequency_band_hz': [lower, upper], 'frequency_hz': frequency[mask].tolist(), 'bins': bins,
        'separation_threshold': threshold, 'native_calls': count, 'rankings': results,
        'criterion': 'maximize_worst_retained_pair_uniform_frequency_rms_divided_by_assumed_noise_sd',
        'limitations': ['Conditional on finite retained hypothesis space', 'Heuristic threshold, not significance or posterior',
            'Simulator articulation override, not guaranteed human cue execution',
            'No tissue identifiability or microphone observation claim', 'No runtime cue selection']}))
