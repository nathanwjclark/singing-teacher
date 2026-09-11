/** A result becomes current on the first frame after it arrives, not at the frame it was computed from.
 * It stays current for its own inference latency plus a grace period, so the next result can replace it
 * on slow devices, while a stalled model still expires. observedAt remains the acquisition time for lag reporting. */
export function resultCurrent(result:{observedAt:number;arrivedAt:number},now:number,grace:number){
 return now-result.arrivedAt<grace+Math.max(0,result.arrivedAt-result.observedAt);
}
