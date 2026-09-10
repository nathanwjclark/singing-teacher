import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import zipfile
import pytest

MODULE = Path(__file__).resolve().parents[1]/"scripts"/"import_session_bundle.py"
spec = importlib.util.spec_from_file_location("session_bundle_import", MODULE)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


def packed(files, compression=zipfile.ZIP_STORED):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=compression) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return stream.getvalue()


def ref(name, raw, field="byteCount"):
    return {"path": name, "sha256": hashlib.sha256(raw).hexdigest(), field: len(raw)}


def fixture(tmp_path, stop="completed", change=None):
    depth = b"\0\0\0?"
    video = {"schema_version": "singing-native-rgbd-1.0.0", "capture_id": "depth-fixture",
             "frames": [{"depth": ref("depth.f32", depth, "bytes")}], "stop_reason": "user-stopped"}
    pcm = b"\0\0\0\0"
    sound = {"schemaVersion": "probe-native-1.0.0", "captureId": "sound-fixture",
             "collectionSessionId": "session-fixture", "linkedDepthCaptureId": "depth-fixture",
             "stopReason": stop, "drive": ref("drive.f32le", pcm), "received": ref("received.f32le", pcm)}
    session = {"schemaVersion": "singing-collection-session-1.0.0", "sessionId": "session-fixture",
        "soundStopReason": stop, "phaseOrder": ["video-depth", "sound"], "simultaneous": False,
        "sameAnatomicalPoseVerified": False, "includedInFit": False}
    video_files = {"manifest.json": json.dumps(video).encode(), "depth.f32": depth}
    sound_files = {"manifest.json": json.dumps(sound).encode(), "drive.f32le": pcm, "received.f32le": pcm}
    if change:
        change(session, video_files, sound_files)
    video_zip, sound_zip = packed(video_files), packed(sound_files)
    session.update(videoDepth=ref("depth.zip", video_zip), sound=ref("sound.zip", sound_zip))
    raw = packed({"session.json": json.dumps(session).encode(), "depth.zip": video_zip, "sound.zip": sound_zip})
    path = tmp_path/"session.zip"; path.write_bytes(raw)
    return path, session, video_zip, sound_zip


@pytest.mark.parametrize("stop", ["completed", "user-stopped", "route-changed"])
def test_swift_wrapper_unpacks_exact_original_phases_and_retains_partial_stop(tmp_path, stop):
    source, session, video, sound = fixture(tmp_path, stop)
    destination = tmp_path/"private-output"
    report = module.import_session_bundle(source, destination)
    assert (destination/"originals/depth.zip").read_bytes() == video
    assert (destination/"originals/sound.zip").read_bytes() == sound
    assert report["soundCompleted"] == (stop == "completed")
    assert report["soundStopReason"] == stop
    assert report["includedInFit"] is False and report["simultaneous"] is False
    assert report["sameAnatomicalPoseVerified"] is False
    assert (destination/"video-depth/manifest.json").is_file()
    assert (destination/"sound/manifest.json").is_file()
    assert (destination/"handoff.json").stat().st_mode & 0o777 == 0o600
    assert destination.stat().st_mode & 0o777 == 0o700
    with pytest.raises(FileExistsError):
        module.import_session_bundle(source, destination)


@pytest.mark.parametrize("change", [
    lambda s,v,a: s.update(simultaneous=True),
    lambda s,v,a: s.update(phaseOrder=["sound", "video-depth"]),
    lambda s,v,a: s.update(sameAnatomicalPoseVerified=True),
    lambda s,v,a: s.update(soundStopReason="different"),
    lambda s,v,a: v.update({"depth.f32": b"tampered"}),
    lambda s,v,a: a.update({"manifest.json": json.dumps({**json.loads(a["manifest.json"]), "linkedDepthCaptureId": "wrong"}).encode()}),
    lambda s,v,a: a.update({"unreferenced.bin": b"unused"}),
    lambda s,v,a: a.update({"../escape": b"bad"}),
    lambda s,v,a: a.update({"C:\\escape": b"bad"}),
])
def test_mismatch_unsafe_paths_or_unverified_claims_fail_without_output(tmp_path, change):
    source, *_ = fixture(tmp_path, change=change)
    destination = tmp_path/"output"
    with pytest.raises(ValueError):
        module.import_session_bundle(source, destination)
    assert not destination.exists()


def test_duplicates_symlinks_and_expansion_limits(tmp_path):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream,"w") as archive:
        with pytest.warns(UserWarning):
            archive.writestr("session.json", b"{}"); archive.writestr("session.json", b"{}")
    source = tmp_path/"duplicate.zip"; source.write_bytes(stream.getvalue())
    with pytest.raises(ValueError, match="Duplicate"):
        module.import_session_bundle(source, tmp_path/"out")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream,"w") as archive:
        entry = zipfile.ZipInfo("session.json"); entry.create_system=3
        entry.external_attr = (stat.S_IFLNK|0o777)<<16
        archive.writestr(entry, b"/etc/passwd")
    source.write_bytes(stream.getvalue())
    with pytest.raises(ValueError, match="regular"):
        module.import_session_bundle(source, tmp_path/"out")
    source.write_bytes(packed({"huge.bin": b"0"*(2*1024*1024)}, zipfile.ZIP_DEFLATED))
    with pytest.raises(ValueError, match="expansion"):
        module.import_session_bundle(source, tmp_path/"out")
    source, *_ = fixture(tmp_path)
    with pytest.raises(ValueError, match="bounded"):
        module.import_session_bundle(source, tmp_path/"out", max_bytes=10)


def test_outer_hash_mismatch_and_duplicate_json_rejected(tmp_path):
    source, *_ = fixture(tmp_path)
    with zipfile.ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files["sound.zip"] += b"changed"
    source.write_bytes(packed(files))
    with pytest.raises(ValueError, match="hash/byte"):
        module.import_session_bundle(source, tmp_path/"out")
    files["session.json"] = b'{"sessionId":"one","sessionId":"two"}'
    source.write_bytes(packed(files))
    with pytest.raises(ValueError, match="Duplicate JSON"):
        module.import_session_bundle(source, tmp_path/"out")
