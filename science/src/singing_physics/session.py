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
from .pcm_design import _snapshot, SCHEMA, select_pcm_experiment
from .pcm_inverse import _bridge, _features
from .pcm_spectral import OPTIONAL_TRIAL_FIELDS, validate_observation
from .engine import ANATOMY, finite


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def _id(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 160 or not value.strip():
        raise ValueError('Invalid identity')
    return value


INLINE_BYTES = 1024
# No verifier accepts a replay above 64 MiB (app_recompute.py, recompute_session_score.evidence), so a
# state whose canonical JSON exceeds it can be neither exported nor verified. The same bound on writes and
# reads keeps a small crafted node set (shared references) from expanding into an unbounded state.
MAX_STATE_BYTES = 64 * 1024 * 1024
EVENT_KEYS = {'format','session_id','version','previous_sha256','action','received_at','details','state_root'}
INTEGRITY_ERRORS = (KeyError, IndexError, TypeError, ValueError, AttributeError, RecursionError)


def _put(nodes, body):
    digest = hashlib.sha256(body.encode()).hexdigest(); nodes[digest] = body
    return digest


def _split(value, nodes):
    """Child entry of value: (canonical text if inline else None, stored node digest or None, canonical length).

    value is JSON data as json.loads returns it (lists, string keys). Iterative and bottom-up, so any depth canonical() can serialize can be stored. A value whose
    canonical JSON reaches INLINE_BYTES is stored once in nodes as ["v",value], ["d",{key:child}] or
    ["l",[child]]; smaller values stay inline in their parent, so no text is copied more than once per node."""
    def leaf(text):
        return (text, None, len(text)) if len(text) < INLINE_BYTES else (None, _put(nodes, '["v",'+text+']'), len(text))
    def opened(value, out):
        """A frame [keys, items, next index, parts, out] for a container holding containers; any other value is finished into out."""
        keys = sorted(value) if isinstance(value, dict) else None
        items = [value[key] for key in keys] if keys is not None else value if isinstance(value, list) else ()
        if any(isinstance(item, (dict, list)) for item in items): return [keys, items, 0, [], out]
        out.append(leaf(canonical(value)))
    top = []; frames = [frame for frame in (opened(value, top),) if frame]
    while frames:
        frame = frames[-1]; keys, items, index, parts, out = frame
        while index < len(items) and not isinstance(items[index], (dict, list)):
            parts.append(leaf(canonical(items[index]))); index += 1
        if index < len(items):
            frame[2] = index+1; child = opened(items[index], parts)
            if child: frames.append(child)
            continue
        frames.pop()
        labels = [json.dumps(key)+':' for key in keys] if keys is not None else ['']*len(parts)
        opening, closing = '{}' if keys is not None else '[]'
        length = 1+len(parts)+sum(len(label)+size for label, (_, _, size) in zip(labels, parts))
        if length < INLINE_BYTES or all(digest is None for _, digest, _ in parts):
            text = opening+','.join(label+part for label, (part, _, _) in zip(labels, parts))+closing
            out.append((text, None, length) if length < INLINE_BYTES else (None, _put(nodes, '["v",'+text+']'), length))
        else:
            entries = ','.join(label+('["h","'+digest+'"]' if digest else '["v",'+part+']') for label, (part, digest, _) in zip(labels, parts))
            out.append((None, _put(nodes, '["'+('d' if keys is not None else 'l')+'",'+opening+entries+closing+']'), length))
    return top[0]


def _root(state, nodes):
    """Digest of the state's root node, which is stored however small the state is."""
    text, digest, _ = _split(state, nodes)
    return digest or _put(nodes, '["v",'+text+']')


def _entries(node):
    tag, value = node
    return value.values() if tag == 'd' else value if tag == 'l' else ()


def _node(body):
    """Parsed node after checking its shape: ["v",value], ["d",{key:child}] or ["l",[child]], every child tagged."""
    node = json.loads(body)
    if type(node) is not list or len(node) != 2 or not (node[0] == 'v' or node[0] == 'd' and type(node[1]) is dict or node[0] == 'l' and type(node[1]) is list):
        raise ValueError('Invalid ledger node')
    if not all(type(c) is list and len(c) == 2 and (c[0] == 'v' or c[0] == 'h' and type(c[1]) is str) for c in _entries(node)):
        raise ValueError('Invalid ledger node')
    return node


def _text(entry, nodes):
    """Canonical JSON text of a child entry over verified parsed nodes, built in one pass without recursion.

    A node referenced more than once below the entry is expanded once and its text reused, and the
    text may not exceed MAX_STATE_BYTES, so crafted shared references cost at most one bounded expansion."""
    references, queue = {}, [entry]
    while queue:
        tag, value = queue.pop()
        if tag == 'h':
            references[value] = references.get(value, 0)+1
            if references[value] == 1: queue.extend(_entries(nodes[value]))
    out, texts, work, length = [], {}, [entry], 0
    while work:
        item = work.pop()
        if type(item) is tuple:  # A shared node's text is complete: keep it for its other references.
            digest, start = item; texts[digest] = ''.join(out[start:]); del out[start:]; out.append(texts[digest]); continue
        if type(item) is str: piece = item
        elif item[0] == 'h' and item[1] in texts: piece = texts[item[1]]
        else:
            if item[0] == 'h' and references[item[1]] > 1: work.append((item[1], len(out)))
            tag, value = item if item[0] == 'v' else nodes[item[1]]
            if tag != 'v':
                keys = sorted(value) if tag == 'd' else range(len(value))
                sequence = ['{' if tag == 'd' else '[']
                for index, key in enumerate(keys): sequence += [(',' if index else '')+(json.dumps(key)+':' if tag == 'd' else ''), value[key]]
                sequence.append('}' if tag == 'd' else ']')
                work.extend(reversed(sequence)); continue
            piece = canonical(value)
        out.append(piece); length += len(piece)
        if length > MAX_STATE_BYTES: raise ValueError('state size')
    return ''.join(out)


def join(digest, nodes):
    """Value of a verified stored node: its canonical text parsed once, so shared nodes never alias."""
    return json.loads(_text(['h', digest], nodes))


def state_fields(events, nodes, key):
    """One top-level field of each verified event's state (None when absent), without joining whole states.

    A stored value shared by several versions is expanded once; every failure is a ledger integrity failure."""
    texts, values = {}, []
    try:
        for event in events:
            if 'state' in event: values.append(event['state'].get(key)); continue
            tag, value = nodes[event['state_root']]
            entry = ['v', value.get(key)] if tag == 'v' else value.get(key, ['v', None])
            if entry[0] == 'h' and entry[1] not in texts: texts[entry[1]] = _text(entry, nodes)
            values.append(json.loads(texts[entry[1]] if entry[0] == 'h' else _text(entry, nodes)))
    except INTEGRITY_ERRORS as exc:
        raise RuntimeError('Session ledger integrity failure') from exc
    return values


def _verify(session_id, rows, load_nodes):
    """The one integrity check for stored rows and supplied replays: (state, ledger digest, events, parsed nodes).

    rows are (version, canonical event body, digest). Full-state (v1) events carry their
    state; format 2 events carry the digest of their state's root node. load_nodes() yields
    (digest, body) and is only called once a format 2 event exists, so databases written
    before the nodes table still open read-only."""
    state = {'session_id':session_id,'version':0,'snapshot':None,'calibration':None,
             'pending':None,'designs':{},'attempts':[],'sensations':[],'jobs':[]}
    previous = '0'*64; events = []; nodes = {}
    try:
        for version, body, digest in rows:
            # Verify the original stored bytes without serializing any state again.
            if hashlib.sha256(body.encode()).hexdigest() != digest: raise ValueError('digest')
            event = json.loads(body)
            if version != len(events)+1 or event['previous_sha256'] != previous or event['session_id'] != session_id: raise ValueError('chain')
            if 'format' in event:
                if event['format'] != 2 or set(event) != EVENT_KEYS or event['version'] != version: raise ValueError('format')
            elif events and 'format' in events[-1] or event['state']['version'] != version: raise ValueError('v1 event')
            previous = digest; events.append({**event,'sha256':digest})
        upgraded = [event for event in events if 'format' in event]
        if upgraded:
            for digest, body in load_nodes():
                if hashlib.sha256(body.encode()).hexdigest() != digest: raise ValueError('node digest')
                nodes[digest] = _node(body)
            reachable = set(); queue = [event['state_root'] for event in upgraded]
            while queue:
                digest = queue.pop()
                if digest not in reachable: reachable.add(digest); queue.extend(c[1] for c in _entries(nodes[digest]) if c[0] == 'h')
            if reachable != set(nodes): raise ValueError('unreachable node')
            for event in upgraded:
                # The writer always inlines both fields in the root, so checking them expands nothing:
                # a root that names them through a stored node could make every event cost a full expansion.
                tag, root = nodes[event['state_root']]
                version, identity = ((['v', root[key]] if tag == 'v' else root[key]) for key in ('version', 'session_id'))
                if version[0] != 'v' or identity[0] != 'v' or version[1] != event['version'] or identity[1] != session_id: raise ValueError('root')
            state = join(upgraded[-1]['state_root'], nodes)
        elif events: state = events[-1]['state']
    except INTEGRITY_ERRORS as exc:
        raise RuntimeError('Session ledger integrity failure') from exc
    return state, previous, events, nodes


def _ledger(db, session_id):
    # Fetch all rows first: a cursor left open by a failed check would keep the database read-locked.
    return _verify(session_id, db.execute('SELECT version,body,digest FROM events WHERE session=? ORDER BY version',(session_id,)).fetchall(),
                   lambda: db.execute('SELECT digest,body FROM nodes WHERE session=?',(session_id,)).fetchall())


def read_ledger(root, session_id):
    """Verified replay that never dispatches a pending job or registers a model.

    The 'state' and 'replay' session actions drive recovery (they submit a persisted
    intent and append job_dispatched). This path opens the database read-only in one
    deferred transaction, so it cannot change the ledger or the job service."""
    path = Path(root).absolute() / 'sessions.sqlite3'
    _id(session_id)
    if path.is_symlink() or not path.is_file():
        raise KeyError(session_id)
    db = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=15)
    try:
        db.execute('BEGIN DEFERRED')
        state,digest,events,nodes=_ledger(db, session_id)
    except sqlite3.Error as exc:
        raise RuntimeError('Session ledger unavailable') from exc
    finally:
        db.close()
    if not events:
        raise KeyError(session_id)  # No recorded session; never an empty stand-in.
    return _response(state,digest,events,nodes)


def _response(state, digest, events, nodes):
    # Nodes appear only once a format 2 event exists, so full-state ledgers read back unchanged.
    return {'state':state,'ledger_sha256':digest,'events':events,**({'nodes':nodes} if nodes else {})}


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
            db.execute('CREATE TABLE IF NOT EXISTS nodes(session TEXT, digest TEXT, body TEXT, PRIMARY KEY(session,digest))')
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
        return _ledger(db, self.session_id)

    def _append(self, db, state, action, details):
        # A format 2 event binds the state by its root node digest; nodes are stored once per session.
        _,previous,_,stored=self._read(db)
        state['version']+=1
        text=canonical(state)
        if len(text)>MAX_STATE_BYTES: raise ValueError('Session state exceeds the ledger size bound')
        # Store the form readers get back (as a v1 reload did: string keys, tuples as lists, surrogate pairs
        # joined), then prove before anything is written that the stored tree rebuilds exactly its canonical
        # text. A state readers or verify_replay could not reproduce rolls the command back.
        value=json.loads(text); text=canonical(value)
        nodes={}; root=_root(value,nodes)
        tree=_text(['h',root],{**stored,**{key:_node(body) for key,body in nodes.items() if key not in stored}})
        if tree!=text: raise ValueError('Session state cannot be stored readably')
        db.executemany('INSERT OR IGNORE INTO nodes VALUES(?,?,?)',[(self.session_id,key,body) for key,body in nodes.items() if key not in stored])
        event={'format':2,'session_id':self.session_id,'version':state['version'],'previous_sha256':previous,'action':action,
               'received_at':_now(),'details':details,'state_root':root}
        db.execute('INSERT INTO events VALUES(?,?,?,?)',(self.session_id,state['version'],canonical(event),_hash(event)))

    def _dispatch(self, *, ledger=False):
        # Persisted intent precedes this side effect. The stable key recovers a crash
        # after JobService submission but before the job ID was recorded here.
        with self._db() as db:
            state,digest,events,nodes=self._read(db)
            model=state['snapshot']['model_id'] if state['snapshot'] else 'session-unfitted:'+_hash(self.session_id)
            self.service.register_model(self.session_id,model)
            pending=state['pending']
            if pending and pending.get('job_id') is None:
                try:
                    pending['job_id']=self.service.submit(pending['request'],idempotency_key=pending['key'])
                except (ValueError, RuntimeError) as exc:
                    record={**pending,'status':'submission_failed','error':str(exc)}
                    if pending.get('control_binding'):
                        from .session_control import job_record
                        record=job_record(record)
                    state['jobs'].append(record)
                    state['pending']=None
                    if pending.get('visual_binding'):
                        from .session_visual import collect
                        collect(state,pending,'submission_failed',None)
                    if pending.get('source_binding'):
                        from .session_source import collect
                        collect(state,pending,'submission_failed',None)
                    if pending.get('control_binding'):
                        from .session_control import collect
                        collect(state,pending,'submission_failed',None)
                    if pending['request']['operation']=='update_pcm':
                        for design in state['designs'].values():
                            if design['status']=='outcome_pending': design['status']='failed'
                self._append(db,state,'job_dispatched',{'job_id':pending.get('job_id')})
                if ledger:state,digest,events,nodes=self._read(db)
            # Parsed state/events are detached request-local objects already.
            return (state,digest,events,nodes) if ledger else state

    def execute(self, command):
        if not isinstance(command,dict) or len(canonical(command).encode())>2_000_000:
            raise ValueError('Invalid or excessive session command')
        action=command.get('action')
        if action in ('state','replay'):
            if set(command)!={'action'}:
                raise ValueError('Unexpected read parameters')
            state,digest,events,nodes=self._dispatch(ledger=True)
            if state.get('control_receipts'):
                from .session_control import verify_ledger
                verify_ledger(state,events,nodes)
            return _response(state,digest,events,nodes) if action=='replay' else {'state':state,'ledger_sha256':digest}
        command_id=_id(command.get('command_id'))
        fields={'forecast_visual':{'forecast_id','parameters'},'score_visual':{'forecast_id','parameters'},'register_model':{'snapshot'},'ingest_calibration':{'document'},'search':{'parameters'},'fit_probe':{'parameters'},'fit_lidar':{'parameters'},
            'select_experiment':{'source_design_id','design_id','target_observation_id','experiment_id','selection_reason'},
            'propose_design':{'parameters'},'collect_job':{'job_id'},'submit_outcome':{'design_id','parameters'},
            'forecast_source_bank':{'parameters'},'score_source_bank':{'forecast_id','pcm','metadata'},'fit_source':{'parameters'},'forecast_source':{'parameters'},'score_source':{'forecast_id','pcm','metadata'},
            'declare_control_binding':{'binding_id','binding'},'forecast_control':{'binding_id','target_id','parameters'},'score_control':{'forecast_id','pcm','metadata'},'record_control_attempt':{'forecast_id','status','reason'},
            'record_attempt':{'design_id','attempt_id','status','reason'},'record_sensation':{'attempt_id','text'}}
        if action not in fields or set(command)!={'action','command_id','expected_version'}|fields[action]:
            raise ValueError('Unsupported session command fields')
        with self._db() as db:
            state,_,_,_=self._read(db)
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
        if action in ('forecast_visual','score_visual'):
            from .session_visual import prepare
            operation,parameters,binding=prepare(state,action,c)
            self._launch(state,operation,parameters,c['command_id'])
            state['pending']['visual_binding']=binding
        elif action in ('fit_source','forecast_source','score_source','forecast_source_bank','score_source_bank'):
            from .session_source import prepare
            operation,parameters,binding=prepare(state,action,c)
            self._launch(state,operation,parameters,c['command_id'])
            state['pending']['source_binding']=binding
        elif action in ('declare_control_binding','forecast_control','score_control','record_control_attempt'):
            from .session_control import prepare
            launch=prepare(state,action,c)
            if launch:
                operation,parameters,binding=launch
                self._launch(state,operation,parameters,c['command_id'])
                state['pending']['control_binding']=binding
        elif action=='register_model':
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
                if not isinstance(trial,dict) or set(trial)-OPTIONAL_TRIAL_FIELDS!={'id','pose','measurement','sample_rate_hz','frame_start_sample','frame_size','duration_s'}:
                    raise ValueError('Invalid calibration trial')
                _id(trial['id']); _id(trial['pose'])
                if trial['id'] in ids: raise ValueError('Duplicate calibration trial')
                ids.add(trial['id'])
                rate,start,size=trial['sample_rate_hz'],trial['frame_start_sample'],trial['frame_size']
                duration=finite(trial['duration_s'],'duration_s')
                if type(rate) is not int or rate not in (44100,48000,96000) or type(start) is not int or start<0 or type(size) is not int or not 256<=size<=32768 or not .1<=duration<=5 or start+size>round(duration*rate):
                    raise ValueError('Unsupported canonical rate, duration or frame bounds')
                _features(trial['measurement'])
                # Consistency only: the session holds no original bytes, so fits keep
                # reporting source_artifact_bytes_verified: false.
                validate_observation(trial)
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
            if not isinstance(params,dict) or set(params)-{'anatomy_bounds','nuisance_profiles','max_synthesis_calls','rounds','seed','objective'}:
                raise ValueError('Invalid search parameters')
            params['observations']=state['calibration']
            self._launch(state,'search_pcm',params,c['command_id'])
        elif action=='fit_lidar':
            from .session_lidar import prepare
            self._launch(state,'rank_lidar_hypotheses',prepare(state,c['parameters']),c['command_id'])
        elif action=='fit_probe':
            if state['snapshot'] is None or state['calibration'] is None:
                raise ValueError('Probe fitting requires current hypotheses and stored PCM calibration')
            params=deepcopy(c['parameters'])
            allowed={'probe_observations','candidates','max_native_calls','pcm_weight','probe_weight'}
            if not isinstance(params,dict) or set(params)-allowed or not {'probe_observations','candidates'}<=set(params):
                raise ValueError('Invalid probe fitting parameters')
            snapshot=state['snapshot']; support={_hash(h['anatomy']) for h in snapshot['hypotheses']}
            candidates=params['candidates']
            if not isinstance(candidates,list) or not 1<=len(candidates)<=32:
                raise ValueError('Require bounded retained probe candidates')
            covered=set()
            for candidate in candidates:
                if not isinstance(candidate,dict) or not isinstance(candidate.get('anatomy'),dict):
                    raise ValueError('Probe candidate requires full retained anatomy')
                key=_hash(candidate['anatomy'])
                if key not in support: raise ValueError('Probe candidate reintroduces unsupported anatomy')
                covered.add(key)
            if covered!=support: raise ValueError('Probe candidates must cover every retained geometry')
            doc=params['probe_observations']
            if not isinstance(doc,dict) or not isinstance(doc.get('trials'),list):
                raise ValueError('Probe observation document required')
            previous_ids=set(snapshot['evidence_ids']);previous_hashes=set(snapshot['evidence_hashes'])
            for record in doc['trials']:
                if not isinstance(record,dict): raise ValueError('Invalid probe record')
                source=record.get('source',{})
                if not isinstance(source,dict): raise ValueError('Probe source identity required')
                ids={v for v in (record.get('id'),source.get('received_artifact_id'),source.get('drive_artifact_id')) if isinstance(v,str)}
                hashes={v for v in (source.get('received_sha256'),source.get('drive_sha256')) if isinstance(v,str)}
                if ids & previous_ids or hashes & previous_hashes:
                    raise ValueError('Probe evidence overlaps existing model lineage')
            params['observations']=state['calibration']
            self._launch(state,'fit_probe_pcm',params,c['command_id'])
        elif action=='propose_design':
            if not state['snapshot']: raise ValueError('A frozen model is required')
            params=deepcopy(c['parameters'])
            if not isinstance(params,dict) or set(params)-{'design_id','target_observation_id','experiments','feature_scales','minimum_separation','max_synthesis_calls','retention_margin','maximum_discrepancy','profile','objective'}:
                raise ValueError('Invalid design parameters')
            identity=_id(params.get('design_id')); target=_id(params.get('target_observation_id'))
            if identity in state['designs'] or any(d['data']['target_observation_id']==target for d in state['designs'].values()):
                raise ValueError('Design or target already reserved')
            snapshot=Artifact(_encode(state['snapshot']))
            params.update(snapshot_json=snapshot.content.decode(),expected_digest=snapshot.sha256,generated_at=_now())
            self._launch(state,'design_pcm',params,c['command_id'])
        elif action=='select_experiment':
            if state['pending'] or not state['snapshot']:
                raise ValueError('Selection requires current idle model')
            source=state['designs'].get(c['source_design_id'])
            if not source or source['status'] not in ('committed','unsupported'):
                raise ValueError('Source forecast is not available for selection')
            if c['design_id'] in state['designs'] or any(d['data']['target_observation_id']==c['target_observation_id'] for d in state['designs'].values()):
                raise ValueError('Design or target already reserved')
            snapshot=Artifact(_encode(state['snapshot'])); forecast=Artifact(_encode(source['data']))
            selected=select_pcm_experiment(forecast,snapshot,expected_design_digest=forecast.sha256,
                expected_snapshot_digest=snapshot.sha256,**{k:c[k] for k in ('design_id','target_observation_id','experiment_id','selection_reason')})
            state['designs'][c['design_id']]={'data':selected.data,'committed_at':_now(),'status':'committed'}
            source['status']='superseded'
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
            if operation in ('fit_phonation','forecast_phonation','score_phonation','forecast_phonation_bank','score_phonation_bank'):
                from .session_source import collect
                collect(state,pending,status['status'],result)
            if operation in ('freeze_visual_forecast','score_visual_forecast'):
                from .session_visual import collect
                collect(state,pending,status['status'],result)
            if operation in ('forecast_control_pcm','score_control_pcm'):
                from .session_control import collect
                collect(state,pending,status['status'],result)
            if operation=='rank_lidar_hypotheses':
                from .session_lidar import collect
                collect(state,pending,status['status'],result)
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
                elif operation=='fit_probe_pcm':
                    included={r['id'] for r in result['probe_records'] if r['included_in_fit']}
                    ranked=sorted([r for r in result['joint']['candidates'] if r['status']=='scored' and r['probe_discrepancy'] is not None],
                        key=lambda r:(r['joint_discrepancy'],r['candidate_id']))
                    if result['status']=='joint_probe_evidence_used' and ranked and included:
                        parent=state['snapshot'];parent_digest=_hash(parent)
                        by_geometry={_hash(h['anatomy']):h for h in parent['hypotheses']}
                        ranked_keys=[]
                        for row in ranked:
                            key=_hash(row['anatomy'])
                            if key not in by_geometry: raise ValueError('Probe result geometry differs from retained support')
                            if key not in ranked_keys: ranked_keys.append(key)
                        # Unscored hypotheses remain explicit support, never discarded as impossible.
                        keys=ranked_keys+[k for k in by_geometry if k not in ranked_keys]
                        ids=set(parent['evidence_ids']);hashes=set(parent['evidence_hashes'])
                        for record in pending['request']['parameters']['probe_observations']['trials']:
                            if record['id'] not in included: continue
                            source=record['source'];ids.update([record['id'],source['received_artifact_id'],source['drive_artifact_id']])
                            hashes.update([source['received_sha256'],source['drive_sha256']])
                            for role in ('calibration','nuisance_prior','timing'):
                                evidence=record.get(role,{})
                                hashes.update(evidence.get('source_hashes',[]))
                                for name in ('calibration_id','prior_id','evidence_id'):
                                    if evidence.get(name): ids.add(evidence[name])
                        now=_now(); result_digest=_hash(result)
                        updated={**parent,'model_id':'probe-model:'+_hash([parent_digest,result_digest]),
                            'parent_snapshot_sha256':parent_digest,'probe_fit_sha256':result_digest,
                            'hypotheses':[by_geometry[k] for k in keys],'evidence_ids':sorted(ids),'evidence_hashes':sorted(hashes),
                            'frozen_at':now,'sealed_at':now,'probe_ranking':[{'candidate_id':r['candidate_id'],
                                'anatomy_sha256':_hash(r['anatomy']),'joint_discrepancy':r['joint_discrepancy'],
                                'probe_discrepancy':r['probe_discrepancy']} for r in ranked],
                            'probe_adoption_scope':'Ranking of retained geometries using original PCM calibration plus new probe; later PCM outcomes are not rescored; all geometry support retained'}
                        artifact=Artifact(_encode(updated));_snapshot(artifact,artifact.sha256)
                        state['snapshot']=updated
                        for design in state['designs'].values():
                            if design['status'] in ('committed','unsupported'): design['status']='stale'
                        result['session_adoption']={'status':'ranked_retained_support','model_id':updated['model_id'],
                            'parent_snapshot_sha256':parent_digest,'scoring_result_sha256':result_digest}
                    else:
                        result['session_adoption']={'status':'no_usable_joint_probe_result','model_unchanged':True}
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
            record={**pending,'status':status['status'],'error':status.get('error'),'result':result}
            if pending.get('control_binding'):
                from .session_control import job_record
                record=job_record(record)
            state['jobs'].append(record)
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
        if state.get('visual_forecasts'):
            from .session_visual import invalidate_stale
            invalidate_stale(state)
        if state.get('source_model'):
            from .session_source import invalidate_stale
            invalidate_stale(state)
        if state.get('control_forecasts'):
            from .session_control import invalidate_stale
            invalidate_stale(state)
        return {'command_id':c['command_id'],'input_sha256':_hash(c)}
