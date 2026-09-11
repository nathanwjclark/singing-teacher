"""Export the pinned public TongueSAM prompt detector, not its SAM mask model."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
import torch
import onnxruntime as ort
from PIL import Image

REVISION = '3f6e8c620e4d89e669a92a22f3be3d007932ce45'

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if subprocess.check_output(['git','-C',str(a.source),'rev-parse','HEAD'],text=True).strip()!=REVISION:
        raise ValueError('Use the reviewed TongueSAM revision '+REVISION)
    if subprocess.check_output(['git','-C',str(a.source),'status','--porcelain'],text=True).strip():
        raise ValueError('Upstream source must be clean')
    sys.path.insert(0,str(a.source.resolve()))
    from segment.yolox_nets.yolo import YoloBody
    torch.set_num_threads(4)
    weights=a.source/'segment/yolox.pth'
    base=YoloBody(1,'s').eval()
    base.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True))
    class Detector(torch.nn.Module):
        def __init__(self):
            super().__init__();self.net=base
        def forward(self,image):
            rows=[]
            for raw,stride,size in zip(self.net(image),(8,16,32),(56,28,14)):
                r=raw.flatten(2).permute(0,2,1)
                y,x=torch.meshgrid(torch.arange(size),torch.arange(size),indexing='ij')
                grid=torch.stack([x,y],-1).reshape(1,-1,2).to(r)
                center=(r[:,:,:2]+grid)*stride/448
                extent=torch.exp(r[:,:,2:4])*stride/448
                score=torch.sigmoid(r[:,:,4:5])*torch.sigmoid(r[:,:,5:6])
                rows.append(torch.cat([center-extent/2,center+extent/2,score],-1))
            return torch.cat(rows,1)
    model=Detector().eval();a.output.mkdir(parents=True,exist_ok=True)
    target=a.output/'detector.onnx'
    if target.exists():raise ValueError('Refusing to replace an existing model')
    torch.onnx.export(model,torch.zeros(1,3,448,448),str(target),input_names=['image'],output_names=['boxes'],opset_version=18,dynamo=False)
    session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider'])
    rows=[]
    # Public upstream examples are execution smoke checks, not held-out accuracy.
    for file in sorted((a.source/'data/test_in').glob('*.jpg')):
        rgb=np.asarray(Image.open(file).convert('RGB').resize((448,448),Image.Resampling.BICUBIC),dtype=np.float32)/255
        tensor=((rgb-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)).transpose(2,0,1)[None]
        with torch.inference_mode():reference=model(torch.from_numpy(tensor)).numpy()
        actual=session.run(None,{'image':tensor})[0]
        if not np.allclose(reference,actual,atol=2e-4,rtol=2e-4):raise ValueError('ONNX export differs from PyTorch')
        best=actual[0,np.argmax(actual[0,:,4])]
        rows.append({'file':file.name,'score':float(best[4]),'box':best[:4].tolist(),'inputSha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    manifest={'schema':'tonguesam-detector/v1','upstreamRevision':REVISION,'modelSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sourceWeightsSha256':hashlib.sha256(weights.read_bytes()).hexdigest(),'input':[1,3,448,448],'output':'normalized xyxy and objectness-times-class score','threshold':.7,'capability':'visible-tongue-bounding-box','notSupported':['surface segmentation','tip position','depth','hidden anatomy'],'normalization':{'mean':[.485,.456,.406],'std':[.229,.224,.225]},'verification':{'examples':len(rows),'kind':'public upstream execution and PyTorch/ONNX agreement; not held-out accuracy'}}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (a.output/'smoke-results.json').write_text(json.dumps(rows,indent=2)+'\n')
    print(json.dumps(manifest))

if __name__=='__main__':main()
