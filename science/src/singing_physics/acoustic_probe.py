"""Conditional external monopole/oral-tube scattering, exp(+i omega t)."""
import hashlib
import json
import re

import numpy as np

OPERATOR_VERSION = "external-monopole-oral-line-v1"
RHO = 1.204
C = 343.0


def _vector(value, name, size=None):
    a = np.asarray(value, dtype=float)
    if a.ndim != 1 or not len(a) or not np.isfinite(a).all() or (size is not None and len(a) != size):
        raise ValueError(f"{name} must be a finite vector of the required length")
    return a


def _frequencies(value):
    f = _vector(value, "frequency_hz")
    if len(f) > 2048 or np.any(np.diff(f) <= 0) or min(f) < 20 or max(f) > 20000:
        raise ValueError("frequency_hz must increase strictly within 20..20000 Hz, at most 2048 bands")
    return f


def _scalar(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name} must be finite within {low}..{high}")
    return float(value)


def tube_impedance(frequency_hz, length_m, area_m2, *, termination="rigid",
                   termination_resistance_pa_s_m3=None, attenuation_np_per_m=.5):
    """Input impedance Pa s/m³; sections ordered input/mouth to termination/glottis.

    Positive attenuation is a passive phenomenological line loss, not a tissue estimate.
    """
    f = _frequencies(frequency_hz)
    lengths = _vector(length_m, "length_m")
    areas = _vector(area_m2, "area_m2", len(lengths))
    if len(lengths) > 256 or min(lengths) <= 0 or sum(lengths) > 2 or min(areas) <= 0 or max(areas) > .1:
        raise ValueError("tube dimensions must be positive, <=256 sections, <=2 m total, <=.1 m² area")
    alpha = _scalar(attenuation_np_per_m, "attenuation_np_per_m", 0, 20)
    if termination not in ("rigid", "pressure-release", "resistive"):
        raise ValueError("unsupported glottal termination")
    if termination == "resistive":
        load = _scalar(termination_resistance_pa_s_m3, "termination resistance", 0, 1e12)
    else:
        if termination_resistance_pa_s_m3 is not None:
            raise ValueError("resistance applies only to resistive termination")
        load = None if termination == "rigid" else 0.
    z = None if load is None else np.full(len(f), load, dtype=complex)
    gamma = alpha + 2j * np.pi * f / C
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        for length, area in zip(lengths[::-1], areas[::-1]):
            zc = RHO * C / area
            t = np.tanh(gamma * length)
            z = zc / t if z is None else zc * (z + zc * t) / (zc + z * t)
    if not np.isfinite(z).all():
        raise ValueError("singular tube impedance; change frequency or declare nonzero loss")
    return z


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def predict_external_probe(engine, *, pose, frequency_hz, placement, calibration,
                           articulation=None, termination="rigid",
                           termination_resistance_pa_s_m3=None, attenuation_np_per_m=.5):
    """Return calibrated direct + mouth-scattered PCM/digital-drive complex response.

    Calibration is caller-supplied evidence, not authenticated by this function.
    No device response, source strength, anatomical branch, or room filter is invented.
    """
    f = _frequencies(frequency_hz)
    for obj, names in ((placement, ("placement_id", "coordinate_frame")),
                       (calibration, ("calibration_id", "route_id", "placement_id"))):
        for name in names:
            if not isinstance(obj.get(name), str) or not obj[name].strip():
                raise ValueError(f"{name} is required")
    if calibration.get("kind") not in ("measured", "synthetic-fixture"):
        raise ValueError("calibration kind must be measured or synthetic-fixture")
    if calibration["placement_id"] != placement["placement_id"]:
        raise ValueError("calibration placement mismatch")
    hashes = calibration.get("source_hashes")
    if not isinstance(hashes, list) or not hashes or any(not isinstance(h, str) or not re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes):
        raise ValueError("calibration source_hashes must contain SHA256 evidence hashes")
    if not np.array_equal(_frequencies(calibration.get("frequency_hz")), f):
        raise ValueError("calibration frequency grid must match exactly; no implicit interpolation")
    source = _vector(calibration.get("source_volume_velocity_real"), "source real", len(f)) + 1j * _vector(calibration.get("source_volume_velocity_imag"), "source imag", len(f))
    mic = _vector(calibration.get("microphone_gain_real"), "microphone real", len(f)) + 1j * _vector(calibration.get("microphone_gain_imag"), "microphone imag", len(f))
    if np.any(abs(source) == 0) or np.any(abs(mic) == 0):
        raise ValueError("calibration must have nonzero source and microphone response")
    delay = _scalar(calibration.get("delay_s"), "delay_s", 0, 1)
    points = [_vector(placement.get(key), key, 3) for key in ("source_m", "microphone_m", "mouth_m")]
    ds, dm, dd = (float(np.linalg.norm(points[i] - points[j])) for i, j in ((0, 2), (1, 2), (0, 1)))
    if min(ds, dm, dd) < .005 or max(ds, dm, dd) > 5:
        raise ValueError("source/mouth/microphone distances must be within .005..5 m")
    geometry = engine.geometry(pose, articulation)
    if geometry["velum_opening_cm2"] > 1e-8:
        raise ValueError("open velum requires nasal branch geometry not exported by this operator")
    lengths = np.asarray(geometry["length_cm"])[::-1] * .01
    areas = np.asarray(geometry["area_cm2"])[::-1] * 1e-4
    if len(lengths) != 40:
        raise ValueError("expected pinned native 40-section glottis-to-mouth export")
    zin = tube_impedance(f, lengths, areas, termination=termination,
                         termination_resistance_pa_s_m3=termination_resistance_pa_s_m3,
                         attenuation_np_per_m=attenuation_np_per_m)
    radius = np.sqrt(areas / np.pi)
    if min(ds, dm) < 3 * radius[0]:
        raise ValueError("compact-mouth approximation requires source and microphone >=3 aperture radii away")
    k = 2 * np.pi * f / C
    ka = k * radius[0]
    radiation = RHO * C / areas[0] * (ka**2 / 4 + 1j * .6133 * ka)
    def green(distance):
        return 1j * 2 * np.pi * f * RHO * np.exp(-1j * k * distance) / (4 * np.pi * distance)
    instrument = source * mic * np.exp(-2j * np.pi * f * delay)
    direct = instrument * green(dd)
    mouth = -instrument * green(ds) * green(dm) / (zin + radiation)
    total = direct + mouth
    reflection = (zin - RHO * C / areas[0]) / (zin + RHO * C / areas[0])
    valid = (ka <= .5) & (k * max(radius) <= 1.) & np.isfinite(total)
    def parts(z):
        return ([float(x.real) if ok else None for x, ok in zip(z, valid)],
                [float(x.imag) if ok else None for x, ok in zip(z, valid)])
    result = {"operator_version": OPERATOR_VERSION, "quantity": "recorded_pcm_per_digital_drive",
              "frequency_hz": f.tolist(), "valid_mask": valid.tolist(),
              "invalid_reason": [None if ok else "outside_compact_mouth_or_plane_wave_domain" for ok in valid],
              "phasor_convention": "exp(+i*omega*t)", "geometry": geometry,
              "geometry_sha256": _hash(geometry), "native_provenance": engine.provenance,
              "calibration": calibration, "calibration_sha256": _hash(calibration),
              "calibration_evidence_authenticated": False, "placement": placement,
              "conditions": {"termination": termination, "termination_resistance_pa_s_m3": termination_resistance_pa_s_m3,
                             "attenuation_np_per_m": attenuation_np_per_m, "density_kg_m3": RHO, "sound_speed_m_s": C},
              "capabilities": {"oral_external_drive": True, "nasal_branches": False,
                               "head_diffraction": False, "room_filter": False, "calibrated_anatomy_recovery": False},
              "limitations": ["Template-conditional geometry, not measured anatomy", "No fossa, nasal branches, wall compliance or subglottal resonances",
                              "Compact unflanged aperture and free monopoles; no head/phone diffraction", "Declared calibration and rigid/resistive glottis require independent evidence"]}
    for name, z in (("response", total), ("direct_response", direct), ("mouth_response", mouth),
                    ("input_impedance_pa_s_m3", zin), ("radiation_impedance_pa_s_m3", radiation), ("reflection", reflection)):
        result[name + "_real"], result[name + "_imag"] = parts(z)
    return result
