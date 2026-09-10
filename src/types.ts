export type Landmark = { x: number; y: number; z?: number; visibility?: number };
export type BodyRegion = 'jaw' | 'neck' | 'shoulders' | 'lips' | 'chest' | 'torso' | 'general';
export type Metrics = {
  mouthOpen: number; headTilt: number; shoulderTilt: number; brightness: number; motion: number;
  headYaw?: number; headPitch?: number; shoulderDepth?: number; torsoLean?: number;
  lipWidth?: number; jawAsymmetry?: number; shoulderElevation?: number;
  distanceCm?: number; relativeDepth?: number; faceDepthSpan?: number;
};
export type TongueObservation = { trackingMode?: 'region' | 'tip'; x: number; y: number; lateral: number; lift: number; visibleFraction: number; extension?: number; elevation?: number; tip?: Landmark; outline?: Landmark[] };
export type TrackingFrame = {
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
