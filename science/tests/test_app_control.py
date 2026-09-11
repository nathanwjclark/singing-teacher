"""How the app derives the delivered-cue binding from Astra's decision (input data only, no native work)."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from app_control import delivered_binding

WORDING = 'Sing an easy, comfortable ah.'
DESIGN = {'selected_experiment_id': 'a', 'profile': {'sample_rate_hz': 48000, 'frame_start_sample': 4800, 'frame_size': 4096, 'duration_s': .25},
          'rankings': [{'experiment': {'experiment_id': 'a', 'pose': 'a', 'JA': -3., 'f0_hz': 180., 'gain': 4.}},
                       {'experiment': {'experiment_id': 'e', 'pose': 'e', 'JA': -3., 'f0_hz': 180., 'gain': 4.}}]}
DECLARED = {'cue': {'cue_id': 'astra-delivered-cue', 'cue_version': '1', 'wording': WORDING,
                    'wording_sha256': hashlib.sha256(WORDING.encode()).hexdigest(), 'mode': 'elicited'},
            'context': {'capture_context_id': 'native-usb-pcm', 'source_kind': 'development-fixture', 'pitch_hz': 200., 'vowel': 'a',
                        'level': 'comfortable', 'posture': 'not-instructed'},
            'controls': [{'control_id': 'earlier', 'JA': -2.5, 'f0_hz': 200.}, {'control_id': 'other', 'JA': -3.5, 'f0_hz': 200.}],
            'gain': 2., 'declared_at': '2026-09-11T00:00:00+00:00'}


def setup(tmp_path, *, hypotheses=2, pitch=181.24, decision=None, design=DESIGN):
    root, directory = tmp_path, tmp_path / 'science-runs/run-one'
    (root / 'astra-decisions/session').mkdir(parents=True); directory.mkdir(parents=True)
    state = {'session_id': 'session', 'snapshot': {'model_id': 'model', 'hypotheses': [{}] * hypotheses},
             'designs': {'selected': {'status': 'committed', 'data': design}}, 'control_bindings': {'cue-earlier': DECLARED},
             'calibration': {'trials': [{'measurement': {'measurements': [{'name': 'pitchHz', 'value': pitch}]}}]}}
    (directory / 'astra-current.json').write_text(json.dumps({'sessionId': 'session', 'modelId': 'model', 'designId': 'selected', 'forecast': design, 'decisionId': 'decision'}))
    (root / 'astra-decisions/session/decision.json').write_text(json.dumps({'status': 'succeeded', 'designId': 'selected',
        'decision': decision or {'action': 'record', 'experimentId': 'a', 'cue': WORDING}}))
    return lambda: delivered_binding(root, directory, state, {'source': 'development-fixture'})


def test_free_text_cue_builds_a_content_derived_plus_bank_around_the_selected_experiment(tmp_path):
    identity, binding, pointer, profile = setup(tmp_path)()
    assert binding['cue']['wording'] == WORDING and binding['cue']['wording_sha256'] == hashlib.sha256(WORDING.encode()).hexdigest()
    assert binding['context'] == {'capture_context_id': 'native-usb-pcm', 'source_kind': 'development-fixture', 'pitch_hz': 181.2,
                                  'vowel': 'a', 'level': 'comfortable', 'posture': 'not-instructed'}
    assert [(c['control_id'], c['JA'], c['f0_hz']) for c in binding['controls']] == [
        ('selected', -3., 181.2), ('jaw-less-open', -2., 181.2), ('jaw-more-open', -4., 181.2), ('pitch-lower', -3., 171.0), ('pitch-higher', -3., 192.0)]
    assert binding['gain'] == 4. and profile == DESIGN['profile'] and pointer['decisionId'] == 'decision'
    again = setup(tmp_path / 'again')()
    assert again[0] == identity and identity.startswith('cue-')


def test_a_repeated_binding_is_reused_verbatim_even_when_the_bank_would_differ(tmp_path):
    decision = {'action': 'record', 'experimentId': 'a', 'cue': WORDING, 'cueBindingId': 'cue-earlier'}
    identity, binding, _, _ = setup(tmp_path, decision=decision)()
    assert identity == 'cue-earlier'
    assert binding == {key: DECLARED[key] for key in ('cue', 'context', 'controls', 'gain')}
    other = deepcopy(DESIGN); other['selected_experiment_id'] = 'e'
    with pytest.raises(ValueError, match='does not match the delivered wording and vowel'):
        setup(tmp_path / 'vowel', decision=decision, design=other)()
    with pytest.raises(ValueError, match='does not match the delivered wording and vowel'):
        setup(tmp_path / 'wording', decision={**decision, 'cue': 'Another cue.'})()


def test_unsupported_pitch_budget_and_stale_decisions_are_refused_before_any_command(tmp_path):
    with pytest.raises(ValueError, match='no room for one-semitone F0 alternatives'):
        setup(tmp_path / 'low', pitch=66.)()
    with pytest.raises(ValueError, match='need 100 synthesis calls'):
        setup(tmp_path / 'budget', hypotheses=20)()
    with pytest.raises(ValueError, match='not a completed recording decision'):
        setup(tmp_path / 'rest', decision={'action': 'rest', 'experimentId': None, 'cue': 'Rest.'})()
    (tmp_path / 'rested').mkdir()
    rested = setup(tmp_path / 'rested')
    (tmp_path / 'rested/science-runs/run-one/astra-rest.json').write_text('{}')
    with pytest.raises(ValueError, match='selected rest'):
        rested()
