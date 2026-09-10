"""Validated process-local adapter to the pinned VocalTractLab C API.

The native API has global state. Own at most one Engine per process; use processes
for concurrency. Anatomical controls and kinematic/source controls stay distinct.
"""
from __future__ import annotations

import ctypes as ct
import hashlib
import json
import math
from pathlib import Path
import sys
import threading
import xml.etree.ElementTree as ET

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / ".build/native"
REVISION = "df30392f18dc5e175b577c3ba734caaa65a3927f"
ANATOMY = [
    ("lip_width", "cm", .5, 1.5),
    ("mandible_height", "cm", .9, 1.8),
    ("lower_molars_height", "cm", .3, .7),
    ("upper_molars_height", "cm", .3, .7),
    ("palate_height", "cm", .8, 2.),
    ("palate_depth", "cm", 2.6, 5.),
    ("hard_palate_length", "cm", 2.2, 5.2),
    ("soft_palate_length", "cm", 2.3, 3.1),
    ("pharynx_length", "cm", 3.5, 8.),
    ("larynx_length", "cm", 2., 4.),
    ("larynx_width", "cm", 2., 3.5),
    ("vocal_fold_length", "cm", .5, 2.),
    ("oral_pharyngeal_angle", "deg", -105., -90.),
]
DOUBLE = ct.POINTER(ct.c_double)
_ownership = threading.Lock()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


class Engine:
    def __init__(self):
        self._closed = True
        if not _ownership.acquire(blocking=False):
            raise RuntimeError("VTL is process-global: close the existing Engine or use another process")
        initialized = False
        try:
            self._thread = threading.get_ident()
            manifest = BUILD / "manifest.json"
            if not manifest.exists():
                raise RuntimeError("Native build missing: run python science/scripts/build_native.py")
            self.provenance = json.loads(manifest.read_text())
            if self.provenance["upstream_revision"] != REVISION:
                raise RuntimeError("Native revision does not match this adapter")
            suffix = {"darwin": "dylib", "linux": "so"}.get(sys.platform)
            if suffix is None:
                raise RuntimeError("This build adapter currently supports macOS and Linux")
            library = BUILD / f"source/lib/Release/libVocalTractLabApi.{suffix}"
            speaker = BUILD / "source/resources/JD3.speaker"
            if digest(speaker) != self.provenance["speaker_sha256"]:
                raise RuntimeError("Reference speaker differs from the build manifest")
            self.provenance = {**self.provenance, "library_sha256": digest(library)}
            self.lib = ct.CDLL(str(library))
            signatures = {
                "vtlInitialize": [ct.c_char_p], "vtlClose": [],
                "vtlGetConstants": [ct.POINTER(ct.c_int)] * 5 + [DOUBLE],
                "vtlGetAnatomyParams": [DOUBLE], "vtlSetAnatomyParams": [DOUBLE],
                "vtlGetTractParams": [ct.c_char_p, DOUBLE],
                "vtlGetTractParamInfo": [ct.c_char_p] * 3 + [DOUBLE] * 3,
                "vtlGetGlottisParamInfo": [ct.c_char_p] * 3 + [DOUBLE] * 3,
                "vtlInputTractToLimitedTract": [DOUBLE, DOUBLE],
                "vtlGetTransferFunction": [DOUBLE, ct.c_int, ct.c_void_p, DOUBLE, DOUBLE],
                "vtlExportTractSvg": [DOUBLE, ct.c_char_p],
                "vtlTractToTube": [DOUBLE, DOUBLE, DOUBLE, ct.POINTER(ct.c_int), DOUBLE, DOUBLE, DOUBLE],
                "vtlSynthesisReset": [],
                "vtlSynthesisAddTract": [ct.c_int, DOUBLE, DOUBLE, DOUBLE],
            }
            for name, signature in signatures.items():
                method = getattr(self.lib, name)
                method.argtypes = signature
                method.restype = ct.c_int
            self._check(self.lib.vtlInitialize(str(speaker).encode()), "initialize")
            initialized = True
            values = [ct.c_int() for _ in range(5)]
            internal_rate = ct.c_double()
            self._check(self.lib.vtlGetConstants(*(ct.byref(x) for x in values), ct.byref(internal_rate)), "constants")
            self.sample_rate, self.tube_count, self.tract_count, self.glottis_count, self.step = [x.value for x in values]
            if not (0 < self.tract_count < 100 and 0 < self.glottis_count < 100 and 0 < self.tube_count < 1000):
                raise RuntimeError("Unexpected native buffer dimensions")
            self._closed = False
            self.base_anatomy = self.anatomy()
            self.source_info = self._param_info("vtlGetGlottisParamInfo", self.glottis_count)
            names = [x.attrib["name"] for x in ET.parse(speaker).findall("./vocal_tract_model/shapes/shape")]
            self.poses = {}
            for name in names:
                buf = (ct.c_double * self.tract_count)()
                self._check(self.lib.vtlGetTractParams(name.encode(), buf), "load pose")
                self.poses[name] = list(buf)
            if not self.poses:
                raise RuntimeError("Reference speaker contains no poses")
        except BaseException:
            if initialized:
                self.lib.vtlClose()
            self._closed = True
            _ownership.release()
            raise

    @staticmethod
    def _check(code, operation):
        if code != 0:
            raise RuntimeError(f"VTL {operation} failed with code {code}")

    def _guard(self):
        if self._closed:
            raise RuntimeError("Engine is closed")
        if threading.get_ident() != self._thread:
            raise RuntimeError("Use Engine only from its owning thread; parallelize by process")

    def close(self):
        if not self._closed:
            self._guard()
            try:
                self._check(self.lib.vtlClose(), "close")
            finally:
                self._closed = True
                _ownership.release()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def anatomy(self):
        self._guard()
        buf = (ct.c_double * len(ANATOMY))()
        self._check(self.lib.vtlGetAnatomyParams(buf), "anatomy read")
        return {row[0]: value for row, value in zip(ANATOMY, buf)}

    def set_anatomy(self, overrides):
        self._guard()
        if not isinstance(overrides, dict):
            raise ValueError("anatomy must be a mapping")
        unknown = set(overrides) - set(self.base_anatomy)
        if unknown:
            raise ValueError(f"Unknown anatomy parameters: {sorted(unknown)}")
        # Every proposal starts from one stable template, not the previous proposal.
        values = {**self.base_anatomy, **overrides}
        for name, _, low, high in ANATOMY:
            values[name] = finite(values[name], name)
            if not low <= values[name] <= high:
                raise ValueError(f"{name} outside [{low}, {high}]")
        minimum_pharynx = sum(values[k] for k in ["palate_height", "upper_molars_height", "lower_molars_height", "mandible_height"])
        if values["pharynx_length"] < minimum_pharynx:
            raise ValueError("pharynx_length violates the combined mouth/jaw height constraint")
        buf = (ct.c_double * len(ANATOMY))(*(values[row[0]] for row in ANATOMY))
        self._check(self.lib.vtlSetAnatomyParams(buf), "anatomy update")
        applied = self.anatomy()
        if not np.allclose(list(values.values()), list(applied.values()), rtol=0, atol=1e-7):
            raise RuntimeError("Native anatomy differs from requested values")
        return applied

    def _param_info(self, function, count):
        names, descriptions, units = [ct.create_string_buffer(count * n) for n in (100, 500, 100)]
        arrays = [(ct.c_double * count)() for _ in range(3)]
        self._check(getattr(self.lib, function)(names, descriptions, units, *arrays), "parameter metadata")
        texts = [b.value.decode().strip().split("\t") for b in (names, descriptions, units)]
        if any(len(t) != count for t in texts):
            raise RuntimeError("Native parameter metadata dimensions differ")
        return [{"name": texts[0][i], "description": texts[1][i], "unit": texts[2][i],
                 "min": arrays[0][i], "max": arrays[1][i], "default": arrays[2][i]} for i in range(count)]

    def pose(self, name, overrides=None):
        self._guard()
        if name not in self.poses:
            raise ValueError(f"Unknown pose {name!r}")
        info = self._param_info("vtlGetTractParamInfo", self.tract_count)
        indices = {p["name"]: i for i, p in enumerate(info)}
        values = list(self.poses[name])
        for key, value in (overrides or {}).items():
            if key not in indices:
                raise ValueError(f"Unknown articulation {key!r}")
            i = indices[key]
            value = finite(value, key)
            if not info[i]["min"] <= value <= info[i]["max"]:
                raise ValueError(f"Articulation {key} outside current anatomy's bounds")
            values[i] = value
        requested = (ct.c_double * self.tract_count)(*values)
        limited = (ct.c_double * self.tract_count)()
        self._check(self.lib.vtlInputTractToLimitedTract(requested, limited), "pose restriction")
        return limited, {p["name"]: {"requested": values[i], "applied": limited[i]} for i, p in enumerate(info)}

    def spectrum(self, pose, overrides=None, bins=1024):
        if type(bins) is not int or bins < 128 or bins > 16384 or bins & (bins - 1):
            raise ValueError("bins must be a power of two between 128 and 16384")
        params, _ = self.pose(pose, overrides)
        magnitude, phase = (ct.c_double * bins)(), (ct.c_double * bins)()
        self._check(self.lib.vtlGetTransferFunction(params, bins, None, magnitude, phase), "transfer function")
        frequency = np.arange(bins // 2 + 1) * self.sample_rate / bins
        magnitude = np.array(magnitude)[:len(frequency)]
        phase = np.array(phase)[:len(frequency)]
        if not np.isfinite(magnitude).all() or np.any(magnitude < 0) or not np.isfinite(phase).all():
            raise RuntimeError("Nonfinite or invalid transfer function")
        return frequency, 20 * np.log10(np.maximum(magnitude, 1e-12)), phase

    def capabilities(self):
        self._guard()
        return {"schema_version": "0.1.0", "engine": "VocalTractLab", "provenance": self.provenance,
                "sample_rate_hz": self.sample_rate,
                "anatomy_parameters": [{"name": n, "unit": u, "min": lo, "max": hi, "default": self.base_anatomy[n],
                                        "role": "global_geometry"} for n, u, lo, hi in ANATOMY],
                "articulation_parameters": self._param_info("vtlGetTractParamInfo", self.tract_count),
                "source_parameters": self.source_info, "poses": sorted(self.poses),
                "supports": ["forward_audio", "sagittal_svg", "tube_area_function", "shared_anatomy_synthetic_transfer_fit"],
                "unsupported": ["human_audio_inverse_fit", "depth_fusion", "nasal_outlet_occlusion", "tissue_mechanics_recovery", "calibrated_posterior"]}

    def export(self, output, pose="a", anatomy=None, articulation=None, f0_hz=160., duration_s=.4):
        output = Path(output)
        if output.exists():
            raise ValueError(f"Output already exists: {output}; choose a new directory")
        f0_hz, duration_s = finite(f0_hz, "f0_hz"), finite(duration_s, "duration_s")
        if not 40 <= f0_hz <= 1000 or not .1 <= duration_s <= 5:
            raise ValueError("Demo F0 must be 40-1000 Hz and duration 0.1-5 seconds")
        applied = self.set_anatomy(anatomy or {})
        params, pose_record = self.pose(pose, articulation)
        source = (ct.c_double * self.glottis_count)(*(p["default"] for p in self.source_info))
        source_names = {p["name"]: i for i, p in enumerate(self.source_info)}
        if "F0" not in source_names or "PR" not in source_names:
            raise RuntimeError("Unexpected source model: expected F0 and PR controls")
        f0_info = self.source_info[source_names["F0"]]
        if not f0_info["min"] <= f0_hz <= f0_info["max"]:
            raise ValueError("F0 outside the selected native source model's bounds")
        source[source_names["F0"]] = f0_hz
        source[source_names["PR"]] = 0
        count = round(duration_s * self.sample_rate)
        ramp = min(round(.025 * self.sample_rate), count)
        self._check(self.lib.vtlSynthesisReset(), "synthesis reset")
        empty = (ct.c_double * 1)()
        self._check(self.lib.vtlSynthesisAddTract(0, empty, params, source), "synthesis initialize")
        source[source_names["PR"]] = 8000
        attack = (ct.c_double * ramp)()
        sustain = (ct.c_double * (count-ramp))()
        self._check(self.lib.vtlSynthesisAddTract(ramp, attack, params, source), "synthesis attack")
        self._check(self.lib.vtlSynthesisAddTract(count-ramp, sustain, params, source), "synthesis sustain")
        audio = np.concatenate([np.array(attack), np.array(sustain)])
        if not np.isfinite(audio).all() or np.max(np.abs(audio)) == 0:
            raise RuntimeError("Native synthesis returned nonfinite or silent output")
        frequency, db, phase = self.spectrum(pose, articulation)
        lengths, areas = (ct.c_double * self.tube_count)(), (ct.c_double * self.tube_count)()
        articulators = (ct.c_int * self.tube_count)()
        incisors, tongue_side, velum = ct.c_double(), ct.c_double(), ct.c_double()
        self._check(self.lib.vtlTractToTube(params, lengths, areas, articulators, ct.byref(incisors), ct.byref(tongue_side), ct.byref(velum)), "tube geometry")
        output.mkdir(parents=True)
        try:
            wavfile.write(output / "audio.wav", self.sample_rate, audio.astype(np.float32))
            self._check(self.lib.vtlExportTractSvg(params, str(output / "tract.svg").encode()), "SVG export")
            write_json(output / "transfer.json", {"frequency_hz": frequency.tolist(), "magnitude_db": db.tolist(), "phase_rad": phase.tolist(),
                                                  "kind": "simulator_transfer_function_not_measured_audio"})
            write_json(output / "geometry.json", {"kind": "model_tube_geometry", "length_cm": list(lengths), "area_cm2": list(areas),
                                                  "articulator_index": list(articulators), "velum_opening_cm2": velum.value})
            record = {"schema_version": "0.1.0", "kind": "synthetic_forward_export", "anatomy": applied, "pose": pose,
                      "articulation": pose_record, "f0_hz": f0_hz, "duration_s": len(audio)/self.sample_rate,
                      "sample_rate_hz": self.sample_rate, "peak_absolute_amplitude": float(np.max(np.abs(audio))),
                      "source": "geometric glottis with a pressure ramp; not inferred tissue mechanics",
                      "provenance": self.provenance, "files": {p.name: digest(p) for p in sorted(output.iterdir())}}
            write_json(output / "manifest.json", record)
        except BaseException:
            # No valid manifest means the caller must not treat a partial export as complete.
            (output / "manifest.json").unlink(missing_ok=True)
            raise
        return record
