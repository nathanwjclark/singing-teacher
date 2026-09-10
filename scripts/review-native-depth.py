#!/usr/bin/env python3
"""Validate a private SingingDepth ZIP and report raw depth coverage; no reconstruction claim."""
import argparse
import hashlib
import json
import math
from pathlib import PurePosixPath, Path
import struct
import zipfile


def review(path, *, allow_rear_lidar=False):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entries')
        if sum(i.file_size for i in archive.infolist()) > 512 * 1024 * 1024:
            raise ValueError('Capture exceeds 512 MB review limit')
        for name in names:
            p = PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts:
                raise ValueError('Unsafe archive member')
        manifests = [name for name in names if PurePosixPath(name).name == 'manifest.json']
        if len(manifests) != 1:
            raise ValueError('Exactly one manifest required')
        manifest_name = manifests[0]
        prefix = str(PurePosixPath(manifest_name).parent)
        prefix = '' if prefix == '.' else prefix + '/'
        raw_manifest = archive.read(manifest_name)
        manifest = json.loads(raw_manifest)
        if manifest.get('schema_version') != 'singing-native-rgbd-1.0.0':
            raise ValueError('Unsupported capture version')
        device=manifest.get('device', {})
        rear=manifest.get('capture_mode')=='separate-rear-lidar-held-pose'
        if rear:
            if not allow_rear_lidar:raise ValueError('Optional rear LiDAR review is disabled')
            if device.get('sensor')!='rear-lidar' or 'LiDAR' not in str(device.get('device_type','')) or device.get('position')!='back' or device.get('output_mirrored') is not False:raise ValueError('Rear sensor identity mismatch')
        elif manifest.get('capture_mode') != 'one-held-pose':
            raise ValueError('This review supports held-pose capture only')
        elif 'TrueDepth' not in str(device.get('device_type','')) or device.get('position')!='front' or device.get('output_mirrored') is not False:
            raise ValueError('Front sensor identity mismatch')
        def artifact(record):
            name = record['path']
            if PurePosixPath(name).name != name:
                raise ValueError('Artifact references must be local filenames')
            data = archive.read(prefix + name)
            if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                raise ValueError('Artifact hash or byte count mismatch: ' + name)
            return data
        def timestamp(value):
            scale = value['timescale']
            if not isinstance(scale, int) or scale <= 0:
                raise ValueError('Invalid source timescale')
            seconds = value['value'] / scale
            if not math.isfinite(seconds) or value.get('seconds') is None or abs(seconds-value['seconds']) > 1e-6:
                raise ValueError('Invalid/inconsistent source time')
            return seconds, value['epoch']
        audio_rows = manifest.get('audio', {}).get('samples', [])
        audio_checked = 0
        prior_audio = None
        for sample in audio_rows:
            if not sample.get('artifact'):
                if not sample.get('missing_reason'):
                    raise ValueError('Missing audio chunk lacks reason')
                continue
            data = artifact(sample['artifact'])
            stamp, epoch = timestamp(sample['presentation_timestamp'])
            if prior_audio is not None and (epoch != prior_audio[1] or stamp < prior_audio[0]):
                raise ValueError('Audio clock reversed or changed epoch')
            prior_audio = stamp, epoch
            fmt = sample['asbd']
            count, stride = sample['num_samples'], fmt['bytes_per_frame']
            if not isinstance(count, int) or count <= 0 or not isinstance(stride, int) or stride <= 0 or len(data) != count*stride:
                raise ValueError('Audio PCM dimensions disagree with bytes')
            if not isinstance(fmt['sample_rate'], (int,float)) or not math.isfinite(fmt['sample_rate']) or fmt['sample_rate'] <= 0:
                raise ValueError('Invalid native audio sample rate')
            audio_checked += 1
        rows = []
        previous = None
        previous_seq = -1
        for frame in manifest['frames']:
            stamp, epoch = timestamp(frame['capture_clock_timestamp'])
            if previous is not None and (epoch != previous[1] or stamp < previous[0]):
                raise ValueError('Capture source clock reversed or changed epoch')
            if frame['sequence'] <= previous_seq:
                raise ValueError('Frame sequence is not increasing')
            previous = stamp, epoch
            previous_seq = frame['sequence']
            row = {'sequence': frame['sequence'], 'write_error': frame.get('write_error'), 'depth_dropped': frame.get('depth_dropped'), 'rgb_dropped': frame.get('rgb_dropped')}
            for kind in ['rgb', 'depth']:
                if not frame.get(kind) and not frame.get(kind + '_dropped') and not frame.get('write_error'):
                    raise ValueError('Missing output lacks drop/write-error reason')
                if frame.get(kind) and frame.get(kind + '_dropped'):
                    raise ValueError('Artifact present but declared dropped')
            if frame.get('rgb'):
                artifact(frame['rgb'])
                timestamp(frame['rgb_timestamp'])
            if frame.get('depth'):
                if frame.get('depth_unit') != 'm' or frame.get('depth_storage') != 'row-major-little-endian-float32-packed':
                    raise ValueError('Unsupported raw depth representation')
                data = artifact(frame['depth'])
                w, h = frame['depth_dimensions']
                if not all(isinstance(n, int) and n > 0 for n in [w, h]) or len(data) != w*h*4:
                    raise ValueError('Depth dimensions disagree with raw bytes')
                values = [x[0] for x in struct.iter_unpack('<f', data)]
                valid = sorted(x for x in values if math.isfinite(x) and x > 0)
                ds, de = timestamp(frame['depth_timestamp'])
                if frame.get('rgb'):
                    rs, re = timestamp(frame['rgb_timestamp'])
                    if de != re:
                        raise ValueError('RGB/depth source epochs differ')
                    row['rgb_depth_delta_ms'] = (rs-ds)*1000
                    declared = frame.get('rgb_depth_timestamp_delta_seconds')
                    if declared is None or abs(declared-(rs-ds)) > 1e-6:
                        raise ValueError('RGB/depth timestamp delta disagrees')
                calibration = frame.get('calibration')
                if calibration:
                    intrinsics = calibration['intrinsics_row_major']
                    if len(intrinsics) != 3 or any(len(r) != 3 or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in r) for r in intrinsics):
                        raise ValueError('Invalid intrinsic matrix')
                    if intrinsics[0][0] <= 0 or intrinsics[1][1] <= 0:
                        raise ValueError('Invalid focal length')
                row.update({'total_pixels':len(values),'positive_finite_pixels':len(valid),'valid_fraction':len(valid)/len(values),'median_depth_m':valid[len(valid)//2] if valid else None,'filtered':frame.get('depth_filtered'),'calibration_present':bool(calibration)})
            rows.append(row)
        return {'sensor':'rear-lidar' if rear else 'front-truedepth','separate_scan':rear,'fusion_enabled':False,'kind':'native-depth-coverage-review','manifest_sha256':hashlib.sha256(raw_manifest).hexdigest(),'capture_id':manifest['capture_id'],'callbacks':len(rows),'verified_audio_chunks':audio_checked,'frames_with_depth':sum('valid_fraction'in r for r in rows),'frames_with_rgb':sum(bool(f.get('rgb')) for f in manifest['frames']),'audio':manifest.get('audio'),'stop_reason':manifest.get('stop_reason'),'frames':rows,'limitations':['Coverage is whole-depth-frame coverage, not mouth segmentation.','No on-device capture is implied by running this validator on a fixture.','Positive finite depth is not evidence of accurate tongue/palate reconstruction.','Native distortion is not corrected and head/world pose is absent; no surface fusion or metric point cloud generated.','Timestamp differences do not establish absolute synchronization uncertainty.']}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_zip')
    parser.add_argument('--output',required=True)
    parser.add_argument('--allow-rear-lidar',action='store_true')
    args=parser.parse_args()
    report=review(args.capture_zip,allow_rear_lidar=args.allow_rear_lidar)
    with Path(args.output).open('x') as f:
        json.dump(report,f,indent=2)
    print(f"Verified {report['callbacks']} callbacks; {report['frames_with_depth']} depth frames. Private report: {args.output}")
