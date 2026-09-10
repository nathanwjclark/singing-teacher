# Synchronized capture and iPhone depth

Implementation addendum to the physiological acoustic moonshot and two-person plan. Available hardware: iPhone 13 Pro Max and iPhone 15 Pro. Prepared September 10, 2026. Hardware feasibility remains to be tested on those devices.

## Repository baseline

Remote: https://github.com/nathanwjclark/singing-teacher

Inspected main at `9a5bfa085666551aa9cea7fa7b404808d5dc485f`. The README describes a browser application with independent camera and microphone lifecycles, local analysis, no recording/upload and no backend. It already has a movement viewer and audio/vision components. `src/lib/depth.ts` derives approximate geometry/range from landmarks, an iris-size prior and assumed camera field of view; it does not ingest measured iPhone depth. Its estimates must remain distinct from hardware depth.

The new plan supersedes this repository baseline. Existing interface and assets are optional reusable material; their architecture does not constrain the implementation. The existing reference anatomy viewer is not yet the geometry produced by a fitted forward model. No remote repository changes, push or deployment were performed for this planning addendum.

## One observation, multiple software modules

Capture can be separate from the inverse model without separating audio from images. One acquisition owner produces a synchronized observation bundle; the inference service consumes the whole bundle. Audio and visual feature extractors may run independently, but their results retain the shared timebase and are fused in the physical likelihood.

```text
iPhone capture app
  microphone + selected RGB camera + corresponding depth
  timestamps + calibration + capture settings + quality
                         |
                 ObservationBundle
                         |
           ingestion / synchronized feature extraction
                         |
            joint physiological acoustic inference
                         |
          model geometry + predictions + uncertainty
                         |
            existing web interface on the MacBook
```

Person B owns all acquisition modalities and alignment, including the native iOS adapter. Person A owns the physical observation model: how visible geometry, depth and sound constrain common anatomy and time-varying articulation. They jointly define the bundle. There is no separate audio-owner versus camera-owner split.

Minimum bundle fields: participant/session/trial IDs; prediction ID; sensor/device/OS identifiers; audio samples and presentation timestamps; RGB frame timestamps; depth values and their own timestamps; depth-versus-disparity representation and units; camera intrinsics/distortion and alignment metadata; pose/transforms where actually available; capture formats and settings; missing/dropped data; filtering flags; artifact hashes; and estimated synchronization uncertainty. An AR face mesh is a derived estimate with its own provenance, not raw measured interior geometry.

For the first mode, record microphone, RGB and depth on one iPhone. Use capture timestamps, not network arrival time, to align data. Record actual frame rates; audio, RGB and depth need not have matching sample rates. Never replicate a stale depth map and label it a fresh simultaneous measurement. Upload/store one bundle after a short trial first; live streaming is an optimization after correctness.

Separate static morphology scans from dynamic singing trials. A profile or open-mouth scan from a different pose can constrain stable structure but is not the exact tract configuration during an earlier sung note. Do not combine nonrigid tongue/jaw poses as though the entire head were a rigid object.

## Available sensors

Both available phones have a front TrueDepth camera system and rear LiDAR. Confirm usable capture formats at runtime; the hardware specification does not guarantee every desired combination or frame rate. [iPhone 13 Pro Max specifications](https://support.apple.com/en-us/111870), [iPhone 15 Pro specifications](https://support.apple.com/en-us/111829).

Current MacBook Air/Pro camera specifications do not include LiDAR or TrueDepth. Use the Mac as compute/display and the phone as the depth instrument. [MacBook Air specifications](https://www.apple.com/macbook-air/specs/), [MacBook Pro specifications](https://www.apple.com/macbook-pro/specs/).

Start with the iPhone 15 Pro's front TrueDepth as the proposed primary face capture path. Compare the 13 Pro Max using the same protocol rather than presuming the newer phone is more accurate. Rear LiDAR is an additional mode to benchmark for visible surfaces and pose/scale constraints. Do not assume simultaneous front TrueDepth and rear LiDAR acquisition on either phone; design separate modes until their concurrent capability is demonstrated.

Apple's AVFoundation APIs support depth capture and time-matched output delivery. Implement a small Swift capture app using an appropriate depth-capable device, video/depth/audio outputs, supported formats and `AVCaptureDataOutputSynchronizer` where compatible. Preserve audio sample timestamps and verify continuity even when delivery is batched. [TrueDepth sample](https://developer.apple.com/documentation/avfoundation/streaming-depth-data-from-the-truedepth-camera), [synchronizer documentation](https://developer.apple.com/documentation/avfoundation/avcapturedataoutputsynchronizer).

ARKit provides rear scene depth and front TrueDepth data through different configurations. Front depth may be absent on a particular color frame and has a separate capture timestamp. If using ARKit rather than an AVFoundation-only pipeline, explicitly align its clock to the audio capture clock and validate the mapping; do not open competing camera sessions accidentally. [Front depth](https://developer.apple.com/documentation/arkit/arframe/captureddepthdata), [scene depth](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth).

Use the native app for depth acquisition and the existing web app for display/control. A browser camera stream or ordinary webcam relay is not a depth/calibration transport contract. Begin with deliberate session-file export/import; add local networking once device signing, permissions and format capture work.

## Mouth and nasal cavities: experiment, not assumption

Depth sensors can help constrain visible surfaces. They do not directly see around occlusions or through tissue. A mouth opening may expose some tongue, teeth or palate surfaces to the cameras, but reliable close-range depth there must be measured. The hidden nasal passages and the throat-to-nose connection remain targets of physical inference unless independently measured.

Benchmark close-range reliability, holes, edge bias and reflectivity effects before giving depth a strong weight in fitting. This is especially important for small, partly occluded, moist surfaces. A clear RGB image is not proof of valid depth. Face-tracking meshes are fitted representations; Apple even provides an option to fill eye/mouth gaps for rendering. Such filled regions are not measurements of an oral cavity. [Apple face geometry documentation](https://developer.apple.com/documentation/arkit/arscnfacegeometry).

Keep unfilled/less-filtered depth where supported and retain validity/confidence information. Apple recommends non-filtered LiDAR depth for computer vision to avoid filling artifacts; it excludes low-confidence points in that mode. Missing samples are useful evidence of sensor limitations. [Apple depth capture session](https://developer.apple.com/videos/play/wwdc2022/110429/).

This does not reduce the moonshot. The intended fusion is measured visible surface constraints plus acoustic interventions to infer hidden anatomy. Test whether adding depth improves recovery, rather than assuming an appealing point cloud establishes internal accuracy.

## First hardware experiment and acceptance gates

1. B verifies signing/deployment and captures RGB, actual depth and microphone audio on one phone. Export a playable recording and inspect depth arrays, timestamps and calibration. A continues the simulator and synthetic recovery work in parallel.
2. Test a known-size rigid target and a small cavity-like bench object at several practical distances/angles. Measure scale bias, repeatability, missing-depth fraction and recoverable geometric detail. This precedes human close-range experiments.
3. Compare front TrueDepth and rear LiDAR, and both phones, on the same targets. Keep the bench configuration fixed. Do not infer a universal anatomical accuracy number from one target.
4. Test audio/video alignment with an external visible/audible event and estimate offset and drift over the planned trial duration. Choose tolerance based on the shortest event being modeled; a provisional 20 ms alignment-error goal is a test target, not a claim of sub-frame visual information.
5. Acquire comfortable external facial and visible-mouth observations from a consenting adult without inserting equipment. Map only valid visible surface evidence into the inverse model. Preserve pose changes and distinguish static scans from simultaneous singing.
6. Run an ablation: audio only, audio plus RGB, and audio plus RGB plus depth under equal fitting budgets. Score held-out prediction and, where available, independent geometry; report uncertainty and failed observations.

Keep the second phone as an independent comparison first. Simultaneous multiple-view capture adds separate clocks, spatial registration and possible sensor interactions. Add it only after single-phone capture works. If used later, estimate cross-device offset/drift and registration explicitly; simultaneous record-button presses are insufficient.

## Work allocation changes

B's early priority becomes the unified capture session and native depth spike, keeping the display interface minimal. A adds depth-projection residuals and visibility masks once the bundle exists. A can help B with numerical calibration validation after the forward adapter is working.

First produce a deployable capture path, then a real synchronized export and measured sensor quality. These are CAP-01 and CAP-02, owned by B. A then implements FUSE-01. If native capture is blocked, retain synchronized browser RGB/audio as a working instrument while reporting depth integration as unfinished. Do not substitute landmark-derived depth for hardware depth without labeling it.

These changes are incorporated into main specification revision 4, section 8, including owners and CAP-01/02, FUSE-01 and DEPTH-01/02 acceptance gates. The PDF is regenerated from that specification. No application implementation or remote changes have been performed.
