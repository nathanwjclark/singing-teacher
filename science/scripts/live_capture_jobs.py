"""Verified private voice capture -> native search -> frozen forecasts -> geometry."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

from singing_physics.engine import Engine, digest, write_json
from singing_physics.pcm_inverse import FEATURES
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.service import JobService
from model_space_diff import pair

ROOT = Path(__file__).resolve().parents[2]

def now(): return datetime.now(timezone.utc).isoformat()

def run(source, output):
    output.mkdir(parents=True, exist_ok=False)
    protocol = {'selection': 'Earliest two full-descriptor voiced windows, periodicity >= .85, dbfs > -60, no clipping/invalid/low-snr',
        'pose_assumption': 'Prompted comfortable ah treated as a; phonetics not independently verified',
        'anatomy_bounds': {'hard_palate_length': [3.8, 5.1]}, 'gains': [1., 4., 16.], 'JA': -3.,
        'search_budget': 36, 'search_rounds': 1, 'seed': 7,
        'forecast_conditions': 'Library a/e/i at JA=-3, F0=180Hz, gain=4; these are proposed simulator conditions, not observed execution',
        'claim': 'Conditional research hypotheses. No identified anatomy, microphone/room calibration, muscle tension or tissue mechanics.'}
    write_json(output/'protocol.json', protocol)
    subprocess.run(['node','--experimental-strip-types',str(ROOT/'science/scripts/import_native_pcm.ts'),str(source),str(output/'import'),'local-participant','voice-calibration','a'],check=True,stdout=subprocess.DEVNULL)
    data=json.loads((output/'import/native-pcm.json').read_text())
    eligible=[]
    for trial in data['fit_trial_options']:
        m=trial['measurement']; values={x['name']:x['value'] for x in m['measurements']}
        if all(values[k] is not None for k in FEATURES) and values['periodicity']>=.85 and values['dbfs']>-60 and not set(m['quality']['flags']).intersection({'clipping','invalid','low-snr'}): eligible.append(trial)
    trials=eligible[:2]
    if len(trials)<2: raise ValueError('No two eligible voice windows; import retained, no fitting performed')
    document={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':trials}
    write_json(output/'observations.json',document)
    nuisance=[{'profile_id':f'gain-{gain:g}','trials':{t['id']:{'JA':-3.,'f0_hz':next(x['value'] for x in t['measurement']['measurements'] if x['name']=='pitchHz'),'gain':gain} for t in trials}} for gain in protocol['gains']]
    jobs=[]
    with JobService(output/'jobs',timeout_s=180) as service:
        def job(operation,parameters,key=None):
            key=key or operation
            request={'operation':operation,'parameters':parameters}
            write_json(output/f'{key}-request.json',request)
            ident=service.submit(request,idempotency_key=key)
            state=service.wait(ident,timeout_s=185)
            jobs.append({'id':ident,'operation':operation,'status':state['status']})
            if state['status']!='succeeded': raise RuntimeError(f'{operation}: {state["error"]}')
            return ident,service.result(ident)
        fit_id,fit=job('search_pcm',{'observations':document,'anatomy_bounds':protocol['anatomy_bounds'],'nuisance_profiles':nuisance,'max_synthesis_calls':36,'rounds':1,'seed':7})
        write_json(output/'fit.json',fit)
        best=fit['joint']['best']
        if best is None: raise ValueError('No scorable candidate; all attempted hypotheses retained')
        with Engine() as engine: provenance=engine.provenance; reference=engine.anatomy()
        scored=sorted([r for r in fit['joint']['candidates'] if r['status']=='scored'],key=lambda r:(r['weighted_mean_square_discrepancy'],r['candidate_id']))
        hypotheses=[];seen=set()
        for row in scored:
            key=json.dumps(row['anatomy'],sort_keys=True)
            if key not in seen and len(hypotheses)<3:
                hypotheses.append({'hypothesis_id':row['candidate_id'],'anatomy':row['anatomy']});seen.add(key)
        snapshot=freeze_pcm_hypotheses(model_id='local-voice-'+output.name,evidence_ids=[t['id'] for t in trials],evidence_hashes=sorted({h for t in trials for h in t['measurement']['provenance']['sourceHashes']}),provenance=provenance,hypotheses=hypotheses,frozen_at=now())
        snapshot.write(output/'hypotheses.json')
        design_id,forecast=job('design_pcm',{'snapshot_json':snapshot.content.decode(),'expected_digest':snapshot.sha256,'design_id':'prospective-'+output.name,'target_observation_id':'future-voice-'+output.name,'generated_at':now(),'experiments':[{'experiment_id':p,'pose':p,'JA':-3.,'f0_hz':180.,'gain':4.} for p in ['a','e','i']],'feature_scales':{name:{'unit':unit,'scale':scale,'assumption':'Engineering discrepancy scale, not calibrated noise'} for name,(unit,scale) in FEATURES.items()},'minimum_separation':.05,'retention_margin':.05,'maximum_discrepancy':2.,'max_synthesis_calls':9})
        write_json(output/'forecast.json',forecast)
        forward_id,forward=job('forward',{'pose':'a','anatomy':best['anatomy'],'articulation':{'JA':-3.},'f0_hz':180.,'duration_s':.25})
        directory=output/'jobs/artifacts'/forward_id/'forward'
        reference_id,_=job('forward',{'pose':'a','anatomy':reference,'articulation':{'JA':-3.},'f0_hz':180.,'duration_s':.25},key='reference-forward')
        reference_directory=output/'jobs/artifacts'/reference_id/'forward'
        write_json(output/'space-diff.json',pair(directory,reference_directory))
        files={'space-diff.json':{'sha256':digest(output/'space-diff.json'),'byteLength':(output/'space-diff.json').stat().st_size}}
        for name in ['tract0.obj','tract0.mtl','tract.svg','geometry.json','manifest.json']:
            raw=(directory/name).read_bytes();(output/name).write_bytes(raw)
            files[name]={'sha256':digest(output/name),'byteLength':len(raw)}
        summary={'schemaVersion':'local-science-result-1','runId':output.name,'createdAt':now(),'status':'succeeded','source':'verified-human-recording','sourceCaptureId':json.loads((source/'manifest.json').read_text())['capture_id'],'sourceImportSha256':digest(output/'import/native-pcm.json'),'calibrationWindows':len(trials),'eligibleWindows':len(eligible),'jobs':jobs,'nativeCalls':fit['actual_synthesis_calls']+forecast['actual_synthesis_calls']+2,'candidateId':best['candidate_id'],'anatomy':best['anatomy'],'referenceAnatomy':reference,'fitDiscrepancy':best['weighted_mean_square_discrepancy'],'baselineDiscrepancy':fit['fixed_anatomy_baseline']['best']['weighted_mean_square_discrepancy'],'forecast':forecast,'files':files,'anatomyValidated':False,'liveTongueSource':'camera tracking, not scientific-model inference','interpretation':protocol['claim'],'geometryRole':'Native model prediction for a declared a/JA=-3 reference pose; not a measured patient mesh','forecastRole':'Prospective simulator predictions; no later human target scored yet'}
        write_json(output/'summary.json',summary)
        print(json.dumps({'status':'succeeded','runId':output.name,'nativeCalls':summary['nativeCalls'],'jobs':jobs},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    try:run(a.source.resolve(),a.output.resolve())
    except Exception as e:
        if a.output.exists():write_json(a.output/'failure.json',{'status':'failed','error':str(e),'time':now()})
        raise
