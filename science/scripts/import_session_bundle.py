#!/usr/bin/env python3
"""Safely unpack linked native phases; preserve originals and never infer simultaneity."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile

LIMIT = 1024 * 1024 * 1024
MAX_ENTRIES = 20000


def _json(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError("Duplicate JSON key")
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def _name(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError("Archive entries must be safe flat filenames")
    return name


def _archive(raw, budget):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise ValueError("Too many archive entries")
        names = set()
        result = {}
        for entry in entries:
            name = _name(entry.filename)
            if name in names:
                raise ValueError("Duplicate archive entry")
            names.add(name)
            mode = entry.external_attr >> 16
            if entry.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or entry.flag_bits & 1:
                raise ValueError("Archive must contain unencrypted regular files only")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Unsupported ZIP compression")
            if entry.file_size > budget[0] or (entry.file_size > 1024*1024 and entry.file_size > max(1, entry.compress_size)*200):
                raise ValueError("Archive exceeds expansion budget or compression-ratio limit")
            budget[0] -= entry.file_size
            with archive.open(entry) as source:
                data = source.read(entry.file_size+1)
            if len(data) != entry.file_size:
                raise ValueError("ZIP byte count mismatch")
            result[name] = data
        return result


def _descriptor(record, files, count_field):
    if not isinstance(record, dict):
        raise ValueError("Invalid artifact descriptor")
    name = _name(record.get("path"))
    size = record.get(count_field)
    if type(size) is not int or size < 0 or name not in files:
        raise ValueError("Missing artifact or invalid byte count")
    data = files[name]
    if len(data) != size or hashlib.sha256(data).hexdigest() != record.get("sha256"):
        raise ValueError("Artifact hash/byte count mismatch")
    return name


def _phase(files, kind):
    if "manifest.json" not in files:
        raise ValueError("Phase manifest missing")
    manifest = _json(files["manifest.json"])
    expected = "singing-native-rgbd-1.0.0" if kind == "videoDepth" else "probe-native-1.0.0"
    schema = "schema_version" if kind == "videoDepth" else "schemaVersion"
    if not isinstance(manifest, dict) or manifest.get(schema) != expected:
        raise ValueError("Unsupported individual capture schema")
    used = {"manifest.json"}
    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if "path" in value:
                field = "bytes" if "bytes" in value else "byteCount"
                used.add(_descriptor(value, files, field))
            for item in value.values():
                walk(item)
    walk(manifest)
    if set(files) != used:
        raise ValueError("Unreferenced phase artifact")
    return manifest


def import_session_bundle(source, destination, *, max_bytes=LIMIT):
    """Validate the complete two-level archive before writing any output.

    Partial sound stops are retained. Only the exact two-phase Swift schema is
    supported; schema modality validation remains with existing individual importers.
    """
    if type(max_bytes) is not int or not 0 < max_bytes <= LIMIT:
        raise ValueError("max_bytes must be positive and at most 1 GiB")
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Choose a new private output directory")
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise ValueError("Input must be a bounded regular archive")
        raw = handle.read(info.st_size+1)
        if len(raw) != info.st_size:
            raise ValueError("Archive changed during read")
    budget = [max_bytes]
    outer = _archive(raw, budget)
    if "session.json" not in outer:
        raise ValueError("Session manifest missing")
    session = _json(outer["session.json"])
    if not isinstance(session, dict) or session.get("schemaVersion") != "singing-collection-session-1.0.0":
        raise ValueError("Unsupported linked-session schema")
    session_id = session.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("Session ID required")
    if (session.get("phaseOrder") != ["video-depth", "sound"] or session.get("simultaneous") is not False
            or session.get("sameAnatomicalPoseVerified") is not False or session.get("includedInFit") is not False):
        raise ValueError("Expected explicitly sequential, unverified-pose, unfitted session")
    stop = session.get("soundStopReason")
    if not isinstance(stop, str) or not stop.strip():
        raise ValueError("Sound stop reason required")
    phase_files, manifests, names = {}, {}, []
    for key in ("videoDepth", "sound"):
        name = _descriptor(session.get(key), outer, "byteCount")
        if name == "session.json" or name in names:
            raise ValueError("Distinct original phase archives required")
        names.append(name)
        files = _archive(outer[name], budget)
        phase_files[key] = files
        manifests[key] = _phase(files, key)
    if set(outer) != {"session.json", *names}:
        raise ValueError("Unexpected linked-session archive entry")
    video, sound = manifests["videoDepth"], manifests["sound"]
    if sound.get("stopReason") != stop:
        raise ValueError("Sound stop reason disagrees with original manifest")
    if sound.get("collectionSessionId") != session_id or sound.get("linkedDepthCaptureId") != video.get("capture_id"):
        raise ValueError("Phase capture/session identity mismatch")
    if not isinstance(video.get("capture_id"), str) or not video["capture_id"] or not isinstance(sound.get("captureId"), str) or not sound["captureId"]:
        raise ValueError("Phase capture IDs required")
    # The app's import (prepare_probe_capture.py) keeps the pull receipt beside original.zip; the sound importer checks
    # the archive against it and classifies with it. A standalone archive has no receipt, so none is suggested.
    receipt = source.parent/"usb-receipt.json"
    pulled = [str(receipt.resolve())] if source.name == "original.zip" and receipt.is_file() else []
    report = {"schemaVersion": "session-unpack-1.0.0", "sessionId": session_id,
        "sourceSha256": hashlib.sha256(raw).hexdigest(), "sessionManifestSha256": hashlib.sha256(outer["session.json"]).hexdigest(),
        "phaseOrder": session["phaseOrder"], "simultaneous": False, "sameAnatomicalPoseVerified": False,
        "includedInFit": False, "soundStopReason": stop, "soundCompleted": stop == "completed",
        "phases": {key: {"directory": "video-depth" if key == "videoDepth" else "sound",
             "originalArchive": f"originals/{session[key]['path']}", "archiveSha256": session[key]["sha256"],
             "manifestSha256": hashlib.sha256(phase_files[key]["manifest.json"]).hexdigest(),
             "files": {name: hashlib.sha256(data).hexdigest() for name, data in phase_files[key].items()}}
             for key in phase_files},
        "nextCommands": {
            "videoDepth": {"argvPrefix": ["node", "--experimental-strip-types", "scripts/import-native-capture.ts", str(destination.resolve()/"video-depth")],
                "requiredUserArguments": ["--participant", "--session", "--output"]},
            "sound": {"argv": ["node", "--experimental-strip-types", "scripts/import-acoustic-probe.ts", str(destination.resolve()/"sound"), str(destination.resolve()/"sound-analysis"), *pulled]}},
        "limitations": ["Only transport identity/hashes verified; individual importers validate modality contents.",
            "Phase order is a producer declaration, not a calibrated cross-device clock comparison.",
            "Partial stops remain captured evidence, not usable-response or calibration acceptance.",
            "No fitting, same-pose equivalence, synchronization or calibration is inferred."]}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".session-unpack-", dir=destination.parent))
    try:
        def write(path, data):
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as output:
                output.write(data)
        for name, data in outer.items():
            write(temporary/"originals"/name, data)
        for key, files in phase_files.items():
            folder = "video-depth" if key == "videoDepth" else "sound"
            for name, data in files.items():
                write(temporary/folder/name, data)
        write(temporary/"handoff.json", json.dumps(report, indent=2, allow_nan=False).encode()+b"\n")
        # Reserve the destination atomically; never replace an existing directory.
        destination.mkdir(mode=0o700)
        try:
            for child in temporary.iterdir():
                child.rename(destination/child.name)
        except BaseException:
            shutil.rmtree(destination)
            raise
    finally:
        shutil.rmtree(temporary)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    import_session_bundle(args.source, args.destination)
