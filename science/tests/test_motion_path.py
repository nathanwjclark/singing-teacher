from copy import deepcopy
import json
import math

from singing_physics.motion_path import couple_motion_hypotheses


def window(index,offset,candidates):
    return {'index':index,'sourceStartSample':offset,'windowOffsetWithinExcerpt':4800,'sampleRateHz':48000,'frameSha256':format(index,'064x'),
        'status':'scored','measurement':{'measurements':[{'name':'pitchHz','value':180}], 'window':{'startMs':100,'endMs':100+4096/48}},'fit':{'feature_scales':{'pitchHz':{'unit':'Hz','scale':20}},'canonical_extractor':{'version':'fixed'},'native_provenance':{'basis':'fixed'},
        'joint':{'candidates':[{'candidate_id':f'{anatomy}-{ja}','anatomy':{'length':anatomy},'status':'scored','weighted_mean_square_discrepancy':cost,'predictions':[{'controls':{'JA':ja,'gain':1}}]} for anatomy,ja,cost in candidates]}}}


def test_dp_sensitivity_and_global_fixed_anatomy_preserves_input():
    windows=[window(0,0,[(4,-4,0),(4,-2,.2),(5,-4,.1)]),window(1,12000,[(4,-4,.2),(4,-2,0),(5,-4,.1)])]
    before=deepcopy(windows);result=couple_motion_hypotheses(windows)
    assert windows==before and result['status']=='available'
    assert [r['JA'] for r in result['sensitivity'][0]['best']['path']]==[-4,-2]
    assert result['sensitivity'][2]['best']['unweightedTransitionCost']==0
    for analysis in result['sensitivity']:
        for path in analysis['alternatives']:
            assert path['objective']==path['dataCost']+analysis['lambda']*path['unweightedTransitionCost']
            assert len({r['anatomySha256'] for r in path['path']})==1
    assert result['additionalSynthesisCalls']==0 and not result['modelUpdated']


def test_missing_middle_and_sparse_gaps_reset_controls_but_not_anatomy():
    windows=[window(0,0,[(4,-4,0),(5,-4,4)]),{'status':'unavailable'},window(2,480000,[(4,-2,3),(5,-2,0)])]
    result=couple_motion_hypotheses(windows)
    assert result['status']=='no-temporal-links' and result['partialEvidence']
    assert len(result['segments'])==2
    for sensitivity in result['sensitivity']:
        assert sensitivity['best']['dataCost']==3
        assert sensitivity['best']['unweightedTransitionCost']==0
        assert sensitivity['best']['anatomy']=={'length':4}
    assert [r['anatomy']['length'] for r in result['independent']]==[4,5]


def test_invalid_candidates_and_incomparable_scale_rejection():
    rows=[window(0,0,[(4,-4,0)]),window(1,12000,[(4,-2,1)])]
    bad=deepcopy(rows);bad[0]['fit']['joint']['candidates'][0]['weighted_mean_square_discrepancy']=math.nan
    result=couple_motion_hypotheses(bad);assert result['excludedWindows'] and result['status']=='no-temporal-links';json.dumps(result,allow_nan=False)
    rows[1]['fit']['feature_scales']['pitchHz']['scale']=30
    result=couple_motion_hypotheses(rows);assert result['status']=='unavailable' and 'scales' in result['reason']


def test_identical_samples_at_disjoint_times_are_valid_stable_sound():
    rows=[window(0,0,[(4,-4,0)]),window(1,12000,[(4,-4,0)])]
    rows[1]['frameSha256']=rows[0]['frameSha256']
    result=couple_motion_hypotheses(rows)
    assert result['status']=='available' and result['includedWindowCount']==2
    assert result['sensitivity'][2]['best']['unweightedTransitionCost']==0


def test_min_marginal_support_matches_complete_path_enumeration():
    import itertools
    windows=[window(i,i*12000,[(4,-4,costs[0]),(4,-2,costs[1]),(5,-3,.1)])
        for i,costs in enumerate(((0,.15),(.12,0),(0,.08)))]
    result=couple_motion_hypotheses(windows)
    for sensitivity in result['sensitivity']:
        penalty=sensitivity['lambda'];expected=[]
        for anatomy,choices in ((4,(-4,-2)),(5,(-3,))):
            for path in itertools.product(choices,repeat=3):
                costs=[next(c['weighted_mean_square_discrepancy'] for c in windows[i]['fit']['joint']['candidates']
                    if c['anatomy']['length']==anatomy and c['predictions'][0]['controls']['JA']==ja) for i,ja in enumerate(path)]
                total=sum(costs)+penalty*sum((path[i]-path[i-1])**2 for i in range(1,3))
                expected.append((anatomy,path,total))
        best=min(row[2] for row in expected)
        for support in sensitivity['uncertainty']:
            for candidate in support['candidates']:
                conditional=min(total for anatomy,path,total in expected if anatomy==candidate['anatomy']['length'] and path[support['position']]==candidate['JA'])
                assert math.isclose(candidate['minimumPathObjective'],conditional,abs_tol=1e-12)
                assert math.isclose(candidate['objectiveGap'],conditional-best,abs_tol=1e-12)
        for transition in sensitivity['transitionUncertainty']:
            start,end=transition['fromPosition'],transition['toPosition']
            assert transition['JAChangeSet']==sorted({path[end]-path[start] for _,path,total in expected if total-best<=.1+1e-10})


def test_time_scaling_missing_windows_and_ambiguous_controls_are_explicit():
    rows=[window(i,i*24000,[(4,-4,0),(4,-2,0)]) for i in range(12)]
    rows[5]={'status':'unavailable','reason':'Recorded dropout'}
    result=couple_motion_hypotheses(rows)
    assert result['includedWindowCount']==11 and result['partialEvidence']
    assert [segment['positions'] for segment in result['segments']]==[list(range(5)),list(range(6,12))]
    assert all(row['JASet']==[-4,-2] for row in result['sensitivity'][0]['uncertainty'])
    assert not any(row['fromPosition']==4 and row['toPosition']==6 for row in result['sensitivity'][1]['transitionUncertainty'])
    # Every remaining transition spans .5 s, so a 2-degree jump costs 4*.25/.5.
    clear=[window(0,0,[(4,-4,0)]),window(1,24000,[(4,-2,0)])]
    assert couple_motion_hypotheses(clear)['sensitivity'][1]['best']['unweightedTransitionCost']==2
