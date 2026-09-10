import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateRecord, type CandidateAnatomy } from '../../contracts';
import { verifyGeometry } from './geometryArtifact';
import './AnatomyModes.css';
import {ScientificGeometry} from '../science/ScientificGeometry';


function disposeObject(root: THREE.Object3D) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

function GeometryView({ bytes }: { bytes: ArrayBuffer }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    let disposed = false;
    let object: THREE.Object3D | undefined;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { queueMicrotask(() => setError('WebGL is unavailable.')); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.domElement.setAttribute('aria-label', 'Verified engine candidate geometry. Drag to orbit; scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3d5147, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 4, 5); scene.add(light);
    const camera = new THREE.PerspectiveCamera(40, 1, .001, 10000);
    camera.position.set(0, 0, 3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    });
    observer.observe(container);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (!url.startsWith('data:') && !url.startsWith('blob:')) throw new Error('External geometry resources are disabled.');
      return url;
    });
    const loader = new GLTFLoader(manager);
    loader.parse(bytes, '', gltf => {
      if (disposed) { disposeObject(gltf.scene); return; }
      object = gltf.scene;
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3()).length();
      if (box.isEmpty() || !Number.isFinite(size) || size <= 0) { disposeObject(object); object = undefined; setError('Geometry contains no visible surface.'); return; }
      scene.add(object);
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.6));
      camera.near = size / 10000; camera.far = size * 100;
      camera.updateProjectionMatrix(); controls.update();
    }, reason => { if (!disposed) setError(reason instanceof Error ? reason.message : 'Geometry could not be loaded.'); });
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => {
      disposed = true; observer.disconnect(); controls.dispose(); renderer.setAnimationLoop(null);
      if (object) disposeObject(object);
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [bytes]);
  return <div className="mapped-geometry" ref={mount}>{error && <p role="alert">{error}</p>}</div>;
}

export function AnatomyModes({ children, candidates = [], scientificPreview=false, onScientificPreview }: { children: ReactNode; candidates?: CandidateAnatomy[]; scientificPreview?:boolean; onScientificPreview?:(enabled:boolean)=>void }) {
  const [mode, setMode] = useState<'default' | 'mapped'>('default');
  const [imported, setImported] = useState<CandidateAnatomy[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [verified, setVerified] = useState<{ key: string; bytes: ArrayBuffer } | null>(null);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const options = [...new Map([...candidates, ...imported].map(candidate => [candidate.id, candidate])).values()];
  const selected = options.find(candidate => candidate.id === selectedId) ?? options[0];
  const geometryKey = selected ? `${selected.id}:${selected.geometry?.sha256}` : '';
  const bytes = verified?.key === geometryKey ? verified.bytes : null;
  const eligible = selected?.availability === 'available' && !!selected.geometry && selected.provenance.kind === 'engine-generated';
  async function importCandidate(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Candidate JSON must be smaller than 2 MB.');
      const result = validateRecord(JSON.parse(await file.text()));
      if (!result.valid) throw new Error(result.errors[0]);
      if (result.record.kind !== 'candidate-anatomy') throw new Error('Choose a candidate-anatomy contract record.');
      const candidate = result.record;
      request.current++;
      setImported(previous => [...previous.filter(item => item.id !== candidate.id), candidate]);
      setSelectedId(candidate.id); setVerified(null); setMessage('Candidate imported. Select its geometry file to verify and view.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Candidate import failed.'); }
  }
  async function importGeometry(file?: File) {
    if (!file || !selected) return;
    const token = ++request.current;
    setVerified(null); setMessage('Verifying geometry…');
    try {
      const result = await verifyGeometry(file, selected);
      if (token !== request.current) return;
      setVerified({ key: geometryKey, bytes: result }); setMessage('SHA-256 verified. Geometry is an engine estimate, not a direct internal measurement.');
    } catch (error) { if (token === request.current) setMessage(error instanceof Error ? error.message : 'Geometry import failed.'); }
  }
  return <div className="anatomy-modes">
    <div className="anatomy-mode-switch" role="group" aria-label="Anatomy mode">
      <button aria-pressed={!scientificPreview&&mode === 'default'} onClick={() => {onScientificPreview?.(false);setMode('default')}}>Default</button>
      <button aria-pressed={!scientificPreview&&mode === 'mapped'} onClick={() => {onScientificPreview?.(false);setMode('mapped')}}>Mapped</button>
      <button aria-pressed={scientificPreview} onClick={()=>onScientificPreview?.(true)}>Model</button>
      <span>{scientificPreview?'Hypothesis':mode === 'default' ? 'Reference anatomy' : 'Engine candidates'}</span>
    </div>
    {scientificPreview&&<ScientificGeometry/>}
    <div className="default-anatomy" hidden={scientificPreview||mode !== 'default'}>{children}</div>
    {!scientificPreview&&mode === 'mapped' && <section className="mapped-anatomy" aria-label="Mapped anatomy">
      <div className="mapped-imports">
        <label>Import candidate JSON<input type="file" accept=".json,application/json" onChange={event => { void importCandidate(event.target.files?.[0]); event.target.value = ''; }} /></label>
        {options.length > 0 && <label>Candidate<select value={selected?.id ?? ''} onChange={event => { request.current++; setSelectedId(event.target.value); setVerified(null); setMessage(''); }}>{options.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.modelVersion}</option>)}</select></label>}
        {eligible && <label>Geometry GLB / embedded glTF<input type="file" accept=".glb,.gltf" onChange={event => { void importGeometry(event.target.files?.[0]); event.target.value = ''; }} /></label>}
      </div>
      {!eligible && <p className="mapped-empty">Mapped anatomy unavailable{selected?.missingReason ? `: ${selected.missingReason.replaceAll('-', ' ')}` : ': no fitted engine geometry yet'}. Phone photos and webcam tracking describe visible surfaces; they do not reconstruct internal muscles.</p>}
      {eligible && !bytes && <p className="mapped-empty">Choose the geometry file referenced by this candidate. Files stay in this browser; remote artifact links are never fetched.</p>}
      {message && <p className="mapped-message" role="status">{message}</p>}
      {bytes && <GeometryView key={geometryKey} bytes={bytes} />}
      {selected && <details className="mapped-provenance"><summary>Parameters & provenance ({selected.parameters.length})</summary>
        <p>Producer: {selected.provenance.producer} {selected.provenance.producerVersion} · {selected.provenance.kind}</p>
        <p>Solver: {selected.solver ? `${selected.solver.name} ${selected.solver.version}` : 'Unavailable'} · Evidence: {selected.evidenceIds.join(', ') || 'None declared'}</p>
        <p>Uncertainty: {selected.uncertaintyMethod ?? 'Not quantified'}{selected.mismatch ? ' · Model mismatch flagged' : ''}</p>
        <p>Artifact: {selected.geometry?.uri ?? 'None'} · SHA-256: {selected.geometry?.sha256 ?? 'None'}</p>
        <table><thead><tr><th>Parameter</th><th>Value</th><th>Status</th></tr></thead><tbody>{selected.parameters.map((parameter, index) => <tr key={`${parameter.name}-${index}`} title={`${parameter.interpretation}; ${parameter.role}; bounds ${parameter.bounds.join('…')}; ${parameter.simulatorMapping}`}><td>{parameter.name}</td><td>{parameter.value} {parameter.unit}</td><td>{parameter.status}</td></tr>)}</tbody></table>
      </details>}
    </section>}
  </div>;
}
