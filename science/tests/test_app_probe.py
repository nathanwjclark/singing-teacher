import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
import pytest
from science.scripts.prepare_probe_capture import prepare

ROOT=Path(__file__).resolve().parents[2]


def archive_fixture(tmp_path):
    capture=tmp_path/'capture'
    subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',
        "import {makeFixture} from './scripts/import-acoustic-probe.test.ts'; await makeFixture(process.argv[1]);",str(capture)],cwd=ROOT,check=True,capture_output=True)
    manifest=json.loads((capture/'manifest.json').read_text())
    identity='12345678-1234-1234-1234-123456789abc'
    manifest['captureId']=identity
    (capture/'manifest.json').write_text(json.dumps(manifest))
    root=tmp_path/'data';(root/'usb-imports').mkdir(parents=True)
    name='probe-'+identity+'.zip'
    with zipfile.ZipFile(root/'usb-imports'/name,'w') as z:
        for source in capture.iterdir():z.write(source,source.name)
    raw=(root/'usb-imports'/name).read_bytes()
    receipt={'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    (root/'native-pull-latest.json').write_text(json.dumps(receipt))
    return root,receipt


def test_real_import_without_calibration_retains_review(tmp_path):
    root,receipt=archive_fixture(tmp_path)
    output=root/'probe-imports'/'one'
    result=prepare(root,output)
    assert not result['eligible'] and not result['includedInFit']
    assert 'calibration' in result['reasons'][0]
    measurement=json.loads((output/result['measurementPath']).read_text())
    assert measurement['captured']['value']
    assert not measurement['includedInFit']['value']
    assert hashlib.sha256((output/'original.zip').read_bytes()).hexdigest()==receipt['sha256']
    with pytest.raises(FileExistsError):prepare(root,output)


def test_changed_archive_rejected_before_import(tmp_path):
    root,receipt=archive_fixture(tmp_path)
    file=root/'usb-imports'/receipt['name'];raw=bytearray(file.read_bytes());raw[-1]^=1;file.write_bytes(raw)
    with pytest.raises(ValueError,match='hash mismatch'):prepare(root,root/'probe-imports'/'bad')
