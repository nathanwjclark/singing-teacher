import {LoaderCircle} from 'lucide-react';
import {useCaptureProgress} from './captureFlow';
import {useScienceOutcome,useScienceStatus} from './scienceClient';
import './CaptureProcessingOverlay.css';

export function CaptureProcessingOverlay(){
 const science=useScienceStatus();
 const outcome=useScienceOutcome(science.status==='succeeded'?science.runId:undefined);
 const progress=useCaptureProgress();
 if(science.status!=='running'&&outcome.status!=='running'&&!progress)return null;
 const title=progress?.label??(science.status==='running'?'Fitting vocal-tract model…':'Scoring your recording…');
 return <section className="capture-processing-toast" role="status" aria-live="polite" aria-label="Recording processing">
   <LoaderCircle className="capture-processing-wheel" size={40} aria-hidden="true"/>
   <div><h2>{title}</h2><p>Your model comparison will appear automatically.</p></div>
 </section>;
}
