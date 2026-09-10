export function ProbeCaptureGuide() {
  return <details className="probe-guide">
    <summary>One iPhone · capture checklist</summary>
    <ol>
      <li><strong>Check the route.</strong> In Singing Depth, open Advanced sound setup, then tap Prepare sound route (silent). This temporarily pauses camera/depth. Use the supported built-in speaker and microphone route; keep the phone outside your mouth. Enter a Placement ID and record its position and orientation near the lips.</li>
      <li><strong>Check output level and placement.</strong> Tap Export level-check request. Complete the protocol’s physical output-level check with a calibrated instrument, then Import reviewed level check and Return to camera. The check must match the current route, volume and placement. A volume slider or ambient-silence reading does not calibrate the speaker. An unchecked route remains blocked for human playback.</li>
      <li><strong>Start deliberately.</strong> Choose your capture task, enable Add sound measurement after video, and tap Start capture. Video, depth and ordinary microphone audio record first. After the ten-second video phase saves, the app rechecks the sound route and starts three probes; hold still without singing for that phase. The versioned external-sweep-pilot-1 protocol records three 1-second, 300–6000 Hz sweeps, with silence before, between and after. The peak digital setting is 0.01; it is not a sound-pressure measurement. Stop cancels the entire sequence, including any pending sound phase. Sound and depth are sequential, not simultaneous.</li>
      <li><strong>Repeat at the same placement.</strong> Capture a comfortable neutral/open-mouth reference, one approved vowel-like pose, a return to reference, and repetitions. Avoid singing during the probe. Record any subjective sensation separately.</li>
      <li><strong>Keep lineage.</strong> Use Share latest private capture or pull it directly over USB while the phone is unlocked. A linked session ZIP retains the original video and probe ZIPs; extract the probe ZIP and run the probe importer, then import its response review JSON below. Keep the original ZIP and generated artifacts together. Changing placement, volume or route requires new calibration records.</li>
    </ol>
    <p>A second phone is optional. Unsupported channels can be retained, but are not anatomical evidence. Native route changes, volume changes, interruptions and backgrounding stop the trial locally; do not treat an incomplete trial as a successful repeat.</p>
  </details>
}
