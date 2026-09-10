import hashlib
import json
import shutil
import subprocess
import pytest
from science.scripts.app_visual import index_frames,frame_image,visual_frames


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'),reason='Optional video decoder unavailable')
def test_exact_encoded_frame_identity_dimensions_pts_and_source_integrity(tmp_path):
    video=tmp_path/'synthetic.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=80x48:r=3:d=1','-c:v','mpeg4','-an',str(video)],check=True)
    media=video.read_bytes();media_hash=hashlib.sha256(media).hexdigest()
    record={'provenance':{'kind':'development-fixture'},'media':{'sha256':media_hash}}
    raw=json.dumps(record).encode();record_hash=hashlib.sha256(raw).hexdigest();identity=hashlib.sha256((record_hash+media_hash).encode()).hexdigest()
    folder=tmp_path/'motion-captures'/identity;folder.mkdir(parents=True)
    (folder/'record.json').write_bytes(raw);(folder/'media').write_bytes(media)
    (folder/'summary.json').write_text(json.dumps({'recordSha256':record_hash,'mediaSha256':media_hash,'mediaByteLength':len(media)}))
    indexed=index_frames(tmp_path,identity)
    assert len(indexed['frames'])==3 and indexed['rotationApplied'] is False
    assert indexed['sourceKind']=='development-fixture'
    assert [r['frameIndex'] for r in indexed['frames']]==[0,1,2]
    assert indexed['frames'][1]['ptsSeconds']==pytest.approx(1/3,abs=1e-5)
    extracted=frame_image(tmp_path,identity,1)
    assert [extracted['width'],extracted['height']]==[80,48]
    png=(tmp_path/'visual-frames'/identity/'frame-1.png').read_bytes()
    assert hashlib.sha256(png).hexdigest()==extracted['pngSha256']
    assert frame_image(tmp_path,identity,1)==extracted
    annotation={'frameIndex':1,'pose':'a','assumedJA':-3.,'visibility':'occluded','upperPixel':None,'lowerPixel':None}
    value=visual_frames([annotation],indexed,True)[0]
    assert value['upper_px'] is None and value['visibility']=='occluded'
    assert value['media_sha256']==media_hash and value['video_frame_index']==1
    with pytest.raises(ValueError,match='reference'):visual_frames([{**annotation,'frameIndex':99}],indexed,True)
    (folder/'media').write_bytes(media[:-1]+bytes([media[-1]^1]))
    with pytest.raises(ValueError,match='integrity'):frame_image(tmp_path,identity,1)
