import {useState} from 'react'
interface TemporalSupport {position:number;startSeconds:number;endSeconds:number;JASet:number[];gainSet:number[];anatomyCount:number}
export interface TemporalResult {
 status:string;reason?:string;includedWindowCount?:number;partialEvidence?:boolean;
 settings:{maxLinkGapSeconds:number;transitionInterpretation:string;objectiveGapTolerance?:number;uncertaintyInterpretation?:string};
 segments:Array<{positions:number[];transitionCount:number}>;
 excludedWindows:Array<{position:number;reason:string}>;
 independent:Array<{position:number;candidateId:string;dataCost:number}>;
 sensitivity:Array<{lambda:number;uncertainty?:TemporalSupport[];transitionUncertainty?:Array<{fromPosition:number;toPosition:number;JAChangeSet:number[];gainRatioSet:number[]}>;tiedBestAnatomyHashes?:string[];alternatives:Array<{anatomySha256:string;objective:number;dataCost:number;weightedTransitionCost:number;unweightedTransitionCost:number;path:Array<{position:number;candidateId:string;JA:number;gain:number}>}>}>;
}
export function TemporalAnalysis({result}:{result?:TemporalResult}){
 const [lambda,setLambda]=useState(.1);
 if(!result)return <p>Temporal comparison was not included in this saved analysis.</p>;
 return <details><summary>Conditional temporal comparison</summary>
 <p>{result.status==='available'?'Linked acoustic windows available.':result.status==='no-temporal-links'?'No temporal links: the usable frames are isolated.':`Unavailable: ${result.reason??'No comparable paths'}`}</p>
 <p>Anatomy stays fixed across the recording. These are heuristic comparisons, not probabilities or measured movement. No interpolation or synchronized visual fitting is performed.</p>
 <p>Maximum gap between linked acoustic frames: {result.settings.maxLinkGapSeconds} seconds. {result.settings.transitionInterpretation}.</p>
 {result.partialEvidence&&<p>Partial evidence: excluded windows remain excluded.</p>}
 <TrajectoryTimeline result={result} lambda={lambda} setLambda={setLambda}/>
 <ul>{result.segments.map((segment,i)=><li key={i}>Segment {i+1}: windows {segment.positions.map(p=>p+1).join(', ')}; {segment.transitionCount} links</li>)}{result.excludedWindows.map(row=><li key={'excluded-'+row.position}>Window {row.position+1}: {row.reason}</li>)}</ul>
 <details><summary>Independent window choices</summary><ul>{result.independent.map(row=><li key={row.position}>Window {row.position+1}: {row.candidateId} · discrepancy {row.dataCost.toPrecision(4)}</li>)}</ul></details>
 {result.sensitivity.map(row=><details key={row.lambda}><summary>{row.lambda===0?'Fixed-anatomy comparison without smoothing':`Regularization λ = ${row.lambda}`}</summary>
 {(row.tiedBestAnatomyHashes?.length??0)>1&&<p>{row.tiedBestAnatomyHashes!.length} anatomy alternatives share the best objective; display order does not break the tie.</p>}
 {row.alternatives.map((path,index)=><div key={path.anatomySha256}><p>Alternative {index+1} · anatomy {path.anatomySha256.slice(0,12)} · unweighted transition {path.unweightedTransitionCost.toPrecision(4)} · acoustic cost {path.dataCost.toPrecision(4)} + transition cost {path.weightedTransitionCost.toPrecision(4)} = {path.objective.toPrecision(4)}</p><ul>{path.path.map(step=><li key={step.position}>Window {step.position+1}: {step.candidateId} (JA {step.JA}, digital gain {step.gain})</li>)}</ul></div>)}</details>)}
 </details>
}

function TrajectoryTimeline({result,lambda,setLambda}:{result:TemporalResult;lambda:number;setLambda:(value:number)=>void}){
 const selected=result.sensitivity.find(row=>row.lambda===lambda)??result.sensitivity[0];
 const support=selected?.uncertainty;
 if(!support?.length)return null;
 const start=support[0].startSeconds,end=support[support.length-1].endSeconds,span=Math.max(.01,end-start);
 const x=(seconds:number)=>45+510*(seconds-start)/span,y=(ja:number)=>20+(-ja-2)*55;
 const points=selected.alternatives[0]?.path??[];
 return <section aria-label="Audio trajectory sensitivity"><h4>Audio trajectory and competing controls</h4>
 <label>Transition regularization <select value={selected.lambda} onChange={event=>setLambda(Number(event.target.value))}>{result.sensitivity.map(row=><option key={row.lambda} value={row.lambda}>λ {row.lambda}</option>)}</select></label>
 <p>Each mark is a measured audio window. Vertical marks show alternative JA hypotheses within objective gap {result.settings.objectiveGapTolerance}; these are sensitivity sets, not confidence intervals. Missing windows are not connected or filled.</p>
 <svg role="img" aria-label="Time course of conditional jaw angle hypotheses" viewBox="0 0 600 180" style={{width:'100%',maxWidth:800}}>
 {[-4,-3,-2].map(ja=><g key={ja}><line x1="40" x2="565" y1={y(ja)} y2={y(ja)} stroke="currentColor" opacity=".2"/><text x="3" y={y(ja)+4} fill="currentColor" fontSize="12">{ja}°</text></g>)}
 {support.map(row=><g key={row.position}><line x1={x(row.startSeconds)} x2={x(row.startSeconds)} y1={y(Math.min(...row.JASet))} y2={y(Math.max(...row.JASet))} stroke="currentColor" opacity=".5" strokeWidth="4"/>{row.JASet.map(ja=><circle key={ja} cx={x(row.startSeconds)} cy={y(ja)} r="3" fill="currentColor" opacity=".6"/>)}<title>Window {row.position+1}, {row.startSeconds.toFixed(3)} s; JA candidates {row.JASet.join(', ')}</title></g>)}
 {points.map(row=>{const observed=support.find(point=>point.position===row.position);return observed?<circle key={row.position} cx={x(observed.startSeconds)} cy={y(row.JA)} r="5" fill="#de8d33"/>:null})}
 <text x="40" y="165" fill="currentColor" fontSize="12">{start.toFixed(2)} s</text><text x="530" y="165" fill="currentColor" fontSize="12">{end.toFixed(2)} s</text>
 </svg>
 <p>Orange marks: minimum-objective path. JA is a simulator angle hypothesis; source changes can produce competing acoustic explanations.</p>
 <details><summary>Window and transition ambiguity</summary><table><thead><tr><th>Audio time (s)</th><th>JA candidates (°)</th><th>Gain candidates</th><th>Anatomy alternatives</th></tr></thead><tbody>{support.map(row=><tr key={row.position}><td>{row.startSeconds.toFixed(3)}–{row.endSeconds.toFixed(3)}</td><td>{row.JASet.join(', ')}</td><td>{row.gainSet.join(', ')}</td><td>{row.anatomyCount}</td></tr>)}</tbody></table>
 <ul>{selected.transitionUncertainty?.map(row=><li key={row.toPosition}>Window {row.fromPosition+1} → {row.toPosition+1}: JA change candidates {row.JAChangeSet.join(', ')}°; gain ratios {row.gainRatioSet.join(', ')}</li>)}</ul></details>
 </section>
}
