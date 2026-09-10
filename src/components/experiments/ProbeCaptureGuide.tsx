export function ProbeCaptureGuide() {
  return <details className="probe-guide">
    <summary>One iPhone · capture checklist</summary>
    <ol>
      <li><strong>Check the route.</strong> In Singing Depth, enable Acoustic mapping (this pauses camera/depth), then tap Prepare route. Preparation is silent. Use the supported built-in speaker and microphone route; keep the phone outside your mouth. Enter a Placement ID and record its position and orientation near the lips.</li>
      <li><strong>Check output level and placement.</strong> Tap Export route / level-check request. Complete the protocol’s physical output-level check with a calibrated instrument, then Import reviewed output-level check. The check must match the current route, volume and placement. A volume slider or ambient-silence reading does not calibrate the speaker. An unchecked route remains blocked for human playback.</li>
      <li><strong>Start deliberately.</strong> Pause singing recordings and coaching. Select Neutral/open mouth, Comfortable ah or Return to baseline, then tap Start 3 probes. The versioned external-sweep-pilot-1 protocol records three 1-second, 300–6000 Hz sweeps, with silence before, between and after. The peak digital setting is 0.01; it is not a sound-pressure measurement. Stop ends both sound and recording.</li>
      <li><strong>Repeat at the same placement.</strong> Capture a comfortable neutral/open-mouth reference, one approved vowel-like pose, a return to reference, and repetitions. Avoid singing during the probe. Record any subjective sensation separately.</li>
      <li><strong>Keep lineage.</strong> Tap Share latest private export, transfer the ZIP to this Mac, run the probe importer, then import its response review JSON below. Keep the original ZIP and generated artifacts together. Changing placement, volume or route requires new calibration records.</li>
    </ol>
    <p>A second phone is optional. Unsupported channels can be retained, but are not anatomical evidence. Native route changes, volume changes, interruptions and backgrounding stop the trial locally; do not treat an incomplete trial as a successful repeat.</p>
  </details>
}
