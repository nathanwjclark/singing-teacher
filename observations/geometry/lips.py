"""Source-defined VTL outer-lip EMA marker distance observation operator."""
from hashlib import sha256
from pathlib import Path
import numpy as np
from .depth import surface_distance, _finite

OPERATOR_ID = "vtl-upper4-lower5-vertex89-distance-v1"
_HEADER = "time(s) UPPER LIP_89-x[cm] UPPER LIP_89-y[cm] UPPER LIP_89-z[cm] LOWER LIP_89-x[cm] LOWER LIP_89-y[cm] LOWER LIP_89-z[cm]"


def lip_predictions_from_ema(path):
    """Read native export containing exactly upper/lower lip markers, in this order.

    Native row times are generated sequence offsets, not capture timestamps.
    Vertex 89 is an outer-lip marker, not the aperture edge or a mouth corner.
    """
    raw = Path(path).read_bytes()
    lines = raw.decode("utf-8").splitlines()
    if not lines or " ".join(lines[0].split()) != _HEADER:
        raise ValueError("expected native upper/lower lip vertex89 EMA header in cm")
    if len(lines) < 2 or any(not line.strip() for line in lines[1:]):
        raise ValueError("EMA export must contain nonempty numeric frames")
    try:
        data = np.array([[float(x) for x in line.split()] for line in lines[1:]], dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid EMA numeric frame") from exc
    if data.ndim != 2 or data.shape[1] != 7 or not np.isfinite(data).all():
        raise ValueError("EMA frames require time and six finite coordinates")
    if data[0, 0] < 0 or np.any(np.diff(data[:, 0]) <= 0):
        raise ValueError("EMA sequence offsets must be nonnegative and increasing")
    distances = np.linalg.norm(data[:, 1:4] - data[:, 4:7], axis=1) * .01
    return [{"operator_id": OPERATOR_ID, "value_m": float(distance),
             "sequence_offset_seconds": float(row[0]), "frame_index": index,
             "artifact_sha256": sha256(raw).hexdigest(),
             "upper_surface_vertex": [4, 89], "lower_surface_vertex": [5, 89]}
            for index, (row, distance) in enumerate(zip(data, distances))]


def lip_distance_residual(observation, upper_uv, lower_uv, prediction, *,
                          correspondence_id, model_sigma_m):
    """Compare explicitly corresponding observed outer-lip markers to native output.

    Capture-to-model frame pairing is caller-owned. correspondence_id references
    the predeclared landmark annotation protocol, not a guessed landmark mapping.
    """
    if not isinstance(correspondence_id, str) or not correspondence_id.strip():
        raise ValueError("a declared lip marker correspondence_id is required")
    if prediction.get("operator_id") != OPERATOR_ID:
        raise ValueError("prediction is not the source-defined lip marker operator")
    if prediction.get("upper_surface_vertex") != [4, 89] or prediction.get("lower_surface_vertex") != [5, 89]:
        raise ValueError("prediction marker identities do not match the operator")
    value = prediction.get("value_m")
    _finite(value, "predicted lip distance")
    if value < 0:
        raise ValueError("predicted distance cannot be negative")
    _finite(model_sigma_m, "model_sigma_m", positive=True)
    measurement = surface_distance(observation, upper_uv, lower_uv)
    sigma = float(np.hypot(measurement["sigma_m"], model_sigma_m))
    return {**measurement, "operator_id": OPERATOR_ID,
            "correspondence_id": correspondence_id, "predicted_value_m": value,
            "model_sigma_m": model_sigma_m, "combined_sigma_m": sigma,
            "residual": (value - measurement["value_m"]) / sigma,
            "prediction": dict(prediction)}
