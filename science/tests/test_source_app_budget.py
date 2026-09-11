"""The app must preserve equal source-shape support for every retained anatomy."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from app_source import source_candidates


@pytest.mark.parametrize('count',[1,2,3,5,8])
def test_matched_source_alternatives_fit_finite_budget(count):
    hypotheses=[{'anatomy':{'hard_palate_length':4+i*.01}} for i in range(count)]
    candidates,support=source_candidates(hypotheses,'source-trial',180.)
    assert support==[{'PS':ps} for ps in ([-.2,0.,.2] if count<=2 else [-.2,.2])]
    assert len(candidates)==count*len(support)<=16
    for hypothesis in hypotheses:
        assert [{'PS':row['trials']['source-trial']['PS']} for row in candidates if row['anatomy']==hypothesis['anatomy']]==support
    assert 3*len(candidates)<=48
    if count==5:assert 3*len(candidates)==30


def test_excess_anatomy_support_rejected_instead_of_dropping_source_alternatives():
    for family in ('geometric','two_mass'):
        with pytest.raises(ValueError,match='cannot cover'):
            source_candidates([{'anatomy':{}}]*9,'source-trial',180.,family)
    with pytest.raises(ValueError,match='Unsupported'):source_candidates([{'anatomy':{}}],'source-trial',180.,'triangular')


@pytest.mark.parametrize('count',[1,2,3,5,8])
def test_mechanical_app_support_is_matched_bounded_and_one_axis(count):
    hypotheses=[{'anatomy':{'hard_palate_length':4+i*.01}} for i in range(count)]
    candidates,support=source_candidates(hypotheses,'source-trial',180.,'two_mass')
    assert [row['XB'] for row in support]==[row['XT'] for row in support]==([.005,.01,.015] if count<=2 else [.005,.015])
    assert all(row['source_model']=='two_mass' and row['EAA']==0. and row['DF']==1. for row in support)
    assert len(candidates)==count*len(support)<=16 and 3*len(candidates)<=48
    for h in hypotheses:
        assert [{k:v for k,v in row['trials']['source-trial'].items() if k in support[0]} for row in candidates if row['anatomy']==h['anatomy']]==support
    assert {row['trials']['source-trial']['gain'] for row in candidates}=={2.}
