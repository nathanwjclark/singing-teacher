#!/usr/bin/env python3
"""Train a private personal tongue keypoint/depth network. No OpenCV or direction tags.
Requires torch/torchvision/onnx, numpy, Pillow. Inputs and learned weights stay private.
"""
import argparse,base64,io,json,random,hashlib,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageEnhance
import torch
from torch import nn
from torch.nn import functional as F
from torchvision.models import resnet18,ResNet18_Weights

class TongueNet(nn.Module):
 def __init__(self,pretrained=False):
  super().__init__();r=resnet18(weights=ResNet18_Weights.DEFAULT if pretrained else None)
  self.stem=nn.Sequential(r.conv1,r.bn1,r.relu,r.maxpool);self.a=r.layer1;self.b=r.layer2;self.c=r.layer3
  self.heat=nn.Sequential(nn.Conv2d(256+128+64,64,3,padding=1),nn.ReLU(),nn.Conv2d(64,32,3,padding=1),nn.ReLU(),nn.Conv2d(32,1,1))
  self.pose=nn.Sequential(nn.Linear(256,64),nn.ReLU(),nn.Linear(64,2))
 def forward(self,image):
  a=self.a(self.stem(image));b=self.b(a);c=self.c(b);h=self.heat(torch.cat([a,F.interpolate(b,size=(32,32),mode='bilinear',align_corners=False),F.interpolate(c,size=(32,32),mode='bilinear',align_corners=False)],1));p=self.pose(c.mean((2,3)));return h,p[:,:1].sigmoid(),p[:,1:2]

def decode(data):return Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).convert('RGB').resize((128,128))
def main():
 p=argparse.ArgumentParser();p.add_argument('--labels',type=Path,required=True);p.add_argument('--native',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--steps',type=int,default=600);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=False)
 torch.manual_seed(734);random.seed(734);np.random.seed(734);torch.set_num_threads(4)
 rows=[]
 for i,s in enumerate(json.loads(args.labels.read_text())['samples']):
  if 'label' not in s:continue
  # Legacy mouth-only exports used normalized x margins as y margins. Reframe
  # them into the new pixel-square ROI. The source webcam aspect was 16:9;
  # missing context is edge padding, never invented depth supervision.
  crop=s['crop'];mw=crop['width']/1.3;aspect=16/9;ow=2.2*mw;oh=ow*aspect
  sx=crop['width']/ow;sy=crop['height']/oh;ox=.45*mw/ow;oy=(.5*aspect-.15)*mw/oh
  im=decode(s['image']).resize((round(256*sx),round(256*sy)));ar=np.asarray(im);left=round(256*ox);top=round(256*oy)
  ar=np.pad(ar,((top,max(0,256-top-ar.shape[0])),(left,max(0,256-left-ar.shape[1])),(0,0)),mode='edge')[:256,:256]
  stream=io.BytesIO();Image.fromarray(ar).save(stream,format='PNG');label=s['label'];label={'x':ox+label['x']*sx,'y':oy+label['y']*sy} if label else None
  rows.append(dict(id=f'web-{i}',image='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),label=label,split='train' if i<16 else 'test'))
 rows+=json.loads(args.native.read_text());train=[r for r in rows if r['split']=='train'];test=[r for r in rows if r['split']=='test'];images={r['id']:decode(r['image']) for r in rows}
 device='mps' if torch.backends.mps.is_available() else 'cpu';net=TongueNet(True).to(device);opt=torch.optim.AdamW(net.parameters(),lr=.00025,weight_decay=.0001)
 # BatchNorm remains on pretrained statistics with this small correlated data set.
 means=torch.tensor([.485,.456,.406],device=device)[None,:,None,None];std=torch.tensor([.229,.224,.225],device=device)[None,:,None,None]
 yy,xx=torch.meshgrid(torch.arange(32,device=device),torch.arange(32,device=device),indexing='ij');started=time.time()
 for step in range(args.steps):
  net.train()
  for m in net.modules():
   if isinstance(m,nn.BatchNorm2d):m.eval()
  batch=random.choices(train,k=16);ims=[];pts=[];vis=[];depth=[];mask=[]
  for row in batch:
   im=images[row['id']];label=row['label'];pt=[label['x'],label['y']] if label else [.5,.5]
   # Translation/scale/flip alter the point with the image; no fabricated depth labels.
   scale=random.uniform(.85,1.15);tx=random.uniform(-.08,.08);ty=random.uniform(-.08,.08)
   im=im.transform((128,128),Image.Transform.AFFINE,(1/scale,0,64-(64+tx*128)/scale,0,1/scale,64-(64+ty*128)/scale),Image.Resampling.BILINEAR)
   pt=[(pt[0]-.5)*scale+.5+tx,(pt[1]-.5)*scale+.5+ty]
   if random.random()<.5:im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);pt[0]=1-pt[0]
   im=ImageEnhance.Brightness(im).enhance(random.uniform(.65,1.35));im=ImageEnhance.Color(im).enhance(random.uniform(.7,1.3));im=ImageEnhance.Contrast(im).enhance(random.uniform(.75,1.25))
   ims.append(np.asarray(im,dtype=np.float32).transpose(2,0,1)/255);pts.append(pt);vis.append(float(label is not None));depth.append(row.get('depthTarget',0));mask.append(float('depthTarget' in row))
  x=(torch.tensor(np.stack(ims),device=device)-means)/std;points=torch.tensor(pts,device=device);v=torch.tensor(vis,device=device)[:,None];z=torch.tensor(depth,device=device)[:,None];zm=torch.tensor(mask,device=device)[:,None]
  target=torch.exp(-((xx[None]-points[:,0,None,None]*32)**2+(yy[None]-points[:,1,None,None]*32)**2)/(2*1.5**2))[:,None]*v[:,:,None,None]
  h,pv,pz=net(x);loss=((h-target)**2*(1+target*15)).mean()*20+F.binary_cross_entropy(pv,v)+(((pz-z)**2)*zm).sum()/zm.sum().clamp(min=1)*2
  opt.zero_grad();loss.backward();opt.step()
  if step%100==0:print(json.dumps(dict(step=step,loss=loss.item(),seconds=round(time.time()-started))),flush=True)
 net.eval();results=[]
 with torch.no_grad():
  for row in rows:
   x=(torch.tensor(np.asarray(images[row['id']],dtype=np.float32).transpose(2,0,1)[None]/255,device=device)-means)/std;heat,visible,depth=net(x);h=heat.cpu().numpy()[0,0];iy,ix=np.unravel_index(h.argmax(),h.shape);prediction=[float(ix/32),float(iy/32)];label=row['label'];results.append(dict(id=row['id'],split=row['split'],visible=visible.item(),heat=float(h.max()),prediction=prediction,label=label,errorPixels=float(np.linalg.norm((np.array(prediction)-[label['x'],label['y']])*[160,128])) if label else None,depth=depth.item(),depthTarget=row.get('depthTarget')))
 net=net.cpu();torch.save(net.state_dict(),args.output/'weights.pt');torch.onnx.export(net,torch.zeros(1,3,128,128),str(args.output/'tongue.onnx'),input_names=['image'],output_names=['heatmap','visibility','depth'],opset_version=18,dynamo=False)
 (args.output/'inputs.json').write_text(json.dumps(rows));(args.output/'evaluation.json').write_text(json.dumps(results,indent=2));(args.output/'manifest.json').write_text(json.dumps(dict(schema='personal-tongue-neural/v1',input=[1,3,128,128],outputs=['heatmap','visibility','depth'],modelSha256=hashlib.sha256((args.output/'tongue.onnx').read_bytes()).hexdigest(),trainingIds=[r['id'] for r in train],heldoutIds=[r['id'] for r in test],directionTagsIgnored=True,depthUnit='mouth widths anterior to mouth-corner plane; learned estimate from sparse RGBD labels',crop='pixel-square 2.2 mouth widths, 0.6 left margin, 0.5 upper margin',architecture='ImageNet ResNet18 stages 1–3, spatial tip heatmap, visibility and independent depth heads',sourceHashes={str(a.name):hashlib.sha256(a.read_bytes()).hexdigest() for a in [args.labels,args.native]}),indent=2))
 print(json.dumps([r for r in results if r['split']=='test'],indent=2),flush=True)
if __name__=='__main__':main()
