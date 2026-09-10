from copy import deepcopy
import importlib.util
from pathlib import Path
import numpy as np
import pytest

spec=importlib.util.spec_from_file_location('pcm_stress',Path(__file__).parents[1]/'scripts/pcm_robustness_challenge.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def test_transforms_are_deterministic_bounded_and_generator_is_not_in_grid():
    p=m.PROTOCOL;pcm=np.sin(np.arange(11025)*.1)*.1;original=pcm.copy()
    for case in p['cases']:
        a=m.transform(pcm,case,44100,3,p)
        np.testing.assert_array_equal(a,m.transform(pcm,case,44100,3,p))
        assert a.shape==pcm.shape and np.isfinite(a).all()
    np.testing.assert_array_equal(pcm,original)
    noise=m.transform(pcm,'noise',44100,3,p)-pcm
    snr=20*np.log10(np.std(pcm)/np.std(noise))
    assert snr==pytest.approx(6.,abs=.2)
    assert all(c['anatomy']!=p['anatomy'] and c['anatomy']!=p['out_of_grid_anatomy'] for c in m.grid(p))


def test_native_smoke_freezes_before_holdout_and_preserves_hard_budget_failure(tmp_path):
    p=deepcopy(m.PROTOCOL);p.update(cases=['clean'],seeds=[3],candidate_anatomies=[p['candidate_anatomies'][0]],hard_synthesis_limit=13)
    report=m.run(tmp_path/'smoke',p)
    assert report['actual_synthesis_calls']==13
    assert report['cases'][0]['status']=='scored'
    assert (tmp_path/'smoke/clean/frozen-fit.json').exists()
    assert (tmp_path/'smoke/clean/clean-heldout-scoring-only-e.pcm.f32').exists()
    with pytest.raises(FileExistsError):m.run(tmp_path/'smoke',p)
    failed=m.run(tmp_path/'failure',{**p,'hard_synthesis_limit':1})
    assert failed['cases'][0]['status']=='failed'
    assert failed['actual_synthesis_calls']==1
    assert 'budget' in failed['cases'][0]['fit_error']


@pytest.mark.parametrize('source',['observed','predicted'])
@pytest.mark.parametrize('flag',['clipping','invalid','dropped','low-signal-to-noise',None])
def test_heldout_quality_failures_do_not_become_finite_scores(source,flag):
    clean={'measurements':[{'name':name,'value':1.} for name in m.FEATURES],
           'quality':{'flags':[],'missingReason':None}}
    observed,predicted=deepcopy(clean),deepcopy(clean)
    bad=observed if source=='observed' else predicted
    bad['quality']={'flags':[flag] if flag else [],'missingReason':None if flag else 'not-captured'}
    score=m.compare(observed,predicted)
    assert score['weighted_discrepancy'] is None
    assert score['quality_failures'][0]['source']==source
    assert all(error==0 for error in score['descriptor_errors'].values())
