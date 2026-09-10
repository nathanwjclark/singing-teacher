import {useEffect,useRef,useMemo} from 'react';
import {createAnatomyMotion} from '../lib/anatomyState';
import {applyModelJaw} from '../components/science/modelAdjustments';
import type {TrackingFrame} from '../types';
export function useAnatomyMotion(frame:TrackingFrame|null,demo:boolean,resetEpoch=0){
 const engine=useMemo(()=>{void resetEpoch;return createAnatomyMotion()},[resetEpoch]);
 const motion=useRef(engine.state);
 const input=useRef({frame,demo});
 useEffect(()=>{input.current={frame,demo}},[frame,demo]);
 useEffect(()=>{let id=0;const tick=(time:number)=>{motion.current=engine.update(input.current.frame,input.current.demo,time);applyModelJaw(motion.current);id=requestAnimationFrame(tick)};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id)},[engine]);
 return motion;
}
