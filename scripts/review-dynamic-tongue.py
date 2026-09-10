#!/usr/bin/env python3
"""Offline head-stabilized visible tongue tracking; no live model or hidden anatomy."""
import argparse,base64,hashlib,io,json,zipfile
from pathlib import Path
import cv2
import numpy as np
from scipy.spatial.transform import Rotation
import importlib.util

def module(name):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def rigid(source,target):
 a=source.mean(0);b=target.mean(0);u,_,vt=np.linalg.svd((source-a).T@(target-b));r=vt.T@u.T
 if np.linalg.det(r)<0:vt[-1]*=-1;r=vt.T@u.T
 return r,b-r@a

def robust_rigid(source,target,seed=19):
 if len(source)<12:return None
 rng=np.random.default_rng(seed);best=np.zeros(len(source),bool)
 for _ in range(150):
  ids=rng.choice(len(source),3,replace=False)
  if np.linalg.norm(np.cross(source[ids[1]]-source[ids[0]],source[ids[2]]-source[ids[0]]))<4:continue
  r,t=rigid(source[ids],target[ids]);inliers=np.linalg.norm(source@r.T+t-target,axis=1)<4
  if inliers.sum()>best.sum():best=inliers
 if best.sum()<12:return None
 r,t=rigid(source[best],target[best]);return r,t,best

def sampled_points(depth,uv,calibration,preview):
 # UV in 640x360 RGB coordinates; depth rays use exact native sample center.
 ij=np.floor(uv/2).astype(int);inside=(ij[:,0]>=0)&(ij[:,0]<320)&(ij[:,1]>=0)&(ij[:,1]<180);ij=np.clip(ij,[0,0],[319,179]);d=depth[ij[:,1],ij[:,0]]
 rect=preview.radial(ij+.5,calibration,(320,180),inverse=True);k=np.array(calibration['intrinsics_row_major'],float);k[0]*=320/calibration['intrinsic_reference_dimensions'][0];k[1]*=180/calibration['intrinsic_reference_dimensions'][1]
 xyz=np.c_[rect,np.ones(len(rect))]@np.linalg.inv(k).T*d[:,None]*1000
 valid=inside&np.isfinite(xyz).all(1)&(d>.08)&(d<.6)
 return xyz,valid

def uri(image):
 ok,buf=cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,85]);assert ok;return 'data:image/jpeg;base64,'+base64.b64encode(buf).decode()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('capture_zip',type=Path);p.add_argument('--annotations',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 if args.output.exists():raise ValueError('Choose a new private output directory')
 preview=module('preview-native-depth');fit=module('fit-native-tongue');module('review-native-depth').review(args.capture_zip)
 ann=json.loads(args.annotations.read_text());z=zipfile.ZipFile(args.capture_zip);mn=next(n for n in z.namelist() if n.endswith('manifest.json'));prefix=mn[:-13];manifest=json.loads(z.read(mn))
 if manifest['capture_id']!=ann['capture_id'] or manifest['device']['output_mirrored']:raise ValueError('Annotation/capture mismatch')
 frames=[f for f in manifest['frames'] if f.get('rgb') and f.get('depth')]
 if any(f['depth_dimensions']!=[320,180] for f in frames):raise ValueError('Unsupported depth geometry')
 images=[];depths=[]
 for f in frames:
  image=cv2.imdecode(np.frombuffer(z.read(prefix+f['rgb']['path']),np.uint8),cv2.IMREAD_COLOR);images.append(cv2.resize(image,(640,360),interpolation=cv2.INTER_AREA));depths.append(np.frombuffer(z.read(prefix+f['depth']['path']),'<f4').reshape(180,320))
 grays=[cv2.cvtColor(im,cv2.COLOR_BGR2GRAY) for im in images];refidx=next(i for i,f in enumerate(frames) if f['sequence']==ann['seed_frame']);ref=frames[refidx];refgray=grays[refidx]
 face=np.zeros((360,640),np.uint8)
 for x0,y0,x1,y1 in ann['face_regions_depth_xyxy']:face[y0*2:y1*2,x0*2:x1*2]=255
 # Explicitly keep the moving mouth and jaw outside all head-pose anchors.
 x0,y0,x1,y1=ann['mouth_exclusion_depth_xyxy'];face[y0*2:y1*2,x0*2:x1*2]=0
 features=cv2.goodFeaturesToTrack(refgray,maxCorners=250,qualityLevel=.005,minDistance=5,mask=face,blockSize=5)
 if features is None or len(features)<20:raise ValueError('Insufficient non-mouth face features')
 rgb_features=features.copy();rgb_reference_uv=rgb_features[:,0].copy()
 reference_uv=features[:,0];reference_xyz,refvalid=sampled_points(depths[refidx],reference_uv,ref['calibration'],preview)
 features=features[refvalid];reference_uv=reference_uv[refvalid];reference_xyz=reference_xyz[refvalid]
 if len(features)<20:raise ValueError('Insufficient face features with valid depth')
 # One manual polygon seeds correspondence; review labels below are NOT used for tracking.
 seed=np.zeros((360,640),np.uint8);polygon=np.round(np.array(ann['tongue_seed_polygon_depth_xy'])*2).astype(np.int32);cv2.fillPoly(seed,[polygon],255);seed=cv2.erode(seed,np.ones((3,3),np.uint8))
 yy,xx=np.indices((360,640),dtype=np.float32);rows=[];samples=[]
 for i,(f,gray,image,d) in enumerate(zip(frames,grays,images,depths)):
  row={'frame':f['sequence'],'seconds':f['relative_seconds'],'head':{},'head_rgb':{},'tongue':{}}
  rgb_next,rgb_ok,_=cv2.calcOpticalFlowPyrLK(refgray,gray,rgb_features,None,winSize=(21,21),maxLevel=3)
  rgb_back,rgb_bok,_=cv2.calcOpticalFlowPyrLK(gray,refgray,rgb_next,None,winSize=(21,21),maxLevel=3)
  rgb_valid=rgb_ok.ravel().astype(bool)&rgb_bok.ravel().astype(bool)&(np.linalg.norm(rgb_back[:,0]-rgb_reference_uv,axis=1)<.8)
  rgb_ids=np.flatnonzero(rgb_valid);rgb_train=rgb_ids[rgb_ids%5!=0];rgb_test=rgb_ids[rgb_ids%5==0];affine=None
  if len(rgb_train)>=12 and len(rgb_test)>=6:
   affine,inliers_rgb=cv2.estimateAffinePartial2D(rgb_next[rgb_train,0],rgb_reference_uv[rgb_train],method=cv2.RANSAC,ransacReprojThreshold=2,maxIters=1000,confidence=.99)
   if affine is not None:
    predicted_rgb=rgb_next[rgb_test,0]@affine[:,:2].T+affine[:,2]
    rgb_error=float(np.median(np.linalg.norm(predicted_rgb-rgb_reference_uv[rgb_test],axis=1)))
    row['head_rgb']={'valid':int(inliers_rgb.sum())>=12 and rgb_error<2,'kind':'2D similarity only; not 3D pose','independent_check_median_pixels_640':rgb_error,'inliers':int(inliers_rgb.sum()),'independent_check_anchors':len(rgb_test),'current_to_reference_affine':affine.tolist()}
  if not row['head_rgb']:row['head_rgb']={'valid':False,'reason':'insufficient independent RGB face correspondences'}
  nxt,ok,_=cv2.calcOpticalFlowPyrLK(refgray,gray,features,None,winSize=(21,21),maxLevel=3)
  back,bok,_=cv2.calcOpticalFlowPyrLK(gray,refgray,nxt,None,winSize=(21,21),maxLevel=3)
  xyz,valid=sampled_points(d,nxt[:,0],f['calibration'],preview);fb=np.linalg.norm(back[:,0]-reference_uv,axis=1)
  valid&=ok.ravel().astype(bool)&bok.ravel().astype(bool)&(fb<.8)
  ids=np.flatnonzero(valid);train=ids[ids%5!=0];test=ids[ids%5==0]
  estimate=robust_rigid(xyz[train],reference_xyz[train]);r=t=None
  if estimate is not None and len(test)>=4:
   r,t,inliers=estimate;before=np.linalg.norm(xyz[test]-reference_xyz[test],axis=1);after=np.linalg.norm(xyz[test]@r.T+t-reference_xyz[test],axis=1)
   row['head']={'valid':float(np.median(after))<5,'anchors':len(train),'inliers':int(inliers.sum()),'independent_check_anchors':len(test),'before_median_mm':float(np.median(before)),'after_median_mm':float(np.median(after)),'rotation_vector_radians':Rotation.from_matrix(r).as_rotvec().tolist(),'rotation_angle_degrees':float(np.linalg.norm(Rotation.from_matrix(r).as_rotvec())*180/np.pi),'translation_mm':t.tolist(),'current_to_reference_rotation':r.tolist()}
  else:row['head']={'valid':False,'reason':'insufficient independent face/depth correspondences','anchors':len(train),'independent_check_anchors':len(test)}
  # Direct reference correspondence avoids cumulative drift. Forward/back check can
  # reject occlusion, but cannot by itself establish tissue identity.
  backward=cv2.calcOpticalFlowFarneback(gray,refgray,None,.5,3,15,3,5,1.2,0)
  forward=cv2.calcOpticalFlowFarneback(refgray,gray,None,.5,3,15,3,5,1.2,0)
  mapx=xx+backward[:,:,0];mapy=yy+backward[:,:,1]
  projected=cv2.remap(seed,mapx,mapy,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)>0
  mapped_forward=cv2.remap(forward,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
  consistency=np.linalg.norm(backward+mapped_forward,axis=2)
  expected=cv2.remap(images[refidx],mapx,mapy,cv2.INTER_LINEAR).astype(float)
  rgb=image[:,:,::-1].astype(float);red,green,blue=rgb.transpose(2,0,1)
  color=(red>65)&(red>green*1.18)&(red>blue*1.15)&(red<240)
  photometric=np.mean(np.abs(image.astype(float)-expected),axis=2)
  mask=projected&(consistency<1.0)&color&(photometric<32)
  mask=cv2.morphologyEx(mask.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8)).astype(bool)
  # Keep only substantial connected overlap, never grow into neighboring lips.
  count,labels,stats,_=cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
  if count>1:mask=labels==(1+np.argmax(stats[1:,cv2.CC_STAT_AREA]))
  support=float(mask.sum()/max(1,(seed>0).sum()))
  native=cv2.resize(mask.astype(np.uint8),(320,180),interpolation=cv2.INTER_NEAREST).astype(bool)
  validdepth=np.isfinite(d)&(d>.08)&(d<.6);native&=validdepth
  n=int(native.sum());rgb_visible=support>=.5;visible=rgb_visible and n>=45
  if rgb_visible:
   my,mx=np.where(mask);uv=np.array([mx.mean(),my.mean()]);row['tongue']['centroid_camera_pixels_640']=uv.tolist()
   if row['head_rgb']['valid']:row['tongue']['centroid_head_pixels_640']=(affine[:,:2]@uv+affine[:,2]).tolist()
  row['tongue'].update({'candidate_visible':visible,'rgb_candidate_visible':rgb_visible,'depth_failure_reason':None if n>=45 else 'insufficient measured depth on the RGB tongue candidate','mask_area_ratio_to_seed':support,'depth_samples':n,'tracking_kind':'manual-seed optical-flow candidate; not semantic tongue detection'})
  overlay=image.copy();overlay[mask]=(overlay[mask]*.4+np.array([120,255,150])*.6).astype(np.uint8)
  for point in nxt[:,0][valid]:cv2.circle(overlay,tuple(np.round(point).astype(int)),2,(255,210,70),-1)
  # Preserve camera context and distinguish unseen from not measured.
  cx0,cy0,cx1,cy1=ann.get('preview_depth_xyxy',[175,50,235,115]);crop=overlay[cy0*2:cy1*2,cx0*2:cx1*2];crop=cv2.rotate(crop,cv2.ROTATE_90_CLOCKWISE)
  sample={'frame':f['sequence'],'seconds':f['relative_seconds'],'image':uri(crop),'head':row['head'],'head_rgb':row['head_rgb'],'tongue':row['tongue'],'observed':[],'fitted':[],'faces':[]}
  if visible and row['head']['valid']:
   xyzgrid,_,_=preview.project(d,f['calibration']);pts=xyzgrid[native]*1000;stabilized=pts@r.T+t
   center=stabilized[:,:2].mean(0);scale=np.maximum(stabilized[:,:2].std(0),1);design=fit.basis(stabilized[:,:2],center,scale)
   ny,nx=np.where(native);hold=(nx+2*ny)%4==0
   if (~hold).sum()>=30 and hold.sum()>=10:
    coef=fit.robust_fit(design[~hold],stabilized[~hold,2]);pred=np.einsum('ni,i->n',design,coef);error=np.abs(pred[hold]-stabilized[hold,2]);row['tongue'].update({'spatial_holdout_mae_mm':float(error.mean()),'fit_coefficients':coef.tolist(),'fit_center_xy':center.tolist(),'fit_scale_xy':scale.tolist(),'centroid_head_mm':stabilized.mean(0).tolist(),'centroid_camera_mm':pts.mean(0).tolist(),'fit_valid':float(error.mean())<=2.5})
    sample['observed']=np.round(stabilized,3).tolist();sample['fitted']=np.round(np.c_[stabilized[:,:2],pred],3).tolist()
    index=np.full((180,320),-1,int);index[native]=np.arange(n);faces=[]
    for y,x in zip(ny,nx):
     if y>=179 or x>=319:continue
     for cells in [((y,x),(y,x+1),(y+1,x)),((y+1,x),(y,x+1),(y+1,x+1))]:
      ii=[int(index[j,k]) for j,k in cells]
      if min(ii)>=0 and np.ptp(stabilized[ii,2])<4:faces.append(ii)
    sample['faces']=faces
  # Separate display of actually measured camera depth, without tissue labels,
  # registration, hole filling, or a fitted anatomical surface. Decimate grid only.
  gx0,gy0,gx1,gy1=ann['mouth_exclusion_depth_xyxy'];raw_mask=np.zeros((180,320),bool);raw_mask[gy0:gy1:2,gx0:gx1:2]=True;raw_mask&=validdepth
  raw_grid,_,_=preview.project(d,f['calibration']);raw_points=raw_grid[raw_mask]*1000
  raw_indices=np.full((180,320),-1,int);raw_indices[raw_mask]=np.arange(len(raw_points));raw_faces=[]
  ry,rx=np.where(raw_mask)
  for py,px in zip(ry,rx):
   if py>=178 or px>=318:continue
   for cells in [((py,px),(py,px+2),(py+2,px)),((py+2,px),(py,px+2),(py+2,px+2))]:
    ii=[int(raw_indices[j,k]) for j,k in cells]
    if min(ii)>=0 and np.ptp(raw_points[ii,2])<4:raw_faces.append(ii)
  sample['measured_camera_depth']={'points_mm':np.round(raw_points,3).tolist(),'faces':raw_faces,'image_crop_depth_xyxy':[gx0,gy0,gx1,gy1],'grid_stride':2,'kind':'unregistered camera-depth samples; image crop is not tissue segmentation'}
  samples.append(sample);rows.append(row)
  if i%25==0:print(f'Processed {i+1}/{len(frames)} frames',flush=True)
 # Sparse independent visual audit. This is validation only, never tracker input.
 audit=[]
 for key,label in ann['visibility_review'].items():
  row=next(r for r in rows if r['frame']==int(key));audit.append({'frame':int(key),'visually_visible':label,'candidate_visible':row['tongue']['candidate_visible'],'agrees':label==row['tongue']['candidate_visible']})
 good=[r for r in rows if r['head']['valid']];fits=[r for r in good if r['tongue'].get('fit_valid')];allfits=[r for r in good if 'spatial_holdout_mae_mm' in r['tongue']]
 report={'head_rgb_features_seeded':len(rgb_features),'head_rgb_valid_frames':sum(r['head_rgb']['valid'] for r in rows),'tongue_rgb_candidate_frames':sum(r['tongue']['rgb_candidate_visible'] for r in rows),'tongue_rgb_stabilized_frames':sum('centroid_head_pixels_640' in r['tongue'] for r in rows),'head_features_seeded':len(features),'head_valid_frames':len(good),'total_frames':len(rows),'independent_face_median_error_before_mm':float(np.median([r['head']['before_median_mm'] for r in good])) if good else None,'independent_face_median_error_after_mm':float(np.median([r['head']['after_median_mm'] for r in good])) if good else None,'tongue_candidate_frames':sum(r['tongue']['candidate_visible'] for r in rows),'surface_fit_valid_frames':len(fits),'surface_fit_evaluated_frames':len(allfits),'surface_spatial_holdout_median_all_mm':float(np.median([r['tongue']['spatial_holdout_mae_mm'] for r in allfits])) if allfits else None,'surface_spatial_holdout_median_mae_mm':float(np.median([r['tongue']['spatial_holdout_mae_mm'] for r in fits])) if fits else None,'visibility_audit':audit,'live_model_ready':False,'limitations':['RGB-only similarity correction removes estimated image-plane face motion, not perspective or 3D head pose.','Sparse manual visibility audit is not a segmentation or tip-position benchmark.','Optical flow tracks a seeded visible patch and may follow lips after occlusion.','Per-frame fitted surface changes may include sensor noise, changing visible support, or tracking error.','No hidden tongue, anatomical tip, or muscle motion is inferred.','No temporal fusion; no interpolation over failed frames.','Independent face anchors are spatially held out but share the same sensor and frame; not external accuracy validation.']}
 provenance={'capture_id':manifest['capture_id'],'seed_frame':ann['seed_frame'],'annotations_sha256':hashlib.sha256(args.annotations.read_bytes()).hexdigest(),'capture_zip_sha256':hashlib.sha256(args.capture_zip.read_bytes()).hexdigest(),'temporal_split':ann.get('temporal_split'),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'head_rgb_validation_threshold_pixels_640':2,'coordinates':'millimeters in reference camera axes, current-to-reference head transform; not anatomical coordinates'}
 args.output.mkdir(parents=True);(args.output/'analysis.json').write_text(json.dumps({'provenance':provenance,'summary':report,'frames':rows},indent=2,allow_nan=False))
 (args.output/'surfaces.json').write_text(json.dumps({'provenance':provenance,'samples':[{k:v for k,v in sample.items() if k!='image'} for sample in samples]},separators=(',',':'),allow_nan=False))
 (args.output/'index.html').write_text(Path(__file__).with_name('dynamic-tongue-preview.html').read_text().replace('__DYNAMIC_DATA__',json.dumps({'provenance':provenance,'summary':report,'samples':samples},separators=(',',':'),allow_nan=False)))
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
