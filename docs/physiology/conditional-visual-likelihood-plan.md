# Conditional visual observation likelihood: delivered conditional software

Status: the conditional native projection, fixed-camera calibration, durable forecast, original-frame annotation and held-out scoring path are implemented. This is not a validated physiological inference capability. It remains separate from motion-audio analysis, LiDAR fusion and source forecasting; the first software experiment requires no new native iPhone capture code.

Actual app/browser verification passed two synthetic-video flows in 38.5 seconds: calibration clicks → native forecast → reload → visible-target scoring, and the equivalent missing/occluded-target path. Both retain the frozen artifact and unchanged baseline. See [app setup and verification limits](../implementation/VISUAL-EXPERIMENTS.md).

## Measurement mismatch addressed by the separate operator

`science/src/singing_physics/engine.py::Engine.lip_markers` returns actual native upper/lower XYZ positions in meters at fixed surface/vertex identities `[4,89]` and `[5,89]`, with operator ID `vtl-upper4-lower5-vertex89-distance-v1` and native provenance. `observations/geometry/lips.py` uses those identities for an explicitly annotated metric surface-distance observation. The integrated joint fitter consumes that metric distance.

`src/capture/motion.ts` instead records MediaPipe landmarks 13/14 as `upper_lip`/`lower_lip`, 61/291 as mouth corners, and uses eye landmarks 33/263 for its image-relative transform. The MediaPipe lip points are not established correspondences to the native outer-surface vertices. The names alone do not make the physical measurements equivalent. The native model does not provide the eye landmarks used by that transform. A direct comparison of current `headRelative` values with native meters would be dimensionally and semantically invalid.

The separate explicit-annotation operator addresses this wiring gap without treating the existing motion recorder as incorrect. The current recorder measures visible movement without claiming a native vertex correspondence.

## Implemented bounded operator

Start with the projected upper-minus-lower marker vector in a stable, approximately frontal segment:

`predicted_pixel_vector(t) = scale * projection * rotation * (upper_xyz(t) - lower_xyz(t))`.

Use an explicitly declared weak-perspective projection. Translation cancels in this difference. Rotation and positive scale are camera nuisance parameters; estimate them only from declared calibration frames and freeze them before held-out frames are scored. Do not optimize an unconstrained per-frame camera or scale that can absorb every anatomical/articulatory prediction error. Native positions are in meters, scale is pixels per meter, and the compared residual is in pixels. A conditional image fit does not by itself establish metric anatomy.

The first implementation should reuse `Engine.lip_markers` and add one pure projection/observation module plus an adapter for annotated frames. Do not add another landmark detector, neural model, camera-calibration dependency, or generalized rendering engine. If the needed physical correspondence is not visible or defensible, return unsupported rather than substitute the existing MediaPipe index.

## Can existing recordings support an annotation app?

Usually they provide enough transport material to attempt annotation: the motion JSON retains image landmarks/timestamps and the saved companion video is hash-bound and downloadable. The video can expose its encoded pixel dimensions. An app can show selected original frames and collect explicit marker selections with a declared mapping. This can be implemented without changing the iPhone recorder.

That does not establish that every saved recording is usable. Before enabling the likelihood, require these missing or insufficiently specified fields:

| Required information | Current limitation | Proposed source |
| --- | --- | --- |
| Human point to native vertex correspondence | MediaPipe names/indices do not prove outer-surface correspondence | Explicit reviewed annotation mapping, native operator/version, visibility and rationale |
| Pixel width and height for the coordinates | Normalized x/y are not a common Euclidean pixel scale; dimensions are not bound in each motion sample | Decode the hash-bound video; save dimensions and coordinate transform used by the selected original frame |
| Crop, rotation, mirroring, detector-input transform | Video dimensions alone do not recover the transform that produced detector landmarks | Declare/verify exact pipeline transform; otherwise annotate on decoded original pixels and label this new observation separately |
| Frame identity and timing | Capture/source timestamps and video playback positions need an explicit mapping | Save video hash, decoded frame index/PTS, timebase, mapping uncertainty; reject unsupported alignment |
| Camera nuisance assumptions | Eye normalization is not a native eye observation or a full 3D head pose | Fixed weak-perspective model, segment identity, calibration-only fitted scale/rotation and frozen digest |
| Executed articulation | A cue or prescribed jaw angle does not prove execution | Explicit measured/inferred/unknown articulation provenance, including model identity when inferred |
| Measurement quality | Detector confidence is not calibrated pixel error | Frozen engineering pixel-error scale labeled uncalibrated; missing/occluded points remain missing |
| Independent calibration/scoring evidence | Renamed frames can duplicate the same physical video evidence | Original video hash plus frame identity/interval, split assignment, and duplicate/overlap checks |

The app should display the marker convention and allow “not visible / cannot establish correspondence.” It must not turn the act of clicking a point into a claim of validated anatomy. New annotations are separate derived evidence linked to immutable originals; they do not overwrite legacy landmarks or manufacture historical calibration.

## Bounded implementation and acceptance

1. **Observation/annotation owner:** add the small annotation record and original-video frame picker, preserving dimensions, exact transforms, operator identity, split, missing values, and source hashes. Round-trip the record and keep local originals available after unsupported input.
2. **Scientific operator owner:** implement the pure projection and fixed-nuisance calibration over real native marker trajectories. Bind actual applied articulation and native version to each prediction. Keep anatomy, articulation, and camera parameters separate in output.
3. **Session owner:** freeze the calibrated operator and explicit candidate predictions before accepting the held-out frame set. Score only compatible records and expose unsupported/missing outcomes in the app; no automatic anatomy adoption in this first lane.
4. **Independent QA owner:** run the following acceptance cases against actual native outputs and transparently generated projections. Synthetic pixels test implementation, not human correspondence validity.

| Acceptance case | Required behavior |
| --- | --- |
| Native trajectory → declared camera → synthetic pixels | Recover the declared conditional projection/residual within predeclared numerical tolerance |
| Translation-only image movement | Difference-vector prediction is unchanged |
| Non-square image dimensions and mirrored/cropped input | Correct explicit transform produces the same physical comparison; absent transform is unsupported |
| Frozen nuisance on held-out articulation | Prediction uses the calibration camera; changing held-out target coordinates cannot change calibration or candidate predictions |
| Scale/anatomy ambiguity | Report equivalent candidate support; do not convert low residual into unique metric anatomy |
| Unmodeled head rotation or camera movement | Residual/missing status exposes mismatch; do not silently absorb it through per-frame nuisance fitting |
| Occlusion, frame gaps, repeated source frames, unavailable marker mapping | Retain missing reasons and reject unsupported evidence; no interpolation presented as observed anatomy |
| Zero-length normalization, nonfinite coordinates, invalid dimensions | Explicit invalid/unsupported result, with no infinite residual or false perfect fit |
| Saved/reloaded annotations and frozen forecast | Identical source/camera/operator bindings; new annotations cannot mutate previously scored evidence |

A human-recording accuracy gate remains a separate experiment requiring defensible marker correspondence and independent physical reference. Full iOS SDK/Xcode validation, device interruptions, and physical LiDAR accuracy are not software acceptance claims of this lane. No internal nasal cavity, tissue mechanics, or vocal-fold inference is enabled by a successful lip projection.

## Review disposition

Priority is to make the missing physical correspondence and coordinate metadata explicit before adding a visual likelihood to model fitting. A new interface that compares existing normalized lip points directly with native metric distance would be a real correctness defect. The smallest defensible implementation is a conditional projected two-marker observation with frozen nuisance, explicit missing evidence, and one connected session scoring path. The connected software now implements that conditional path. Continuous calibrated motion inference, defensible human correspondences and independent accuracy measurements remain future evidence work; no anatomy or learning-efficacy result follows from the software checks.
