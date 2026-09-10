"""Frozen small PCM robustness challenge; investigator evidence, not diagnosis."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.signal import lfilter
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm, fit_pcm, FEATURES

PROTOCOL = {'version': 'pcm-robustness-1', 'cases': ['clean','noise','coloration','echo','control-mismatch','out-of-grid'],
    'seeds': [17011,17021,17027,17033,17041,17047], 'hard_synthesis_limit':126,
    'anatomy': {'hard_palate_length':4.35,'pharynx_length':6.85},
    'out_of_grid_anatomy':{'hard_palate_length':3.2,'pharynx_length':7.6},
    'candidate_anatomies':[{'hard_palate_length':4.2,'pharynx_length':6.6},{'hard_palate_length':4.5,'pharynx_length':7.1}],
    'noise_snr_db':6.,'coloration_cutoff_hz':1200.,'echoes':[[.015,.5],[.035,.25]],
    'calibration_controls':{'a':{'JA':-2.,'f0_hz':180.,'gain':.8},'i':{'JA':-4.,'f0_hz':180.,'gain':16.}},
    'heldout_controls':{'JA':-3.,'f0_hz':190.,'gain':32.},
    'alternative_controls':{'a':{'JA':-3.,'f0_hz':200.,'gain':.96},'i':{'JA':-3.,'f0_hz':200.,'gain':19.2}},
    'control_mismatch':{'a':{'JA':-3.5,'f0_hz':195.,'gain':1.04},'i':{'JA':-2.,'f0_hz':195.,'gain':20.8},
                        'e':{'JA':-4.,'f0_hz':205.,'gain':41.6}},
    'duration_s':.25,'frame_start_sample':4410,'frame_size':4096,
    'engineering_discrepancy_warning_threshold':4.,
    'interpretation':'Noisy/altered actual PCM; no generator-in-grid guarantee; Lead-A investigation, not independent B evaluation'}


def write(path,value):
    path.write_text(json.dumps(value,sort_keys=True,indent=2,allow_nan=False)+'\n')


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def transform(pcm, case, rate, seed, protocol):
    values=np.array(pcm,dtype=float,copy=True)
    if case=='noise':
        sigma=float(np.sqrt(np.mean(values**2)))*10**(-protocol['noise_snr_db']/20)
        values+=np.random.default_rng(seed).normal(0,sigma,len(values))
    elif case=='coloration':
        alpha=float(np.exp(-2*np.pi*protocol['coloration_cutoff_hz']/rate))
        values=lfilter([1-alpha],[1,-alpha],values)
    elif case=='echo':
        original=values.copy()
        for delay,gain in protocol['echoes']:
            shift=round(delay*rate)
            values[shift:]+=gain*original[:-shift]
    elif case not in ('clean','control-mismatch','out-of-grid'):
        raise ValueError('Unknown stress case')
    return values


def grid(protocol):
    return [{'candidate_id':f'geometry-{i}-controls-{j}','anatomy':anatomy,'trials':deepcopy(controls)}
            for i,anatomy in enumerate(protocol['candidate_anatomies'])
            for j,controls in enumerate((protocol['calibration_controls'],protocol['alternative_controls']))]


def compare(observed,predicted):
    target={m['name']:m for m in observed['measurements']}
    pred={m['name']:m for m in predicted['measurements']}
    errors,missing={},[]
    for name,(_,scale) in FEATURES.items():
        if target[name]['value'] is None or pred[name]['value'] is None:
            missing.append(name)
        else:
            errors[name]=pred[name]['value']-target[name]['value']
    quality_failures=[]
    for source,record in [('observed',observed),('predicted',predicted)]:
        quality=record.get('quality',{})
        rejected=sorted(set(quality.get('flags',[]))&{'clipping','invalid','dropped','low-signal-to-noise'})
        if rejected or quality.get('missingReason') is not None:
            quality_failures.append({'source':source,'flags':rejected,'missing_reason':quality.get('missingReason')})
    score=float(np.mean([(value/FEATURES[name][1])**2 for name,value in errors.items()])) if len(errors)>=3 and not missing and not quality_failures else None
    return {'descriptor_errors':errors,'missing_descriptors':missing,'quality_failures':quality_failures,'weighted_discrepancy':score}


def run(output,protocol=None):
    p=deepcopy(PROTOCOL if protocol is None else protocol)
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    write(output/'protocol.json',p);candidates=grid(p);write(output/'candidate-grid.json',candidates)
    count=0;results=[]
    with Engine() as engine:
        native=engine.synthesize
        def counted(*args,**kwargs):
            nonlocal count
            if count>=p['hard_synthesis_limit']:raise RuntimeError('Hard challenge synthesis budget exhausted')
            count+=1
            return native(*args,**kwargs)
        engine.synthesize=counted
        provenance=engine.provenance
        for case_index,case in enumerate(p['cases']):
            folder=output/case;folder.mkdir();start=count
            truth=p['out_of_grid_anatomy'] if case=='out-of-grid' else p['anatomy']
            write(folder/'generating-truth.json',{'anatomy':truth,'case':case,'seed':p['seeds'][case_index]})
            def produce(label,pose,anatomy,control,alter):
                engine.set_anatomy(anatomy)
                raw=engine.synthesize(pose,{'JA':control['JA']},f0_hz=control['f0_hz'],duration_s=p['duration_s'])*control['gain']
                changed=transform(raw,case,engine.sample_rate,p['seeds'][case_index]+(100 if pose=='e' else 0)+(1 if pose=='i' else 0),p) if alter else raw
                offset=p['frame_start_sample'];frame=changed[offset:offset+p['frame_size']]
                name=f'{case}-{label}-{pose}'
                canonical=extract_pcm(frame,engine.sample_rate,measurement_id=name,observation_id=name+'-observation',
                    artifact_id=name+'-artifact',start_ms=offset/engine.sample_rate*1000,source_kind='development-fixture')
                frame.astype('<f4').tofile(folder/f'{name}.pcm.f32')
                write(folder/f'{name}.json',{'canonical':canonical,'untransformed_pcm_sha256':hashlib.sha256(raw.astype('<f4').tobytes()).hexdigest(),
                    'frame_sha256':canonical['pcmFloat32Sha256'],'controls':control,'stress_applied':alter})
                return canonical['measurement']
            result={'case':case,'seed':p['seeds'][case_index],'status':'failed'}
            fit=None
            try:
                rows=[]
                for pose,nominal in p['calibration_controls'].items():
                    control=p['control_mismatch'][pose] if case=='control-mismatch' else nominal
                    measurement=produce('calibration',pose,truth,control,True)
                    rows.append({'id':pose,'pose':pose,'measurement':measurement,'sample_rate_hz':engine.sample_rate,
                        'frame_start_sample':p['frame_start_sample'],'frame_size':p['frame_size'],'duration_s':p['duration_s']})
                document={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':rows}
                write(folder/'observations.json',document)
                fit=fit_pcm(engine,document,candidates=candidates,max_synthesis_calls=2*len(candidates)*len(rows))
                write(folder/'frozen-fit.json',fit)
                result['frozen_fit_sha256']=digest(fit)
                result['fit_synthesis_calls']=fit['actual_synthesis_calls']
            except Exception as exc:
                result['fit_error']=f'{type(exc).__name__}: {exc}'
                write(folder/'frozen-fit-failure.json',result)
            # Held-out signal is generated only after the fit or its failure is persisted.
            try:
                held_control=p['control_mismatch']['e'] if case=='control-mismatch' else p['heldout_controls']
                held=produce('heldout-scoring-only','e',truth,held_control,True)
                scores={}
                if fit:
                    for model in ('joint','fixed_anatomy_baseline'):
                        best=fit[model]['best']
                        if best is None:
                            scores[model]={'status':'no_scored_candidate','engineering_mismatch_warning':True};continue
                        prediction=produce(model+'-prediction','e',best['anatomy'],p['heldout_controls'],False)
                        held_score=compare(held,prediction)
                        calibration=best['weighted_mean_square_discrepancy']
                        held_value=held_score['weighted_discrepancy']
                        scores[model]={'status':'scored','selected_candidate':best['candidate_id'],
                            'calibration_discrepancy':calibration,'heldout':held_score,
                            'anatomy_error_cm':{key:best['anatomy'][key]-truth[key] for key in truth},
                            'engineering_mismatch_warning':held_value is None or calibration>p['engineering_discrepancy_warning_threshold'] or held_value>p['engineering_discrepancy_warning_threshold']}
                    result.update(status='scored',scores=scores)
            except Exception as exc:
                result['heldout_error']=f'{type(exc).__name__}: {exc}'
            if result['status']!='scored':result['engineering_mismatch_warning']=True
            result['actual_synthesis_calls']=count-start;results.append(result);write(folder/'score.json',result)
    report={'protocol':p,'protocol_sha256':digest(p),'native_provenance':provenance,'actual_synthesis_calls':count,'cases':results,
        'limitations':['Engineering mismatch flags are not calibrated or diagnostic','Known nominal held-out controls; control-mismatch deliberately violates them',
            'Coarse descriptors and sparse finite grid cannot establish anatomical uniqueness','No held-out tuning; every case including missing/failed results retained']}
    write(output/'report.json',report)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();report=run(args.output)
    print(json.dumps({'actual_synthesis_calls':report['actual_synthesis_calls'],'cases':report['cases']},indent=2))
