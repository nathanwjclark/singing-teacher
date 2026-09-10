import type { TrackingFrame, Landmark } from '../types'
import type { MotionSample, MotionPhase, MotionObservation } from '../contracts/learning'
const valid = (p?: Landmark) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility >= .5)
/** Separate a declared 2D rigid image estimate; never convert MediaPipe z into depth. */
export function motionSample(frame: TrackingFrame, originMs: number, repetition: number, phase: MotionPhase, previousTimestamp?: number): MotionSample {
  const left = frame.face[33], right = frame.face[263]
  const dx = right?.x - left?.x, dy = right?.y - left?.y, scale = Math.hypot(dx, dy)
  const head = valid(left) && valid(right) && scale > .01 ? { center: [(left.x + right.x) / 2, (left.y + right.y) / 2] as [number,number], rollRadians: Math.atan2(dy,dx), scale, method: 'outer-eye-image-similarity' as const } : null
  const landmarks: [string, Landmark | undefined][] = [['upper_lip',frame.face[13]],['lower_lip',frame.face[14]],['mouth_left',frame.face[61]],['mouth_right',frame.face[291]],['tongue_tip',frame.tongue?.trackingMode === 'tip' ? frame.tongue.tip : undefined]]
  return { id: crypto.randomUUID(), captureMs: Math.max(0,frame.timestamp-originMs), sourceTimestampMs: frame.timestamp, repetition, phase, head, gapBefore: previousTimestamp !== undefined && frame.timestamp-previousTimestamp > 250, points: landmarks.map(([name,p]) => {
    if(!valid(p)) return {name,image:null,headRelative:null,visibility:'missing',reason: name === 'tongue_tip' ? 'tip-not-tracked' : 'landmark-not-visible',confidence:null}
    const x=p!.x-(head?.center[0]??0),y=p!.y-(head?.center[1]??0),c=Math.cos(head?.rollRadians??0),s=Math.sin(head?.rollRadians??0)
    return {name,image:[p!.x,p!.y],headRelative:head?[(x*c+y*s)/head.scale,(-x*s+y*c)/head.scale]:null,visibility:'estimated-visible',reason:head?null:'head-reference-missing',confidence:p!.visibility??null}
  }) }
}
export function observedEnvelope(samples: MotionSample[]): MotionObservation['observedEnvelope'] {
  return ['upper_lip','lower_lip','mouth_left','mouth_right','tongue_tip'].flatMap(name=>{
    const points=samples.flatMap(s=>s.points.filter(p=>p.name===name&&p.headRelative).map(p=>p.headRelative!))
    return points.length ? [{name,min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))] as [number,number],max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as [number,number],samples:points.length}] : []
  })
}
export function phaseAt(elapsedMs:number):{repetition:number;phase:MotionPhase;done:boolean}{
  const repetition=Math.min(3,Math.floor(elapsedMs/7000)+1), t=Math.min(Math.max(0,elapsedMs),20999)%7000
  return {repetition,phase:t<2000?'neutral':t<5000?'gesture':'return',done:elapsedMs>=21000}
}

/** Bind visible-motion evidence to the exact retained video bytes. */
export async function motionMediaBinding(blob: Blob): Promise<{sha256:string;byteLength:number}> {
 if (!blob.size) throw new Error('Recorder returned empty media')
 const bytes=await blob.arrayBuffer()
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),byteLength:blob.size}
}
export async function verifyMotionMedia(media: MotionObservation['media'],blob:Blob):Promise<void>{
 if(!media?.sha256||media.byteLength===undefined)throw new Error('This JSON has no media integrity binding. Legacy landmarks can be replayed, but a companion video cannot be verified.')
 if(blob.size!==media.byteLength)throw new Error('Companion video byte length does not match this motion capture')
 const binding=await motionMediaBinding(blob)
 if(binding.sha256!==media.sha256)throw new Error('Companion video SHA-256 does not match this motion capture')
}
