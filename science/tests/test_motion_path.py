from copy import deepcopy
import json
import math

from singing_physics.motion_path import couple_motion_hypotheses


def window(index,offset,candidates):
    return {'index':index,'sourceStartSample':offset,'windowOffsetWithinExcerpt':4800,'sampleRateHz':48000,'frameSha256':str(index)*64,
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
