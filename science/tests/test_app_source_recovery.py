"""An explicit new attempt can recover a failed worker without rewriting its receipt."""
import hashlib
import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import app_source


def test_terminal_worker_receipt_retained_and_new_explicit_attempt_succeeds(tmp_path,monkeypatch):
    root=tmp_path/'app';directory=root/'science-runs/run-test';directory.mkdir(parents=True)
    (root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-test'}))
    (directory/'summary.json').write_text(json.dumps({'sessionId':'session'}))
    monkeypatch.setenv('SCIENCE_URL','http://127.0.0.1:1');monkeypatch.setenv('SCIENCE_TOKEN','test-only')
    state={'snapshot':{'model_id':'baseline'},'version':2,'pending':None,'jobs':[]}
    class Backend:
        def __init__(self,*args):pass
        def execute(self,command):return {'state':state}
    monkeypatch.setattr(app_source,'HTTPBackend',Backend)
    for attempt,result in [('failed',None),('retry',{'status':'available','actual_synthesis_calls':2})]:
        output=root/attempt;output.mkdir()
        identity='source-app-'+attempt
        key='session:'+hashlib.sha256(json.dumps(['session',identity],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        command={'action':'forecast_source_bank','command_id':identity,'expected_version':2,'parameters':{}}
        (output/'intent.json').write_text(json.dumps({'command':command,'binding':{},'baselineModelId':'baseline'}))
        state['jobs'].append({'job_id':attempt,'key':key,'request':{'operation':'forecast_phonation_bank'},'status':'failed' if result is None else 'succeeded','result':result})
        if result is None:
            with pytest.raises(ValueError,match='new explicit attempt'):app_source.run(root,'forecast',output)
            receipt=(output/'failure-receipt.json').read_bytes()
            assert json.loads(receipt)['retryRequiresNewAttempt']
        else:
            app_source.run(root,'forecast',output)
            assert json.loads((output/'result.json').read_text())['status']=='available'
    assert (root/'failed/failure-receipt.json').read_bytes()==receipt
    assert len(state['jobs'])==2
