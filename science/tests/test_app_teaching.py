import sys
import json
from pathlib import Path
from copy import deepcopy
import pytest
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_session_source import setup_source
from test_session import send,collect
from singing_physics.pcm_inverse import FEATURES

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from live_capture_jobs import LocalBackend
import live_capture_jobs

from app_teaching import run


def test_native_teaching_pair_frozen_audio_and_stale_guard(tmp_path,monkeypatch):
    monkeypatch.setattr(live_capture_jobs,'EXPORTS',(*live_capture_jobs.EXPORTS,'audio.wav'))
    with JobService(tmp_path/'jobs') as service:
        backend=LocalBackend(service,'session');controller=backend.controller
        baseline,_,_=setup_source(controller)
        send(controller,'propose_design',parameters={'design_id':'design','target_observation_id':'future',
            'experiments':[{'experiment_id':p,'pose':p,'JA':-3.,'f0_hz':180.,'gain':4.} for p in ['a','e']],
            'profile':{'sample_rate_hz':48000,'frame_start_sample':4800,'frame_size':4096,'duration_s':.25},
            'feature_scales':{key:{'unit':unit,'scale':scale,'assumption':'Test engineering scale'} for key,(unit,scale) in FEATURES.items()},'max_synthesis_calls':2})
        state=collect(controller,service)
        send(controller,'select_experiment',source_design_id='design',design_id='selected',target_observation_id='later',experiment_id='a',selection_reason='Software test supported vowel')
        state=controller.execute({'action':'state'})['state'];frozen=deepcopy(state['designs']['selected'])
        root=tmp_path/'app';directory=root/'science-runs/run-test';directory.mkdir(parents=True)
        (root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-test'}))
        (directory/'summary.json').write_text(json.dumps({'sessionId':'session','modelId':'baseline','designId':'selected'}))
        request={'demonstrationId':'tongue-jaw-vowels','modelId':'baseline','designId':'selected'}
        output=root/'teaching-attempts/teaching-abcd'
        result=run(root,output,request,backend=backend,audio_enabled=True)
        assert result['before']['pose']=='e' and result['after']['pose']=='a'
        assert result['capabilities']['geometry']['available']
        assert result['capabilities']['synthesis']['available'],result['capabilities']['synthesis']
        assert result['before']['geometry']['svg']['sha256']!=result['after']['geometry']['svg']['sha256']
        assert result['before']['prediction']['canonical']==frozen['data']['rankings'][1]['predictions'][0]['canonical'] or result['before']['prediction']['canonical']==frozen['data']['rankings'][0]['predictions'][0]['canonical']
        assert controller.execute({'action':'state'})['state']['designs']['selected']==frozen
        assert run(root,output,request,backend=backend,audio_enabled=True)==result
        changed=deepcopy(baseline);changed['model_id']='changed';send(controller,'register_model',snapshot=changed)
        with pytest.raises(ValueError,match='current committed'):run(root,output,request,backend=backend)
