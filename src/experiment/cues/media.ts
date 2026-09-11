import type { LearningPitchSample } from './types.ts'
import { detectPitch, audioFrameSize } from '../../lib/audio.ts'
import { MELODY_HOP_MS } from '../../evaluation/learning/melody.ts'
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('singing-teacher-learning-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('media');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
export async function storeLearningMedia(id:string,blob:Blob){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').put(blob,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export async function readLearningMedia(id:string):Promise<Blob|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('media').objectStore('media').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{db.close()}}
/** Single-note attempts keep 4096-sample windows every 100 ms. Melodic attempts use the sample-rate-scaled
 * analysis window every MELODY_HOP_MS, time-stamped at the window center, with voicing state per window.
 * Stored precision (0.1 ms, 0.01 Hz) is far below the hop and the 50-cent pitch criterion. */
export async function extractLearningPitch(blob:Blob, melodic=false):Promise<LearningPitchSample[]>{
 const context=new AudioContext()
 try{
  const buffer=await context.decodeAudioData(await blob.arrayBuffer()), mono=new Float32Array(buffer.length)
  for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++)mono[i]+=data[i]/buffer.numberOfChannels}
  const frames:LearningPitchSample[]=[], size=melodic?audioFrameSize(buffer.sampleRate):4096, hop=Math.round(buffer.sampleRate*(melodic?MELODY_HOP_MS:100)/1000), round=(value:number,scale:number)=>Math.round(value*scale)/scale
  for(let i=0;i+size<=mono.length;i+=hop){
   const data=mono.subarray(i,i+size), valid=data.every(Number.isFinite), hz=valid?detectPitch(data,buffer.sampleRate).pitchHz:null
   frames.push(melodic?{offsetMs:round((i+size/2)/buffer.sampleRate*1000,10),hz:hz===null?null:round(hz,100),status:!valid?'rejected':hz===null?'unvoiced':'voiced',windowMs:round(size/buffer.sampleRate*1000,10)}:{offsetMs:i/buffer.sampleRate*1000,hz})
  }
  return frames
 }finally{await context.close()}
}
/** Reference playback for declared notes: one Web Audio triangle oscillator per note with short ramps to mark note changes. */
export async function playLearningMelody(notes:{hz:number;durationMs:number}[]){
 const context=new AudioContext()
 try{
  await context.resume()
  let time=context.currentTime+.05, last:OscillatorNode|null=null
  for(const note of notes){
   const oscillator=context.createOscillator(),gain=context.createGain(),end=time+note.durationMs/1000
   oscillator.type='triangle';oscillator.frequency.value=note.hz
   gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.2,time+.02);gain.gain.setValueAtTime(.2,end-.03);gain.gain.linearRampToValueAtTime(0,end)
   oscillator.connect(gain).connect(context.destination);oscillator.start(time);oscillator.stop(end);time=end;last=oscillator
  }
  if(last)await new Promise(resolve=>{last.onended=resolve})
 }finally{await context.close()}
}
