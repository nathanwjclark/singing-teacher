"""Pair native VTL sagittal contours in their unmodified common coordinate frame.

Contour indices follow VocalTract::exportSvg: upper cover, uvula, upper
cover/teeth/lip, lower larynx, epiglottis, lower cover/teeth/lip, tongue.
This is a sagittal envelope, not a measured 3D lumen or muscle reconstruction.
"""
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET


def contours(path):
    lines = ET.parse(path).findall('.//{http://www.w3.org/2000/svg}polyline')
    if len(lines) < 8:
        raise ValueError('Unexpected native SVG contour layout')
    points = []
    for line in lines[:7]:
        values = [float(v) for v in line.attrib['points'].split()]
        if len(values) % 2 or not all(math.isfinite(v) for v in values):
            raise ValueError('Invalid native contour')
        points.append(list(zip(values[::2], values[1::2])))
    upper, uvula, oral, lower, epiglottis, floor, tongue = points
    # Find floor attachment nearest the actual exported tip; no rescaling to fit.
    tip = tongue[-1]
    junction = min(range(1, len(floor)), key=lambda i: (floor[i][0]-tip[0])**2+(floor[i][1]-tip[1])**2)
    return {'airway': upper+uvula+oral+list(reversed(lower+tongue+floor[junction:])),
            'tongue': tongue+list(reversed(floor[:junction+1])),
            'outlines': points}


def pair(candidate: Path, reference: Path):
    predicted = json.loads((candidate/'geometry.json').read_text())
    baseline = json.loads((reference/'geometry.json').read_text())
    if predicted['pose'] != baseline['pose']:
        raise ValueError('Reference and candidate must use identical declared pose')
    return {'schemaVersion':'native-space-diff-1', 'coordinateFrame':'VTL native sagittal SVG; 37.8 units/cm',
            'role':'Candidate versus native reference anatomy at the same declared pose; not an observed correction',
            'pose':predicted['pose'], 'anatomy':predicted['anatomy'], 'referenceAnatomy':baseline['anatomy'],
            'articulation':predicted['articulation'], 'referenceArticulation':baseline['articulation'],
            'candidate':contours(candidate/'tract.svg'), 'reference':contours(reference/'tract.svg')}
