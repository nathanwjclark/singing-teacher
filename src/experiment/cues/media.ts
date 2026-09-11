import type { LearningPitchSample } from './types.ts'
import { detectPitch, audioFrameSize } from '../../lib/audio.ts'
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('singing-teacher-learning-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('media');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
export async function storeLearningMedia(id:string,blob:Blob){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').put(blob,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export async function readLearningMedia(id:string):Promise<Blob|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('media').objectStore('media').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{db.close()}}
export async function extractLearningPitch(blob:Blob, melodic=false):Promise<LearningPitchSample[]>{
 const context=new AudioContext()
 try{
  const buffer=await context.decodeAudioData(await blob.arrayBuffer()), mono=new Float32Array(buffer.length)
  for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++)mono[i]+=data[i]/buffer.numberOfChannels}
  const frames:LearningPitchSample[]=[], size=melodic?audioFrameSize(buffer.sampleRate):4096, hop=Math.round(buffer.sampleRate*.1)
  for(let i=0;i+size<=mono.length;i+=hop){
   const data=mono.subarray(i,i+size), valid=data.every(Number.isFinite), result=valid?detectPitch(data,buffer.sampleRate):{pitchHz:null,periodicity:null}
   frames.push(melodic?{offsetMs:(i+size/2)/buffer.sampleRate*1000,hz:result.pitchHz,status:!valid?'rejected':result.pitchHz===null?'unvoiced':'voiced',reason:!valid?'Nonfinite PCM':result.pitchHz===null?'Quiet, aperiodic or outside supported pitch range':null,windowMs:size/buffer.sampleRate*1000}:{offsetMs:i/buffer.sampleRate*1000,hz:result.pitchHz})
  }
  return frames
 }finally{await context.close()}
}
