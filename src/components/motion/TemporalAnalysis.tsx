import {useState} from 'react'
interface TemporalSupport {position:number;startSeconds:number;endSeconds:number;JASet:number[];gainSet:number[];anatomyCount:number}
interface ConstantComparison {anatomySha256:string;JA:number;gain:number;objective:number;improvement:number;admissible:boolean}
export interface TemporalWarning {code:string;message:string}
export interface TemporalResult {
 status:string;reason?:string;includedWindowCount?:number;partialEvidence?:boolean;
 informationOverConstant?:'present'|'none'|'not-evaluated';warnings?:TemporalWarning[];
 settings:{maxLinkGapSeconds:number;transitionInterpretation:string;objectiveGapTolerance?:number;uncertaintyInterpretation?:string};
 segments:Array<{positions:number[];transitionCount:number}>;
 excludedWindows:Array<{position:number;startSeconds?:number|null;reason:string}>;
 independent:Array<{position:number;candidateId:string;dataCost:number}>;
 sensitivity:Array<{lambda:number;uncertainty?:TemporalSupport[];transitionUncertainty?:Array<{fromPosition:number;toPosition:number;JAChangeSet:number[];gainRatioSet:number[]}>;tiedBestAnatomyHashes?:string[];constantComparison?:ConstantComparison|null;alternatives:Array<{anatomySha256:string;objective:number;dataCost:number;weightedTransitionCost:number;timeScaledTransitionCost:number;path:Array<{position:number;candidateId:string;JA:number;gain:number}>}>}>;
}
const seconds=(value:number|null|undefined)=>value==null?'time unknown':`${value.toFixed(2)} s`;
export function TemporalAnalysis({result}:{result?:TemporalResult}){
 const [lambda,setLambda]=useState(.1);
 if(!result)return <p>Temporal comparison was not included in this saved analysis.</p>;
 return <details><summary>Conditional temporal comparison</summary>
 <p>{result.status==='available'?'Linked acoustic windows available.':result.status==='no-temporal-links'?'No temporal links: the usable frames are isolated.':`Unavailable: ${result.reason??'No comparable paths'}`}</p>
 <p>Anatomy stays fixed across the recording. These are heuristic comparisons, not probabilities or measured movement. No interpolation or synchronized visual fitting is performed.</p>
 <p>Maximum gap between linked acoustic frames: {result.settings.maxLinkGapSeconds} seconds. {result.settings.transitionInterpretation}.</p>
 {result.partialEvidence&&<p>Partial evidence: excluded windows remain excluded.</p>}
 <TrajectoryTimeline result={result} lambda={lambda} setLambda={setLambda}/>
 <ul aria-label="Linked segments and missing windows">{result.segments.map((segment,i)=><li key={i}>Segment {i+1}: windows {segment.positions.map(p=>p+1).join(', ')}; {segment.transitionCount} links</li>)}{result.excludedWindows.map(row=><li key={'excluded-'+row.position}>Missing window {row.position+1} at {seconds(row.startSeconds)}: {row.reason}</li>)}</ul>
 <details><summary>Independent window choices</summary><ul>{result.independent.map(row=><li key={row.position}>Window {row.position+1}: {row.candidateId} · discrepancy {row.dataCost.toPrecision(4)}</li>)}</ul></details>
 {result.sensitivity.map(row=><details key={row.lambda}><summary>{row.lambda===0?'Fixed-anatomy comparison without smoothing':`Regularization λ = ${row.lambda}`}</summary>
 {(row.tiedBestAnatomyHashes?.length??0)>1&&<p>{row.tiedBestAnatomyHashes!.length} anatomy alternatives share the best objective; display order does not break the tie.</p>}
 {row.alternatives.map((path,index)=><div key={path.anatomySha256}><p>Alternative {index+1} · anatomy {path.anatomySha256.slice(0,12)} · time-scaled transition {path.timeScaledTransitionCost.toPrecision(4)} · acoustic cost {path.dataCost.toPrecision(4)} + transition cost {path.weightedTransitionCost.toPrecision(4)} = {path.objective.toPrecision(4)}</p><ul>{path.path.map(step=><li key={step.position}>Window {step.position+1}: {step.candidateId} (JA {step.JA}, digital gain {step.gain})</li>)}</ul></div>)}</details>)}
 </details>
}

function ConstantNote({comparison,lambda,tolerance}:{comparison?:ConstantComparison|null;lambda:number;tolerance?:number}){
 if(!comparison)return <p>No single JA/gain control was scored in every usable window, so no constant path is compared.</p>;
 const constant=`JA ${comparison.JA}°, digital gain ${comparison.gain}`;
 return comparison.admissible
  ?<p>At λ {lambda} the best constant path ({constant}) is within the objective-gap tolerance {tolerance} of the best path. At this setting the recording gives no evidence of control change.</p>
  :<p>At λ {lambda} the best path improves on the best constant path ({constant}) by {comparison.improvement.toPrecision(3)}, more than the tolerance {tolerance}. Source changes the bank cannot represent can also produce this difference.</p>;
}

function TrajectoryTimeline({result,lambda,setLambda}:{result:TemporalResult;lambda:number;setLambda:(value:number)=>void}){
 const selected=result.sensitivity.find(row=>row.lambda===lambda)??result.sensitivity[0];
 const support=selected?.uncertainty;
 if(!support?.length)return null;
 const frame=support[0].endSeconds-support[0].startSeconds;
 const missing=result.excludedWindows.filter((row):row is {position:number;startSeconds:number;reason:string}=>row.startSeconds!=null);
 const starts=[...support,...missing].map(row=>row.startSeconds);
 const start=Math.min(...starts),end=Math.max(...starts)+frame,span=Math.max(.01,end-start);
 const x=(value:number)=>45+510*(value-start)/span,y=(ja:number)=>20+(-ja-2)*55;
 const time=new Map(support.map(row=>[row.position,row.startSeconds]));
 const path=new Map((selected.alternatives[0]?.path??[]).map(row=>[row.position,row.JA]));
 // Lines join consecutive measured frames inside one linked segment only; gaps stay open.
 const links=result.segments.flatMap(segment=>segment.positions.slice(1).map((position,i)=>[segment.positions[i],position])).filter(([a,b])=>path.has(a)&&path.has(b));
 return <section aria-label="Audio trajectory sensitivity"><h4>Audio trajectory and competing controls</h4>
 <label>Transition regularization <select value={selected.lambda} onChange={event=>setLambda(Number(event.target.value))}>{result.sensitivity.map(row=><option key={row.lambda} value={row.lambda}>λ {row.lambda}</option>)}</select></label>
 <p>Each dot column is a measured audio window. Vertical marks show alternative JA hypotheses within objective gap {result.settings.objectiveGapTolerance}; these are sensitivity sets, not confidence intervals. Crosses on the lower row are missing windows; lines never cross them.</p>
 <svg role="img" aria-label="Time course of conditional jaw angle hypotheses with missing windows" viewBox="0 0 600 196" style={{width:'100%',maxWidth:800}}>
 {[-4,-3,-2].map(ja=><g key={ja}><line x1="40" x2="565" y1={y(ja)} y2={y(ja)} stroke="currentColor" opacity=".2"/><text x="3" y={y(ja)+4} fill="currentColor" fontSize="12">{ja}°</text></g>)}
 <text x="3" y="157" fill="currentColor" fontSize="12">gap</text>
 {support.map(row=><g key={row.position}><line x1={x(row.startSeconds)} x2={x(row.startSeconds)} y1={y(Math.min(...row.JASet))} y2={y(Math.max(...row.JASet))} stroke="currentColor" opacity=".5" strokeWidth="4"/>{row.JASet.map(ja=><circle key={ja} cx={x(row.startSeconds)} cy={y(ja)} r="3" fill="currentColor" opacity=".6"/>)}<title>Window {row.position+1}, {row.startSeconds.toFixed(3)} s; JA candidates {row.JASet.join(', ')}</title></g>)}
 {links.map(([a,b])=><line key={a+'-'+b} x1={x(time.get(a)!)} x2={x(time.get(b)!)} y1={y(path.get(a)!)} y2={y(path.get(b)!)} stroke="#de8d33" strokeWidth="2"/>)}
 {[...path].map(([position,ja])=>time.has(position)?<circle key={position} cx={x(time.get(position)!)} cy={y(ja)} r="5" fill="#de8d33"/>:null)}
 {missing.map(row=><g key={'missing-'+row.position} data-missing-window={row.position+1}><path d={`M${x(row.startSeconds)-4} 149L${x(row.startSeconds)+4} 157M${x(row.startSeconds)-4} 157L${x(row.startSeconds)+4} 149`} stroke="currentColor" strokeWidth="2"/><title>Window {row.position+1}, {row.startSeconds.toFixed(3)} s missing: {row.reason}</title></g>)}
 <text x="40" y="186" fill="currentColor" fontSize="12">{start.toFixed(2)} s</text><text x="530" y="186" fill="currentColor" fontSize="12">{end.toFixed(2)} s</text>
 </svg>
 <p>Orange: minimum-objective path. JA is a simulator angle hypothesis; source changes can produce competing acoustic explanations.</p>
 <ConstantNote comparison={selected.constantComparison} lambda={selected.lambda} tolerance={result.settings.objectiveGapTolerance}/>
 <details><summary>Window and transition ambiguity</summary><table><thead><tr><th>Audio time (s)</th><th>JA candidates (°)</th><th>Gain candidates</th><th>Anatomy alternatives</th></tr></thead><tbody>{support.map(row=><tr key={row.position}><td>{row.startSeconds.toFixed(3)}–{row.endSeconds.toFixed(3)}</td><td>{row.JASet.join(', ')}</td><td>{row.gainSet.join(', ')}</td><td>{row.anatomyCount}</td></tr>)}</tbody></table>
 <ul>{selected.transitionUncertainty?.map(row=><li key={row.toPosition}>Window {row.fromPosition+1} → {row.toPosition+1}: JA change candidates {row.JAChangeSet.join(', ')}°; gain ratios {row.gainRatioSet.join(', ')}</li>)}</ul></details>
 </section>
}
