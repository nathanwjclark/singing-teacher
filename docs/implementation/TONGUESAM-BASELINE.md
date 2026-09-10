# TongueSAM pretrained baseline

The app now ships TongueSAM's public **YOLOX tongue prompt detector** as an ONNX asset. When the private personal tongue network is absent, it loads automatically. It requires no user labels, personal training, Python service or paid model calls. The camera crop stays in the browser.

This is a visible-tongue **bounding box**, not the full TongueSAM surface segmentation model. Region-only observations never drive the 3D tongue-tip animation. They contain no inferred tip or depth. The live overlay and Tongue Lab label this distinction. Existing personal tip weights, when installed, retain precedence.

## Provenance and reproduction

Upstream: https://github.com/cshan-github/TongueSAM at `3f6e8c620e4d89e669a92a22f3be3d007932ce45`, file `segment/yolox.pth`. Its public checkpoint SHA-256 is `a4f83fa8aeb47074ceb31d2b4c9823d4a8d574b5cdc6f7c6db68d16398fa3d3b`.

`scripts/export-tonguesam-detector.py --source <clean pinned checkout> --output <new output directory>` loads tensor-only weights, exports decoded normalized boxes, and verifies PyTorch/ONNX numerical agreement on all twelve upstream example images. It preserves the published 448-pixel input, ImageNet normalization and 0.7 objectness-times-class threshold. The browser uses the highest-scoring valid box in the mouth crop; no class probabilities or calibration claims are inferred from that score.

The exported artifact and SHA-256 manifest are under `public/models/tonguesam/`. The app verifies the hash before loading. Accompanying MIT/Apache license texts and NOTICE identify TongueSAM/Shan Cao and the Megvii YOLOX architecture. No public-example images or private training data are redistributed. Export environment used Python 3.12, torch 2.14.0, torchvision 0.29.0, onnx 1.22.0, onnxruntime 1.30.0, Pillow 12.3.0 and NumPy 2.5.3; these are offline developer dependencies, not app startup requirements.

## Runtime behavior

The 34 MiB model loads lazily after the absent-private-model check. ONNX inference runs in a dedicated worker, with one in-flight frame in the existing tracker. Requests have a 15-second timeout; repeated failures pause tongue inference until camera restart. Capture continues. Region results expire after 800 ms (personal tip results retain 300 ms expiry), and loss of the face invalidates pending results immediately. Camera shutdown terminates the worker.

Actual browser checks detected a region in an upstream example, rejected a uniform gray frame, and confirmed region output cannot move the anatomical tongue tip. Worker inference took roughly 0.38–0.43 seconds per frame on this Mac. This is a few-Hz region estimate, not high-rate motion capture. Public-example execution and export agreement are not independent singer/session accuracy tests.

## Full segmentation remains a separate step

TongueSAM's official README links the fine-tuned `tonguesam.pth` mask checkpoint through Baidu. The browser site-safety policy blocked access to that host in this environment. No bypass was attempted, and no alternate author-published checkpoint was found in the search. Its detector checkpoint is independently available directly in GitHub and is the only learned artifact used here.

Obtaining the author's segmentation checkpoint through an allowed source would enable the full box→SAM-mask stage. A generic SAM replacement would be a different baseline and must be labeled and evaluated separately. Neither that replacement nor the unavailable fine-tuned mask has been silently substituted. The intended product requires no user CV-model training; any future improvements should be developed and tested centrally before release.
