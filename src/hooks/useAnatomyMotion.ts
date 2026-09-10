import {useEffect,useRef,useState} from 'react';
import {createAnatomyMotion} from '../lib/anatomyState';
import type {TrackingFrame} from '../types';
export function useAnatomyMotion(frame:TrackingFrame|null,demo:boolean){
 const [engine]=useState(createAnatomyMotion);
 const motion=useRef(engine.state);
 const input=useRef({frame,demo});
 useEffect(()=>{input.current={frame,demo}},[frame,demo]);
 useEffect(()=>{let id=0;const tick=(time:number)=>{motion.current=engine.update(input.current.frame,input.current.demo,time);id=requestAnimationFrame(tick)};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id)},[engine]);
 return motion;
}
