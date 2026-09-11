import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
import pytest
from science.scripts.prepare_probe_capture import prepare

ROOT=Path(__file__).resolve().parents[2]


def archive_fixture(tmp_path):
    capture=tmp_path/'capture'
    subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',
        "import {makeFixture} from './scripts/import-acoustic-probe.test.ts'; await makeFixture(process.argv[1]);",str(capture)],cwd=ROOT,check=True,capture_output=True)
    manifest=json.loads((capture/'manifest.json').read_text())
    identity='12345678-1234-1234-1234-123456789abc'
    manifest['captureId']=identity
    (capture/'manifest.json').write_text(json.dumps(manifest))
    root=tmp_path/'data';(root/'usb-imports').mkdir(parents=True)
    name='probe-'+identity+'.zip'
    with zipfile.ZipFile(root/'usb-imports'/name,'w') as z:
        for source in capture.iterdir():z.write(source,source.name)
    raw=(root/'usb-imports'/name).read_bytes()
    receipt={'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    (root/'native-pull-latest.json').write_text(json.dumps(receipt))
    return root,receipt


def test_real_import_without_calibration_retains_review(tmp_path):
    root,receipt=archive_fixture(tmp_path)
    output=root/'probe-imports'/'one'
    result=prepare(root,output)
    assert not result['eligible'] and not result['includedInFit']
    assert 'calibration' in result['reasons'][0]
    measurement=json.loads((output/result['measurementPath']).read_text())
    assert measurement['captured']['value']
    assert not measurement['includedInFit']['value']
    assert hashlib.sha256((output/'original.zip').read_bytes()).hexdigest()==receipt['sha256']
    with pytest.raises(FileExistsError):prepare(root,output)


def test_changed_archive_rejected_before_import(tmp_path):
    root,receipt=archive_fixture(tmp_path)
    file=root/'usb-imports'/receipt['name'];raw=bytearray(file.read_bytes());raw[-1]^=1;file.write_bytes(raw)
    with pytest.raises(ValueError,match='hash mismatch'):prepare(root,root/'probe-imports'/'bad')


def saved_setup(root, receipt):
    folder=root/'probe-setups'/receipt['setupId'];folder.mkdir(parents=True)
    (folder/'configuration.json').write_text('{}');(folder/'profile.json').write_text('{}')
    receipt={**receipt,**{key:hashlib.sha256(b'{}').hexdigest() for key in ('configurationSha256','profileSha256')}}
    (folder/'summary.json').write_text(json.dumps(receipt))
    (root/'probe-setup-current.json').write_text(json.dumps({'setupId':receipt['setupId'],'receiptSha256':hashlib.sha256((folder/'summary.json').read_bytes()).hexdigest()}))


@pytest.mark.parametrize('receipt,reason',[({'setupId':'no-manifest','eligible':True},'could not be verified'),
    ({'setupId':'other-capture','eligible':True,'manifestSha256':'b'*64},'belongs to a different capture; each probe capture needs its own setup')])
def test_unusable_saved_setup_keeps_review_with_explicit_reason(tmp_path,receipt,reason):
    root,_=archive_fixture(tmp_path);saved_setup(root,receipt)
    result=prepare(root,root/'probe-imports'/'one')
    assert not result['eligible'] and 'setupId' not in result
    assert reason in result['reasons'][-1]
    assert (root/'probe-imports'/'one'/result['measurementPath']).exists()


@pytest.mark.parametrize('crash_after,app_setup',[(None,False),(None,True),('fit_probe',False),('collect_job',False),('cancelled_submit',False)])
def test_original_probe_runs_joint_session_adoption(tmp_path, monkeypatch,crash_after,app_setup):
    import os
    import sys
    from contextlib import contextmanager
    from singing_physics.service import JobService
    from singing_physics.session import SessionController
    from singing_physics.engine import Engine
    from singing_physics.pcm_inverse import fit_pcm
    from science.scripts.live_capture_jobs import LocalBackend
    from science.scripts import run_probe_fit
    from test_session_probe import setup
    descriptor=tmp_path/'fixture.json'
    subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',
        "import {setupFixture} from './science/scripts/import_probe_science.test.ts'; import {writeFile} from 'node:fs/promises'; await writeFile(process.argv[1],JSON.stringify(await setupFixture()));",str(descriptor)],
        cwd=ROOT,env={**os.environ,'PROBE_PYTHON':sys.executable},check=True,capture_output=True)
    fixture=json.loads(descriptor.read_text());root=tmp_path/'data';root.mkdir()
    config=fixture['config'];config['capture_binding']['manifest_sha256']=hashlib.sha256((Path(fixture['capture'])/'manifest.json').read_bytes()).hexdigest()
    (root/'probe-science-config.json').write_text(json.dumps(config))
    evidence=Path(fixture['root'])/'calibration-evidence.txt'
    (root/evidence.name).write_bytes(evidence.read_bytes())
    imported=root/'probe-imports'/'imported';imported.mkdir(parents=True)
    # Importer verifies original capture bytes again inside runner, not review JSON.
    import shutil
    shutil.copytree(fixture['capture'],imported/'capture')
    (imported/'summary.json').write_text(json.dumps({'eligible':True,'captureDirectory':'capture'}))
    voice=root/'science-runs'/'voice';voice.mkdir(parents=True)
    (root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'voice'}))
    (voice/'summary.json').write_text(json.dumps({'sessionId':'probe-runner'}))
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(service.root/'sessions',service,'probe-runner')
        _,candidates,parent=setup(controller)
        state=controller.execute({'action':'state'})['state']
        with Engine() as engine:
            fitted=fit_pcm(engine,state['calibration'],candidates=[{k:c[k] for k in ('candidate_id','anatomy','trials')} for c in candidates],max_synthesis_calls=4)
        (voice/'fit.json').write_text(json.dumps(fitted))
        (root/'probe-fit-profile.json').write_text(json.dumps({'JA':-3.,'gain':1.,'direct_gain':1.,'coupling_gain':1.,'delay_s':0.}))
        if app_setup:
            def publish(identity, jaw):
                folder=root/'probe-setups'/identity;folder.mkdir(parents=True)
                shutil.copyfile(root/'probe-science-config.json',folder/'configuration.json')
                shutil.copyfile(root/evidence.name,folder/evidence.name)
                profile=json.loads((root/'probe-fit-profile.json').read_text());profile['JA']=jaw
                (folder/'profile.json').write_text(json.dumps(profile))
                receipt={'setupId':identity,'eligible':True,
                    'configurationSha256':hashlib.sha256((folder/'configuration.json').read_bytes()).hexdigest(),
                    'profileSha256':hashlib.sha256((folder/'profile.json').read_bytes()).hexdigest()}
                (folder/'summary.json').write_text(json.dumps(receipt))
                (root/'probe-setup-current.json').write_text(json.dumps({'setupId':identity,
                    'receiptSha256':hashlib.sha256((folder/'summary.json').read_bytes()).hexdigest()}))
                return receipt
            original=publish('original-setup',-3.)
            summary=json.loads((imported/'summary.json').read_text())
            summary.update(setupId=original['setupId'],setupConfigurationSha256=original['configurationSha256'],setupProfileSha256=original['profileSha256'])
            (imported/'summary.json').write_text(json.dumps(summary))
            # A later setup must not replace the controls already bound to this import.
            publish('later-setup',-4.)
        @contextmanager
        def backend(_output,session_id):
            value=LocalBackend(service,session_id)
            original=value.execute
            def execute(command):
                nonlocal crash_after
                result=original(command)
                if command['action']==crash_after or crash_after=='cancelled_submit' and command['action']=='fit_probe':
                    if crash_after=='cancelled_submit':service.cancel(result['state']['pending']['job_id'])
                    crash_after=None
                    raise SystemExit('simulated process death after durable side effect')
                return result
            value.execute=execute
            yield value
        monkeypatch.setattr(run_probe_fit,'backend_for',backend)
        cancelled=crash_after=='cancelled_submit'
        if crash_after:
            with pytest.raises(SystemExit):run_probe_fit.run(root,'imported',parent['model_id'],root/'probe-fits'/'fit')
        if cancelled:
            with pytest.raises(ValueError,match='retry the fit in the app'):
                run_probe_fit.run(root,'imported',parent['model_id'],root/'probe-fits'/'fit')
            assert controller.execute({'action':'state'})['state']['pending'] is None
            assert (root/'probe-fits/fit/failure.json').exists()
            # The app allocates a fresh intent after a terminal failed attempt.
            result=run_probe_fit.run(root,'imported',parent['model_id'],root/'probe-fits'/'retry')
            assert result['includedInFit']
            return
        result=run_probe_fit.run(root,'imported',parent['model_id'],root/'probe-fits'/'fit')
        assert result['includedInFit'] and result['nativeCalls']==12
        assert result['modelId']!=parent['model_id']
        assert result['score']['probe_discrepancy']>100
        assert (root/'probe-fits/fit/session-ledger.json').exists()
        if app_setup:
            intent=json.loads((root/'probe-fits/fit/intent.json').read_text())
            assert intent['setupId']=='original-setup'
            assert all(t['JA']==-3. for c in intent['command']['parameters']['candidates'] for t in c['probe_trials'].values())
        state=controller.execute({'action':'state'})['state']
        assert state['pending'] is None
        version=state['version']
        assert run_probe_fit.run(root,'imported',parent['model_id'],root/'probe-fits'/'fit')==result
        assert controller.execute({'action':'state'})['state']['version']==version
        assert len([j for j in state['jobs'] if j['request']['operation']=='fit_probe_pcm'])==1
