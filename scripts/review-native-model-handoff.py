#!/usr/bin/env python3
"""Check a private depth diagnostic against the scientific model's real input gates."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'science/src')]
from observations.geometry.native_capture import read_native_capture
from singing_physics.engine import Engine


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_directory', type=Path)
    parser.add_argument('--capture-zip', type=Path, required=True)
    parser.add_argument('--dynamic-analysis', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    capture = read_native_capture(args.source_directory)
    analysis = json.loads(args.dynamic_analysis.read_text())
    provenance = analysis['provenance']
    if provenance['capture_id'] != capture.capture_id or provenance['capture_zip_sha256'] != digest(args.capture_zip):
        raise ValueError('Dynamic report is not bound to this original capture')
    with zipfile.ZipFile(args.capture_zip) as archive:
        names = [n for n in archive.namelist() if n.endswith('/manifest.json') or n == 'manifest.json']
        if len(names) != 1 or hashlib.sha256(archive.read(names[0])).hexdigest() != capture.manifest_sha256:
            raise ValueError('ZIP and original-directory manifest differ')
    split = provenance['temporal_split']
    cal, held = split['calibration_frames'], split['heldout_frames']
    actual = {frame.sequence for frame in capture.frames}
    reported = [row['frame'] for row in analysis['frames']]
    if len(reported) != len(set(reported)) or set(reported) != actual:
        raise ValueError('Dynamic report omits or duplicates source frames')
    if not (min(actual) == cal[0] <= cal[1] < held[0] <= held[1] == max(actual)) or held[0] != cal[1] + 1:
        raise ValueError('Expected complete disjoint chronological split')
    rows = []
    for row in analysis['frames']:
        surface_valid = bool(row.get('tongue', {}).get('fit_valid', False))
        # Current diagnostic is not a validated anatomical observation operator.
        rows.append({'frame': row['frame'], 'split': 'calibration' if row['frame'] <= cal[1] else 'heldout',
            'head_3d_supported': bool(row['head'].get('valid')),
            'tongue_depth_samples': row['tongue'].get('depth_samples', 0),
            'diagnostic_surface_valid': surface_valid,
            'model_observation_eligible': False,
            'prediction_error_mm': None,
            'reason': 'No anatomical surface correspondence or independently validated measurement operator; absent depth is not an observation'})
    args.output.mkdir(parents=True, exist_ok=False)
    with Engine() as engine:
        reference = {'kind': 'unfitted_native_reference', 'anatomy': engine.anatomy(),
            'capabilities': engine.capabilities(), 'pose': 'a',
            'pose_role': 'Illustrative library reference, not the observed vowel or tongue pose',
            'geometry': engine.geometry('a')}
        params, _ = engine.pose('a')
        files = engine._native_surface_files(params)
        for name, raw in files.items():
            (args.output / name).write_bytes(raw)
        reference['native_files_sha256'] = {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}
    (args.output / 'unfitted-reference.json').write_text(json.dumps(reference, indent=2, allow_nan=False))
    report = {'kind': 'native_model_handoff_review', 'capture_id': capture.capture_id,
        'source_manifest_sha256': capture.manifest_sha256, 'source_zip_sha256': digest(args.capture_zip),
        'analysis_sha256': digest(args.dynamic_analysis), 'split': split,
        'verified_original_artifacts': len(capture.artifacts),
        'actual_scientific_operations': ['read_native_capture: all original artifacts verified',
            'Engine: initialize native anatomical parameter basis', 'Engine: export unfitted native reference geometry and mesh'],
        'calibration_frames': sum(r['split'] == 'calibration' for r in rows),
        'heldout_frames': sum(r['split'] == 'heldout' for r in rows),
        'eligible_calibration_observations': 0, 'scored_heldout_frames': 0,
        'fit_status': 'abstained_missing_validated_anatomical_observations',
        'personal_anatomy_updated': False, 'forecast': None, 'frames': rows,
        'gates': ['Actual visible tongue depth support', 'Independent supported head registration',
            'Validated depth/pixel calibration and measurement error',
            'Explicit anatomical correspondence from observed patch to native surface',
            'Predeclared articulation inputs or a predictive motion model for later frames'],
        'interpretation': 'No valid 3D tongue observations can be fabricated from RGB or deeper cavity returns. The native reference is executable but unfitted. Missing heldout predictions are not zero-error predictions. No sensor uncertainty, tissue identity, or hidden geometry inferred.'}
    (args.output / 'assessment.json').write_text(json.dumps(report, indent=2, allow_nan=False))
    (args.output / 'FINDINGS.md').write_text(f'''# Scientific model handoff\n\nVerified {len(capture.artifacts)} original artifacts using Nicole's native consumer. Initialized her native model and exported its actual reference mesh; that reference is **not fitted to this person**.\n\nFrozen temporal roles: {cal[0]}–{cal[1]} calibration; {held[0]}–{held[1]} held out. Source and diagnostic hashes are retained in assessment.json. The contact sheet was viewed before splitting; this was not a blinded experiment.\n\nThe current diagnostic does not provide validated anatomical correspondence or calibration. The diagnostic contains {sum(r['diagnostic_surface_valid'] for r in rows)} accepted local 3D surface fits, which are not validated anatomical correspondences. Fitting therefore abstained. No anatomical parameters changed, no predictions were fabricated, and no withheld-frame errors were scored.\n\nDeeper cavity returns cannot stand in for missing tongue measurements. A future model comparison needs a capture with simultaneous visible-tongue and independent face depth, followed by validated mapping and declared anatomical correspondence. Later tongue controls also need a predictive rule; re-fitting each test frame would be reconstruction, not heldout prediction.\n\nThe per-frame diagnostics and anonymous measured camera surfaces remain useful for acquisition review. The existing native model's geometry and mesh are retained separately as an unfitted reference.\n''')
    print(json.dumps({k: report[k] for k in ('capture_id', 'verified_original_artifacts', 'fit_status', 'scored_heldout_frames', 'personal_anatomy_updated')}, indent=2))

if __name__ == '__main__':
    main()
