import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, TrackingFrame } from '../types';

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

export interface VisionEngine { process(video: HTMLVideoElement, timestamp: number): TrackingFrame; close(): void }

export async function createVisionEngine(): Promise<VisionEngine> {
  const { cv } = await loadOpenCV();
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 1,
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
  let frameCount = 0;
  let closed = false;
  return {
    process(video, timestamp) {
      if (closed) throw new Error('Vision engine is closed.');
      const landmarks = face.detectForVideo(video, timestamp).faceLandmarks[0] ?? [];
      if (frameCount++ % 2 === 0) cachedPose = pose.detectForVideo(video, timestamp).landmarks[0] ?? [];
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
      return { face: landmarks, pose: cachedPose, timestamp, metrics: { mouthOpen, headTilt: tilt(landmarks[33], landmarks[263]), shoulderTilt: tilt(cachedPose[11], cachedPose[12]), brightness, motion } };
    },
    close() { if (!closed) { closed = true; face.close(); pose.close(); previous.delete(); } },
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
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, '#c5fc93aa');
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_LIPS, '#d2ff96');
  lines(frame.pose, [{ start: 11, end: 12 }, { start: 11, end: 13 }, { start: 12, end: 14 }, { start: 11, end: 23 }, { start: 12, end: 24 }], '#c5fc9366');
  context.fillStyle = '#d2ff96';
  for (const index of [1, 13, 14, 33, 263]) {
    const point = frame.face[index];
    if (point) { context.beginPath(); context.arc(point.x * width, point.y * height, 2.5, 0, Math.PI * 2); context.fill(); }
  }
}
