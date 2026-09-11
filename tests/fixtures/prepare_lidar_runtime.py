"""Seed the LiDAR browser check with the app and worker data of the native
integration test (science/tests/test_app_lidar_runtime.py): a baseline fitted
through the app, one adopted rear-depth geometry, rejected and duplicate
attempts, and a second adopted frame. The app data is <root>/app and the worker
data <root>/worker.

Generated synthetic evidence only; the depth calibration and correspondences are
mathematical constructions, not an iPhone or human measurement.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'science/tests'))
from test_app_lidar_runtime import test_original_rear_depth_changes_normal_native_model_through_app as seed

# The worker starts its jobs with multiprocessing 'spawn', which re-imports this script.
if __name__ == '__main__':
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True)
    seed(root)
