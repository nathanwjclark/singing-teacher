import {useEffect,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {useCaptureProgress} from './captureFlow';
import {useScienceOutcome,useScienceStatus} from './scienceClient';
import './CaptureProcessingOverlay.css';

export function CaptureProcessingOverlay(){
 const science=useScienceStatus();
 const outcome=useScienceOutcome(science.status==='succeeded'?science.runId:undefined);
 const progress=useCaptureProgress();
 const job=science.status==='running'?science:outcome.status==='running'?outcome:null;
 const active=!!job||!!progress;
 // The component starts its fallback clock on mount; persisted job timestamps
 // keep the real elapsed time when the page is reopened during fitting.
 const [now,setNow]=useState(Date.now);
 const [openedAt]=useState(Date.now);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);
 if(!active)return null;
 const started=job?.startedAt?Date.parse(job.startedAt):progress?.startedAt??openedAt;
 const seconds=Math.max(0,Math.floor((now-started)/1000));
 const title=progress?.label??(science.status==='running'?'Fitting vocal-tract model…':'Scoring your recording…');
 return <div className="capture-processing-scrim"><section className="capture-processing-overlay" role="status" aria-live="polite" aria-label="Recording processing">
   <LoaderCircle className="capture-processing-wheel" size={76} aria-hidden="true"/>
   <h2>{title}</h2>
   <div className="capture-processing-clock" aria-live="off">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')} elapsed</div>
   <p>{progress?.stage==='geometry'?'Loading the verified comparison into your anatomy views.':progress?.stage==='preparing'?'Checking and preparing the recording from your iPhone.':seconds>=120?'This is taking longer than the recent run. Processing is still reported as active; the app will show the result or an error automatically.':'Allow about 1–2 minutes. The previous comparable fit took about a minute; timing varies by recording.'}</p>
   <small>Keep this local server running. Your model comparison will appear automatically.</small>
 </section></div>;
}
