export type Landmark = { x: number; y: number; z?: number; visibility?: number };
export type Metrics = { mouthOpen: number; headTilt: number; shoulderTilt: number; brightness: number; motion: number };
export type TrackingFrame = { face: Landmark[]; pose: Landmark[]; metrics: Metrics; timestamp: number };
export type TrackingStatus = 'idle' | 'loading' | 'tracking' | 'no-face' | 'error';
export type Tip = { id: string; title: string; detail: string; severity: 'focus' | 'adjust' | 'good'; region: 'jaw' | 'neck' | 'shoulders' | 'general'; score: number };
