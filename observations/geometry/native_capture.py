"""Verified original SingingDepth artifacts and explicit geometry readiness gates.

This consumes the original native directory; KIT import remains owned by B.
Raw AVDepthData is never relabeled rectified or used as a world/head pose.
"""
from dataclasses import dataclass
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import numpy as np

_LIMIT = 512 * 1024 * 1024


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be nonempty text")
    return value


def _integer(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def _timestamp(value):
    if not isinstance(value, dict):
        raise ValueError("timestamp must be native CMTime metadata")
    ticks = _integer(value.get("value"), "timestamp value")
    scale = _integer(value.get("timescale"), "timestamp timescale", 1)
    epoch = _integer(value.get("epoch"), "timestamp epoch")
    flags = _integer(value.get("flags"), "timestamp flags")
    seconds = value.get("seconds")
    if (not flags & 1 or flags & 28 or isinstance(seconds, bool)
            or not isinstance(seconds, (int, float)) or not np.isfinite(seconds)
            or abs(ticks / scale - seconds) > 1e-6):
        raise ValueError("invalid or inconsistent native timestamp")
    return ticks / scale, epoch


def _dimensions(value, name):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{name} requires width,height")
    w, h = [_integer(x, name, 1) for x in value]
    if w * h > _LIMIT // 4:
        raise ValueError("depth dimensions exceed capture limit")
    return w, h


def _calibration(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("calibration must be an object or null")
    for key, shape in (("intrinsics_row_major", (3, 3)), ("extrinsics_3x4_row_major", (3, 4))):
        matrix = np.asarray(value.get(key), dtype=float)
        if matrix.shape != shape or not np.isfinite(matrix).all():
            raise ValueError(f"invalid {key}")
    k = np.asarray(value["intrinsics_row_major"])
    if k[0, 0] <= 0 or k[1, 1] <= 0 or not np.allclose(k[2], [0, 0, 1], atol=1e-9, rtol=0):
        raise ValueError("invalid native intrinsics")
    _dimensions(value.get("intrinsic_reference_dimensions"), "intrinsic reference dimensions")
    pixel_size = value.get("pixel_size_mm")
    if isinstance(pixel_size, bool) or not isinstance(pixel_size, (int, float)) or not np.isfinite(pixel_size) or pixel_size <= 0:
        raise ValueError("invalid calibration pixel size")
    center = np.asarray(value.get("lens_distortion_center"), float)
    if center.shape != (2,) or not np.isfinite(center).all():
        raise ValueError("invalid distortion center")
    for field in ("lens_distortion_table_base64", "inverse_lens_distortion_table_base64"):
        encoded = value.get(field)
        if encoded is not None:
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise ValueError("invalid encoded distortion table") from exc
            if len(raw) % 4 or not np.isfinite(np.frombuffer(raw, dtype="<f4")).all():
                raise ValueError("invalid distortion table floats")
    return value


@dataclass(frozen=True)
class NativeDepthFrame:
    sequence: int
    source_frame_id: str
    evidence_id: str | None
    timebase_id: str
    timestamp_seconds: float
    depth_m: np.ndarray | None
    calibration: dict | None
    source_metadata: dict
    readiness: dict


@dataclass(frozen=True)
class NativeCapture:
    capture_id: str
    manifest_sha256: str
    artifacts: dict
    frames: tuple[NativeDepthFrame, ...]


def read_native_capture(directory, *, max_bytes=_LIMIT, allow_rear_lidar=False):
    """Verify source artifacts and decode packed metric axial depth without fusion.

    evidence/timebase identifiers match B's native KIT importer. Numeric CMTime
    gives ordering, not physical audio alignment. Provenance hashes establish
    byte consistency, never genuine device origin or measurement accuracy.
    """
    _integer(max_bytes, "max_bytes", 1)
    if max_bytes > _LIMIT:
        raise ValueError("max_bytes cannot exceed 512 MiB")
    root = Path(directory).resolve(strict=True)
    buffers = {}
    total = 0

    def read(name):
        nonlocal total
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
            raise ValueError("artifact path must be a safe local filename")
        if name in buffers:
            return buffers[name]
        descriptor = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size + total > max_bytes:
                raise ValueError("nonregular artifact or capture byte limit exceeded")
            data = handle.read(info.st_size + 1)
            if len(data) != info.st_size:
                raise ValueError("artifact changed during read")
        total += len(data)
        buffers[name] = data
        return data

    raw_manifest = read("manifest.json")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate manifest JSON key")
            result[key] = value
        return result
    manifest = json.loads(raw_manifest, object_pairs_hook=pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite manifest JSON")))
    if (not isinstance(manifest, dict) or manifest.get("schema_version") != "singing-native-rgbd-1.0.0"
            or manifest.get("capture_mode") not in ("one-held-pose", "separate-rear-lidar-held-pose")):
        raise ValueError("unsupported native capture schema/mode")
    capture_id = _text(manifest.get("capture_id"), "capture_id")
    device = manifest.get("device", {})
    sensor = "unsupported"
    if isinstance(device, dict) and device.get("output_mirrored") is False:
        if "TrueDepth" in str(device.get("device_type", "")) and device.get("position") == "front" and manifest.get("capture_mode") == "one-held-pose":
            sensor = "front-truedepth"
        elif "LiDAR" in str(device.get("device_type", "")) and device.get("position") == "back" and device.get("sensor") == "rear-lidar" and manifest.get("capture_mode") == "separate-rear-lidar-held-pose":
            if not allow_rear_lidar:raise ValueError("Optional rear LiDAR ingestion is disabled")
            sensor = "rear-lidar"
    if sensor == "unsupported":raise ValueError("expected declared unmirrored front TrueDepth or explicitly enabled rear LiDAR capture")
    artifacts = {}
    def verify(value):
        if isinstance(value, list):
            for item in value:
                verify(item)
        elif isinstance(value, dict):
            if "path" in value:
                data = read(value["path"])
                count = _integer(value.get("bytes"), "artifact bytes")
                digest = hashlib.sha256(data).hexdigest()
                if len(data) != count or digest != value.get("sha256"):
                    raise ValueError("artifact hash or byte count mismatch")
                artifacts[f"{capture_id}/artifact/{value['path']}"] = {"path": value["path"], "sha256": digest, "bytes": count}
            for child in value.values():
                verify(child)
    verify(manifest)
    manifest_hash = hashlib.sha256(raw_manifest).hexdigest()
    artifacts[f"{capture_id}/artifact/manifest.json"] = {"path": "manifest.json", "sha256": manifest_hash, "bytes": len(raw_manifest)}
    rows = manifest.get("frames")
    if not isinstance(rows, list):
        raise ValueError("frames must be an array")
    frames = []
    prior_sequence, prior_timestamp, prior_epoch = -1, None, None
    prior_depth_timestamp = None
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("frame must be an object")
        sequence = _integer(row.get("sequence"), "frame sequence")
        capture_timestamp, capture_epoch = _timestamp(row.get("capture_clock_timestamp"))
        if sequence <= prior_sequence or (prior_timestamp is not None and
                (capture_timestamp < prior_timestamp or capture_epoch != prior_epoch)):
            raise ValueError("native capture sequence/clock reversed or changed epoch")
        prior_sequence, prior_timestamp, prior_epoch = sequence, capture_timestamp, capture_epoch
        ref = row.get("depth")
        depth, calibration, evidence = None, None, None
        timestamp, epoch = capture_timestamp, capture_epoch
        blocked = ["native_distortion_not_rectified", "depth_noise_not_calibrated",
                   "audio_clock_alignment_not_measured", "absolute_sync_uncertainty_unknown",
                   "world_head_pose_not_measured", "landmark_correspondence_not_validated"]
        if ref is None:
            if not row.get("depth_dropped") and not row.get("write_error"):
                raise ValueError("missing depth requires drop/write-error reason")
            blocked.append("depth_missing")
        else:
            if row.get("depth_dropped"):
                raise ValueError("present depth cannot be declared dropped")
            if row.get("depth_unit") != "m" or row.get("depth_storage") != "row-major-little-endian-float32-packed":
                raise ValueError("unsupported raw depth units/storage")
            if type(row.get("depth_filtered")) is not bool:
                raise ValueError("depth filtering status must be explicit")
            if row["depth_filtered"]:
                blocked.append("filtered_depth_requires_measured_sample_mask")
            w, h = _dimensions(row.get("depth_dimensions"), "depth dimensions")
            raw = buffers[ref["path"]]
            if len(raw) != w * h * 4:
                raise ValueError("depth dimensions disagree with packed bytes")
            depth = np.frombuffer(raw, dtype="<f4").reshape(h, w).copy()
            depth.setflags(write=False)
            timestamp, epoch = _timestamp(row.get("depth_timestamp"))
            if epoch != capture_epoch:
                raise ValueError("depth and capture timestamp epochs differ")
            if prior_depth_timestamp is not None and timestamp < prior_depth_timestamp:
                raise ValueError("native depth clock reversed")
            prior_depth_timestamp = timestamp
            evidence = f"{capture_id}/artifact/{ref['path']}"
            calibration = _calibration(row.get("calibration"))
            if calibration is None:
                blocked.append("camera_calibration_missing")
            if row.get("depth_accuracy_label") != "absolute":
                blocked.append("absolute_depth_accuracy_not_declared")
            if not np.any(np.isfinite(depth) & (depth > 0)):
                blocked.append("no_positive_finite_depth")
        if sensor == "rear-lidar":blocked.append("vendor_fused_depth_support_not_independently_characterized")
        valid = int(np.count_nonzero(np.isfinite(depth) & (depth > 0))) if depth is not None else 0
        readiness = {"sensor": sensor, "separate_scan": sensor == "rear-lidar", "decoded_axial_depth_m": depth is not None, "positive_finite_pixels": valid,
            "total_pixels": int(depth.size) if depth is not None else 0, "calibration_metadata_present": calibration is not None,
            "metric_points_ready": False, "joint_fusion_ready": False, "blocking_reasons": blocked,
            "calibration_extrinsics_are_world_pose": False, "manifest_sha256": manifest_hash}
        frames.append(NativeDepthFrame(sequence, _text(row.get("id", f"frame-{sequence}"), "source frame id"), evidence,
            f"{capture_id}/depth/synchronizer/epoch-{epoch}", timestamp, depth, calibration, row, readiness))
    return NativeCapture(capture_id, manifest_hash, artifacts, tuple(frames))
