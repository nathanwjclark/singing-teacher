"""Versioned local research sessions over the existing isolated JobService."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3

from .service import canonical
from .prediction import Artifact, _encode, _timestamp
from .pcm_design import _snapshot, SCHEMA
from .pcm_inverse import _bridge, _features
from .engine import ANATOMY, finite


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def _id(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 160 or not value.strip():
        raise ValueError('Invalid identity')
    return value


class SessionController:
    """Synchronous JSON commands; numerical work is always submitted to JobService."""
    def __init__(self, root, service, session_id):
        self.session_id = _id(session_id)
        self.service = service
        path = Path(root).absolute()
        if path.is_symlink():
            raise ValueError('Session root cannot be a symlink')
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.stat().st_uid != os.getuid():
            raise ValueError('Session root must be owned by current user')
        os.chmod(path, 0o700)
        self.path = path / 'sessions.sqlite3'
        if self.path.is_symlink():
            raise ValueError('Session database cannot be a symlink')
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS events(session TEXT, version INTEGER, body TEXT, digest TEXT, PRIMARY KEY(session,version))')
            db.execute('CREATE TABLE IF NOT EXISTS commands(session TEXT, id TEXT, digest TEXT, PRIMARY KEY(session,id))')
        os.chmod(self.path, 0o600)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _read(self, db):
        state = {'session_id':self.session_id,'version':0,'snapshot':None,'calibration':None,
                 'pending':None,'designs':{},'attempts':[],'sensations':[],'jobs':[]}
        previous = '0'*64
        events=[]
        for version, body, digest in db.execute('SELECT version,body,digest FROM events WHERE session=? ORDER BY version',(self.session_id,)):
            event=json.loads(body)
            if version!=state['version']+1 or _hash(event)!=digest or event['previous_sha256']!=previous or event['session_id']!=self.session_id or event['state']['version']!=version:
                raise RuntimeError('Session ledger integrity failure')
            state=event['state']; previous=digest; events.append({**event,'sha256':digest})
        return state,previous,events

    def _append(self, db, state, action, details):
        _,previous,_=self._read(db)
        state['version']+=1
        event={'session_id':self.session_id,'previous_sha256':previous,'action':action,'received_at':_now(),
               'details':details,'state':deepcopy(state)}
        db.execute('INSERT INTO events VALUES(?,?,?,?)',(self.session_id,state['version'],canonical(event),_hash(event)))

    def _dispatch(self):
        # Persisted intent precedes this side effect. The stable key recovers a crash
        # after JobService submission but before the job ID was recorded here.
        with self._db() as db:
            state,_,_=self._read(db)
            model=state['snapshot']['model_id'] if state['snapshot'] else 'session-unfitted:'+_hash(self.session_id)
            self.service.register_model(self.session_id,model)
            pending=state['pending']
            if pending and pending.get('job_id') is None:
                try:
                    pending['job_id']=self.service.submit(pending['request'],idempotency_key=pending['key'])
                except (ValueError, RuntimeError) as exc:
                    state['jobs'].append({**pending,'status':'submission_failed','error':str(exc)})
                    state['pending']=None
                    if pending['request']['operation']=='update_pcm':
                        for design in state['designs'].values():
                            if design['status']=='outcome_pending': design['status']='failed'
                self._append(db,state,'job_dispatched',{'job_id':pending.get('job_id')})
            return deepcopy(state)

    def execute(self, command):
        if not isinstance(command,dict) or len(canonical(command).encode())>2_000_000:
            raise ValueError('Invalid or excessive session command')
        action=command.get('action')
        if action in ('state','replay'):
            if set(command)!={'action'}:
                raise ValueError('Unexpected read parameters')
            self._dispatch()
            with self._db() as db:
                state,digest,events=self._read(db)
                return {'state':state,'ledger_sha256':digest, **({'events':events} if action=='replay' else {})}
        command_id=_id(command.get('command_id'))
        fields={'register_model':{'snapshot'},'ingest_calibration':{'document'},'search':{'parameters'},
            'propose_design':{'parameters'},'collect_job':{'job_id'},'submit_outcome':{'design_id','parameters'},
            'record_attempt':{'design_id','attempt_id','status','reason'},'record_sensation':{'attempt_id','text'}}
        if action not in fields or set(command)!={'action','command_id','expected_version'}|fields[action]:
            raise ValueError('Unsupported session command fields')
        with self._db() as db:
            state,_,_=self._read(db)
            prior=db.execute('SELECT digest FROM commands WHERE session=? AND id=?',(self.session_id,command_id)).fetchone()
            if prior:
                if prior[0]!=_hash(command):
                    raise ValueError('Command identity reused with different input')
            else:
                if type(command['expected_version']) is not int or command['expected_version']!=state['version']:
                    raise ValueError('stale_session_version')
                details=self._apply(state,action,command)
                self._append(db,state,action,details)
                db.execute('INSERT INTO commands VALUES(?,?,?)',(self.session_id,command_id,_hash(command)))
        return {'state':self._dispatch()}

    def _launch(self,state,operation,parameters,command_id):
        if state['pending']:
            raise ValueError('Session already has an outstanding job')
        model=state['snapshot']['model_id'] if state['snapshot'] else 'session-unfitted:'+_hash(self.session_id)
        state['pending']={'request':{'operation':operation,'parameters':parameters,'session_id':self.session_id,'model_id':model},
                          'key':'session:'+_hash([self.session_id,command_id]),'job_id':None,'base_model_id':model}

    def _apply(self,state,action,c):
        if action=='register_model':
            if state['pending']:
                raise ValueError('Collect outstanding job before registering a model')
            artifact=Artifact(_encode(c['snapshot'])); _snapshot(artifact,artifact.sha256)
            if state['snapshot'] and state['snapshot']['model_id']==c['snapshot']['model_id'] and state['snapshot']!=c['snapshot']:
                raise ValueError('Model identity cannot be rebound')
            state['snapshot']=deepcopy(c['snapshot'])
            for design in state['designs'].values():
                if design['status']=='committed': design['status']='stale'
        elif action=='ingest_calibration':
            if state['pending'] or state['snapshot'] or state['designs']:
                raise ValueError('Initial calibration is immutable after modeling starts')
            doc=c['document']
            if not isinstance(doc,dict) or set(doc)!={'schema_version','kind','trials'} or doc['kind']!='canonical_pcm_observations' or doc['schema_version']!='0.1.0' or not isinstance(doc['trials'],list) or not 1<=len(doc['trials'])<=10:
                raise ValueError('Unsupported calibration document')
            ids=set()
            for trial in doc['trials']:
                if not isinstance(trial,dict) or set(trial)!={'id','pose','measurement','sample_rate_hz','frame_start_sample','frame_size','duration_s'}:
                    raise ValueError('Invalid calibration trial')
                _id(trial['id']); _id(trial['pose'])
                if trial['id'] in ids: raise ValueError('Duplicate calibration trial')
                ids.add(trial['id'])
                rate,start,size=trial['sample_rate_hz'],trial['frame_start_sample'],trial['frame_size']
                duration=finite(trial['duration_s'],'duration_s')
                if type(rate) is not int or rate not in (44100,48000,96000) or type(start) is not int or start<0 or type(size) is not int or not 256<=size<=32768 or not .1<=duration<=5 or start+size>round(duration*rate):
                    raise ValueError('Unsupported canonical rate, duration or frame bounds')
                _features(trial['measurement'])
            profiles=_bridge({'operation':'validate','records':[t['measurement'] for t in doc['trials']],
                'sampleRates':sorted({t['sample_rate_hz'] for t in doc['trials']})},None)
            sizes={p['sampleRate']:p['frameSize'] for p in profiles['audioProfiles']}
            intervals=set(); measurement_ids=set()
            for trial in doc['trials']:
                record=trial['measurement']; window=record['window']; rate=trial['sample_rate_hz']
                if record['id'] in measurement_ids: raise ValueError('Duplicate canonical measurement')
                measurement_ids.add(record['id'])
                if trial['frame_size']!=sizes[rate] or not math.isclose(window['endMs']-window['startMs'],trial['frame_size']/rate*1000,abs_tol=1e-6,rel_tol=0) or not math.isclose(window['startMs'],trial['frame_start_sample']/rate*1000,abs_tol=1e-6,rel_tol=0):
                    raise ValueError('Canonical frame size or window mismatch')
                keys={('hash',h,window['startMs'],window['endMs']) for h in record['provenance']['sourceHashes']}
                keys.add(('artifact',record['artifactId'],window['startMs'],window['endMs']))
                if intervals & keys: raise ValueError('Duplicate source audio interval')
                intervals.update(keys)
                if sum(v['value'] is not None for v in _features(record).values())<3:
                    raise ValueError('Insufficient observed canonical descriptors')
            state['calibration']=deepcopy(doc)
        elif action=='search':
            if state['calibration'] is None or state['snapshot']:
                raise ValueError('Search requires initial calibration and no frozen model')
            params=deepcopy(c['parameters'])
            if not isinstance(params,dict) or set(params)-{'anatomy_bounds','nuisance_profiles','max_synthesis_calls','rounds','seed'}:
                raise ValueError('Invalid search parameters')
            params['observations']=state['calibration']
            self._launch(state,'search_pcm',params,c['command_id'])
        elif action=='propose_design':
            if not state['snapshot']: raise ValueError('A frozen model is required')
            params=deepcopy(c['parameters'])
            if not isinstance(params,dict) or set(params)-{'design_id','target_observation_id','experiments','feature_scales','minimum_separation','max_synthesis_calls','retention_margin','maximum_discrepancy','profile'}:
                raise ValueError('Invalid design parameters')
            identity=_id(params.get('design_id')); target=_id(params.get('target_observation_id'))
            if identity in state['designs'] or any(d['data']['target_observation_id']==target for d in state['designs'].values()):
                raise ValueError('Design or target already reserved')
            snapshot=Artifact(_encode(state['snapshot']))
            params.update(snapshot_json=snapshot.content.decode(),expected_digest=snapshot.sha256,generated_at=_now())
            self._launch(state,'design_pcm',params,c['command_id'])
        elif action=='submit_outcome':
            design=state['designs'].get(c['design_id'])
            if not design or design['status']!='committed' or design['data']['model_id']!=state['snapshot']['model_id']:
                raise ValueError('Outcome requires a current committed design')
            params=deepcopy(c['parameters'])
            if not isinstance(params,dict) or set(params)-{'experiment_id','observation_id','artifact_id','observed_at','pcm','source_kind','sample_rate_hz','frame_start_sample','frame_size'} or not {'experiment_id','observation_id','artifact_id','observed_at','pcm','source_kind'}<=set(params):
                raise ValueError('Invalid outcome parameters')
            for key in ('sample_rate_hz','frame_start_sample','frame_size'):
                expected=design['data']['profile'][key]
                if key in params and (type(params[key]) is not int or params[key]!=expected):
                    raise ValueError('Outcome profile must match committed design')
                params[key]=expected
            if params['observation_id']!=design['data']['target_observation_id'] or params['experiment_id']!=design['data']['selected_experiment_id']:
                raise ValueError('Outcome must match committed selected experiment and target')
            if not _timestamp(design['committed_at']) < _timestamp(params['observed_at']) <= _timestamp(_now()):
                raise ValueError('Capture must follow committed design')
            snapshot=Artifact(_encode(state['snapshot'])); artifact=Artifact(_encode(design['data']))
            params.update(snapshot_json=snapshot.content.decode(),expected_snapshot_digest=snapshot.sha256,
                design_json=artifact.content.decode(),expected_design_digest=artifact.sha256)
            self._launch(state,'update_pcm',params,c['command_id']); design['status']='outcome_pending'
        elif action=='collect_job':
            pending=state['pending']
            if not pending or pending['job_id']!=c['job_id']:
                raise ValueError('Job is not owned by current session intent')
            status=self.service.status(c['job_id'])
            if status['status'] not in {'succeeded','failed','cancelled'}:
                raise ValueError('Job has not completed')
            result=self.service.result(c['job_id']) if status['status']=='succeeded' else None
            operation=pending['request']['operation']
            if result is not None:
                if operation=='search_pcm':
                    rows=sorted([r for r in result['joint']['candidates'] if r['status']=='scored'],key=lambda r:(r['weighted_mean_square_discrepancy'],r['candidate_id']))
                    seen=set(); hypotheses=[]
                    for row in rows:
                        key=_hash(row['anatomy'])
                        if key not in seen and len(hypotheses)<32:
                            seen.add(key); hypotheses.append({'hypothesis_id':row['candidate_id'],'anatomy':row['anatomy']})
                    if hypotheses:
                        measurements=[t['measurement'] for t in state['calibration']['trials']]
                        ids=sorted({v for t in state['calibration']['trials'] for v in [t['id'],t['measurement']['id'],t['measurement']['observationId'],t['measurement']['artifactId']]})
                        hashes=sorted({h for m in measurements for h in m['provenance']['sourceHashes']})
                        now=_now(); snapshot={'schema_version':SCHEMA,'kind':'frozen_pcm_hypotheses','model_id':'session-model:'+_hash([self.session_id,c['job_id'],result]),
                            'evidence_ids':ids,'evidence_hashes':hashes,'provenance':result['native_provenance'],'hypotheses':hypotheses,
                            'duplicate_geometries':[],'frozen_at':now,'sealed_at':now,'anatomy_units':{n:u for n,u,*_ in ANATOMY},
                            'scope':'At most 32 unique scored geometries, ranked by search discrepancy; not posterior support',
                            'search_result_sha256':_hash(result),'scored_candidates_before_truncation':len(rows)}
                        artifact=Artifact(_encode(snapshot)); _snapshot(artifact,artifact.sha256); state['snapshot']=snapshot
                elif operation=='design_pcm':
                    state['designs'][result['design_id']]={'data':result,'committed_at':_now(),'status':'committed' if result['selected_experiment_id'] is not None else 'unsupported'}
                elif operation=='update_pcm':
                    if any(d['status']=='stopped' and d['data']['target_observation_id']==pending['request']['parameters']['observation_id'] for d in state['designs'].values()):
                        raise ValueError('Stopped attempt cannot update model')
                    state['snapshot']=result['updated_snapshot']
                    for design in state['designs'].values():
                        if design['status']=='outcome_pending': design['status']='completed'
                        elif design['status']=='committed': design['status']='stale'
            if result is None and operation=='update_pcm':
                for design in state['designs'].values():
                    if design['status']=='outcome_pending': design['status']='failed'
            if operation=='update_pcm':
                state['attempts'].append({'attempt_id':pending['request']['parameters']['observation_id'],
                    'status':status['status'],'job_id':c['job_id'],'scientific_status':result.get('status') if result else None})
            state['jobs'].append({**pending,'status':status['status'],'error':status.get('error'),'result':result})
            state['pending']=None
        elif action=='record_attempt':
            if c['status'] not in ('stopped','failed') or not isinstance(c['reason'],str) or not 1<=len(c['reason'])<=2000:
                raise ValueError('Explicit stopped/failed attempt and reason required')
            _id(c['attempt_id'])
            if any(a['attempt_id']==c['attempt_id'] for a in state['attempts']): raise ValueError('Duplicate attempt')
            design=state['designs'].get(c['design_id'])
            if not design or design['status'] not in ('committed','outcome_pending'): raise ValueError('Attempt design not active')
            if state['pending']:
                pending=state['pending']
                if pending['request']['operation']!='update_pcm' or pending['request']['parameters']['observation_id']!=design['data']['target_observation_id']:
                    raise ValueError('Unrelated outstanding job prevents attempt transition')
                if pending['job_id']: self.service.cancel(pending['job_id'])
                state['jobs'].append({**pending,'status':'stopped_without_model_update','result':None})
                state['pending']=None
            design['status']=c['status']
            state['attempts'].append({k:c[k] for k in ('design_id','attempt_id','status','reason')})
        elif action=='record_sensation':
            if not any(a['attempt_id']==c['attempt_id'] for a in state['attempts']) or not isinstance(c['text'],str) or not 1<=len(c['text'])<=2000:
                raise ValueError('Sensation must reference recorded attempt and bounded text')
            state['sensations'].append({'attempt_id':c['attempt_id'],'text':c['text'],'kind':'subjective_report_not_model_constraint'})
        return {'command_id':c['command_id'],'input_sha256':_hash(c)}
