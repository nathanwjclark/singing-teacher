"""The app must preserve equal source-shape support for every retained anatomy."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from app_source import source_candidates


@pytest.mark.parametrize('count',[1,2,3,5,8])
def test_matched_source_alternatives_fit_finite_budget(count):
    hypotheses=[{'anatomy':{'hard_palate_length':4+i*.01}} for i in range(count)]
    candidates,skews=source_candidates(hypotheses,'source-trial',180.,'geometric')
    assert skews==([-.2,0.,.2] if count<=2 else [-.2,.2])
    assert len(candidates)==count*len(skews)<=16
    for hypothesis in hypotheses:
        support=[row['trials']['source-trial']['PS'] for row in candidates if row['anatomy']==hypothesis['anatomy']]
        assert support==skews
    assert 3*len(candidates)<=48
    if count==5:assert 3*len(candidates)==30


def test_excess_anatomy_support_rejected_instead_of_dropping_source_alternatives():
    with pytest.raises(ValueError,match='cannot cover'):
        source_candidates([{'anatomy':{}}]*9,'source-trial',180.)


@pytest.mark.parametrize('count',[1,5,8])
def test_mechanical_app_support_is_matched_and_bounded(count):
    hypotheses=[{'anatomy':{'hard_palate_length':4+i*.01}} for i in range(count)]
    candidates,support=source_candidates(hypotheses,'source-trial',180.)
    assert len(candidates)==count*2<=16 and 3*len(candidates)<=48
    for h in hypotheses:
        assert [{k:v for k,v in row['trials']['source-trial'].items() if k in support[0]} for row in candidates if row['anatomy']==h['anatomy']]==support
    assert all(row['source_model']=='two_mass' for row in support)
