"""Seed the motion-timeline browser check: a native voice capture for the real
baseline fit and an encoded native motion recording for the real analysis.

Generated synthetic evidence only. The motion audio holds one-second JA segments,
a silent half second (unvoiced windows) and a last quarter second an octave up
(outside the pitch-bank support), so the timeline shows both kinds of gap. From
3 s the pitch rises from 180 to 200 Hz while JA changes, so a path change can
coincide with a switch between pitch-bank anchors.
"""
import json
from pathlib import Path
import shutil
import sys

import numpy as np

sys.path.insert(0, str(Path.cwd() / 'science/tests'))
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import resample_native_pcm
from test_live_capture_jobs import capture
from test_app_source_loop import publish_capture
from test_app_motion_runtime import encode_media, motion_record

root = Path(sys.argv[1])
data, fixture = root / 'app', root / 'fixture'
data.mkdir(parents=True)
fixture.mkdir(parents=True)
voice = capture(fixture)
manifest = json.loads((voice / 'manifest.json').read_text())
manifest['capture_id'] = '00000000-0000-4000-8000-000000000031'
(voice / 'manifest.json').write_text(json.dumps(manifest))
publish_capture(data, voice)
pitch = [180.]*12 + [200.]*3 + [360.]
controls = list(zip((ja for ja in (-4., -3., -2., -3.) for _ in range(4)), pitch))
with Engine() as engine:
    native = np.concatenate([engine.synthesize('a', {'JA': ja}, f0_hz=f0, duration_s=.25) for ja, f0 in controls])
pcm, _ = resample_native_pcm(native, 44100, 48000)
pcm[2 * 48000:round(2.5 * 48000)] = 0
raw = fixture / 'motion.f32'
raw.write_bytes(pcm.astype('<f4').tobytes())
media = encode_media(shutil.which('ffmpeg'), fixture, raw, name='motion.webm', seconds=4)
(fixture / 'motion.json').write_text(json.dumps(motion_record(media, 'motion-timeline-fixture', 'video/webm')))
