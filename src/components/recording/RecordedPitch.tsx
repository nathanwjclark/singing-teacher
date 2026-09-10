import { useEffect, useState } from 'react';
import type { AudioMeasurement } from '../../contracts';
import type { FinishedRecording } from '../../lib/recording';
import { measureRecording } from '../../lib/recordingMeasurements';
import { pitchToNote } from '../../lib/audio';

export function RecordedPitch({ recording }: { recording: FinishedRecording }) {
  const [rows, setRows] = useState<AudioMeasurement[] | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false, download = '';
    void measureRecording(recording).then(value => {
      if (cancelled) return;
      setRows(value);
      download = URL.createObjectURL(new Blob([JSON.stringify({ schema: 'singing-teacher/recorded-audio/1', observationId: recording.observationBundle.id, hopMs: 100, measurements: value }, null, 2)], { type: 'application/json' }));
      setUrl(download);
    }).catch(cause => { if (!cancelled) setError(`Audio extraction failed: ${cause instanceof Error ? cause.message : String(cause)}. Download the recording for offline analysis.`); });
    return () => { cancelled = true; if (download) URL.revokeObjectURL(download); };
  }, [recording]);
  if (error) return <p role="alert">{error}</p>;
  if (!rows) return <p role="status">Extracting the recorded pitch timeline…</p>;
  if (!rows.length) return <p>No audio windows in this recording. Start the microphone before recording.</p>;
  const duration = rows.at(-1)!.window.endMs;
  const notes = rows.map(row => {
    const hz = row.measurements.find(m => m.name === 'pitchHz')?.value;
    return typeof hz === 'number' ? { time: row.window.startMs, hz, note: pitchToNote(hz)! } : null;
  });
  const valid = notes.filter(value => value !== null);
  const width = 680, height = 115;
  const y = (midi: number) => 8 + (85 - midi) / 49 * (height - 16);
  let path = '', connected = false;
  notes.forEach(point => {
    if (!point) { connected = false; return; }
    const x = 28 + point.time / duration * (width - 34);
    const yy = y(69 + 12 * Math.log2(point.hz / 440));
    path += `${connected ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)} `;
    if (!connected) path += `l0.7,0 `;
    connected = true;
  });
  return <section className="recorded-pitch">
    <strong>Recorded pitch · {valid.length}/{rows.length} windows voiced</strong>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pitch extracted from saved recording at 100 millisecond intervals; gaps mean no reliable pitch">
      {[36, 60, 84].map(midi => <g key={midi}><text x="0" y={y(midi) + 3} fill="#97a496" fontSize="9">C{midi / 12 - 1}</text><line x1="28" x2={width} y1={y(midi)} y2={y(midi)} stroke="#ffffff15" /></g>)}
      <path d={path} fill="none" stroke="#ead98c" strokeWidth="1.5" />
    </svg>
    <div className="audio-axis"><span>0 s</span><span>{(duration / 1000).toFixed(1)} s</span></div>
    <p>{valid.length ? `Notes observed: ${[...new Set(valid.map(point => `${point.note.name}${point.note.octave}`))].join(', ')}.` : 'No stable pitch detected. Check microphone input and try sustaining a vowel.'} Silence and uncertain windows remain gaps.</p>
    <a href={url} download={`${recording.manifest.id}-audio.json`}>Download pitch & audio measurements</a>
  </section>;
}
