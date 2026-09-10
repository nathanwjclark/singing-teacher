from copy import deepcopy
from datetime import datetime, timezone
import hashlib

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import design_pcm, freeze_pcm_hypotheses, update_pcm
from singing_physics.pcm_inverse import resample_native_pcm
from singing_physics.prediction import Artifact, _encode


def now():
    return datetime.now(timezone.utc).isoformat()


SCALES = {'dbfs': {'unit': 'dBFS', 'scale': .1, 'assumption': 'Synthetic test discrimination scale, not calibrated noise'},
          'centroidHz': {'unit': 'Hz', 'scale': 5., 'assumption': 'Synthetic test scale'},
          'flatness': {'unit': 'ratio', 'scale': .00001, 'assumption': 'Synthetic test scale'}}
EXPERIMENTS = [{'experiment_id': 'a-vowel', 'pose': 'a', 'JA': -3., 'f0_hz': 180., 'gain': .8}]


def freeze(identical=False, hashes=None):
    with Engine() as engine:
        provenance = engine.provenance
    anatomy = {'hard_palate_length': 4.2, 'pharynx_length': 7.}
    return freeze_pcm_hypotheses(model_id='research-model', evidence_ids=['calibration'],
        evidence_hashes=hashes or ['a'*64], provenance=provenance, frozen_at=now(), hypotheses=[
            {'hypothesis_id': 'first', 'anatomy': anatomy},
            {'hypothesis_id': 'second', 'anatomy': anatomy if identical else {'hard_palate_length': 4.8, 'pharynx_length': 6.2}}])


def design(snapshot, **changes):
    kwargs = dict(expected_digest=snapshot.sha256, design_id='design', target_observation_id='target',
        generated_at=now(), experiments=EXPERIMENTS, feature_scales=SCALES)
    kwargs.update(changes)
    return design_pcm(snapshot, **kwargs)


def observed_frame(snapshot):
    with Engine() as engine:
        engine.set_anatomy(snapshot.data['hypotheses'][0]['anatomy'])
        return engine.synthesize('a', {'JA': -3.}, f0_hz=180., duration_s=.25)[4410:8506]*.8


def update(ranking, snapshot, frame, **changes):
    kwargs = dict(expected_design_digest=ranking.sha256, expected_snapshot_digest=snapshot.sha256,
        experiment_id='a-vowel', observation_id='target', artifact_id='target-audio', observed_at=now(), pcm=frame)
    kwargs.update(changes)
    return update_pcm(ranking, snapshot, **kwargs)


def test_native_design_then_actual_receipt_update_preserves_prior_and_budget(tmp_path):
    snapshot = freeze()
    ranking = design(snapshot, max_synthesis_calls=2)
    before = ranking.content
    ranking.write(tmp_path/'ranking.json')
    assert ranking.data['actual_synthesis_calls'] == 2
    assert ranking.data['selected_experiment_id'] == 'a-vowel'
    result = update(ranking, snapshot, observed_frame(snapshot)).data
    assert result['status'] == 'conditional_support_updated'
    assert result['scores'][0]['standardized_rms'] == pytest.approx(0, abs=1e-8)
    assert len(result['updated_snapshot']['hypotheses']) == 1
    assert ranking.content == before == (tmp_path/'ranking.json').read_bytes()
    receipt = result['observation_receipt']
    assert datetime.fromisoformat(receipt['received_at']) > datetime.fromisoformat(ranking.data['sealed_at'])
    assert hashlib.sha256(_encode(receipt)).hexdigest() == result['observation_receipt_sha256']
    assert receipt['canonical']['pcmFloat32Sha256'] == receipt['frame_sha256']
    updated = Artifact(_encode(result['updated_snapshot']))
    stopped = design(updated, target_observation_id='later').data
    assert stopped['selected_experiment_id'] is None
    assert stopped['rankings'][0]['status'] == 'insufficient_distinct_hypotheses'
    with pytest.raises(FileExistsError):
        ranking.write(tmp_path/'ranking.json')
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_identical_physical_candidates_collapse_and_no_separation_abstains():
    snapshot = freeze(identical=True)
    assert len(snapshot.data['hypotheses']) == 1
    assert snapshot.data['duplicate_geometries'] == [{'hypothesis_id': 'second', 'equivalent_to': 'first'}]
    ranking = design(snapshot)
    assert ranking.data['selected_experiment_id'] is None
    result = update(ranking, snapshot, observed_frame(snapshot)).data
    assert result['status'] == 'no_design_separation'
    assert len(result['updated_snapshot']['hypotheses']) == 1
    unresolved = design(freeze(), minimum_separation=1e10).data
    assert unresolved['selected_experiment_id'] is None
    assert unresolved['rankings'][0]['status'] == 'no_separation_at_assumed_threshold'


def test_missing_predicted_and_observed_features_never_improve_rank_or_prune():
    snapshot = freeze()
    ranking = design(snapshot, experiments=[{**EXPERIMENTS[0], 'gain': 100.}])
    assert ranking.data['selected_experiment_id'] is None
    assert ranking.data['rankings'][0]['status'] == 'missing_predicted_features'
    result = update(ranking, snapshot, np.zeros(4096)).data
    assert result['status'] == 'missing_required_features'
    assert len(result['updated_snapshot']['hypotheses']) == 2
    assert result['scores'] == []


def test_validation_budget_and_receipt_identity():
    snapshot = freeze()
    for changes in ({'max_synthesis_calls': 1}, {'expected_digest': 'stale'}, {'target_observation_id': 'calibration'},
                    {'experiments': [{**EXPERIMENTS[0], 'pose': 'nasal-plugging'}]},
                    {'experiments': [{**EXPERIMENTS[0], 'JA': float('nan')}]},
                    {'feature_scales': {**SCALES, 'dbfs': {**SCALES['dbfs'], 'unit': 'Hz'}}}):
        with pytest.raises(ValueError):
            design(snapshot, **changes)
    ranking = design(snapshot)
    frame = observed_frame(snapshot)
    for changes in ({'expected_design_digest': 'stale'}, {'observation_id': 'calibration'}, {'artifact_id': 'calibration'},
                    {'observed_at': snapshot.data['frozen_at']}, {'sample_rate_hz': 48000}, {'frame_start_sample': 0},
                    {'pcm': np.ones(10)}, {'pcm': np.full(4096, np.nan)}, {'source_kind': 'development-fixture'}):
        with pytest.raises(ValueError):
            update(ranking, snapshot, frame, **changes)
    altered = ranking.data; altered['extractor']['extractorSha256'] = 'b'*64
    stale = Artifact(_encode(altered))
    with pytest.raises(ValueError, match='extractor'):
        update(stale, snapshot, frame)
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_repeated_physical_frame_is_rejected_despite_renamed_ids():
    snapshot = freeze()
    first_frame = observed_frame(snapshot)
    raw_hash = hashlib.sha256(np.asarray(first_frame, dtype='<f4').tobytes()).hexdigest()
    previously_seen = freeze(hashes=[raw_hash])
    ranking = design(previously_seen)
    with pytest.raises(ValueError, match='Repeated physical'):
        update(ranking, previously_seen, first_frame, artifact_id='renamed-source')


def test_rehashed_prediction_features_cannot_change_update_score():
    snapshot = freeze(); ranking = design(snapshot)
    modified = deepcopy(ranking.data)
    modified['rankings'][0]['predictions'][0]['features']['dbfs'] += 10
    forged = Artifact(_encode(modified))
    with pytest.raises(ValueError, match='binding'):
        update(forged, snapshot, observed_frame(snapshot))


def test_mismatch_abstains_and_distinct_designs_cannot_alias_model_identity():
    snapshot = freeze()
    narrow = design(snapshot)
    broad = design(snapshot, retention_margin=1e12)
    frame = observed_frame(snapshot)
    first = update(narrow, snapshot, frame).data
    second = update(broad, snapshot, frame).data
    assert len(first['updated_snapshot']['hypotheses']) == 1
    assert len(second['updated_snapshot']['hypotheses']) == 2
    assert first['updated_snapshot']['model_id'] != second['updated_snapshot']['model_id']
    mismatch_design = design(snapshot, maximum_discrepancy=.000001)
    mismatch = update(mismatch_design, snapshot, frame*.9).data
    assert mismatch['status'] == 'model_mismatch'
    assert len(mismatch['updated_snapshot']['hypotheses']) == 2


@pytest.mark.parametrize('rate,size', [(48000, 4096), (96000, 8192)])
def test_native_phone_profile_forecast_and_later_pcm_update(rate, size):
    snapshot = freeze()
    profile = {'sample_rate_hz': rate, 'frame_start_sample': rate//10,
               'frame_size': size, 'duration_s': .25}
    ranking = design(snapshot, profile=profile)
    assert ranking.data['profile'] == profile
    with Engine() as engine:
        engine.set_anatomy(snapshot.data['hypotheses'][0]['anatomy'])
        generated = engine.synthesize('a', {'JA': -3.}, f0_hz=180., duration_s=.25)
        recording, resampling = resample_native_pcm(generated, engine.sample_rate, rate)
    start = profile['frame_start_sample']
    frame = np.asarray(recording[start:start+size]*.8, dtype='<f4')
    params = {key: profile[key] for key in ('sample_rate_hz', 'frame_start_sample', 'frame_size')}
    result = update(ranking, snapshot, frame, **params).data
    assert result['status'] == 'conditional_support_updated'
    assert result['scores'][0]['standardized_rms'] == pytest.approx(0, abs=1e-8)
    assert result['observation_receipt']['profile'] == profile
    assert result['observation_receipt']['frame_sha256'] == hashlib.sha256(frame.tobytes()).hexdigest()
    assert ranking.data['rankings'][0]['predictions'][0]['resampling'] == resampling
    assert resampling['observations_resampled'] is False
    for mismatch in ({'sample_rate_hz': 44100}, {'frame_start_sample': start+1}, {'frame_size': size//2}):
        with pytest.raises(ValueError, match='profile'):
            update(ranking, snapshot, frame, **{**params, **mismatch})
    modified = ranking.data
    modified['profile']['frame_start_sample'] += 1
    with pytest.raises(ValueError, match='profile binding'):
        update(Artifact(_encode(modified)), snapshot, frame, **{**params, 'frame_start_sample': start+1})


@pytest.mark.parametrize('changes', [
    {'sample_rate_hz': 32000}, {'frame_size': 8192}, {'frame_start_sample': -1},
    {'duration_s': .1}, {'duration_s': 6}, {'frame_start_sample': True}, {'extra': 1}])
def test_invalid_design_profile_rejected(changes):
    profile = {'sample_rate_hz': 48000, 'frame_start_sample': 4800, 'frame_size': 4096, 'duration_s': .25}
    with pytest.raises(ValueError):
        design(freeze(), profile={**profile, **changes})


def test_explicit_forecast_choice_preserves_numerics_and_rejects_different_outcome():
    from singing_physics.pcm_design import select_pcm_experiment
    snapshot=freeze()
    ranking=design(snapshot)
    chosen=select_pcm_experiment(ranking,snapshot,expected_design_digest=ranking.sha256,
        expected_snapshot_digest=snapshot.sha256,design_id='chosen',target_observation_id='chosen-target',
        experiment_id='a-vowel',selection_reason='Declared test choice')
    assert chosen.data['rankings']==ranking.data['rankings']
    with pytest.raises(ValueError,match='explicitly committed'):
        update(chosen,snapshot,observed_frame(snapshot),experiment_id='other',observation_id='chosen-target')
    result=update(chosen,snapshot,observed_frame(snapshot),observation_id='chosen-target')
    assert result.data['design_sha256']==chosen.sha256
    bad=deepcopy(ranking.data);bad['rankings'][0]['predictions'][0]['features']=None
    unsupported=Artifact(_encode(bad))
    with pytest.raises(ValueError,match='complete'):
        select_pcm_experiment(unsupported,snapshot,expected_design_digest=unsupported.sha256,
            expected_snapshot_digest=snapshot.sha256,design_id='chosen',target_observation_id='new-target',
            experiment_id='a-vowel',selection_reason='Test')
