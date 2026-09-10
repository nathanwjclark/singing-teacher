"""Content-addressed physical forecasts for frozen candidate geometries.

These predict tract transfer, not microphone recordings or calibrated uncertainty.
The caller commits the returned artifact before collecting its target evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path

import numpy as np

from .engine import ANATOMY, Engine, finite


def _encode(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    except (ValueError, TypeError) as exc:
        raise ValueError("Artifact must contain finite JSON data") from exc


def _identity(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")
    return value


def _timestamp(value):
    _identity(value, "timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("timestamp must be ISO 8601") from exc
    if parsed.utcoffset() is None:
        raise ValueError("timestamp must include timezone")
    return parsed


@dataclass(frozen=True)
class Artifact:
    """Immutable bytes; reading data returns a detached copy, never mutable state."""
    content: bytes

    def __post_init__(self):
        if not isinstance(self.content, bytes):
            raise ValueError("Artifact content must be immutable bytes")

    @property
    def sha256(self):
        return hashlib.sha256(self.content).hexdigest()

    @property
    def data(self):
        return json.loads(self.content)

    def write(self, path):
        """Exclusive creation; an existing prediction is never overwritten."""
        with Path(path).open("xb") as stream:
            stream.write(self.content)


def freeze_candidates(*, model_id, evidence_ids, provenance, candidates, frozen_at):
    """Freeze explicit candidate IDs and anatomy overrides plus their evidence lineage."""
    _identity(model_id, "model_id")
    _timestamp(frozen_at)
    if not isinstance(evidence_ids, list) or not evidence_ids:
        raise ValueError("evidence_ids must be a nonempty list")
    for item in evidence_ids:
        _identity(item, "evidence_id")
    if len(set(evidence_ids)) != len(evidence_ids):
        raise ValueError("Duplicate evidence IDs")
    if not isinstance(provenance, dict) or not provenance:
        raise ValueError("Engine provenance is required")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Candidates must be a nonempty list")
    ids = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) != {"candidate_id", "anatomy"}:
            raise ValueError("Each candidate needs candidate_id and anatomy only")
        ids.append(_identity(candidate["candidate_id"], "candidate_id"))
        if not isinstance(candidate["anatomy"], dict) or not candidate["anatomy"]:
            raise ValueError("Explicit candidate anatomy is required")
        for key, value in candidate["anatomy"].items():
            _identity(key, "anatomy parameter")
            finite(value, key)
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate candidate IDs")
    return Artifact(_encode({"schema_version": "0.1.0", "kind": "frozen_anatomy_candidates",
        "model_id": model_id, "evidence_ids": evidence_ids, "provenance": provenance,
        "candidates": candidates, "frozen_at": frozen_at}))


def predict(snapshot: Artifact, *, expected_digest, prediction_id, target_evidence_id,
            generated_at, intervention, bins=512, repeat_variability=None):
    """Forecast a named pose with optional native articulation overrides.

    repeat_variability, when supplied, must describe independently measured repeat
    SDs on this exact transfer-frequency grid with its own evidence IDs. It is not
    inferred from candidate disagreement. Prediction owns and closes its Engine.
    """
    if not isinstance(snapshot, Artifact) or snapshot.sha256 != expected_digest:
        raise ValueError("Frozen candidate digest mismatch")
    try:
        data = snapshot.data
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid candidate JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("Candidate artifact must be a JSON object")
    required = {"schema_version", "kind", "model_id", "evidence_ids", "provenance",
                "candidates", "frozen_at"}
    if set(data) != required:
        raise ValueError("Invalid candidate artifact fields")
    if data.get("kind") != "frozen_anatomy_candidates" or data.get("schema_version") != "0.1.0":
        raise ValueError("Unsupported frozen candidate artifact")
    validated = freeze_candidates(**{k: data[k] for k in (
        "model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
    if validated.content != snapshot.content:
        raise ValueError("Candidate artifact is not canonical or has extra fields")
    _identity(prediction_id, "prediction_id")
    _identity(target_evidence_id, "target_evidence_id")
    if target_evidence_id in data["evidence_ids"]:
        raise ValueError("Target evidence must not be fitting evidence")
    if _timestamp(generated_at) < _timestamp(data["frozen_at"]):
        raise ValueError("Prediction precedes model freeze")
    if not isinstance(intervention, dict) or set(intervention) - {"kind", "pose", "articulation"}:
        raise ValueError("Invalid intervention fields")
    if intervention.get("kind") != "named_pose":
        raise ValueError("Only named_pose is supported; nasal plugging is unsupported")
    _identity(intervention.get("pose"), "pose")
    articulation = intervention.get("articulation", {})
    if not isinstance(articulation, dict):
        raise ValueError("articulation must be a mapping")
    with Engine() as engine:
        if data["provenance"] != engine.provenance:
            raise ValueError("Candidate provenance differs from current engine")
        spectra, records = [], []
        for candidate in data["candidates"]:
            applied = engine.set_anatomy(candidate["anatomy"])
            _, controls = engine.pose(intervention["pose"], articulation)
            frequency, magnitude, _ = engine.spectrum(intervention["pose"], articulation, bins=bins)
            spectra.append(magnitude)
            records.append({"candidate_id": candidate["candidate_id"], "anatomy": applied,
                            "articulation": controls, "magnitude_db": magnitude.tolist()})
        sample_rate = engine.sample_rate
    stack = np.asarray(spectra)
    sd = stack.std(axis=0, ddof=0)
    disagreement = {"interpretation": "unweighted_candidate_disagreement_not_calibrated_posterior",
                    "population_sd_db": sd.tolist(), "range_db": np.ptp(stack, axis=0).tolist(),
                    "rms_population_sd_db": float(np.sqrt(np.mean(sd ** 2)))}
    if repeat_variability is not None:
        if not isinstance(repeat_variability, dict) or set(repeat_variability) != {
                "frequency_hz", "sd_db", "evidence_ids", "quantity"}:
            raise ValueError("Repeat variability requires frequency_hz, sd_db, evidence_ids, quantity")
        if repeat_variability["quantity"] != "tract_transfer_magnitude_db":
            raise ValueError("Repeat variability must measure the same transfer quantity")
        ids = repeat_variability["evidence_ids"]
        if not isinstance(ids, list) or not ids:
            raise ValueError("Repeat variability needs measured evidence IDs")
        for item in ids:
            _identity(item, "repeat evidence ID")
        if len(set(ids)) != len(ids) or target_evidence_id in ids:
            raise ValueError("Repeat evidence must be distinct and precede target evidence")
        rf = np.asarray(repeat_variability["frequency_hz"], dtype=float)
        noise = np.asarray(repeat_variability["sd_db"], dtype=float)
        if rf.shape != frequency.shape or not np.array_equal(rf, frequency):
            raise ValueError("Repeat frequency grid mismatch")
        if noise.shape != sd.shape or not np.isfinite(noise).all() or np.any(noise < 0):
            raise ValueError("Repeat SD must be finite, nonnegative and match grid")
        disagreement["exceeds_measured_repeat_sd"] = (sd > noise).tolist()
    return Artifact(_encode({"schema_version": "0.1.0", "kind": "simulated_tract_transfer_prediction",
        "prediction_id": prediction_id, "model_id": data["model_id"],
        "candidate_snapshot_sha256": snapshot.sha256, "fitting_evidence_ids": data["evidence_ids"],
        "target_evidence_id": target_evidence_id, "generated_at": generated_at,
        "model_frozen_at": data["frozen_at"], "provenance": data["provenance"],
        "intervention": intervention, "sample_rate_hz": sample_rate, "bins": bins,
        "frequency_hz": frequency.tolist(), "quantity": "tract_transfer_magnitude_db",
        "units": {"frequency": "Hz", "magnitude": "dB", "anatomy": {name: unit for name, unit, _, _ in ANATOMY}},
        "candidates": records, "disagreement": disagreement,
        "measured_repeat_variability": repeat_variability,
        "limitations": ["Not microphone audio", "No calibrated posterior", "No nasal outlet occlusion",
                        "Commit-before-capture enforcement belongs to capture coordinator"]}))
