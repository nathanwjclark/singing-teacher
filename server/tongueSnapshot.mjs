const finite=v=>typeof v==='number'&&Number.isFinite(v),unit=v=>finite(v)&&v>=0&&v<=1;
const only=(value,keys)=>Object.keys(value).every(k=>keys.includes(k));
const tipFields=['trackingMode','x','y','lateral','lift','visibleFraction','observedAt','confidence','extension','elevation','curl','tip','tip3D'];
/** Phone snapshots: landmarks.tongue is either null or a well-formed tip; a visible-region box travels only as visibleTongueRegion. */
export function tongueSnapshotError(tongue,region){
 if(tongue!=null&&!(typeof tongue==='object'&&tongue.trackingMode==='tip'&&only(tongue,tipFields)&&unit(tongue.x)&&unit(tongue.y)&&[tongue.lateral,tongue.lift,tongue.visibleFraction].every(finite)
  &&['observedAt','confidence','extension','elevation','curl'].every(k=>tongue[k]===undefined||finite(tongue[k]))
  &&(tongue.tip===undefined||(tongue.tip&&typeof tongue.tip==='object'&&only(tongue.tip,['x','y','z','visibility'])&&unit(tongue.tip.x)&&unit(tongue.tip.y)))
  &&(tongue.tip3D===undefined||(tongue.tip3D&&typeof tongue.tip3D==='object'&&only(tongue.tip3D,['x','y','z','depthSource'])&&[tongue.tip3D.x,tongue.tip3D.y,tongue.tip3D.z].every(finite)&&['learned','sensor'].includes(tongue.tip3D.depthSource)))))
  return 'A tongue landmark must be a tip observation; send a region box as visibleTongueRegion';
 const box=region?.box;
 if(region!=null&&!(typeof region==='object'&&region.trackingMode==='region'&&only(region,['trackingMode','box','confidence','observedAt'])&&Array.isArray(box)&&box.length===4&&box.every(unit)&&box[2]>box[0]&&box[3]>box[1]&&finite(region.confidence)&&finite(region.observedAt)))
  return 'Invalid visible tongue region';
 return null;
}
