import { measurePhonation } from './measure.ts';
import type { PhonationMetadata } from './types.ts';
self.onmessage = async (event: MessageEvent<{id:string;pcm:Float32Array;sampleRate:number;metadata:PhonationMetadata}>) => {
 const {id,pcm,sampleRate,metadata}=event.data;
 try { self.postMessage({id,observation:await measurePhonation(pcm,sampleRate,metadata)}); }
 catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Invalid phonation request'});}
};
