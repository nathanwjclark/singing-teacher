#!/usr/bin/env python3
"""Build private browser tip examples from point labels, ignoring direction tags."""
import argparse,base64,hashlib,json
from pathlib import Path
import cv2,numpy as np
p=argparse.ArgumentParser();p.add_argument('labels',type=Path);p.add_argument('output',type=Path);p.add_argument('--training-count',type=int,default=16);a=p.parse_args()
if a.output.exists():raise ValueError('Refuse to overwrite a private profile; use a new output')
d=json.loads(a.labels.read_text());examples=[];frames=[]
for i,s in enumerate(d['samples'][:a.training_count]):
 if not s.get('label'):continue
 im=cv2.imdecode(np.frombuffer(base64.b64decode(s['image'].split(',')[1]),np.uint8),1)
 # Same sample centers and luminance coefficients as the browser at160x128.
 im=cv2.resize(im,(160,128),interpolation=cv2.INTER_LINEAR)[1::2,1::2]
 gray=im[:,:,2]*.3+im[:,:,1]*.59+im[:,:,0]*.11
 examples.append({'gray':gray.round(3).ravel().tolist(),'tip':s['label']});frames.append(i)
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps({'schema':'tongue-tip-profile/v1','width':80,'height':64,'trainingFrames':frames,'source_sha256':hashlib.sha256(a.labels.read_bytes()).hexdigest(),'heldoutFrames':list(range(a.training_count,len(d['samples']))),'directionTagsIgnored':True,'scope':'Personal appearance examples; correlated frames, no independent-person validation or depth inference','examples':examples},separators=(',',':')))
print(json.dumps({'trainingFrames':frames,'heldoutCount':len(d['samples'])-a.training_count,'output':str(a.output)}))
