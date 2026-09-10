# AUD-01: canonical browser audio measurements

`analyzeAudioFrame(pcm, sampleRate)` accepts a finite mono PCM window of 256–32768 power-of-two samples. Live analysis uses `audioFrameSize(sampleRate)` to retain at least 85 ms at the actual AudioContext rate, sampled roughly 10 times/second (4096 samples at 44.1/48 kHz, 8192 at 96 kHz, 16384 at 192 kHz). A fixed 4096 window previously made the detector return no pitch at 192 kHz. The same function handles decoded recordings and synthesized engine PCM. Window inputs must use the same sample rate/window duration when comparing results; there is no resampling hidden in the API.

`extractAudioMeasurement(pcm, sampleRate, metadata)` produces the versioned KIT-01 AudioMeasurement contract. Metadata supplies observation/artifact IDs, hashes, start time and source timebase; it must reference the actual retained source. Producer version and method are pinned to `1.1.0` / `pcm-blackman-power-yin/1.1.0`.

Features: digital RMS level in dBFS; power-weighted spectral centroid and flatness over 80–10000 Hz (limited by Nyquist); YIN-style fundamental frequency over 65–1100 Hz; waveform periodicity. Below −60 dBFS, pitch/spectral features are missing with low-confidence reasons. These descriptors are not ratings of singing quality or direct measurements of muscles. No formant estimates or anatomical inference are fabricated.

The spectrum uses the [Web Audio Blackman convention](https://www.w3.org/TR/webaudio/#blackman-window), with an independent radix-2 FFT and zero temporal smoothing. This makes live/recorded/synthesized extraction identical rather than depending on stateful browser spectral smoothing.

## Automatic relative ambient calibration

Each microphone start or detected audio-track/settings change resets calibration. The estimator collects at least 20 unvoiced quiet windows spanning 1.9 seconds, takes their lower 20th percentile, and adapts cautiously over a rolling 30-second history. Louder windows and clipped samples are excluded. The UI stays in “pause singing briefly” while continuous voiced input prevents calibration. Clipping means a sample reaches 0.995 full scale. Estimated SNR subtracts estimated ambient power from total power; it is missing near ambient level. Serialized SNR uses a power ratio (the contract has no generic dB unit).

This automatically establishes relative ambient/gain context. It does **not** identify microphone frequency response, absolute SPL, room impulse response or reverberation time from passive ambient audio. Those require known reference excitation/calibration measurements. The capture request disables noise suppression, AGC and echo cancellation, but [device constraints/settings](https://w3c.github.io/mediacapture-main/) determine support; a quality flag preserves processing that remains enabled. Actual recording settings remain the capture owner's responsibility.

## Integration and limits

AudioPanel adds `externalStream`, `onStream` and `onMeasurement` props. It stops locally owned microphone tracks on release, and only disconnects borrowed phone streams. No recording starts automatically. `onStream(null)` signals release.

Live callback measurements are transient previews. Their source IDs explicitly say `unrecorded-pcm`, carry `live-preview-not-recorded` and `analysis-poll-timestamp` flags, and have unknown synchronization uncertainty. They must not be presented as source-synchronized recorded evidence. Scientific replay should decode the recorded artifact and invoke the canonical extractor using its actual capture timebase/hashes. Phone previews additionally flag unknown remote latency. Worklet-level exact sample capture belongs to acquisition and is not claimed by this panel.

The synthetic UI demo remains an illustrative animation; it emits no measured evidence. Four focused checks cover known tone/silence/invalid PCM/contract serialization, ambient calibration/singing rejection/clipping, 28 frequency/device-rate combinations, and sub-second recorded note transitions with silence. Run `node --experimental-strip-types --test src/lib/audio.measurement.test.ts`.


## Saved pitch timeline and repair evidence

`measureRecording` decodes the saved container, chooses the highest-energy audio channel, and extracts a window every 100 ms across the recording. The previous one-second interval discarded most note changes. A ten-minute capture produces roughly 6000 windows. Extraction yields to the browser every 20 windows; dashboard and replay share a cached extraction promise. Quiet recorded windows establish their own ambient calibration; continuous singing remains uncalibrated. Time coordinates belong to decoded audio; unknown sensor synchronization remains explicit.

**Last recording** shows the saved pitch trajectory, voiced-window count, note names, and a downloadable JSON of versioned audio measurements. It never substitutes the live graph for recorded evidence. Missing pitch remains a gap. The live graph also renders isolated voiced samples and explains quiet/unsteady/ambiguous input, displays the actual input label and AudioContext sample rate, and surfaces analysis errors without terminating its render loop.

Targeted Chrome browser check: inject an oscillator-backed microphone, explicitly record 220 → 440 → silence → 330 Hz, stop and decode the actual MediaRecorder blob, open Last recording, and inspect exported JSON. Result: 25 windows, A3/A4/E4, and five silent gaps. The normal 48 kHz live path already worked with injected input; this does not establish the cause on the user's physical microphone. A real-device check is still required, especially for input selection, permission/autoplay, noisy rooms and phone/WebRTC routing. This work does not claim room EQ compensation or anatomical inference.

### Sensitive live pitch meter

The Studio pitch meter uses an 18 dB lower input floor (−78 dBFS instead of
−60 dBFS) and a 0.72 YIN periodicity threshold when the canonical detector has no
pitch. This is a display estimate: microphone PCM, recorded audio, and the
versioned canonical measurements supplied to experiments remain unchanged.
Ambient calibration sees the sensitive periodicity so quiet sustained singing
is not mistaken for room noise. The waveform display also scales up quieter
input. Silence and non-periodic noise still produce pitch gaps; a periodic fan
or accompaniment can produce a note, since periodicity does not identify a voice.
