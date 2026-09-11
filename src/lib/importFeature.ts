/** Loads a feature's code on first use. A browser keeps a failed dynamic import for the rest of the page's
 * life, so trying again in place fails the same way; the error says to reload and keeps the browser's
 * error as its cause. Nothing reloads automatically, because a recording may be running. */
export function importFeature<T>(feature:string,load:()=>Promise<T>):Promise<T>{
 return load().catch(error=>{throw new Error(`${feature} could not be loaded. Reload the page to try again.`,{cause:error});});
}
