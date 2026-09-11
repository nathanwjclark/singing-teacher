from copy import deepcopy
import json
import math

import numpy as np

from singing_physics.motion_path import CONSTANT_TOLERANCE_PER_WINDOW,MAX_LINK_GAP_SECONDS,couple_motion_hypotheses

ANATOMY={length:format(length,'064x') for length in (4,5)}
LENGTH={digest:length for length,digest in ANATOMY.items()}


def window(index,offset,candidates):
    return {'index':index,'sourceStartSample':offset,'windowOffsetWithinExcerpt':4800,'sampleRateHz':48000,'frameSha256':format(index,'064x'),
        'status':'scored','measurement':{'measurements':[{'name':'pitchHz','value':180}], 'window':{'startMs':100,'endMs':100+4096/48}},'fit':{'featureScales':{'pitchHz':{'unit':'Hz','scale':20}},'comparisonSha256':'c'*64,
        'joint':{'candidates':[{'candidate_id':f'{anatomy}-{ja}','anatomySha256':ANATOMY[anatomy],'status':'scored','weighted_mean_square_discrepancy':cost,'JA':ja,'gain':1} for anatomy,ja,cost in candidates]}}}


def test_dp_sensitivity_and_global_fixed_anatomy_preserves_input():
    windows=[window(0,0,[(4,-4,0),(4,-2,.2),(5,-4,.1)]),window(1,12000,[(4,-4,.2),(4,-2,0),(5,-4,.1)])]
    before=deepcopy(windows);result=couple_motion_hypotheses(windows)
    assert windows==before and result['status']=='available'
    assert [r['JA'] for r in result['sensitivity'][0]['alternatives'][0]['path']]==[-4,-2]
    assert result['sensitivity'][2]['alternatives'][0]['timeScaledTransitionCost']==0
    for analysis in result['sensitivity']:
        for path in analysis['alternatives']:
            assert path['objective']==path['dataCost']+analysis['lambda']*path['timeScaledTransitionCost']
            assert {int(r['candidateId'].split('-')[0]) for r in path['path']}=={LENGTH[path['anatomySha256']]}
    assert result['additionalSynthesisCalls']==0 and not result['modelUpdated']


def test_missing_middle_and_sparse_gaps_reset_controls_but_not_anatomy():
    windows=[window(0,0,[(4,-4,0),(5,-4,4)]),{'status':'unavailable'},window(2,480000,[(4,-2,3),(5,-2,0)])]
    result=couple_motion_hypotheses(windows)
    assert result['status']=='no-temporal-links' and result['partialEvidence']
    assert len(result['segments'])==2
    assert result['excludedWindows']==[{'position':1,'startSeconds':None,'reason':'Missing or unscorable independent window'}]
    for sensitivity in result['sensitivity']:
        assert sensitivity['alternatives'][0]['dataCost']==3
        assert sensitivity['alternatives'][0]['timeScaledTransitionCost']==0
        assert sensitivity['alternatives'][0]['anatomySha256']==ANATOMY[4]
    assert [LENGTH[r['anatomySha256']] for r in result['independent']]==[4,5]


def test_invalid_candidates_and_incomparable_provenance_rejection():
    rows=[window(0,0,[(4,-4,0)]),window(1,12000,[(4,-2,1)])]
    bad=deepcopy(rows);bad[0]['fit']['joint']['candidates'][0]['weighted_mean_square_discrepancy']=math.nan
    result=couple_motion_hypotheses(bad);assert result['excludedWindows'] and result['status']=='no-temporal-links';json.dumps(result,allow_nan=False)
    unit=deepcopy(rows);unit[1]['fit']['featureScales']['pitchHz']['unit']='cents'
    result=couple_motion_hypotheses(unit);assert result['status']=='unavailable' and 'units' in result['reason']
    provenance=deepcopy(rows);provenance[1]['fit']['comparisonSha256']='d'*64
    assert couple_motion_hypotheses(provenance)['status']=='unavailable'


def test_per_window_scale_values_combine_when_policy_and_units_match():
    # A noisy window carries its own wider scale; it must not block or rescale its neighbours.
    rows=[window(0,0,[(4,-4,0),(4,-2,.3)]),window(1,12000,[(4,-4,.3),(4,-2,0)])]
    rows[1]['fit']['featureScales']['pitchHz']['scale']=60
    result=couple_motion_hypotheses(rows)
    assert result['status']=='available' and result['includedWindowCount']==2
    assert [r['dataCost'] for r in result['independent']]==[0,0]


def test_identical_samples_at_disjoint_times_are_valid_stable_sound():
    rows=[window(0,0,[(4,-4,0)]),window(1,12000,[(4,-4,0)])]
    rows[1]['frameSha256']=rows[0]['frameSha256']
    result=couple_motion_hypotheses(rows)
    assert result['status']=='available' and result['includedWindowCount']==2
    assert result['sensitivity'][2]['alternatives'][0]['timeScaledTransitionCost']==0


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
                    if c['anatomySha256']==ANATOMY[anatomy] and c['JA']==ja) for i,ja in enumerate(path)]
                total=sum(costs)+penalty*sum((path[i]-path[i-1])**2 for i in range(1,3))
                expected.append((anatomy,path,total))
        best=min(row[2] for row in expected)
        for support in sensitivity['uncertainty']:
            candidates=windows[support['position']]['fit']['joint']['candidates']
            assert len(support['candidateObjectiveGaps'])==len(candidates)
            for candidate,gap in zip(candidates,support['candidateObjectiveGaps']):
                anatomy=LENGTH[candidate['anatomySha256']]
                conditional=min(total for length,path,total in expected if length==anatomy and path[support['position']]==candidate['JA'])
                assert math.isclose(gap,conditional-best,abs_tol=1e-12)
        for transition in sensitivity['transitionUncertainty']:
            start,end=transition['fromPosition'],transition['toPosition']
            assert transition['JAChangeSet']==sorted({path[end]-path[start] for _,path,total in expected if total-best<=.1+1e-10})


def test_unscored_candidates_keep_their_slot_in_objective_gaps():
    rows=[window(i,i*12000,[(4,-4,0),(4,-2,.05)]) for i in range(2)]
    rows[1]['fit']['joint']['candidates'][0].update(status='missing_predicted_features',weighted_mean_square_discrepancy=None)
    gaps=[row['candidateObjectiveGaps'] for row in couple_motion_hypotheses(rows)['sensitivity'][0]['uncertainty']]
    assert gaps[1][0] is None and gaps[1][1]==0 and len(gaps[0])==2


def test_time_scaling_missing_windows_and_ambiguous_controls_are_explicit():
    rows=[window(i,i*24000,[(4,-4,0),(4,-2,0)]) for i in range(12)]
    rows[5]={'status':'unavailable','reason':'Recorded dropout','sourceStartSample':5*24000,'windowOffsetWithinExcerpt':4800,'sampleRateHz':48000}
    result=couple_motion_hypotheses(rows)
    assert result['includedWindowCount']==11 and result['partialEvidence']
    assert result['excludedWindows']==[{'position':5,'startSeconds':(5*24000+4800)/48000,'reason':'Recorded dropout'}]
    assert [segment['positions'] for segment in result['segments']]==[list(range(5)),list(range(6,12))]
    assert all(row['JASet']==[-4,-2] for row in result['sensitivity'][0]['uncertainty'])
    assert not any(row['fromPosition']==4 and row['toPosition']==6 for row in result['sensitivity'][1]['transitionUncertainty'])
    # Every remaining transition spans .5 s, so a 2-degree jump costs 4*.25/.5.
    clear=[window(0,0,[(4,-4,0)]),window(1,24000,[(4,-2,0)])]
    assert couple_motion_hypotheses(clear)['sensitivity'][1]['alternatives'][0]['timeScaledTransitionCost']==2


def test_link_gap_boundary_between_measured_frames():
    frame=4096/48000
    for gap,status in ((MAX_LINK_GAP_SECONDS-.001,'available'),(MAX_LINK_GAP_SECONDS+.001,'no-temporal-links')):
        offset=round((frame+gap)*48000)
        result=couple_motion_hypotheses([window(0,0,[(4,-4,0)]),window(1,offset,[(4,-4,0)])])
        assert result['status']==status and len(result['segments'])==(1 if status=='available' else 2)


def test_constant_path_comparison_uses_a_per_window_tolerance():
    # Changing controls fit better than any constant path by more than 0.01 per window.
    varying=[window(i,i*12000,[(4,-4,0 if i%2 else .5),(4,-2,.5 if i%2 else 0)]) for i in range(4)]
    result=couple_motion_hypotheses(varying)
    assert result['settings']['constantTolerancePerWindow']==CONSTANT_TOLERANCE_PER_WINDOW==.01
    assert result['informationOverConstant']=='exceeds-tolerance' and result['warnings']==[]
    plain=result['sensitivity'][0]['constantComparison']
    assert plain['objective']==1.0 and plain['improvement']==1.0 and plain['improvementPerWindow']==.25 and plain['tolerance']==.04 and plain['admissible'] is False
    # The strongest smoothing selects the constant path itself, so it is admissible there.
    assert result['sensitivity'][2]['constantComparison']['admissible'] is True
    # Improvements within the tolerance at lambda 0 stay within it at every lambda.
    flat=[window(i,i*12000,[(4,-4,0 if i%2 else .01),(4,-2,.01 if i%2 else 0)]) for i in range(4)]
    result=couple_motion_hypotheses(flat)
    assert result['informationOverConstant']=='within-tolerance'
    assert [w['code'] for w in result['warnings']]==['constant-within-tolerance'] and 'noise and pitch-bank switches' in result['warnings'][0]['message']
    assert all(row['constantComparison']['admissible'] for row in result['sensitivity'])
    assert math.isclose(result['sensitivity'][0]['constantComparison']['improvement'],.02)
    # A control missing from one window cannot form a constant path; one window cannot show change.
    partial=[window(0,0,[(4,-4,0)]),window(1,12000,[(4,-2,0)])]
    assert couple_motion_hypotheses(partial)['informationOverConstant']=='not-evaluated'
    assert couple_motion_hypotheses(partial)['sensitivity'][0]['constantComparison'] is None
    assert couple_motion_hypotheses([window(0,0,[(4,-4,0)])])['informationOverConstant']=='not-evaluated'


def test_constant_control_with_small_noise_stays_within_tolerance_at_any_length():
    # True constant control (-3) with the same small score noise at 12 and 120 windows. A fixed
    # 0.1 tolerance on the summed improvement read 12 windows as within it and 120 as exceeding it.
    for count in (12,120):
        rng=np.random.default_rng(5)
        rows=[window(i,i*12000,[(4,ja,float(base+abs(rng.normal(0,.01)))) for ja,base in ((-4,.01),(-3,0.),(-2,.01))]) for i in range(count)]
        result=couple_motion_hypotheses(rows);comparison=result['sensitivity'][0]['constantComparison']
        assert comparison['JA']==-3 and result['informationOverConstant']=='within-tolerance'
        assert comparison['improvementPerWindow']<CONSTANT_TOLERANCE_PER_WINDOW
        assert (comparison['improvement']>.1)==(count==120)


def test_path_changes_at_pitch_bank_switches_are_flagged():
    rows=[window(i,i*12000,[(4,-4,0 if i<2 else .5),(4,-2,.5 if i<2 else 0)]) for i in range(4)]
    for i,row in enumerate(rows):row['fit']['bankIndex']=0 if i<2 else 1
    result=couple_motion_hypotheses(rows);plain=result['sensitivity'][0]
    assert [row['pitchBankSwitch'] for row in plain['transitionUncertainty']]==[False,True,False]
    assert [row['bankIndex'] for row in plain['uncertainty']]==[0,0,1,1]
    assert plain['pathChangesAtPitchBankSwitch']==[{'fromPosition':1,'toPosition':2}]
    # Lambda 1 keeps one control throughout, so no change coincides with the switch.
    assert result['sensitivity'][2]['pathChangesAtPitchBankSwitch']==[]
    # Windows without a bank index never report a switch.
    assert not any(row['pitchBankSwitch'] for row in couple_motion_hypotheses([window(i,i*12000,[(4,-4,0)]) for i in range(3)])['sensitivity'][0]['transitionUncertainty'])
