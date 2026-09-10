export interface TemporalResult {
 status:string;reason?:string;includedWindowCount?:number;partialEvidence?:boolean;
 settings:{maxLinkGapSeconds:number;transitionInterpretation:string};
 segments:Array<{positions:number[];transitionCount:number}>;
 excludedWindows:Array<{position:number;reason:string}>;
 independent:Array<{position:number;candidateId:string;dataCost:number}>;
 sensitivity:Array<{lambda:number;tiedBestAnatomyHashes?:string[];alternatives:Array<{anatomySha256:string;objective:number;dataCost:number;weightedTransitionCost:number;unweightedTransitionCost:number;path:Array<{position:number;candidateId:string;JA:number;gain:number}>}>}>;
}
export function TemporalAnalysis({result}:{result?:TemporalResult}){
 if(!result)return <p>Temporal comparison was not included in this saved analysis.</p>;
 return <details><summary>Conditional temporal comparison</summary>
 <p>{result.status==='available'?'Linked acoustic windows available.':result.status==='no-temporal-links'?'No temporal links: the usable frames are isolated.':`Unavailable: ${result.reason??'No comparable paths'}`}</p>
 <p>Anatomy stays fixed across the recording. These are heuristic comparisons, not probabilities or measured movement. No interpolation or synchronized visual fitting is performed.</p>
 <p>Maximum gap between linked acoustic frames: {result.settings.maxLinkGapSeconds} seconds. {result.settings.transitionInterpretation}.</p>
 {result.partialEvidence&&<p>Partial evidence: excluded windows remain excluded.</p>}
 <ul>{result.segments.map((segment,i)=><li key={i}>Segment {i+1}: windows {segment.positions.map(p=>p+1).join(', ')}; {segment.transitionCount} links</li>)}{result.excludedWindows.map(row=><li key={'excluded-'+row.position}>Window {row.position+1}: {row.reason}</li>)}</ul>
 <details><summary>Independent window choices</summary><ul>{result.independent.map(row=><li key={row.position}>Window {row.position+1}: {row.candidateId} · discrepancy {row.dataCost.toPrecision(4)}</li>)}</ul></details>
 {result.sensitivity.map(row=><details key={row.lambda}><summary>{row.lambda===0?'Fixed-anatomy comparison without smoothing':`Regularization λ = ${row.lambda}`}</summary>
 {(row.tiedBestAnatomyHashes?.length??0)>1&&<p>{row.tiedBestAnatomyHashes!.length} anatomy alternatives share the best objective; display order does not break the tie.</p>}
 {row.alternatives.map((path,index)=><div key={path.anatomySha256}><p>Alternative {index+1} · anatomy {path.anatomySha256.slice(0,12)} · unweighted transition {path.unweightedTransitionCost.toPrecision(4)} · acoustic cost {path.dataCost.toPrecision(4)} + transition cost {path.weightedTransitionCost.toPrecision(4)} = {path.objective.toPrecision(4)}</p><ul>{path.path.map(step=><li key={step.position}>Window {step.position+1}: {step.candidateId} (JA {step.JA}, digital gain {step.gain})</li>)}</ul></div>)}</details>)}
 </details>
}
