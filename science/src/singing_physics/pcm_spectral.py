"""Versioned finite-frame spectral discrepancy; not an anatomical likelihood."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

import numpy as np

COARSE_OBJECTIVE = 'canonical-coarse-v1'
SPECTRAL_OBJECTIVE = 'multires-log-spectrum-v1'
CONFIG = {
    'version': SPECTRAL_OBJECTIVE,
    'reference_sample_rate_hz': 44100,
    'reference_window_samples': [512, 1024, 2048],
    'hop_fraction': .25,
    'window': 'periodic-hann',
    'frequency_grid_hz': np.linspace(80., 8000., 64).tolist(),
    'pooling': 'mean-one-sided-power-density-over-complete-windows',
    'frequency_interpolation': 'linear-power-density',
    'power_floor_fs2_per_hz': 1e-14,
    'shape_scale_db': 6., 'unexplained_level_scale_db': 3.,
    'gain_adjustment_bounds_db': [-24., 24.],
    'tilt_adjustment_bounds_db_per_octave': [-6., 6.],
    'pitch_scale_hz': 20., 'periodicity_scale': .1,
    'interpretation': 'engineering discrepancy with bounded nuisance projection, not calibrated likelihood',
}


def policy():
    return {'config': deepcopy(CONFIG), 'implementation_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'numpy_version': np.__version__}


def objective_policy(objective):
    if objective == COARSE_OBJECTIVE:
        return {'version': COARSE_OBJECTIVE, 'interpretation': 'legacy canonical coarse-descriptor discrepancy'}
    if objective == SPECTRAL_OBJECTIVE:
        return policy()
    raise ValueError('Unsupported PCM objective')


def require_policy(value):
    if value != policy():
        raise ValueError('Unsupported spectral policy: version, implementation or numerical runtime changed; refit and freeze a new forecast')


def extract_spectral(pcm, sample_rate_hz, *, source_artifact_hashes, source_artifact_id, frame_start_sample=0):
    """Extract the exact float32 frame without resampling observed audio."""
    if type(frame_start_sample) is not int or frame_start_sample < 0:
        raise ValueError('Spectral frame offset must be nonnegative sample index')
    values = np.asarray(pcm, dtype=np.float32)
    if type(sample_rate_hz) is not int or sample_rate_hz not in (44100, 48000, 96000):
        raise ValueError('Unsupported spectral sample rate')
    if values.shape != (8192 if sample_rate_hz == 96000 else 4096,) or not np.isfinite(values).all() or np.max(np.abs(values)) >= .995:
        raise ValueError('Spectral input requires one finite unclipped canonical frame')
    if not isinstance(source_artifact_id, str) or not source_artifact_id.strip() or not isinstance(source_artifact_hashes, list) or not source_artifact_hashes or any(not isinstance(h, str) or re.fullmatch('[0-9a-f]{64}', h) is None for h in source_artifact_hashes):
        raise ValueError('Spectral input requires source artifact identity and SHA-256 hashes')
    audio = values.astype(float)
    rms = float(np.sqrt(np.mean(audio**2)))
    if rms <= 1e-5:
        raise ValueError('Spectral input is below the -100 dBFS analysis floor')
    resolutions = []
    for reference in CONFIG['reference_window_samples']:
        size = round(reference * sample_rate_hz / CONFIG['reference_sample_rate_hz'])
        hop = max(1, round(size * CONFIG['hop_fraction']))
        starts = list(range(0, len(audio)-size+1, hop))
        window = .5-.5*np.cos(2*np.pi*np.arange(size)/size)
        frames = np.stack([audio[start:start+size] * window for start in starts])
        density = np.abs(np.fft.rfft(frames, axis=1))**2/(sample_rate_hz*np.sum(window**2))
        density[:, 1:(-1 if size % 2 == 0 else None)] *= 2
        pooled = np.mean(density, axis=0)
        frequencies = np.fft.rfftfreq(size, 1/sample_rate_hz)
        band_power = np.interp(CONFIG['frequency_grid_hz'], frequencies, pooled)
        log_power = 10*np.log10(np.maximum(band_power, CONFIG['power_floor_fs2_per_hz']))
        resolutions.append({'window_samples': size, 'hop_samples': hop, 'complete_windows': len(starts),
                            'log_power_dbfs_per_hz': log_power.tolist()})
    return {'policy': policy(), 'frame_sha256': hashlib.sha256(values.astype('<f4').tobytes()).hexdigest(),
            'sample_rate_hz': sample_rate_hz, 'frame_size': len(values), 'frame_start_sample':frame_start_sample, 'rms_dbfs': 20*np.log10(rms),
            'source_artifact_id': source_artifact_id, 'source_artifact_hashes': list(source_artifact_hashes),
            'resolutions': resolutions}


def validate_spectral(value, *, sample_rate_hz=None, frame_size=None):
    required = {'policy', 'frame_sha256', 'sample_rate_hz', 'frame_size', 'frame_start_sample', 'rms_dbfs', 'source_artifact_id', 'source_artifact_hashes', 'resolutions'}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError('Invalid spectral observation fields')
    require_policy(value['policy'])
    if type(value['frame_start_sample']) is not int or value['frame_start_sample'] < 0:
        raise ValueError('Invalid spectral frame offset')
    rate, size = value['sample_rate_hz'], value['frame_size']
    if type(rate) is not int or rate not in (44100,48000,96000) or type(size) is not int or size != (8192 if rate == 96000 else 4096) or (sample_rate_hz is not None and rate != sample_rate_hz) or (frame_size is not None and size != frame_size):
        raise ValueError('Spectral observation profile mismatch')
    if not isinstance(value['frame_sha256'], str) or re.fullmatch('[a-f0-9]{64}', value['frame_sha256']) is None or not isinstance(value['source_artifact_id'], str) or not value['source_artifact_id'].strip():
        raise ValueError('Invalid spectral frame/source identity')
    hashes = value['source_artifact_hashes']
    if not isinstance(hashes,list) or not hashes or any(not isinstance(h,str) or re.fullmatch('[a-f0-9]{64}',h) is None for h in hashes):
        raise ValueError('Invalid spectral source hashes')
    level = value['rms_dbfs']
    if isinstance(level,bool) or not isinstance(level,(int,float)) or not np.isfinite(level) or not -100 < level < 0:
        raise ValueError('Invalid spectral RMS level in dBFS')
    if not isinstance(value['resolutions'],list) or len(value['resolutions']) != 3:
        raise ValueError('Require every spectral resolution')
    for reference,row in zip(CONFIG['reference_window_samples'],value['resolutions']):
        window = round(reference*rate/44100); hop = round(window*.25)
        if not isinstance(row,dict) or set(row) != {'window_samples','hop_samples','complete_windows','log_power_dbfs_per_hz'} or row['window_samples'] != window or row['hop_samples'] != hop or row['complete_windows'] != len(range(0,size-window+1,hop)):
            raise ValueError('Invalid spectral resolution or window count')
        bands = np.asarray(row['log_power_dbfs_per_hz'])
        if bands.dtype.kind not in 'fi' or bands.shape != (64,) or not np.isfinite(bands).all() or np.any(bands < -140.000001) or np.any(bands > 0):
            raise ValueError('Invalid spectral power density in dBFS/Hz')
    return value


def validate_observation(trial):
    """Bind derived spectral fields to the canonical trial and original artifact."""
    if 'spectral_observation' not in trial:
        return
    value = validate_spectral(trial['spectral_observation'], sample_rate_hz=trial['sample_rate_hz'], frame_size=trial['frame_size'])
    measurement = trial['measurement']
    if value['frame_start_sample'] != trial['frame_start_sample'] or value['frame_sha256'] not in measurement['provenance']['sourceHashes']:
        raise ValueError('Spectral frame hash/offset is not bound to the canonical observation')
    if value['source_artifact_id'] != measurement['artifactId'] or value['source_artifact_hashes'] != measurement['provenance']['sourceHashes']:
        raise ValueError('Spectral source differs from canonical observation source')


def discrepancy(predicted, observed, *, predicted_features=None, observed_features=None):
    """Profile bounded level and tilt; preserve raw shape and nuisance diagnostics.

    Resolutions/bins are correlated summaries, not independent observations. The
    same bounded projection applies to both experiment discrimination and outcomes.
    """
    validate_spectral(predicted); validate_spectral(observed)
    if (predicted['sample_rate_hz'],predicted['frame_size']) != (observed['sample_rate_hz'],observed['frame_size']):
        raise ValueError('Spectral comparison requires matching PCM profiles')
    p = np.array([r['log_power_dbfs_per_hz'] for r in predicted['resolutions']])
    o = np.array([r['log_power_dbfs_per_hz'] for r in observed['resolutions']])
    delta = o-p
    # Remove a separate constant at each resolution; overall PCM level remains a
    # separate bounded diagnostic, never a proxy for vocal-tract geometry.
    shape = delta-delta.mean(axis=1,keepdims=True)
    octave = np.log2(np.asarray(CONFIG['frequency_grid_hz']))
    octave -= octave.mean()
    tilt = float(np.clip(np.sum(shape*octave)/(len(shape)*np.sum(octave**2)), *CONFIG['tilt_adjustment_bounds_db_per_octave']))
    adjusted = shape-tilt*octave
    level = float(observed['rms_dbfs']-predicted['rms_dbfs'])
    gain = float(np.clip(level,*CONFIG['gain_adjustment_bounds_db']))
    shape_rms = float(np.sqrt(np.mean(adjusted**2)))
    components = {'spectral_shape': (shape_rms/CONFIG['shape_scale_db'])**2,
                  'unexplained_level': ((level-gain)/CONFIG['unexplained_level_scale_db'])**2}
    if (predicted_features is None) != (observed_features is None):
        raise ValueError('Both canonical feature sets are required')
    if predicted_features is not None:
        for name,scale in [('pitchHz',CONFIG['pitch_scale_hz']),('periodicity',CONFIG['periodicity_scale'])]:
            pvalue,ovalue = predicted_features.get(name),observed_features.get(name)
            if pvalue is None or ovalue is None or isinstance(pvalue,bool) or isinstance(ovalue,bool) or not np.isfinite([pvalue,ovalue]).all():
                raise ValueError('Spectral objective requires finite pitch and periodicity')
            components[name] = ((pvalue-ovalue)/scale)**2
    return {'mean_square': float(np.mean(list(components.values()))), 'components':components,
            'raw_shape_rms_db':float(np.sqrt(np.mean(shape**2))), 'adjusted_shape_rms_db':shape_rms,
            'gain_adjustment_db':gain, 'unexplained_level_db':level-gain,
            'tilt_adjustment_db_per_octave':tilt,
            'nuisance_bound_reached': abs(tilt) >= 6 or abs(gain) >= 24,
            'shape_normalization':'Unbounded constant log-power offset removed separately per resolution; overall PCM level is scored separately with bounded gain',
            'nuisance_interpretation':'Empirical recording/source tilt and level adjustment, not measured source physiology or calibrated room response'}
