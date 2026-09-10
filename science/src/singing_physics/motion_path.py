"""Finite conditional paths over existing PCM candidate scores; no new inference engine."""
from copy import deepcopy
import hashlib
import json
import math
import re

VERSION='motion-conditional-path-1'
PENALTIES=(0.,.1,1.)
MAX_LINK_GAP_SECONDS=.5


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def _hash(value):return hashlib.sha256(_canonical(value).encode()).hexdigest()
def _number(value):return type(value) in (int,float) and math.isfinite(value)


def couple_motion_hypotheses(windows):
    """Keep anatomy fixed for a recording; minimize per-segment JA/gain path costs.

    This objective is a heuristic sum of fixed-scale discrepancies, not likelihood.
    """
    if not isinstance(windows,list) or len(windows)>3:raise ValueError('At most3 predeclared windows supported')
    result={'kind':VERSION,'status':'unavailable','settings':{'penalties':list(PENALTIES),'maxLinkGapSeconds':MAX_LINK_GAP_SECONDS,
        'JA_difference_scale_deg':1.,'log2_gain_difference_scale':1.,'anatomyScope':'fixed-across-entire-recording',
        'objective':'sum fixed-scale PCM weighted mean-square discrepancies + lambda * sum squared JA/gain differences',
        'transitionInterpretation':'dimensionless engineering regularizer; not calibrated motion dynamics or posterior'},
        'inputSha256':hashlib.sha256(json.dumps(windows,sort_keys=True,separators=(',',':'),allow_nan=True).encode()).hexdigest(),'inputHashScope':'Python canonical JSON including explicit nonfinite tokens if supplied','segments':[],'excludedWindows':[],'independent':[],'sensitivity':[],
        'additionalSynthesisCalls':0,'modelUpdated':False,'limitations':['Sparse observed frames only; no interpolation or audiovisual correspondence.',
            'Source F0 is conditioned on each measured frame; remaining source assumptions inherited unchanged.',
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
    for penalty in PENALTIES:
        alternatives=[]
        for anatomy_hash in sorted(shared):
            selected=[];total=0.;data_total=0.;transition_total=0.
            for segment in segments:
                states=[]
                for node in segment:
                    choices=sorted([r for r in node['rows'] if r['anatomySha256']==anatomy_hash],key=lambda r:r['candidateId'])
                    next_states=[]
                    for row in choices:
                        if not states:best=(row['dataCost'],[{'position':node['position'],**row}],row['dataCost'],0.)
                        else:
                            candidates=[]
                            for cost,path,data_cost,transition_cost in states:
                                prior=path[-1];jump=(row['JA']-prior['JA'])**2+(math.log2(row['gain']/prior['gain']))**2
                                candidates.append((cost+row['dataCost']+penalty*jump,path+[{'position':node['position'],**row}],data_cost+row['dataCost'],transition_cost+jump))
                            best=min(candidates,key=lambda s:(s[0],[r['candidateId'] for r in s[1]]))
                        next_states.append(best)
                    states=next_states
                cost,path,data_cost,transition_cost=min(states,key=lambda s:(s[0],[r['candidateId'] for r in s[1]]))
                selected.extend(path);total+=cost;data_total+=data_cost;transition_total+=transition_cost
            alternatives.append({'anatomySha256':anatomy_hash,'anatomy':selected[0]['anatomy'],'objective':total,'dataCost':data_total,
                'unweightedTransitionCost':transition_total,'weightedTransitionCost':penalty*transition_total,'path':selected})
        alternatives.sort(key=lambda r:(r['objective'],r['anatomySha256']))
        result['sensitivity'].append({'lambda':penalty,'alternatives':alternatives,'best':alternatives[0],'tiedBestAnatomyHashes':[r['anatomySha256'] for r in alternatives if r['objective']==alternatives[0]['objective']]})
    result['status']='available' if any(len(segment)>1 for segment in segments) else 'no-temporal-links'
    result['includedWindowCount']=len(parsed);result['partialEvidence']=bool(result['excludedWindows'])
    return result
