#!/usr/bin/env python3
"""One-frame visible tongue patch fit and frozen temporal evaluation. Private outputs only."""
import argparse,base64,hashlib,importlib.util,io,json,zipfile
from pathlib import Path
import numpy as np
from PIL import Image

def import_script(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def validate_regions(annotation, frames):
    """Require in-bounds, separately anchored tongue/face/cheek annotations."""
    if not isinstance(annotation, dict) or not isinstance(annotation.get('regions_xyxy'), dict):
        raise ValueError('Expected explicit capture-specific region annotations')
    if set(annotation['regions_xyxy']) != {'mouth','tongue','cheek'}:
        raise ValueError('Expected mouth/tongue/cheek regions')
    boxes = {'tracking_template': annotation.get('tracking_template_xyxy'), **annotation['regions_xyxy']}
    for name, box in boxes.items():
        if not isinstance(box, list) or len(box)!=4 or any(type(v) is not int for v in box):
            raise ValueError(f'{name}: expected integer rectangle coordinates')
        x0,y0,x1,y1=box
        if not (22<=x0<x1<=298 and 22<=y0<y1<=158):
            raise ValueError(f'{name}: region must leave 22-pixel tracking margins')
    tongue=boxes['tongue']
    for name in ['tracking_template','cheek']:
        other=boxes[name]
        if max(tongue[0],other[0])<min(tongue[2],other[2]) and max(tongue[1],other[1])<min(tongue[3],other[3]):
            raise ValueError(f'{name}: nuisance registration region overlaps evaluated tongue')
    reference=annotation.get('reference_frame')
    if type(reference) is not int or not any(f['sequence']==reference for f in frames):
        raise ValueError('Reference frame must identify a paired native frame')

def basis(xy,center,scale,degree=2):
    u,v=((xy-center)/scale).T
    return np.stack([np.ones_like(u),u,v]+([u*u,u*v,v*v] if degree==2 else []),axis=1)

def robust_fit(a,z):
    # Fixed Huber threshold 1.5 mm; mild curvature penalty. Chosen before holdout evaluation.
    penalty=np.diag([0.,0.,0.]+([.05,.05,.05] if a.shape[1]==6 else []))
    weights=np.ones(len(z));coef=np.zeros(a.shape[1])
    for _ in range(8):
        coef=np.linalg.solve(np.einsum('ni,n,nj->ij',a,weights,a)+penalty+np.eye(a.shape[1])*1e-10,np.einsum('ni,n,n->i',a,weights,z))
        weights=np.minimum(1,1.5/np.maximum(np.abs(z-np.einsum('ni,i->n',a,coef)),1e-9))
    if not np.isfinite(coef).all():raise ValueError('Nonfinite fit')
    return coef

def select(rgb,depth,box,shift):
    x0,y0,x1,y1=box;dx,dy=shift
    yy,xx=np.indices(depth.shape)
    roi=(xx>=x0+dx+1)&(xx<x1+dx-1)&(yy>=y0+dy+1)&(yy<y1+dy-1)
    r,g,b=rgb.astype(float).transpose(2,0,1)
    color=(r>55)&(r>g*1.3)&(r>b*1.25)&(np.maximum.reduce([r,g,b])<235)
    valid=np.isfinite(depth)&(depth>.08)&(depth<.5)
    padded=np.pad(depth,1,mode='edge');neighbors=np.lib.stride_tricks.sliding_window_view(padded,(3,3))
    usable=np.isfinite(neighbors)&(neighbors>0)
    # Do not manufacture a depth estimate; local median only identifies isolated spikes.
    clean=np.where(usable,neighbors,np.inf)
    ordered=np.sort(clean.reshape(*depth.shape,9),axis=-1)
    count=usable.sum(axis=(-2,-1));median=np.take_along_axis(ordered,np.maximum(0,(count-1)//2)[...,None],axis=-1)[...,0]
    consistent=(count>=7)&(np.abs(depth-median)<.0025)
    mask=roi&color&valid&consistent
    return mask,{'interior_pixels':int(roi.sum()),'after_color':int((roi&color).sum()),'after_depth':int((roi&color&valid).sum()),'selected':int(mask.sum())}

def image_uri(rgb,mask,box,shift):
    # Diagnostic image crop: mark included sensor samples, not inferred hidden tissue.
    x0,y0,x1,y1=box;dx,dy=shift;x0=max(0,x0+dx-12);y0=max(0,y0+dy-12);x1=min(320,x1+dx+12);y1=min(180,y1+dy+12)
    crop=rgb[y0:y1,x0:x1].copy();m=mask[y0:y1,x0:x1]
    crop[m]=(crop[m]*.35+np.array([120,255,170])*.65).astype('uint8')
    # Rotate the native landscape sensor view clockwise for human-readable portrait.
    image=Image.fromarray(np.rot90(crop,k=-1)).resize((400,400),Image.Resampling.NEAREST)
    out=io.BytesIO();image.save(out,format='PNG');return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('capture_zip',type=Path);p.add_argument('--regions',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    if args.output.exists():raise ValueError('Choose a new output directory')
    preview=import_script('preview-native-depth');review=import_script('review-native-depth');review.review(args.capture_zip)
    z=zipfile.ZipFile(args.capture_zip);name=next(n for n in z.namelist() if n.endswith('manifest.json'));prefix=name[:-13];m=json.loads(z.read(name));ann=json.loads(args.regions.read_text())
    if m['capture_id']!=ann['capture_id'] or m['device']['output_mirrored']:raise ValueError('Capture/annotation mismatch or mirrored output')
    frames=[f for f in m['frames'] if f.get('rgb') and f.get('depth')]
    if any(f['depth_dimensions']!=[320,180] or f['rgb_dimensions']!=[1280,720] for f in frames):raise ValueError('Unsupported annotation geometry')
    validate_regions(ann,frames)
    def load(f):
        rgb=np.asarray(Image.open(io.BytesIO(z.read(prefix+f['rgb']['path']))).convert('RGB').resize((320,180),Image.Resampling.BOX))
        d=np.frombuffer(z.read(prefix+f['depth']['path']),dtype='<f4').reshape(180,320)
        return rgb,d
    ref=next(f for f in frames if f['sequence']==ann['reference_frame']);rgb,d=load(ref);box=ann['regions_xyxy']['tongue']
    mask,counts=select(rgb,d,box,(0,0));xyz,_,_=preview.project(d,ref['calibration']);points=xyz[mask]*1000
    if len(points)<30:raise ValueError('Insufficient conservative reference tongue samples')
    center=points[:,:2].mean(axis=0);scale=np.maximum(points[:,:2].std(axis=0),1.)
    a=basis(points[:,:2],center,scale);coef=robust_fit(a,points[:,2]);plane=robust_fit(a[:,:3],points[:,2])
    bounds=np.array([points[:,:2].min(axis=0),points[:,:2].max(axis=0)])
    # Freeze and persist train-only model BEFORE looking at held-out depth.
    args.output.mkdir(parents=True)
    model={'kind':'visible-tongue-patch-quadratic','train_frame':ref['sequence'],'train_depth_sha256':ref['depth']['sha256'],'units':'mm','center_xy':center.tolist(),'scale_xy':scale.tolist(),'coefficients':coef.tolist(),'plane_coefficients':plane.tolist(),'xy_bounds':bounds.tolist(),'reference_selected_samples':len(points),'selection_counts':counts,'scope':'Measured visible patch only; no hidden tongue volume or muscle parameters','fit_settings':{'huber_delta_mm':1.5,'curvature_penalty':.05,'iterations':8},'evaluation_settings':{'minimum_face_ncc':.9,'minimum_samples':30,'required_median_mae_mm':2.,'required_improvement_over_plane':.1}}
    model_text=json.dumps(model,sort_keys=True,indent=2);(args.output/'frozen-model.json').write_text(model_text);model_hash=hashlib.sha256(model_text.encode()).hexdigest()
    tx0,ty0,tx1,ty1=ann['tracking_template_xyxy'];template=rgb[ty0:ty1,tx0:tx1].mean(axis=2)
    cx0,cy0,cx1,cy1=ann['regions_xyxy']['cheek'];ref_cheek=d[cy0:cy1,cx0:cx1];ref_cheek=float(np.median(ref_cheek[np.isfinite(ref_cheek)&(ref_cheek>0)]))
    rows=[];samples=[];previews=set(np.linspace(0,len(frames)-1,10,dtype=int).tolist()+[ref['sequence']])
    for f in frames:
        image,depth=load(f);dx,dy,ncc=preview.track(image.mean(axis=2),template,(tx0,ty0))
        row={'frame':f['sequence'],'seconds':f['relative_seconds'],'role':'train' if f['sequence']==ref['sequence'] else 'held-out','tracking_ncc':ncc,'shift_depth_pixels':[dx,dy]}
        selected,cnt=select(image,depth,box,(dx,dy));row['selection']=cnt
        cheek=depth[cy0+dy:cy1+dy,cx0+dx:cx1+dx];cv=cheek[np.isfinite(cheek)&(cheek>0)]
        if ncc<.9 or abs(dx)>=22 or abs(dy)>=22 or len(cv)<30:
            row['excluded_reason']='face registration unreliable';rows.append(row);continue
        offset=float(np.median(cv))-ref_cheek
        # Nuisance alignment is driven ONLY by non-tongue camera template + cheek depth.
        yy,xx=np.indices(depth.shape);uv=np.stack((xx+.5-dx,yy+.5-dy),axis=-1)
        rect=preview.radial(uv,ref['calibration'],(320,180),inverse=True)
        k=np.array(ref['calibration']['intrinsics_row_major'],float);k[0]*=320/ref['calibration']['intrinsic_reference_dimensions'][0];k[1]*=180/ref['calibration']['intrinsic_reference_dimensions'][1]
        rays=np.concatenate((rect,np.ones((180,320,1))),axis=-1)@np.linalg.inv(k).T
        aligned=rays*(depth-offset)[...,None]*1000
        pts=aligned[selected];inside=((pts[:,:2]>=bounds[0])&(pts[:,:2]<=bounds[1])).all(axis=1)
        pts=pts[inside];row['evaluated_samples']=len(pts);row['cheek_depth_offset_mm']=offset*1000
        if len(pts)<30:
            row['excluded_reason']='too few samples within trained support';rows.append(row);continue
        design=basis(pts[:,:2],center,scale);pred=np.einsum('ni,i->n',design,coef);flat=np.einsum('ni,i->n',design[:,:3],plane)
        err=np.abs(pred-pts[:,2]);pe=np.abs(flat-pts[:,2]);row.update({'mae_mm':float(err.mean()),'median_ae_mm':float(np.median(err)),'p90_ae_mm':float(np.quantile(err,.9)),'plane_mae_mm':float(pe.mean()),'plane_p90_ae_mm':float(np.quantile(pe,.9))});rows.append(row)
        if f['sequence'] in previews:
            samples.append({'frame':f['sequence'],'role':row['role'],'observed':np.round(pts,3).tolist(),'predicted':np.round(np.c_[pts[:,:2],pred],3).tolist(),'error_mm':np.round(err,3).tolist(),'rgb':image_uri(image,selected,box,(dx,dy)),'metrics':row})
    held=[r for r in rows if r['role']=='held-out' and 'mae_mm'in r]
    if not held:raise ValueError('No usable held-out frames; no success claim')
    mae=float(np.median([r['mae_mm'] for r in held]));baseline=float(np.median([r['plane_mae_mm'] for r in held]));gain=1-mae/baseline if baseline else 0
    # Keep model acceptance fixed and transparent; same-pose replay is not cross-pose validation.
    passed=mae<=2 and gain>=.1
    result={'frozen_model_sha256':model_hash,'train_frame':ref['sequence'],'reference_selection':counts,'reference_patch_extent_mm':np.ptp(points,axis=0).tolist(),'heldout_evaluated':len(held),'heldout_total':len(frames)-1,'median_frame_mae_mm':mae,'plane_median_frame_mae_mm':baseline,'relative_improvement_over_plane':gain,'predeclared_fit_gate_passed':passed,'frames':rows,'limitations':['Manual interior ROI + fixed RGB/depth gates are a conservative selection, not validated tongue segmentation.','Repeated frames from one held pose are correlated and do not establish performance on new tongue poses.','XY face translation and cheek depth offset do not correct full rigid rotation.','Only observed support is fitted; hidden tongue anatomy and muscle parameters remain unknown.','Metric error includes sensor and correspondence error; independent accuracy validation remains outstanding.']}
    (args.output/'evaluation.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    # Reference fitted mesh uses native valid-mask adjacency; holes and excluded samples remain absent.
    idx=np.full(mask.shape,-1,int);idx[mask]=np.arange(mask.sum());faces=[]
    for y in range(179):
        for x in range(319):
            for cells in [((y,x),(y,x+1),(y+1,x)),((y+1,x),(y,x+1),(y+1,x+1))]:
                ids=[int(idx[j,i]) for j,i in cells]
                if min(ids)>=0:faces.append(ids)
    fitted=np.c_[points[:,:2],np.einsum('ni,i->n',a,coef)]
    with (args.output/'fitted-visible-patch.ply').open('w') as ply:
        ply.write(f'ply\nformat ascii 1.0\ncomment Fitted visible tongue patch only; meters; no unseen anatomy\nelement vertex {len(fitted)}\nproperty float x\nproperty float y\nproperty float z\nelement face {len(faces)}\nproperty list uchar int vertex_indices\nend_header\n')
        for point in fitted/1000:ply.write(' '.join(map(str,point))+'\n')
        for face in faces:ply.write('3 '+' '.join(map(str,face))+'\n')
    payload={'model':model,'evaluation':result,'samples':samples,'reference_fit':np.round(fitted,3).tolist(),'reference_faces':faces}
    (args.output/'index.html').write_text(Path(__file__).with_name('tongue-fit-preview.html').read_text().replace('__FIT_DATA__',json.dumps(payload,separators=(',',':'),allow_nan=False)))
    print(json.dumps({k:v for k,v in result.items() if k!='frames'},indent=2))
if __name__=='__main__':main()
