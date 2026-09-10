import sys,json,hashlib,subprocess
from pathlib import Path
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path.cwd()/'science/tests'))
from test_session_visual import setup
from singing_physics.service import JobService
from singing_physics.session import SessionController
with JobService(root/'jobs') as service:
 c=SessionController(service.root/'sessions',service,'session');baseline,params,target=setup(c)
 video=root/'synthetic.mp4'
 subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=1000x1000:r=3:d=1','-c:v','mpeg4','-an',str(video)],check=True)
 media=video.read_bytes();mh=hashlib.sha256(media).hexdigest();raw=json.dumps({'provenance':{'kind':'development-fixture'},'media':{'sha256':mh}}).encode();rh=hashlib.sha256(raw).hexdigest();identity=hashlib.sha256((rh+mh).encode()).hexdigest();folder=root/'motion-captures'/identity;folder.mkdir(parents=True)
 (folder/'record.json').write_bytes(raw);(folder/'media').write_bytes(media);(folder/'summary.json').write_text(json.dumps({'observationId':'synthetic-visual','mimeType':'video/mp4','recordSha256':rh,'mediaSha256':mh,'mediaByteLength':len(media)}))
 voice=root/'science-runs/voice';voice.mkdir(parents=True);(root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'voice'}));(voice/'summary.json').write_text(json.dumps({'sessionId':'session'}))
 print(json.dumps({'captureId':identity,'upper':params['calibration_frames'][0]['upper_px'],'lower':params['calibration_frames'][0]['lower_px']}))
