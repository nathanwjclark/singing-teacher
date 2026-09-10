import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, TrackingFrame } from '../types';
import { createTongueTracker } from './tongueTracking';
import { depthMetrics } from './depth';
import { createTrackingStabilizer } from './trackingStability';

interface Mat { delete(): void; copyTo(destination: Mat): void }
interface OpenCV {
  Mat: new () => Mat;
  imread(canvas: HTMLCanvasElement): Mat;
  cvtColor(source: Mat, destination: Mat, conversion: number): void;
  absdiff(first: Mat, second: Mat, destination: Mat): void;
  mean(mat: Mat): number[];
  COLOR_RGBA2GRAY: number;
}

let cvPromise: Promise<{ cv: OpenCV }> | undefined;
function loadOpenCV(): Promise<{ cv: OpenCV }> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise<{ cv: OpenCV }>((resolve, reject) => {
    const global = window as unknown as { cv?: OpenCV };
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => finish(new Error('OpenCV could not load. Check your connection and try again.')), 60000);
    const interval = window.setInterval(check, 100);
    let finished = false;
    function finish(error?: Error, cv?: OpenCV) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(interval);
      if (error) { script.remove(); reject(error); }
      // This OpenCV build is a self-resolving Emscripten thenable. Wrapping it
      // prevents native Promise assimilation from looping indefinitely.
      else resolve({ cv: cv! });
    }
    function check() {
      if (global.cv?.Mat) finish(undefined, global.cv);
    }
    script.src = 'https://docs.opencv.org/4.13.0/opencv.js';
    script.async = true;
    script.onload = check;
    script.onerror = () => finish(new Error('Unable to download OpenCV. Check your connection and try again.'));
    if (global.cv) void check();
    else document.head.appendChild(script);
  }).catch(error => { cvPromise = undefined; throw error; });
  return cvPromise;
}

export interface VisionEngine { process(video: HTMLVideoElement, timestamp: number): TrackingFrame; calibrate(): boolean; calibrateTongue(): void; selectTongueTip(x:number,y:number): void; close(): void }

export async function createVisionEngine(): Promise<VisionEngine> {
  const { cv } = await loadOpenCV();
  // OpenCV's UMD footer leaves its initialized Emscripten module globally.
  // MediaPipe otherwise reuses that incompatible module and never initializes.
  const globals = window as unknown as { Module?: unknown };
  if (globals.Module === cv) delete globals.Module;
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  let pose: PoseLandmarker;
  try {
    pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1,
    });
  } catch (error) { face.close(); throw error; }

  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 120;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { face.close(); pose.close(); throw new Error('This browser does not support camera image processing.'); }
  const previous = new cv.Mat();
  let hasPrevious = false;
  let cachedPose: Landmark[] = [];
  let cachedWorldPose: Landmark[] = [];
  let depthHistory: number[] = [];
  let baselineDistance: number | undefined;
  let recentDistance: number | undefined;
  const stabilizer = createTrackingStabilizer();
  const tongueCanvas = document.createElement('canvas');
  tongueCanvas.width=160; tongueCanvas.height=128;
  const tongueContext=tongueCanvas.getContext('2d', {willReadFrequently:true})!;
  const trackTongue=createTongueTracker();
  let pendingTongueTip:{x:number;y:number}|undefined;
  let closed = false;
  const profileRequest=new AbortController();
  void fetch('/api/tongue-profile',{cache:'no-store',signal:profileRequest.signal}).then(async response=>{
    if(!response.ok){if(!closed)trackTongue.profileUnavailable();return;}
    const profile:unknown=await response.json();if(!closed)trackTongue.setProfile(profile);
  }).catch(()=>{if(!closed)trackTongue.profileUnavailable();});
  return {
    process(video, timestamp) {
      if (closed) throw new Error('Vision engine is closed.');
      const faceResult = face.detectForVideo(video, timestamp);
      const landmarks = faceResult.faceLandmarks[0] ?? [];
      const faceTransform = faceResult.facialTransformationMatrixes[0]?.data;
      const blendshapes = Object.fromEntries((faceResult.faceBlendshapes[0]?.categories ?? []).map(category => [category.categoryName, category.score]));
      const poseResult = pose.detectForVideo(video, timestamp);
      cachedPose = stabilizer.pose(poseResult.landmarks[0] ?? [], timestamp);
      cachedWorldPose = stabilizer.worldPose(poseResult.worldLandmarks[0] ?? [], timestamp);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const rgba = cv.imread(canvas);
      const gray = new cv.Mat();
      const difference = new cv.Mat();
      let brightness = 0, motion = 0;
      try {
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        brightness = cv.mean(gray)[0];
        if (hasPrevious) { cv.absdiff(gray, previous, difference); motion = cv.mean(difference)[0] / 255; }
        gray.copyTo(previous);
        hasPrevious = true;
      } finally { rgba.delete(); gray.delete(); difference.delete(); }
      const aspect = video.videoWidth / video.videoHeight;
      const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
      const tilt = (a?: Landmark, b?: Landmark) => {
        if (!a || !b) return 0;
        const angle = Math.atan2(b.y - a.y, (b.x - a.x) * aspect) * 180 / Math.PI;
        return angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
      };
      const mouthOpen = landmarks.length > 308 ? distance(landmarks[13], landmarks[14]) / Math.max(distance(landmarks[78], landmarks[308]), .001) : 0;
      const depth = depthMetrics(landmarks, cachedPose, cachedWorldPose, faceTransform, blendshapes, video.videoWidth, video.videoHeight);
      if (depth.distanceCm !== undefined) {
        depthHistory.push(depth.distanceCm);
        depthHistory = depthHistory.slice(-7);
        const sorted = [...depthHistory].sort((a, b) => a - b);
        recentDistance = sorted[Math.floor(sorted.length / 2)];
        depth.distanceCm = recentDistance;
        if (baselineDistance !== undefined) depth.relativeDepth = recentDistance / baselineDistance;
      } else { recentDistance = undefined; depthHistory = []; }
      let tongue: TrackingFrame['tongue'];
      let tongueSearch: TrackingFrame['tongueSearch'];
      let tongueStatus='Show your face';
      if(landmarks.length>308) {
        const mouthLeft=Math.min(landmarks[78].x,landmarks[308].x);
        const mouthWidth=Math.abs(landmarks[78].x-landmarks[308].x);
        const x=Math.max(0,mouthLeft-mouthWidth*.15),y=Math.max(0,landmarks[13].y-mouthWidth*.15);
        const width=Math.min(1-x,mouthWidth*1.3);
        const height=Math.min(1-y,Math.max(landmarks[14].y-y+mouthWidth*.65,mouthWidth*.8));
        tongueSearch={x,y,width,height};
        tongueStatus=Math.abs(depth.headYaw??0)>40 ? 'Face forward' : mouthOpen<.06 ? 'Open your mouth / show your tongue' : mouthWidth*video.videoWidth<16 ? 'Move closer for tongue tracking' : 'Searching for visible tongue';
        if(tongueStatus==='Searching for visible tongue') {
          // Preserve the native mouth detail instead of downsampling the entire
          // video until the tongue is only a handful of pixels high.
          tongueContext.drawImage(video,x*video.videoWidth,y*video.videoHeight,width*video.videoWidth,height*video.videoHeight,0,0,160,128);
          if(pendingTongueTip){trackTongue.selectTip((pendingTongueTip.x-x)/width,(pendingTongueTip.y-y)/height);pendingTongueTip=undefined;}
          const localFace=landmarks.map(p=>({...p,x:(p.x-x)/width,y:(p.y-y)/height}));
          const local=trackTongue(tongueContext.getImageData(0,0,160,128).data,160,128,localFace);
          if(local) {
            tongue={...local,x:x+local.x*width,y:y+local.y*height,tip:local.tip ? {x:x+local.tip.x*width,y:y+local.tip.y*height} : undefined,outline:local.outline?.map(p=>({x:x+p.x*width,y:y+p.y*height}))};
            tongueStatus=local.trackingMode==='tip'?'Tongue tip tracked · crosshair':trackTongue.isTipSelected()?'Tip lost · select it again':'Tongue visible · select Track tip';
          }
        } else trackTongue(new Uint8ClampedArray(0),0,0,[]);
      } else trackTongue(new Uint8ClampedArray(0),0,0,[]);
      const tongueDiagnostic=trackTongue.diagnostics();
      if(tongueDiagnostic.state==='lost'&&tongueStatus==='Searching for visible tongue')tongueStatus='Tip lost · open Tongue lab for details';
      return { tongue, tongueStatus, tongueSearch, tongueDiagnostic, face: landmarks, pose: cachedPose, worldPose: cachedWorldPose, faceTransform, blendshapes, timestamp, metrics: stabilizer.metrics({ mouthOpen, headTilt: tilt(landmarks[33], landmarks[263]), shoulderTilt: tilt(cachedPose[11], cachedPose[12]), brightness, motion, ...depth }, timestamp, landmarks.length > 0) };
    },
    selectTongueTip(x,y) { pendingTongueTip={x,y}; },
    calibrateTongue() { trackTongue.resetMotionReference(); },
    calibrate() { if (closed || recentDistance === undefined || depthHistory.length < 5) return false; baselineDistance = recentDistance; return true; },
    close() { if (!closed) { closed = true; profileRequest.abort(); face.close(); pose.close(); previous.delete(); } },
  };
}

export function drawTracking(context: CanvasRenderingContext2D, frame: TrackingFrame, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  context.lineWidth = 1.5;
  const lines = (landmarks: Landmark[], connections: Array<{ start: number; end: number }>, color: string) => {
    context.strokeStyle = color;
    context.beginPath();
    for (const { start, end } of connections) {
      const a = landmarks[start], b = landmarks[end];
      if (!a || !b || (a.visibility ?? 1) < .5 || (b.visibility ?? 1) < .5) continue;
      context.moveTo(a.x * width, a.y * height); context.lineTo(b.x * width, b.y * height);
    }
    context.stroke();
  };
  context.lineWidth = .55;
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_TESSELATION, '#c5fc9338');
  context.lineWidth = 1.2;
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, '#c5fc93aa');
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_LIPS, '#d2ff96');
  lines(frame.face, [...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW], '#b3e4ceaa');
  lines(frame.face, [...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS], '#9de4ff');
  // The face model already supplies stable eyes, nose and mouth. Body-model
  // facial points are a coarser estimate and should not compete with that mesh.
  lines(frame.pose, PoseLandmarker.POSE_CONNECTIONS.filter(edge => edge.start >= 11 && edge.end >= 11), '#c5fc9399');
  context.fillStyle = '#d2ff96';
  for (const point of frame.face) {
    context.beginPath(); context.arc(point.x * width, point.y * height, .8, 0, Math.PI * 2); context.fill();
  }
  for (const point of frame.pose.slice(11)) {
    if ((point.visibility ?? 0) < .5) continue;
    context.beginPath(); context.arc(point.x * width, point.y * height, 2.5, 0, Math.PI * 2); context.fill();
  }
  context.save();
  if(frame.tongueSearch && !frame.tongue) {
    const box=frame.tongueSearch;context.strokeStyle='#ff91b388';context.lineWidth=1;context.setLineDash([4,4]);
    context.strokeRect(box.x*width,box.y*height,box.width*width,box.height*height);context.setLineDash([]);
  }
  if(frame.tongue) {
    context.fillStyle='#ff71aa';context.strokeStyle='#ffb3d0';context.lineWidth=2;
    for(const p of frame.tongue.outline??[]){context.beginPath();context.arc(p.x*width,p.y*height,1.6,0,Math.PI*2);context.fill();}
    if(frame.tongue.trackingMode!=='region'){
    const x=frame.tongue.x*width,y=frame.tongue.y*height;
    context.beginPath();context.arc(x,y,6,0,Math.PI*2);context.moveTo(x-10,y);context.lineTo(x+10,y);context.moveTo(x,y-10);context.lineTo(x,y+10);context.stroke();
    }
  }
  context.restore();
}
