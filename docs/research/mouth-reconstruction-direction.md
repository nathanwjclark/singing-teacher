# Mouth reconstruction direction

User decision: prefer 3D capture and registration to a model for inside-mouth bootstrap, rather than expanding manual point labeling as the primary capture workflow. Tongue Lab labels remain a small diagnostic for visible tip tracking.

Separate two acquisitions:

1. **Visible surface mapping:** collect calibrated, overlapping RGB/depth views while holding each comfortable pose still. Retain intrinsics, depth-to-RGB alignment, sensor timestamps, validity masks and per-view pose. Register compatible observations into partial surfaces; show coverage and holes. Fit the anatomical reference to supported surface evidence, retaining fixed/inferred regions separately. Different tongue/jaw poses must remain separate pose groups rather than being rigidly fused into a single purported scan.
2. **Dynamic articulation:** capture repeated neutral → gesture → return sequences. Estimate the changing visible shape relative to the head and fit a deformable model over time. Do not treat changing articulation as permanent anatomy or a filled mesh as evidence of hidden surfaces.

Apple exposes TrueDepth data through native capture APIs ([depth photos](https://developer.apple.com/documentation/avfoundation/capturing-photos-with-depth), [ARFrame captured depth](https://developer.apple.com/documentation/arkit/arframe/captureddepthdata)). Its [Object Capture workflow](https://developer.apple.com/videos/play/wwdc2021/10076/) provides a reference for image-based reconstruction, not evidence that a stock object-scanning pipeline works on a moving mouth. Suitability and interior-mouth coverage must be measured on the actual phone; device depth support alone does not establish that tongue or palate surfaces are recoverable.

Next concrete acceptance experiment: export one raw native RGB-D sequence of a held comfortable mouth pose plus a known external size/depth target, inspect valid interior pixels and repeatability, then attempt a partial surface reconstruction. This determines whether native depth, RGB photogrammetry, or a hybrid is supported. No software-only fixture can pass this device-quality gate. Preserve private local processing and explicit capture.
