#!/usr/bin/env python3
"""Private calibrated RGB-D diagnostic. Requires numpy and Pillow; no uploads/fusion."""
import argparse, base64, importlib.util, io, json, math, zipfile
from pathlib import Path
import numpy as np
from PIL import Image


def radial(points, calibration, size, inverse=False):
    """Apple header mapping: inverse LUT maps distorted samples to rectilinear rays."""
    ref = np.array(calibration['intrinsic_reference_dimensions'], float)
    scale = np.array(size) / ref
    center = np.array(calibration['lens_distortion_center']) * scale
    key = ('inverse_' if inverse else '') + 'lens_distortion_table_base64'
    table = np.frombuffer(base64.b64decode(calibration[key]), dtype='<f4')
    if len(table) < 2 or not np.isfinite(table).all():
        raise ValueError('Missing or invalid radial calibration table')
    if not np.isclose(scale[0], scale[1], rtol=1e-5):
        raise ValueError('Unsupported calibration crop/aspect ratio')
    vector = np.asarray(points) - center
    radius = np.linalg.norm(vector, axis=-1)
    max_radius = np.linalg.norm(np.maximum(center, np.array(size)-center))
    mag = np.interp(radius / max_radius * (len(table)-1), np.arange(len(table)), table)
    return center + vector * (1 + mag[..., None])


def project(depth, calibration):
    h, w = depth.shape
    y, x = np.indices((h, w))
    # Native pixel centers, consistently scaled into calibration coordinates.
    points = np.stack((x+.5, y+.5), axis=-1)
    rect = radial(points, calibration, (w, h), inverse=True)
    k = np.array(calibration['intrinsics_row_major'], float)
    k[0] *= w / calibration['intrinsic_reference_dimensions'][0]
    k[1] *= h / calibration['intrinsic_reference_dimensions'][1]
    rays = np.concatenate((rect, np.ones((h,w,1))),axis=-1) @ np.linalg.inv(k).T
    return rays * depth[...,None], rect, points


def track(gray, template, origin, radius=22):
    x,y = origin; h,w = template.shape
    search=gray[y-radius:y+h+radius,x-radius:x+w+radius]
    windows=np.lib.stride_tricks.sliding_window_view(search,(h,w))
    a=windows-windows.mean(axis=(-2,-1),keepdims=True)
    b=template-template.mean()
    scores=(a*b).sum(axis=(-2,-1))/np.maximum(1e-9,np.sqrt((a*a).sum(axis=(-2,-1))*(b*b).sum()))
    dy,dx=np.unravel_index(np.argmax(scores),scores.shape)
    return int(dx-radius),int(dy-radius),float(scores[dy,dx])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_zip',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--regions',type=Path,required=True,help='Private manual-region JSON bound to capture_id')
    args=parser.parse_args();out=args.output
    if out.exists(): raise ValueError('Output already exists; choose a new private directory')
    # Validate archive paths, hashes, dimensions, and timestamps before consuming it.
    spec=importlib.util.spec_from_file_location('review',Path(__file__).with_name('review-native-depth.py'))
    reviewer=importlib.util.module_from_spec(spec);spec.loader.exec_module(reviewer)
    reviewer.review(args.capture_zip)
    archive=zipfile.ZipFile(args.capture_zip)
    manifest_name=next(n for n in archive.namelist() if n.endswith('manifest.json'))
    prefix=manifest_name[:-len('manifest.json')];manifest=json.loads(archive.read(manifest_name))
    frames=[f for f in manifest['frames'] if f.get('rgb') and f.get('depth')]
    if not frames: raise ValueError('No paired frames')
    if manifest['device']['output_mirrored'] or frames[0]['depth_dimensions'] != [320,180]:
        raise ValueError('This manually annotated diagnostic requires unmirrored 320×180 depth')
    # Explicit capture-specific manual regions. Never silently reuse on another participant.
    annotation=json.loads(args.regions.read_text())
    if manifest['capture_id'] != annotation['capture_id']:
        raise ValueError('Manual regions are specific to the first capture; annotate new captures before use')
    def load(f):
        rgb=np.asarray(Image.open(io.BytesIO(archive.read(prefix+f['rgb']['path']))).convert('RGB').resize((320,180),Image.Resampling.BOX))
        depth=np.frombuffer(archive.read(prefix+f['depth']['path']),dtype='<f4').reshape(180,320)
        return rgb,depth
    mid=next(i for i,f in enumerate(frames) if f['sequence']==annotation['reference_frame'])
    reference,_=load(frames[mid]);gray=reference.mean(axis=2)
    tx0,ty0,tx1,ty1=annotation['tracking_template_xyxy']
    if not (22<=tx0<tx1<=298 and 22<=ty0<ty1<=158): raise ValueError('Tracking template must leave search margins')
    origin=(tx0,ty0);template=gray[ty0:ty1,tx0:tx1]
    # Coordinates in native depth pixels, corresponding to the manually inspected RGB plate.
    regions=annotation['regions_xyxy']
    if set(regions)!={'mouth','tongue','cheek'}: raise ValueError('Expected mouth/tongue/cheek regions')
    for x0,y0,x1,y1 in regions.values():
        if not (22<=x0<x1<=298 and 22<=y0<y1<=158): raise ValueError('Region must leave tracking margins')
    chosen=set(np.linspace(0,len(frames)-1,9,dtype=int).tolist()+[mid])
    rows=[];previews=[];max_shift=0.;roundtrip=0.;ref_depth=None
    out.mkdir(parents=True)
    for i,f in enumerate(frames):
        rgb,d=load(f);dx,dy,score=track(rgb.mean(axis=2),template,origin)
        if abs(dx)>=22 or abs(dy)>=22: score=0. # search boundary is not a trustworthy correspondence
        xyz,rect,native=project(d,f['calibration'])
        shift=np.linalg.norm(rect-native,axis=-1)
        round_trip=radial(rect,f['calibration'],(320,180))-native
        roundtrip=max(roundtrip,float(np.linalg.norm(round_trip,axis=-1).max()))
        max_shift=max(max_shift,float(shift.max()))
        row={'frame':f['sequence'],'seconds':f['relative_seconds'],'shift_depth_pixels':[dx,dy],'tracking_ncc':score,'regions':{}}
        for name,(x0,y0,x1,y1) in regions.items():
            patch=d[y0+dy:y1+dy,x0+dx:x1+dx];valid=np.isfinite(patch)&(patch>0)
            samples=patch[valid]
            row['regions'][name]={'valid_fraction':float(valid.mean()),'median_m':float(np.median(samples)) if len(samples) else None,'p10_p90_m':np.quantile(samples,[.1,.9]).tolist() if len(samples) else None}
        rows.append(row)
        if i==mid: ref_depth=d.copy()
        if i in chosen:
            # Wider mouth context. No interpolation of missing samples or depth filling.
            bx0,by0,bx1,by1=annotation['preview_xyxy']
            if not (22<=bx0<bx1<=298 and 22<=by0<by1<=158): raise ValueError('Preview region must leave tracking margins')
            x0,y0,x1,y1=bx0+dx,by0+dy,bx1+dx,by1+dy
            cloud=xyz[y0:y1,x0:x1];colors=rgb[y0:y1,x0:x1]
            valid=np.isfinite(cloud).all(axis=2)&(cloud[...,2]>.08)&(cloud[...,2]<.5)
            points=cloud[valid];cols=colors[valid]
            item={'frame':f['sequence'],'seconds':round(f['relative_seconds'],3),'points':np.round(points*1000,3).tolist(),'colors':cols.tolist(),'regions':row['regions'],'tracking_ncc':score,'dx':dx,'dy':dy}
            # Only local triangles with short edges and small depth jumps; holes stay holes.
            index=np.full(valid.shape,-1,int);index[valid]=np.arange(valid.sum());tri=[]
            for yy in range(valid.shape[0]-1):
                for xx in range(valid.shape[1]-1):
                    for corners in [((yy,xx),(yy,xx+1),(yy+1,xx)),((yy+1,xx),(yy,xx+1),(yy+1,xx+1))]:
                        ids=[int(index[a,b]) for a,b in corners]
                        if min(ids)<0:continue
                        pts=points[ids]
                        if np.ptp(pts[:,2])>.004 or max(np.linalg.norm(pts[a]-pts[b]) for a,b in [(0,1),(1,2),(2,0)])>.005:continue
                        tri.append(ids)
            item['triangles']=tri
            image=Image.fromarray(rgb).resize((960,540),Image.Resampling.NEAREST)
            buf=io.BytesIO();image.save(buf,format='JPEG',quality=85);item['rgb']='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
            norm=np.clip((d-.14)/.16,0,1);norm=np.nan_to_num(norm,nan=0,posinf=1,neginf=0)
            heat=np.stack((np.clip(2*norm,0,1),1-np.abs(2*norm-1),np.clip(2*(1-norm),0,1)),axis=-1)
            heat[~np.isfinite(d)|(d<=0)]=0
            buf=io.BytesIO();Image.fromarray((heat*255).astype('uint8')).save(buf,format='PNG');item['heat']='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
            previews.append(item)
            if i==mid:
                with (out/'mouth-surface.ply').open('w') as ply:
                    ply.write('ply\nformat ascii 1.0\ncomment Single-frame rectified visible RGB-D surface; meters; holes not filled\n')
                    ply.write(f'element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face {len(tri)}\nproperty list uchar int vertex_indices\nend_header\n')
                    for point,color in zip(points,cols):ply.write(' '.join(map(str,[*point,*color]))+'\n')
                    for face in tri:ply.write('3 '+' '.join(map(str,face))+'\n')
    # Temporal residuals after tracked XY translation and robust cheek depth offset.
    reference_row=rows[mid]
    for f,row in zip(frames,rows):
        _,d=load(f);dx,dy=row['shift_depth_pixels']
        zoffset=row['regions']['cheek']['median_m']-reference_row['regions']['cheek']['median_m']
        for name,(x0,y0,x1,y1) in regions.items():
            a=d[y0+dy:y1+dy,x0+dx:x1+dx];b=ref_depth[y0:y1,x0:x1];valid=np.isfinite(a)&np.isfinite(b)&(a>0)&(b>0)
            residual=np.abs(a[valid]-b[valid]-zoffset)*1000
            row['regions'][name]['median_absolute_residual_mm']=float(np.median(residual)) if len(residual) else None
    good=[r for r in rows if r['tracking_ncc']>=.8]
    if not good: raise ValueError('No frames passed tracking; revise manual reference')
    summaries={}
    for name in regions:
        summaries[name]={'valid_fraction_range':[min(r['regions'][name]['valid_fraction'] for r in good),max(r['regions'][name]['valid_fraction'] for r in good)],'median_absolute_temporal_residual_mm':float(np.median([r['regions'][name]['median_absolute_residual_mm'] for r in good if r['regions'][name]['median_absolute_residual_mm'] is not None]))}
    result={'capture_id':manifest['capture_id'],'paired_frames':len(frames),'tracked_frames_ncc_at_least_0_8':len(good),'depth_size':[320,180],'max_ray_rectification_pixels':max_shift,'max_lut_roundtrip_pixels':roundtrip,'regions':summaries,'frames':rows,'manual_regions_reference_frame':frames[mid]['sequence'],'manual_regions_native_depth_xyxy':regions,'limitations':['RGB/depth image-space registration follows AVDepthData contract; no independent alignment target was captured.','Nearest native RGB/depth correspondence; lens rays corrected with inverse LUT per Apple SDK header.','Temporal residual mixes true articulation, rigid motion/rotation, correspondence error and sensor noise; not a noise estimate.','Single-frame surface only; no temporal fusion, hole filling, hidden tissue or fitted anatomy.','Manual mouth/tongue rectangles and face translation are approximate; not anatomical segmentation.','Pixel-center scaling and axial Z pinhole backprojection; independent metric scale/accuracy validation remains outstanding.']}
    (out/'analysis.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    (out/'preview-data.json').write_text(json.dumps({'samples':previews,'analysis':result},separators=(',',':'),allow_nan=False))
    template=Path(__file__).with_name('native-depth-preview.html').read_text()
    (out/'index.html').write_text(template.replace('__PREVIEW_DATA__',json.dumps({'samples':previews,'analysis':result},separators=(',',':'),allow_nan=False)))
    print(json.dumps({k:v for k,v in result.items() if k!='frames'},indent=2))

if __name__=='__main__': main()
