#!/usr/bin/env python3
"""Attach calibrated native depth supervision to private, manually marked tips.
No color segmentation, optical flow, or OpenCV. Invalid depth stays unlabelled.
Rows contain id (capture prefix-frame), image, crop, face and label. This is a
review utility, not an automated annotation generator or ground-truth guarantee.
"""
import argparse,json,base64,zipfile,hashlib,importlib.util
from pathlib import Path
import numpy as np
def point(uv,d,c):
 # Upright normalized -> native sensor sample center, calibrated inverse radial ray.
 u,v=uv;ix=int(v*320);iy=int((1-u)*180)
 if not 1<=ix<319 or not 1<=iy<179:return None
 patch=d[iy-1:iy+2,ix-1:ix+2];valid=np.isfinite(patch)&(patch>.08)&(patch<.6)
 if valid.sum()<6:return None
 z=float(np.median(patch[valid]));
 if float(np.ptp(patch[valid]))>.012:return None
 center=np.array(c['lens_distortion_center'])*np.array([320,180])/c['intrinsic_reference_dimensions'];vec=np.array([ix+.5,iy+.5])-center
 table=np.frombuffer(base64.b64decode(c['inverse_lens_distortion_table_base64']),'<f4');radius=np.linalg.norm(vec);mx=np.linalg.norm(np.maximum(center,np.array([320,180])-center));mag=np.interp(radius/mx*(len(table)-1),np.arange(len(table)),table)
 xy=center+vec*(1+mag);k=np.array(c['intrinsics_row_major'],float);k[0]*=320/c['intrinsic_reference_dimensions'][0];k[1]*=180/c['intrinsic_reference_dimensions'][1]
 xyz=np.linalg.inv(k)@np.r_[xy,1]*z
 return np.array([-xyz[1],-xyz[0],-xyz[2]]) # upright x-right/y-up/z-toward-camera

def main():
 p=argparse.ArgumentParser();p.add_argument('labels',type=Path);p.add_argument('--archives',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 if a.output.exists():raise ValueError('Choose a new output; preserve prior annotations')
 rows=json.loads(a.labels.read_text());archives={}
 for row in rows:
  row.pop('tip3D',None);row.pop('depthTarget',None)
  if not row.get('label'):continue
  name=row['id'];prefix,number=name.split('-');matches=list(a.archives.glob('capture-'+prefix+'*.zip'))
  if len(matches)!=1:raise ValueError('Capture prefix must identify exactly one archive')
  if prefix not in archives:
   spec=importlib.util.spec_from_file_location('review',Path(__file__).with_name('review-native-depth.py'));review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review);review.review(matches[0])
   z=zipfile.ZipFile(matches[0]);mn=next(n for n in z.namelist() if n.endswith('manifest.json'));archives[prefix]=(z,json.loads(z.read(mn)),mn[:-13])
  z,m,b=archives[prefix];f=next(f for f in m['frames'] if f['sequence']==int(number))
  d=np.frombuffer(z.read(b+f['depth']['path']),'<f4').reshape(180,320);crop=row['crop'];label=row['label'];uv=[crop['x']+label['x']*crop['width'],crop['y']+label['y']*crop['height']];tip=point(uv,d,f['calibration']);l=row['face'];ps=[point([l[i]['x'],l[i]['y']],d,f['calibration']) for i in [78,308,4]]
  if tip is None or any(x is None for x in ps):continue
  left,right,nose=ps
  if left[0]>right[0]:left,right=right,left
  span=np.linalg.norm(right-left)
  if span<.015 or span>.1:continue
  origin=(left+right)/2;ex=(right-left)/span;up=nose-origin;ey=up-ex*np.dot(up,ex)
  if np.linalg.norm(ey)<.01:continue
  ey/=np.linalg.norm(ey);ez=np.cross(ex,ey);local=np.array([np.dot(tip-origin,v) for v in [ex,ey,ez]])/span
  if not np.isfinite(local).all() or np.max(np.abs(local))>2:continue
  row['tip3D']=local.tolist();row['depthTarget']=float(local[2]);row['mouthWidthMm']=float(span*1000);row['depthEvidence']='native 3x3 median, >=6 valid samples, <=12 mm spread, inverse lens table, mouth-local basis; sparse edge support, not precision tip ground truth'
 a.output.write_text(json.dumps(rows));print(json.dumps({'rows':len(rows),'withDepth':sum('depthTarget' in r for r in rows),'labelsSha256':hashlib.sha256(a.labels.read_bytes()).hexdigest()}))
if __name__=='__main__':main()
