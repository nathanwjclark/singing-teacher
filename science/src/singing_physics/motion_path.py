"""Finite conditional paths over existing PCM candidate scores; no new inference engine."""
import hashlib
import json
import math
import re

VERSION='motion-conditional-path-3'
OBJECTIVE_GAP=.1
REFERENCE_INTERVAL_SECONDS=.25
PENALTIES=(0.,.1,1.)
MAX_LINK_GAP_SECONDS=.5
# The constant-path tolerance grows with the evidence: a summed improvement is compared with this per included window.
CONSTANT_TOLERANCE_PER_WINDOW=.01


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def _hash(value):return hashlib.sha256(_canonical(value).encode()).hexdigest()
def _number(value):return type(value) in (int,float) and math.isfinite(value)
def _digest(value):return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) is not None
def _seconds(window):
    try:
        start=(window['sourceStartSample']+window['windowOffsetWithinExcerpt'])/window['sampleRateHz']
        return start if _number(start) else None
    except (KeyError,TypeError,ZeroDivisionError):return None


def couple_motion_hypotheses(windows):
    """Keep anatomy fixed for a recording; minimize per-segment JA/gain path costs.

    This objective is a heuristic sum of standardized discrepancies, not likelihood.
    """
    if not isinstance(windows,list) or len(windows)>120:raise ValueError('At most120 predeclared windows supported')
    result={'kind':VERSION,'status':'unavailable','settings':{'penalties':list(PENALTIES),'maxLinkGapSeconds':MAX_LINK_GAP_SECONDS,
        'JA_difference_scale_deg':1.,'log2_gain_difference_scale':1.,'anatomyScope':'fixed-across-entire-recording',
        'objective':'sum of per-window-scaled PCM mean-square discrepancies + lambda * sum of elapsed-time-scaled squared JA/gain differences',
        'transitionInterpretation':'elapsed-time-scaled engineering regularizer; not calibrated motion dynamics or posterior',
        'referenceIntervalSeconds':REFERENCE_INTERVAL_SECONDS,'objectiveGapTolerance':OBJECTIVE_GAP,
        'uncertaintyInterpretation':'minimum complete-path objective gaps; sensitivity sets, not confidence intervals or probabilities',
        'candidateObjectiveGapsOrder':'aligned with the window fit.joint.candidates list; null where a candidate has no finite comparable score',
        'constantComparison':'best constant JA/gain path for one anatomy (zero transition cost) against the best path; admissible when its summed improvement is within constantTolerancePerWindow times the included window count',
        'constantTolerancePerWindow':CONSTANT_TOLERANCE_PER_WINDOW,
        'pitchBankSwitches':'a path control change between linked windows compared with different pitch-bank anchors may reflect the source pitch change rather than articulation',
        'linkGapPolicy':'recordings are limited to 30 s, so adjacent frames on the evenly spaced grid are at most about 0.41 s apart and always link; longer spacing breaks every link'},
        'inputSha256':hashlib.sha256(json.dumps(windows,sort_keys=True,separators=(',',':'),allow_nan=True).encode()).hexdigest(),'inputHashScope':'Python canonical JSON including explicit nonfinite tokens if supplied','segments':[],'excludedWindows':[],'independent':[],'sensitivity':[],
        'additionalSynthesisCalls':0,'modelUpdated':False,'informationOverConstant':'not-evaluated','warnings':[],'limitations':['Discrete observed frames only; unmeasured intervals are not interpolated or aligned to video.',
            'Source F0 uses the declared per-frame pitch bank; remaining source assumptions are inherited unchanged.',
            'Scores are not probabilities; low cost does not identify anatomy or observed JA.',
            'Source changes the fixed-source bank cannot represent can appear as JA/gain changes; a path that beats the constant path is not evidence of articulation change on its own.',
            'Measurement noise and pitch-bank switches can also make a time-varying path improve on a constant control.']}
    parsed=[];signature=None;previous=None;segments=[];current=[]
    for position,window in enumerate(windows):
        reason=None;rows=[]
        fit=window.get('fit') if isinstance(window,dict) else None
        if not fit or window.get('status')!='scored':
            own=window.get('reason') if isinstance(window,dict) else None
            reason=own if isinstance(own,str) and own else 'Missing or unscorable independent window'
        if reason is None:
            try:
                scales=fit['featureScales'];comparison=fit['comparisonSha256']
                if not isinstance(scales,dict) or not scales or not _digest(comparison):raise ValueError('Missing comparable score provenance')
                for scale in scales.values():
                    if not isinstance(scale,dict) or not _number(scale.get('scale')) or scale['scale']<=0 or not isinstance(scale.get('unit'),str):raise ValueError('Invalid feature scale')
                measured=window['measurement'].get('measurements')
                if not isinstance(measured,list):raise ValueError('Missing descriptor availability for cost comparison')
                available=sorted(m['name'] for m in measured if m.get('name') in scales and _number(m.get('value')))
                if not available:raise ValueError('No declared finite objective descriptors')
                # Scale values may differ per window (each window's own uncertainty); policy, units and provenance may not.
                found=_hash([comparison,{name:scale['unit'] for name,scale in scales.items()},available])
                if signature is not None and found!=signature:
                    result['reason']='Independent fit scale units/policy, extractor or native provenance differ; costs cannot be combined';return result
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
                for slot,candidate in enumerate(raw):
                    if not isinstance(candidate,dict) or candidate.get('status')!='scored':continue
                    cost=candidate.get('weighted_mean_square_discrepancy');ja,gain=candidate.get('JA'),candidate.get('gain')
                    if not _number(cost) or not 0<=cost<=1e100:continue
                    if not _number(ja) or not -5<=ja<=-1 or not _number(gain) or gain<=0 or gain>100:continue
                    anatomy=candidate.get('anatomySha256');identity=candidate.get('candidate_id')
                    if not _digest(anatomy) or not isinstance(identity,str) or not identity or identity in identities:continue
                    identities.add(identity)
                    rows.append({'candidateId':identity,'anatomySha256':anatomy,'JA':ja,'gain':gain,'dataCost':cost,'slot':slot})
                if not rows:raise ValueError('No finite comparable candidate controls/scores')
                if previous is not None and start<previous['end']-1e-9:raise ValueError('Overlapping or reversed acoustic frames')
            except (KeyError,TypeError,ValueError) as error:reason=str(error)
        if reason is not None:
            if current:segments.append(current);current=[]
            result['excludedWindows'].append({'position':position,'startSeconds':_seconds(window) if isinstance(window,dict) else None,'reason':reason});previous=None;continue
        bank=fit.get('bankIndex')
        node={'position':position,'start':start,'end':end,'rows':rows,'candidateCount':len(raw),'bank':bank if type(bank) is int else None}
        if previous is not None and start-previous['end']>MAX_LINK_GAP_SECONDS:
            if current:segments.append(current)
            current=[]
        current.append(node);parsed.append(node);previous=node
        best=min(rows,key=lambda r:(r['dataCost'],r['candidateId']))
        result['independent'].append({'position':position,**{key:best[key] for key in ('candidateId','anatomySha256','JA','gain','dataCost')}})
    if current:segments.append(current)
    if not parsed:result['reason']='No usable windows';return result
    result['comparisonSignature']=signature
    result['segments']=[{'positions':[n['position'] for n in segment],'startSeconds':segment[0]['start'],'endSeconds':segment[-1]['end'],
        'transitionCount':len(segment)-1,'acousticFrames':[{'position':n['position'],'startSeconds':n['start'],'endSeconds':n['end']} for n in segment]} for segment in segments]
    shared=set.intersection(*[{r['anatomySha256'] for r in node['rows']} for node in parsed])
    if not shared:result['reason']='No single anatomy has valid candidates across every usable window';return result
    # Constant paths: one anatomy and one JA/gain control scored in every usable window; no transition cost.
    totals={}
    for node in parsed:
        for row in node['rows']:
            costs=totals.setdefault((row['anatomySha256'],row['JA'],row['gain']),{})
            costs[node['position']]=min(row['dataCost'],costs.get(node['position'],math.inf))
    constant=sorted((sum(costs.values()),key) for key,costs in totals.items() if len(costs)==len(parsed))
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
                path=[{key:row[key] for key in ('position','candidateId','JA','gain','dataCost')} for row in path]
                analyses.append((segment,choices,forward,backward,path,optimum,data,transition))
            total=sum(entry[5] for entry in analyses);data_total=sum(entry[6] for entry in analyses);transition_total=sum(entry[7] for entry in analyses)
            selected=[row for entry in analyses for row in entry[4]]
            alternatives.append({'anatomySha256':anatomy_hash,'objective':total,'dataCost':data_total,
                'timeScaledTransitionCost':transition_total,'weightedTransitionCost':penalty*transition_total,'path':selected})
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
            gaps=[None]*node['candidateCount'];support=[]
            for row in marginals:
                if row['position']!=node['position']:continue
                gaps[row['slot']]=gap=max(0.,row['minimumPathObjective']-best)
                if gap<=OBJECTIVE_GAP+1e-10:support.append(row)
            uncertainty.append({'position':node['position'],'startSeconds':node['start'],'endSeconds':node['end'],
                'JASet':sorted({row['JA'] for row in support}),'gainSet':sorted({row['gain'] for row in support}),
                'anatomyCount':len({row['anatomySha256'] for row in support}),'bankIndex':node['bank'],'candidateObjectiveGaps':gaps})
        for segment in segments:
            for prior,node in zip(segment,segment[1:]):
                rows=[row for row in transition_marginals if row['fromPosition']==prior['position'] and row['toPosition']==node['position']
                    and row['minimumPathObjective']-best<=OBJECTIVE_GAP+1e-10]
                transitions.append({'fromPosition':prior['position'],'toPosition':node['position'],
                    'JAChangeSet':sorted({row['JAChange'] for row in rows}),'gainRatioSet':sorted({row['gainRatio'] for row in rows}),
                    'admissiblePairCount':len(rows),'intervalSeconds':node['start']-prior['start'],
                    'pitchBankSwitch':None not in (prior['bank'],node['bank']) and prior['bank']!=node['bank']})
        comparison=None
        if constant:
            cost,(anatomy_hash,ja,gain)=constant[0];tolerance=CONSTANT_TOLERANCE_PER_WINDOW*len(parsed)
            comparison={'anatomySha256':anatomy_hash,'JA':ja,'gain':gain,'objective':cost,'improvement':max(0.,cost-best),
                'improvementPerWindow':max(0.,cost-best)/len(parsed),'tolerance':tolerance,'admissible':cost-best<=tolerance+1e-10}
        # Path control changes that coincide with a switch between pitch-bank anchors.
        steps={row['position']:(row['JA'],row['gain']) for row in alternatives[0]['path']}
        switches=[{'fromPosition':row['fromPosition'],'toPosition':row['toPosition']} for row in transitions
            if row['pitchBankSwitch'] and steps[row['fromPosition']]!=steps[row['toPosition']]]
        # Alternatives are sorted, so the first is the minimum-objective path; it is not repeated.
        result['sensitivity'].append({'lambda':penalty,'alternatives':alternatives,
            'tiedBestAnatomyHashes':[r['anatomySha256'] for r in alternatives if abs(r['objective']-best)<=1e-12],
            'uncertainty':uncertainty,'transitionUncertainty':transitions,'constantComparison':comparison,'pathChangesAtPitchBankSwitch':switches})
    # The lambda=0 optimum is the lowest objective at any lambda, so a constant path admissible there is admissible everywhere.
    if len(parsed)>1 and constant:
        result['informationOverConstant']='within-tolerance' if result['sensitivity'][0]['constantComparison']['admissible'] else 'exceeds-tolerance'
    if result['informationOverConstant']=='within-tolerance':
        result['warnings'].append({'code':'constant-within-tolerance','message':f'At every regularization setting the improvement over a constant JA/gain control is within the tolerance ({CONSTANT_TOLERANCE_PER_WINDOW:g} per measured window). Measurement noise and pitch-bank switches can also produce improvement, so neither result on its own shows or rules out control change.'})
    result['status']='available' if any(len(segment)>1 for segment in segments) else 'no-temporal-links'
    result['includedWindowCount']=len(parsed);result['partialEvidence']=bool(result['excludedWindows'])
    return result
