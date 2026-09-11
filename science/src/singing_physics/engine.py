"""Validated process-local adapter to the pinned VocalTractLab C API.

The native API has global state. Own at most one Engine per process; use processes
for concurrency. Anatomical controls and kinematic/source controls stay distinct.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import ctypes as ct
import hashlib
import json
import math
from numbers import Real
from pathlib import Path
import sys
import threading
import tempfile
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
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value):
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
            if digest(ROOT / "patches/anatomy-tongue-bounds.patch") != self.provenance["patch_sha256"]:
                raise RuntimeError("Native patch differs from the build manifest")
            certified_hash = self.provenance.get("library_sha256")
            if not isinstance(certified_hash, str) or len(certified_hash) != 64 or any(c not in "0123456789abcdef" for c in certified_hash):
                raise RuntimeError("Native build lacks a certified library hash: rebuild with python science/scripts/build_native.py")
            library_hash = digest(library)
            if certified_hash != library_hash:
                raise RuntimeError("Native library differs from the build manifest")
            self.provenance = {**self.provenance, "library_sha256": library_hash}
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
                "vtlTractSequenceToEmaAndMesh": [DOUBLE, DOUBLE, ct.c_int, ct.c_int, ct.c_int, ct.c_int, ct.POINTER(ct.c_int), ct.POINTER(ct.c_int), ct.c_char_p, ct.c_char_p],
                "vtlSynthesisReset": [],
                "vtlSynthesisAddTract": [ct.c_int, DOUBLE, DOUBLE, DOUBLE],
            }
            for name, signature in signatures.items():
                method = getattr(self.lib, name)
                method.argtypes = signature
                method.restype = ct.c_int
            self._check(self.lib.vtlInitialize(str(speaker).encode()), "initialize")
            initialized = True
            self._native_initialized = True
            self.source_model_family = "Geometric glottis"
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
            # JD3's detailed stored geometry is not exactly reconstructed by its
            # 13 AnatomyParams. Use one representational basis from the first
            # forward call so freezing/reapplying those parameters is lossless
            # within this adapter, including the default speaker.
            self.set_anatomy(self.base_anatomy)
            self.provenance = {**self.provenance,
                "geometry_basis": "vtl-anatomy-params-reconstructed-v1"}
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
                if self._native_initialized:
                    self._check(self.lib.vtlClose(), "close")
                    self._native_initialized = False
            finally:
                self._closed = True
                _ownership.release()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _load_source_family(self, family, anatomy):
        """Select a native model by changing only certified speaker selection bits."""
        speaker = BUILD / "source/resources/JD3.speaker"
        if digest(speaker) != self.provenance["speaker_sha256"]:
            raise RuntimeError("Reference speaker changed before source selection")
        tree = ET.parse(speaker)
        models = tree.getroot().findall("./glottis_models/glottis_model")
        if family not in {row.get("type") for row in models}:
            raise ValueError("Unsupported native source family")
        for row in models:
            row.set("selected", "1" if row.get("type") == family else "0")
        raw = ET.tostring(tree.getroot(), encoding="utf-8", xml_declaration=True)
        with tempfile.TemporaryDirectory(prefix="singing-source-family-") as directory:
            path = Path(directory) / "selected.speaker"
            path.write_bytes(raw)
            if self._native_initialized:
                self._check(self.lib.vtlClose(), "close before source selection")
                self._native_initialized = False
            self._check(self.lib.vtlInitialize(str(path).encode()), "source model initialize")
            self._native_initialized = True
        values = [ct.c_int() for _ in range(5)]
        internal_rate = ct.c_double()
        self._check(self.lib.vtlGetConstants(*(ct.byref(x) for x in values), ct.byref(internal_rate)), "source constants")
        rate, tubes, tract, count, step = [x.value for x in values]
        if (rate, tubes, tract, step) != (self.sample_rate, self.tube_count, self.tract_count, self.step) or not 0 < count < 100:
            raise RuntimeError("Source model changed native tract dimensions")
        self.glottis_count = count
        self.source_info = self._param_info("vtlGetGlottisParamInfo", count)
        self.source_model_family = family
        self.set_anatomy(anatomy)
        self.provenance = {**self.provenance, "selected_source_family": family,
            "selected_source_speaker_sha256": hashlib.sha256(raw).hexdigest(),
            "source_selection_policy": "certified-JD3-selection-only-v1"}

    @contextmanager
    def source_model(self, family):
        """Use a native glottis model temporarily, restoring exact caller state.

        Speaker masses, stiffnesses and all other static parameters remain the
        certified template values. Their availability is not evidence that these
        properties can be identified in a human from microphone recordings.
        """
        self._guard()
        if family not in ("Geometric glottis", "Two-mass model"):
            raise ValueError("Unsupported native source family")
        previous = self.source_model_family
        if family == previous:
            yield self
            return
        saved, provenance = self.anatomy(), deepcopy(self.provenance)
        try:
            self._load_source_family(family, saved)
            yield self
        finally:
            try:
                self._load_source_family(previous, saved)
                self.provenance = provenance
            except BaseException:
                self.close()
                raise

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
        texts = [b.value.decode().strip(" \r\n").split("\t") for b in (names, descriptions, units)]
        if any(len(t) != count for t in texts):
            raise RuntimeError("Native parameter metadata dimensions differ")
        return [{"name": texts[0][i], "description": texts[1][i], "unit": texts[2][i],
                 "min": arrays[0][i], "max": arrays[1][i], "default": arrays[2][i]} for i in range(count)]

    def pose(self, name, overrides=None):
        self._guard()
        if not isinstance(name, str) or name not in self.poses:
            raise ValueError(f"Unknown pose {name!r}")
        if overrides is not None and not isinstance(overrides, dict):
            raise ValueError("articulation must be a mapping")
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
                "supports": ["forward_audio", "sagittal_svg", "tube_area_function", "shared_anatomy_synthetic_transfer_fit", "native_outer_lip_markers", "native_surface_mesh_obj"],
                "unsupported": ["human_audio_inverse_fit", "full_internal_anatomy_depth_reconstruction", "nasal_outlet_occlusion", "tissue_mechanics_recovery", "calibrated_posterior"]}

    def synthesize(self, pose, articulation=None, f0_hz=160., duration_s=.4):
        """Synthesize a stationary pose at the current anatomy; return float64 audio.

        Each call resets the acoustic solver and ramps glottal pressure over 25 ms.
        Values are native amplitudes, not normalized or microphone-calibrated sound.
        """
        self._guard()
        f0_hz, duration_s = finite(f0_hz, "f0_hz"), finite(duration_s, "duration_s")
        if not 40 <= f0_hz <= 1000 or not .1 <= duration_s <= 5:
            raise ValueError("F0 must be 40-1000 Hz and duration 0.1-5 seconds")
        params, _ = self.pose(pose, articulation)
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
        return audio

    def geometry(self, pose, articulation=None):
        """Return the current model's discretized tract, not measured anatomy."""
        params, pose_record = self.pose(pose, articulation)
        lengths, areas = (ct.c_double * self.tube_count)(), (ct.c_double * self.tube_count)()
        articulators = (ct.c_int * self.tube_count)()
        incisors, tongue_side, velum = ct.c_double(), ct.c_double(), ct.c_double()
        self._check(self.lib.vtlTractToTube(params, lengths, areas, articulators, ct.byref(incisors), ct.byref(tongue_side), ct.byref(velum)), "tube geometry")
        numeric = [*lengths, *areas, incisors.value, tongue_side.value, velum.value]
        if not np.isfinite(numeric).all() or min(lengths) <= 0 or min(areas) < 0 or velum.value < 0:
            raise RuntimeError("Native tube geometry contains invalid dimensions")
        return {"kind": "model_tube_geometry", "length_cm": list(lengths), "area_cm2": list(areas),
                "articulator_index": list(articulators), "velum_opening_cm2": velum.value,
                "incisor_position_cm": incisors.value, "tongue_side_elevation": tongue_side.value,
                "tongue_side_elevation_parameter": "TS3", "anatomy": self.anatomy(),
                "pose": pose, "articulation": pose_record}

    def _native_surface_files(self, params):
        """Read exact native static-frame files; never synthesize a mesh in Python."""
        source = (ct.c_double * self.glottis_count)(*(p["default"] for p in self.source_info))
        surfaces = (ct.c_int * 2)(4, 5)
        vertices = (ct.c_int * 2)(89, 89)
        with tempfile.TemporaryDirectory(prefix="singing-lip-markers-") as temporary:
            self._check(self.lib.vtlTractSequenceToEmaAndMesh(
                params, source, self.tract_count, self.glottis_count, 1, 2,
                surfaces, vertices, temporary.encode(), b"tract"), "lip marker export")
            root = Path(temporary)
            return {"tract-ema.txt": (root / "tract-ema.txt").read_bytes(),
                    "tract0.obj": (root / "tract-meshes/tract0.obj").read_bytes(),
                    "tract0.mtl": (root / "tract-meshes/tract0.mtl").read_bytes()}

    @staticmethod
    def _mesh_metadata(files):
        vertices, normals, faces, materials = [], [], [], []
        try:
            for line in files["tract0.obj"].decode("utf-8").splitlines():
                parts = line.split()
                if not parts:
                    continue
                if parts[0] == "v":
                    vertices.append([float(x) for x in parts[1:]])
                elif parts[0] == "vn":
                    normals.append([float(x) for x in parts[1:]])
                elif parts[0] == "f":
                    faces.append([tuple(int(x) for x in token.split("//")) for token in parts[1:]])
                elif parts[0] == "mtllib":
                    materials.append(parts[1:])
            for vectors in (vertices, normals):
                array = np.array(vectors)
                if array.ndim != 2 or array.shape[1] != 3 or not len(array) or not np.isfinite(array).all():
                    raise ValueError("invalid vertex or normal vectors")
            if not faces or any(len(face) != 3 or any(len(pair) != 2 or not 1 <= pair[0] <= len(vertices)
                    or not 1 <= pair[1] <= len(normals) for pair in face) for face in faces):
                raise ValueError("invalid triangle indices")
            if materials != [["tract0.mtl"]] or b"newmtl " not in files["tract0.mtl"]:
                raise ValueError("missing native material definitions")
        except (ValueError, UnicodeError) as exc:
            raise RuntimeError("Invalid native OBJ mesh") from exc
        return {"kind": "model_derived_template_conditional_surface_mesh_not_scan",
                "format": "Wavefront OBJ", "file": "tract0.obj", "material_file": "tract0.mtl",
                "coordinate_unit": "cm", "meters_per_coordinate_unit": .01,
                "coordinate_frame": "vtl_model", "vertex_count": len(vertices),
                "triangle_count": len(faces), "normal_count": len(normals),
                "source": "VocalTract::saveAsObjFile(saveBothSides=true)",
                "limitations": ["Not measured or reconstructed human anatomy", "Not validated as watertight"]}

    def lip_markers(self, pose, articulation=None):
        """Native outer-lip surface markers in model coordinates, not aperture edges.

        Fixed surface/vertex identities are source-verified at the pinned revision.
        The upstream exporter also writes a mesh; both temporary outputs are removed.
        """
        params, controls = self.pose(pose, articulation)
        raw = self._native_surface_files(params)["tract-ema.txt"]
        lines = raw.decode("utf-8").splitlines()
        expected = "time(s) UPPER LIP_89-x[cm] UPPER LIP_89-y[cm] UPPER LIP_89-z[cm] LOWER LIP_89-x[cm] LOWER LIP_89-y[cm] LOWER LIP_89-z[cm]"
        if len(lines) != 2 or " ".join(lines[0].split()) != expected:
            raise RuntimeError("Unexpected native lip marker header or frame count")
        try:
            row = np.array([float(x) for x in lines[1].split()])
        except ValueError as exc:
            raise RuntimeError("Invalid native lip marker coordinates") from exc
        if row.shape != (7,) or not np.isfinite(row).all() or row[0] != 0:
            raise RuntimeError("Invalid native lip marker coordinates or sequence offset")
        upper, lower = row[1:4] * .01, row[4:7] * .01
        distance = float(np.linalg.norm(upper - lower))
        return {"operator_id": "vtl-upper4-lower5-vertex89-distance-v1",
                "distance_m": distance, "value_m": distance,
                "positions_m": {"upper": upper.tolist(), "lower": lower.tolist()},
                "coordinate_frame": "vtl_model", "native_coordinate_unit": "cm",
                "upper_surface_vertex": [4, 89], "lower_surface_vertex": [5, 89],
                "sequence_offset_seconds": 0., "frame_index": 0,
                "artifact_sha256": hashlib.sha256(raw).hexdigest(),
                "articulation": controls, "anatomy": self.anatomy(), "pose": pose}

    def export(self, output, pose="a", anatomy=None, articulation=None, f0_hz=160., duration_s=.4):
        """Export matching artifacts. Omitted anatomy preserves the current model.

        Explicit anatomy uses set_anatomy's template-relative semantics. Failed
        exports restore the previous anatomy; partial output has no manifest.
        """
        self._guard()
        output = Path(output)
        if output.exists():
            raise ValueError(f"Output already exists: {output}; choose a new directory")
        previous = self.anatomy()
        try:
            if anatomy is not None:
                self.set_anatomy(anatomy)
            return self._export_current(output, pose, articulation, f0_hz, duration_s)
        except BaseException:
            if self.anatomy() != previous:
                self.set_anatomy(previous)
            raise

    def _export_current(self, output, pose, articulation, f0_hz, duration_s):
        f0_hz, duration_s = finite(f0_hz, "f0_hz"), finite(duration_s, "duration_s")
        audio = self.synthesize(pose, articulation, f0_hz, duration_s)
        applied = self.anatomy()
        params, pose_record = self.pose(pose, articulation)
        frequency, db, phase = self.spectrum(pose, articulation)
        geometry = self.geometry(pose, articulation)
        surface_files = self._native_surface_files(params)
        surface_mesh = self._mesh_metadata(surface_files)
        output.mkdir(parents=True)
        try:
            wavfile.write(output / "audio.wav", self.sample_rate, audio.astype(np.float32))
            self._check(self.lib.vtlExportTractSvg(params, str(output / "tract.svg").encode()), "SVG export")
            write_json(output / "transfer.json", {"frequency_hz": frequency.tolist(), "magnitude_db": db.tolist(), "phase_rad": phase.tolist(),
                                                  "kind": "simulator_transfer_function_not_measured_audio"})
            write_json(output / "geometry.json", geometry)
            for name, raw in surface_files.items():
                (output / name).write_bytes(raw)
            write_json(output / "surface-mesh.json", surface_mesh)
            record = {"schema_version": "0.1.0", "kind": "synthetic_forward_export", "anatomy": applied, "pose": pose,
                      "articulation": pose_record, "f0_hz": f0_hz, "duration_s": len(audio)/self.sample_rate,
                      "sample_rate_hz": self.sample_rate, "peak_absolute_amplitude": float(np.max(np.abs(audio))),
                      "source": "geometric glottis with a pressure ramp; not inferred tissue mechanics",
                      "surface_mesh": surface_mesh, "provenance": self.provenance, "files": {p.name: digest(p) for p in sorted(output.iterdir())}}
            write_json(output / "manifest.json", record)
        except BaseException:
            # No valid manifest means the caller must not treat a partial export as complete.
            (output / "manifest.json").unlink(missing_ok=True)
            raise
        return record
