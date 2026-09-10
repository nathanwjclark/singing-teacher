"""Calibrated visible-surface observations; no occluded-surface completion."""
from .depth import DepthFrame, SurfaceObservation, reconstruct, surface_distance, surface_residuals

__all__ = ["DepthFrame", "SurfaceObservation", "reconstruct", "surface_distance", "surface_residuals"]
from .lips import lip_predictions_from_ema, lip_distance_residual

__all__ += ["lip_predictions_from_ema", "lip_distance_residual"]
