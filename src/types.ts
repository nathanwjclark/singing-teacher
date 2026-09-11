export type Landmark = { x: number; y: number; z?: number; visibility?: number };
export type BodyRegion = 'jaw' | 'neck' | 'shoulders' | 'lips' | 'chest' | 'torso' | 'general';
export type Metrics = {
  mouthOpen: number; headTilt: number; shoulderTilt: number; brightness: number; motion: number;
  headYaw?: number; headPitch?: number; shoulderDepth?: number; torsoLean?: number;
  lipWidth?: number; jawAsymmetry?: number; shoulderElevation?: number;
  distanceCm?: number; relativeDepth?: number; faceDepthSpan?: number;
};
/** A tip-driven tongue pose (personal tip model or the declared demo). */
export type TongueTipObservation = { trackingMode?: 'tip'; observedAt?: number; confidence?: number; tip3D?: {x:number;y:number;z:number;depthSource:'learned'|'sensor'}; x: number; y: number; lateral: number; lift: number; visibleFraction: number; extension?: number; elevation?: number; curl?: number; tip?: Landmark };
/** A detected visible-tongue box in normalized image coordinates [xMin,yMin,xMax,yMax]. It has no tip, pose or depth fields, so no consumer can read it as one. */
export type TongueRegionObservation = { trackingMode: 'region'; observedAt: number; confidence: number; box: [number, number, number, number] };
export type TongueObservation = TongueTipObservation | TongueRegionObservation;
/** capability names the loaded model; abstained is true only while the model's current result found nothing. */
export type TongueDiagnostic = {state:'unselected'|'selected'|'tracking'|'lost';reason:string;score?:number;margin?:number;capability?:'region'|'tip';abstained?:boolean};
export type TrackingFrame = {
  tongueDiagnostic?: TongueDiagnostic;
  tongue?: TongueObservation;
  tongueStatus?: string;
  tongueSearch?: { x: number; y: number; width: number; height: number };
  face: Landmark[]; pose: Landmark[]; metrics: Metrics; timestamp: number;
  worldPose?: Landmark[];
  blendshapes?: Record<string, number>;
  faceTransform?: number[];
};
export type TrackingStatus = 'idle' | 'loading' | 'tracking' | 'no-face' | 'error';
export type Tip = { id: string; title: string; detail: string; severity: 'focus' | 'adjust' | 'good'; region: BodyRegion; score: number; muscles?: string[] };
