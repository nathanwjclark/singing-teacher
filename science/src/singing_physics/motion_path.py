"""Finite conditional paths over existing PCM candidate scores; no new inference engine."""
from copy import deepcopy
import hashlib
import json
import math
import re

VERSION='motion-conditional-path-2'
OBJECTIVE_GAP=.1
REFERENCE_INTERVAL_SECONDS=.25
PENALTIES=(0.,.1,1.)
MAX_LINK_GAP_SECONDS=.5


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def _hash(value):return hashlib.sha256(_canonical(value).encode()).hexdigest()
def _number(value):return type(value) in (int,float) and math.isfinite(value)


def couple_motion_hypotheses(windows):
    """Keep anatomy fixed for a recording; minimize per-segment JA/gain path costs.

    This objective is a heuristic sum of fixed-scale discrepancies, not likelihood.
    """
    if not isinstance(windows,list) or len(windows)>120:raise ValueError('At most120 predeclared windows supported')
    result={'kind':VERSION,'status':'unavailable','settings':{'penalties':list(PENALTIES),'maxLinkGapSeconds':MAX_LINK_GAP_SECONDS,
        'JA_difference_scale_deg':1.,'log2_gain_difference_scale':1.,'anatomyScope':'fixed-across-entire-recording',
        'objective':'sum fixed-scale PCM weighted mean-square discrepancies + lambda * sum squared JA/gain differences',
        'transitionInterpretation':'elapsed-time-scaled engineering regularizer; not calibrated motion dynamics or posterior',
        'referenceIntervalSeconds':REFERENCE_INTERVAL_SECONDS,'objectiveGapTolerance':OBJECTIVE_GAP,
        'uncertaintyInterpretation':'minimum complete-path objective gaps; sensitivity sets, not confidence intervals or probabilities'},
        'inputSha256':hashlib.sha256(json.dumps(windows,sort_keys=True,separators=(',',':'),allow_nan=True).encode()).hexdigest(),'inputHashScope':'Python canonical JSON including explicit nonfinite tokens if supplied','segments':[],'excludedWindows':[],'independent':[],'sensitivity':[],
        'additionalSynthesisCalls':0,'modelUpdated':False,'limitations':['Discrete observed frames only; unmeasured intervals are not interpolated or aligned to video.',
            'Source F0 uses the declared per-frame pitch bank; remaining source assumptions are inherited unchanged.',
            'Scores are not probabilities; low cost does not identify anatomy or observed JA.']}
    parsed=[];signature=None;previous=None;segments=[];current=[]
    for position,window in enumerate(windows):
        reason=None;rows=[]
        fit=window.get('fit') if isinstance(window,dict) else None
        if not fit or window.get('status')!='scored':reason='Missing or unscorable independent window'
        if reason is None:
            try:
                scales=fit['feature_scales'];extractor=fit['canonical_extractor'];native=fit['native_provenance']
                if not scales or not extractor or not native:raise ValueError('Missing comparable score provenance')
                for scale in scales.values():
                    if not isinstance(scale,dict) or not _number(scale.get('scale')) or scale['scale']<=0 or not isinstance(scale.get('unit'),str):raise ValueError('Invalid feature scale')
                measured=window['measurement'].get('measurements')
                if not isinstance(measured,list):raise ValueError('Missing descriptor availability for cost comparison')
                available=sorted(m['name'] for m in measured if m.get('name') in scales and _number(m.get('value')))
                if not available:raise ValueError('No declared finite objective descriptors')
                found=_hash([scales,extractor,native,available])
                if signature is not None and found!=signature:
                    result['reason']='Independent fit scales/extractor/native provenance differ; costs cannot be combined';return result
                signature=found
                rate=window['sampleRateHz'];offset=window['sourceStartSample'];crop=window['windowOffsetWithinExcerpt']
                measurement=window['measurement'];duration_ms=measurement['window']['endMs']-measurement['window']['startMs']
                if type(rate) is not int or rate not in (44100,48000,96000) or type(offset) is not int or offset<0 or type(crop) is not int or crop<0 or not _number(duration_ms) or duration_ms<=0:raise ValueError('Invalid acoustic sample span')
                frame_hash=window['frameSha256']
                if not isinstance(frame_hash,str) or not re.fullmatch('[a-f0-9]{64}',frame_hash):raise ValueError('Missing physical frame hash')
                start=(offset+crop)/rate;end=start+duration_ms/1000
                raw=fit['joint']['candidates']
                if not isinstance(raw,list) or len(raw)>18:raise ValueError('At most18 candidates per window')
                identities=set()
                for candidate in raw:
                    if candidate.get('status')!='scored':continue
                    cost=candidate.get('weighted_mean_square_discrepancy');predictions=candidate.get('predictions')
                    if not _number(cost) or not 0<=cost<=1e100 or not isinstance(predictions,list) or len(predictions)!=1:continue
                    control=predictions[0].get('controls',{});ja,gain=control.get('JA'),control.get('gain')
                    if not _number(ja) or not -5<=ja<=-1 or not _number(gain) or gain<=0 or gain>100:continue
                    anatomy=candidate.get('anatomy');identity=candidate.get('candidate_id')
                    if not isinstance(anatomy,dict) or not anatomy or not all(_number(v) for v in anatomy.values()) or not isinstance(identity,str) or not identity or identity in identities:continue
                    identities.add(identity)
                    rows.append({'candidateId':identity,'anatomySha256':_hash(anatomy),'anatomy':anatomy,'JA':ja,'gain':gain,'dataCost':cost})
                if not rows:raise ValueError('No finite comparable candidate controls/scores')
                if previous is not None and start<previous['end']-1e-9:raise ValueError('Overlapping or reversed acoustic frames')
            except (KeyError,TypeError,ValueError) as error:reason=str(error)
        if reason is not None:
            if current:segments.append(current);current=[]
            result['excludedWindows'].append({'position':position,'reason':reason});previous=None;continue
        node={'position':position,'start':start,'end':end,'rows':rows}
        if previous is not None and start-previous['end']>MAX_LINK_GAP_SECONDS:
            if current:segments.append(current)
            current=[]
        current.append(node);parsed.append(node);previous=node
        best=min(rows,key=lambda r:(r['dataCost'],r['candidateId']))
        result['independent'].append({'position':position,**deepcopy(best)})
    if current:segments.append(current)
    if not parsed:result['reason']='No usable windows';return result
    result['comparisonSignature']=signature
    result['segments']=[{'positions':[n['position'] for n in segment],'startSeconds':segment[0]['start'],'endSeconds':segment[-1]['end'],
        'transitionCount':len(segment)-1,'acousticFrames':[{'position':n['position'],'startSeconds':n['start'],'endSeconds':n['end']} for n in segment]} for segment in segments]
    shared=set.intersection(*[{r['anatomySha256'] for r in node['rows']} for node in parsed])
    if not shared:result['reason']='No single anatomy has valid candidates across every usable window';return result
    def jump(prior,row,interval):
        return ((row['JA']-prior['JA'])**2+math.log2(row['gain']/prior['gain'])**2)*REFERENCE_INTERVAL_SECONDS/interval
    for penalty in PENALTIES:
        alternatives=[];marginals=[];transition_marginals=[]
        for anatomy_hash in sorted(shared):
            analyses=[]
            for segment in segments:
                choices=[sorted([r for r in node['rows'] if r['anatomySha256']==anatomy_hash],key=lambda r:r['candidateId']) for node in segment]
                forward=[];parents=[]
                for index,rows in enumerate(choices):
                    costs=[];pointers=[]
                    for row in rows:
                        if index==0:costs.append(row['dataCost']);pointers.append(None)
                        else:
                            interval=segment[index]['start']-segment[index-1]['start']
                            values=[forward[index-1][j]+penalty*jump(previous,row,interval) for j,previous in enumerate(choices[index-1])]
                            chosen=min(range(len(values)),key=lambda j:(values[j],choices[index-1][j]['candidateId']))
                            costs.append(values[chosen]+row['dataCost']);pointers.append(chosen)
                    forward.append(costs);parents.append(pointers)
                backward=[[0.]*len(rows) for rows in choices]
                for index in range(len(choices)-2,-1,-1):
                    interval=segment[index+1]['start']-segment[index]['start']
                    backward[index]=[min(penalty*jump(row,next_row,interval)+next_row['dataCost']+backward[index+1][j]
                        for j,next_row in enumerate(choices[index+1])) for row in choices[index]]
                best_index=min(range(len(forward[-1])),key=lambda j:(forward[-1][j],choices[-1][j]['candidateId']))
                optimum=forward[-1][best_index];path=[]
                for index in range(len(choices)-1,-1,-1):
                    node=segment[index];row=choices[index][best_index]
                    path.append({'position':node['position'],'startSeconds':node['start'],'endSeconds':node['end'],**row})
                    best_index=parents[index][best_index]
                path.reverse()
                data=sum(row['dataCost'] for row in path)
                transition=sum(jump(path[i-1],path[i],path[i]['startSeconds']-path[i-1]['startSeconds']) for i in range(1,len(path)))
                analyses.append((segment,choices,forward,backward,path,optimum,data,transition))
            total=sum(entry[5] for entry in analyses);data_total=sum(entry[6] for entry in analyses);transition_total=sum(entry[7] for entry in analyses)
            selected=[row for entry in analyses for row in entry[4]]
            alternatives.append({'anatomySha256':anatomy_hash,'anatomy':selected[0]['anatomy'],'objective':total,'dataCost':data_total,
                'unweightedTransitionCost':transition_total,'weightedTransitionCost':penalty*transition_total,'path':selected})
            for segment,choices,forward,backward,path,optimum,_,_ in analyses:
                for index,rows in enumerate(choices):
                    for j,row in enumerate(rows):
                        marginals.append({'position':segment[index]['position'],**row,'minimumPathObjective':total-optimum+forward[index][j]+backward[index][j]})
                    if index:
                        interval=segment[index]['start']-segment[index-1]['start']
                        for prior_index,prior in enumerate(choices[index-1]):
                            for j,row in enumerate(rows):
                                transition_marginals.append({'fromPosition':segment[index-1]['position'],'toPosition':segment[index]['position'],
                                    'anatomySha256':anatomy_hash,'JAChange':row['JA']-prior['JA'],'gainRatio':row['gain']/prior['gain'],
                                    'minimumPathObjective':total-optimum+forward[index-1][prior_index]+penalty*jump(prior,row,interval)+row['dataCost']+backward[index][j]})
        alternatives.sort(key=lambda r:(r['objective'],r['anatomySha256']))
        best=alternatives[0]['objective'];uncertainty=[];transitions=[]
        for node in parsed:
            all_rows=[{**row,'objectiveGap':max(0.,row['minimumPathObjective']-best)} for row in marginals if row['position']==node['position']]
            support=[row for row in all_rows if row['objectiveGap']<=OBJECTIVE_GAP+1e-10]
            uncertainty.append({'position':node['position'],'startSeconds':node['start'],'endSeconds':node['end'],
                'JASet':sorted({row['JA'] for row in support}),'gainSet':sorted({row['gain'] for row in support}),
                'anatomyCount':len({row['anatomySha256'] for row in support}),'candidates':all_rows})
        for segment in segments:
            for prior,node in zip(segment,segment[1:]):
                rows=[row for row in transition_marginals if row['fromPosition']==prior['position'] and row['toPosition']==node['position']
                    and row['minimumPathObjective']-best<=OBJECTIVE_GAP+1e-10]
                transitions.append({'fromPosition':prior['position'],'toPosition':node['position'],
                    'JAChangeSet':sorted({row['JAChange'] for row in rows}),'gainRatioSet':sorted({row['gainRatio'] for row in rows}),
                    'admissiblePairCount':len(rows),'intervalSeconds':node['start']-prior['start']})
        result['sensitivity'].append({'lambda':penalty,'alternatives':alternatives,'best':alternatives[0],
            'tiedBestAnatomyHashes':[r['anatomySha256'] for r in alternatives if abs(r['objective']-best)<=1e-12],
            'uncertainty':uncertainty,'transitionUncertainty':transitions})
    result['status']='available' if any(len(segment)>1 for segment in segments) else 'no-temporal-links'
    result['includedWindowCount']=len(parsed);result['partialEvidence']=bool(result['excludedWindows'])
    return result
