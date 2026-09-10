import type { ProbeAttempt } from '../../contracts/probes.ts'
export const EXTRACTOR_VERSION='repeated-drive-response-1.0.0'
/** In-place radix-2 transform; forward is unnormalized, inverse divides by N. */
function fft(re:Float64Array,im:Float64Array,inverse=false){
 const n=re.length
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}
 for(let size=2;size<=n;size*=2){const angle=(inverse?2:-2)*Math.PI/size;for(let start=0;start<n;start+=size)for(let j=0;j<size/2;j++){const c=Math.cos(angle*j),s=Math.sin(angle*j),a=start+j,b=a+size/2,tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}
export function extractProbeResponse(drive:Float64Array,received:Float64Array,attempt:ProbeAttempt){
 const segments=attempt.segments
 if(!segments.length)throw Error('No complete repeated segments')
 const length=segments[0].sampleCount
 if(segments.some(s=>s.sampleCount!==length))throw Error('Repeated windows must have equal lengths')
 if(length<64||length>262144)throw Error('Unsupported response window length')
 const n=2**Math.ceil(Math.log2(length)),bins=n/2+1,rate=attempt.sampleRateHz,count=segments.length
 const xx=new Float64Array(bins),yy=new Float64Array(bins),yxR=new Float64Array(bins),yxI=new Float64Array(bins)
 const repeats:{xr:Float64Array;xi:Float64Array;yr:Float64Array;yi:Float64Array}[]=[]
 // Rectangular full-event windows preserve LTI convolution. Native envelopes belong to exact drive.
 for(const segment of segments){
  if(segment.receivedStartSample===null)throw Error('Missing received sample alignment')
  const xr=new Float64Array(n),xi=new Float64Array(n),yr=new Float64Array(n),yi=new Float64Array(n)
  xr.set(drive.subarray(segment.driveStartSample,segment.driveStartSample+length));yr.set(received.subarray(segment.receivedStartSample,segment.receivedStartSample+length));fft(xr,xi);fft(yr,yi)
  for(let k=0;k<bins;k++){xx[k]+=(xr[k]**2+xi[k]**2)/count;yy[k]+=(yr[k]**2+yi[k]**2)/count;yxR[k]+=(yr[k]*xr[k]+yi[k]*xi[k])/count;yxI[k]+=(yi[k]*xr[k]-yr[k]*xi[k])/count}
  repeats.push({xr,xi,yr,yi})
 }
 const maxPower=xx.reduce((a,b)=>Math.max(a,b),0),epsilon=Math.max(1e-20,maxPower*1e-8)
 const real=new Float64Array(bins),imag=new Float64Array(bins),coherence:(number|null)[]=[],relativeStd:(number|null)[]=[],valid:boolean[]=[],frequencyHz:number[]=[]
 let clippedSamples=0;for(const sample of received)if(Math.abs(sample)>=.999)clippedSamples++
 const flags:string[]=[];if(count<2)flags.push('At least two repeated segments required; coherence unavailable')
 if(clippedSamples)flags.push('Received PCM saturation detected')
 if(attempt.timing.support!=='sample-aligned')flags.push('Unverified playback alignment; absolute phase and time-of-flight unsupported')
 if(attempt.failures?.length)flags.push(...attempt.failures)
 flags.push('Hardware processing/nonlinearity uncharacterized; digital drive is not incident acoustic pressure')
 let signal=0,noise=0
 for(let k=0;k<bins;k++){
  real[k]=yxR[k]/(xx[k]+epsilon);imag[k]=yxI[k]/(xx[k]+epsilon)
  const c=count>1?Math.max(0,Math.min(1,(yxR[k]**2+yxI[k]**2)/Math.max(1e-30,xx[k]*yy[k]))):null
  let variance=0
  for(const r of repeats){const p=r.xr[k]**2+r.xi[k]**2+epsilon,hr=(r.yr[k]*r.xr[k]+r.yi[k]*r.xi[k])/p,hi=(r.yi[k]*r.xr[k]-r.yr[k]*r.xi[k])/p;variance+=(hr-real[k])**2+(hi-imag[k])**2}
  const std=count>1?Math.sqrt(variance/(count-1))/Math.max(1e-12,Math.hypot(real[k],imag[k])):null
  const f=k*rate/n,inBand=f>=attempt.protocol.bandHz[0]&&f<=attempt.protocol.bandHz[1],supported=inBand&&xx[k]>maxPower*1e-5
  frequencyHz.push(f);coherence.push(c);relativeStd.push(std);valid.push(supported&&count>=2&&!clippedSamples&&!attempt.failures?.length&&c!==null&&c>=.6&&std!==null&&std<=1)
  if(supported&&c!==null){signal+=yy[k]*c;noise+=yy[k]*(1-c)}
 }
 const irR=new Float64Array(n),irI=new Float64Array(n)
 for(let k=0;k<bins;k++){irR[k]=real[k];irI[k]=imag[k]}
 for(let k=1;k<bins-1;k++){irR[n-k]=real[k];irI[n-k]=-imag[k]};fft(irR,irI,true)
 const full={frequencyHz,real:Array.from(real),imag:Array.from(imag),coherence,relativeStd,valid}
 // Nonoverlapping aggregates document frequency correlation; never count FFT bins as independent observations.
 const response={frequencyHz:[] as number[],real:[] as number[],imag:[] as number[],magnitude:[] as number[],coherence:[] as (number|null)[],relativeStd:[] as (number|null)[],valid:[] as boolean[]}
 const first=Math.ceil(attempt.protocol.bandHz[0]*n/rate),last=Math.min(bins-1,Math.floor(attempt.protocol.bandHz[1]*n/rate)),step=Math.max(1,Math.ceil((last-first+1)/128))
 for(let start=first;start<=last;start+=step){const end=Math.min(last+1,start+step),size=end-start;let re=0,im=0,mag=0,co=0,sd=0,ok=0;for(let k=start;k<end;k++){re+=real[k];im+=imag[k];mag+=Math.hypot(real[k],imag[k]);co+=coherence[k]??0;sd+=relativeStd[k]??0;if(valid[k])ok++}response.frequencyHz.push((start+end-1)/2*rate/n);response.real.push(re/size);response.imag.push(im/size);response.magnitude.push(mag/size);response.coherence.push(count>1?co/size:null);response.relativeStd.push(count>1?sd/size:null);response.valid.push(ok/size>=.8)}
 const good=response.frequencyHz.filter((_,i)=>response.valid[i])
 return{full,response,impulse:Array.from(irR),configuration:{fftSize:n,window:'rectangular-full-event',normalization:'mean cross/power spectra; forward FFT unnormalized; inverse FFT / N',regularization:epsilon,regularizationRule:'max drive spectral power * 1e-8',minimumDrivePowerFraction:1e-5,minimumCoherence:.6,maximumRelativeStd:1,summaryAggregation:'nonoverlapping frequency bands; magnitude averaged separately; bins not independent evidence',arbitraryDirectPathGating:false},quality:{repeats:count,clippedSamples,snrDb:signal>0&&noise>=0?10*Math.log10(signal/Math.max(noise,1e-20)):null,flags,validBandHz:good.length?[good[0],good[good.length-1]] as [number,number]:null}}
}
