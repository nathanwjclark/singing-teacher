"""Native joint probe evidence adoption into the current durable model."""
from copy import deepcopy
from datetime import datetime,timezone

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_probe_inverse import probe_fixture
from test_session import send,collect,design_params


def setup(controller):
    with Engine() as engine:
        pcm,probes,candidates=probe_fixture(engine)
        full=[]
        for candidate in candidates:
            candidate['anatomy']=engine.set_anatomy(candidate['anatomy'])
            full.append({'hypothesis_id':candidate['candidate_id'],'anatomy':candidate['anatomy']})
        provenance=engine.provenance
    snapshot=freeze_pcm_hypotheses(model_id='initial',evidence_ids=['sing','sing-measurement','sing-pcm'],
            evidence_hashes=pcm['trials'][0]['measurement']['provenance']['sourceHashes'],provenance=provenance,
            hypotheses=full,frozen_at=datetime.now(timezone.utc).isoformat()).data
    send(controller,'ingest_calibration',document=pcm)
    send(controller,'register_model',snapshot=snapshot)
    return probes,candidates,snapshot


def test_native_probe_adoption_preserves_support_lineage_and_next_forecast(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        probes,candidates,parent=setup(controller)
        send(controller,'propose_design',parameters=design_params())
        collect(controller,service)
        before=deepcopy((probes,candidates))
        send(controller,'fit_probe',parameters={'probe_observations':probes,'candidates':candidates,'max_native_calls':12})
        state=collect(controller,service)
        result=state['jobs'][-1]['result'];snapshot=state['snapshot']
        assert before==(probes,candidates)
        assert result['actual_operator_calls']==12
        assert result['session_adoption']['status']=='ranked_retained_support'
        assert snapshot['model_id']!=parent['model_id']
        assert len(snapshot['hypotheses'])==len(parent['hypotheses'])
        assert set(parent['evidence_hashes'])<=set(snapshot['evidence_hashes'])
        assert probes['trials'][0]['source']['received_sha256'] in snapshot['evidence_hashes']
        assert state['designs']['design']['status']=='stale'
        with pytest.raises(ValueError,match='overlaps'):
            send(controller,'fit_probe',parameters={'probe_observations':probes,'candidates':candidates,'max_native_calls':12})
        send(controller,'propose_design',parameters=design_params('post-probe','next-target'))
        state=collect(controller,service)
        assert state['designs']['post-probe']['data']['model_id']==snapshot['model_id']
        replay=controller.execute({'action':'replay'})
        assert SessionController(tmp_path/'sessions',service,'session').execute({'action':'replay'})==replay


def test_unsupported_probe_retained_without_model_adoption_and_candidate_guard(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        probes,candidates,parent=setup(controller)
        with pytest.raises(ValueError,match='every retained'):
            send(controller,'fit_probe',parameters={'probe_observations':probes,'candidates':candidates[:1]})
        changed=deepcopy(candidates);changed[0]['anatomy']['hard_palate_length']=4.3
        with pytest.raises(ValueError,match='unsupported anatomy'):
            send(controller,'fit_probe',parameters={'probe_observations':probes,'candidates':changed})
        probes['trials'][0]['channel']='nasal-unsupported'
        send(controller,'fit_probe',parameters={'probe_observations':probes,'candidates':candidates,'max_native_calls':4})
        state=collect(controller,service)
        assert state['snapshot']==parent
        assert state['jobs'][-1]['result']['session_adoption']['model_unchanged']
        assert not state['jobs'][-1]['result']['probe_records'][0]['included_in_fit']
