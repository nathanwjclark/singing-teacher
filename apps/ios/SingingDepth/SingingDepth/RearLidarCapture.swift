import AVFoundation
import Combine
import CoreImage
import UIKit
import CryptoKit

/// Optional, deliberate rear scan. The caller releases other camera sessions before enabling.
/// AVFoundation delivers a fused LiDAR/YUV depth product, not independent raw laser returns.
/// https://developer.apple.com/documentation/avfoundation/capturing-depth-using-the-lidar-camera
final class RearLidarCapture: NSObject, ObservableObject, AVCaptureDataOutputSynchronizerDelegate {
    @Published private(set) var capability = "disabled"
    private var enabled = false
    let session = AVCaptureSession()
    @Published private(set) var rawDepthPreview: UIImage?
    @Published private(set) var depthPreviewStatus = "Waiting for depth"
    private var lastPreviewTime = 0.0
    @Published private(set) var status = "Camera permission required."
    @Published private(set) var ready = false
    @Published private(set) var recording = false
    @Published private(set) var exporting = false
    @Published private(set) var archiveURL: URL?
    @Published private(set) var retryAvailable = false
    var onSaved: ((URL, String, String) -> Void)?
    private var sessionID: String?
    private var pendingExport: (folder: URL, manifest: [String: Any], count: Int)?
    private let queue = DispatchQueue(label: "singing.rear-lidar.capture")
    private let video = AVCaptureVideoDataOutput()
    private let depth = AVCaptureDepthDataOutput()
    private var synchronizer: AVCaptureDataOutputSynchronizer?
    private let imageContext = CIContext()
    private var configured = false
    private var folder: URL?
    private var frames: [[String: Any]] = []
    private var origin: CMTime?
    private var captureID = ""
    private var startedAt = ""
    private var task = ""
    private var deviceDescription: [String: Any] = [:]
    private var validDepthFrames = 0
    private var artifactBytes = 0
    private var frameCount = 0
    private var timeout: DispatchWorkItem?
    private var notificationTokens: [NSObjectProtocol] = []
    private var applicationInBackground = false

    override init() {
        super.init()
        let center = NotificationCenter.default
        for name in [AVCaptureSession.wasInterruptedNotification, AVCaptureSession.runtimeErrorNotification] {
            notificationTokens.append(center.addObserver(forName: name, object: session, queue: nil) { [weak self] notification in
                let reason = notification.name == AVCaptureSession.wasInterruptedNotification ? "session-interrupted" : "session-runtime-error"
                self?.queue.async { [weak self] in
                    guard let self else { return }
                    self.finish(reason: reason)
                    DispatchQueue.main.async {
                        self.ready = false
                        self.capability = "interrupted"
                        // Keep the saved/export-failure result visible after an interrupted capture.
                        if self.archiveURL == nil { self.status += " Camera interrupted; return to the app to resume preview." }
                    }
                }
            })
        }
        notificationTokens.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { [weak self] _ in
            self?.queue.async { [weak self] in self?.resumePreview() }
        })
        notificationTokens.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { [weak self] in
                guard let self else { return }
                self.applicationInBackground = true
                self.finish(reason: "app-backgrounded")
                self.session.stopRunning()
                DispatchQueue.main.async { self.ready = false }
            }
        })
        notificationTokens.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { [weak self] in
                self?.applicationInBackground = false
                self?.resumePreview()
            }
        })
    }
    deinit { notificationTokens.forEach(NotificationCenter.default.removeObserver) }
    private func resumePreview() {
        guard configured, enabled, !applicationInBackground, !session.isInterrupted else { return }
        if !session.isRunning { session.startRunning() }
        let running = session.isRunning
        DispatchQueue.main.async { self.ready = running; self.capability = running ? "available" : "interrupted" }
    }

    private func message(_ text: String) { DispatchQueue.main.async { self.status = text } }
    /// Discovery does not request permission or start a capture session.
    static func discoverCapability() -> String {
        if AVCaptureDevice.authorizationStatus(for: .video) == .denied || AVCaptureDevice.authorizationStatus(for: .video) == .restricted { return "permission-denied" }
        guard let camera = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else { return "unsupported-device" }
        return supportedPair(camera) == nil ? "unavailable-format" : "available"
    }
    private static func supportedPair(_ camera: AVCaptureDevice) -> (AVCaptureDevice.Format, AVCaptureDevice.Format)? {
        // Bound archive size without assuming a particular phone's format catalogue.
        for format in camera.formats.sorted(by: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width > CMVideoFormatDescriptionGetDimensions($1.formatDescription).width }) {
            let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            guard size.width > 0, size.height > 0, size.width <= 1920, size.height <= 1440 else { continue }
            let options = format.supportedDepthDataFormats.filter {
                let dimensions = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                let type = CMFormatDescriptionGetMediaSubType($0.formatDescription)
                return dimensions.width > 0 && dimensions.height > 0 && dimensions.width <= 640 && dimensions.height <= 480 && (type == kCVPixelFormatType_DepthFloat32 || type == kCVPixelFormatType_DepthFloat16)
            }
            if let depth = options.max(by: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width }) { return (format, depth) }
        }
        return nil
    }
    func requestCamera() {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
            guard let self else { return }
            self.queue.async {
                guard self.enabled else { return }
                if allowed { self.configure() }
                else { DispatchQueue.main.async { self.capability = "permission-denied"; self.ready = false; self.status = "Rear camera access denied. Enable Camera in Settings." } }
            }
        }
    }
    /// No microphone is configured. Switching must be explicit and between captures.
    func setEnabled(_ value: Bool, completion: @escaping () -> Void = {}) {
        queue.async {
            self.enabled = value
            if value { self.requestCamera() }
            else {
                self.finish(reason: "rear-lidar-disabled")
                self.session.stopRunning()
                DispatchQueue.main.async { self.ready = false; self.capability = "disabled"; self.rawDepthPreview = nil }
            }
            DispatchQueue.main.async(execute: completion)
        }
    }
    private func configure() {
        guard enabled, !applicationInBackground else { return }
        guard !configured else { resumePreview(); return }
        guard let camera = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else {
            DispatchQueue.main.async { self.capability = "unsupported-device"; self.status = "Rear LiDAR is unavailable on this device." }; return
        }
        guard let (format, depthFormat) = Self.supportedPair(camera) else {
            DispatchQueue.main.async { self.capability = "unavailable-format"; self.status = "No bounded compatible RGB/LiDAR format is available." }; return
        }
        do {
            session.beginConfiguration()
            defer { session.commitConfiguration() }
            session.sessionPreset = .inputPriority
            let input = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(input) else { throw CaptureError.message("Cannot add rear LiDAR camera input.") }
            session.addInput(input)
            try camera.lockForConfiguration()
            camera.activeFormat = format
            camera.activeDepthDataFormat = depthFormat
            if format.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= 15 && $0.maxFrameRate >= 15 }) && depthFormat.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= 15 && $0.maxFrameRate >= 15 }) {
                camera.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 15)
                camera.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 15)
            }
            camera.unlockForConfiguration()
            video.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            video.alwaysDiscardsLateVideoFrames = true
            depth.isFilteringEnabled = false
            guard session.canAddOutput(video), session.canAddOutput(depth) else { throw CaptureError.message("Cannot attach synchronized camera outputs.") }
            session.addOutput(video); session.addOutput(depth)
            for connection in [video.connection(with: .video), depth.connection(with: .depthData)].compactMap({ $0 }) {
                if connection.isVideoMirroringSupported { connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false }
            }
            synchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [video, depth])
            synchronizer?.setDelegate(self, queue: queue)
            let rgbSize = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let depthSize = CMVideoFormatDescriptionGetDimensions(depthFormat.formatDescription)
            deviceDescription = ["model": UIDevice.current.model, "system_version": UIDevice.current.systemVersion, "camera": camera.localizedName, "position": "back", "sensor": "rear-lidar", "depth_product": "AVFoundation-LiDAR-YUV-fused-depth", "confidence_available": false, "device_type": camera.deviceType.rawValue, "rgb_format_dimensions": [rgbSize.width, rgbSize.height], "depth_format_dimensions": [depthSize.width, depthSize.height], "source_depth_pixel_format": CMFormatDescriptionGetMediaSubType(depthFormat.formatDescription), "output_mirrored": false]
            configured = true
            queue.async {
                self.resumePreview()
                let running = self.session.isRunning
                self.message(running ? "Ready. Preview is live; nothing is being recorded." : "Camera preview unavailable; return to the app to retry.")
            }
        } catch {
            // A failed partial configuration must not poison the next permission/setup attempt.
            session.beginConfiguration()
            session.inputs.forEach { session.removeInput($0) }
            session.outputs.forEach { session.removeOutput($0) }
            session.commitConfiguration()
            DispatchQueue.main.async { self.capability = "failed"; self.ready = false; self.status = "Rear LiDAR setup failed: \(error.localizedDescription)" } }
    }
    func start(pose: String, sessionID: String? = nil, completion: @escaping (Bool) -> Void = { _ in }) {
        queue.async {
            guard self.enabled, self.configured, !pose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, pose.count <= 200, self.session.isRunning, !self.session.isInterrupted, self.folder == nil, self.pendingExport == nil else { DispatchQueue.main.async { completion(false) }; return }
            do {
                self.captureID = UUID().uuidString
                self.sessionID = sessionID
                let root = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let folder = root.appendingPathComponent("rear-lidar-\(self.captureID)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try (folder as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
                self.folder = folder; self.frames = []; self.artifactBytes = 0; self.validDepthFrames = 0; self.origin = nil; self.frameCount = 0; self.task = pose
                self.startedAt = ISO8601DateFormatter().string(from: Date())
                DispatchQueue.main.async { self.archiveURL = nil; self.retryAvailable = false; self.recording = true; self.status = "Recording. Stop ends the whole capture."; completion(true) }
                let timeout = DispatchWorkItem { self.finish(reason: "ten-second-limit") }; self.timeout = timeout
                self.queue.asyncAfter(deadline: .now() + 10, execute: timeout)
            } catch { self.message("Could not start: \(error.localizedDescription)"); DispatchQueue.main.async { completion(false) } }
        }
    }
    func stop(reason: String) { queue.async { self.finish(reason: reason) } }
    private func seconds(_ value: CMTime) -> Any {
        guard value.isNumeric else { return NSNull() }
        let number = CMTimeGetSeconds(value)
        return number.isFinite ? number as Any : NSNull()
    }
    private func time(_ value: CMTime) -> [String: Any] {
        ["value": value.value, "timescale": value.timescale, "epoch": value.epoch, "flags": value.flags.rawValue, "seconds": seconds(value)]
    }
    private func artifact(_ data: Data, name: String, folder: URL) throws -> [String: Any] {
        guard data.count <= 16 * 1024 * 1024, artifactBytes + data.count <= 120 * 1024 * 1024 else { throw CaptureError.message("Rear scan artifact byte limit reached.") }
        try data.write(to: folder.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
        artifactBytes += data.count
        return ["path": name, "bytes": data.count, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]
    }
    private func updateDepthPreview(_ measured: AVCaptureSynchronizedDepthData?) {
        let now = Date.timeIntervalSinceReferenceDate
        guard now - lastPreviewTime >= 0.1 else { return }
        lastPreviewTime = now
        guard let measured, !measured.depthDataWasDropped else {
            DispatchQueue.main.async { self.rawDepthPreview = nil; self.depthPreviewStatus = "Depth unavailable" }; return
        }
        let buffer = measured.depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32).depthDataMap
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer), stride = CVPixelBufferGetBytesPerRow(buffer)
        var pixels = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
            for x in 0..<width {
                let z = row[x]
                // A fixed display window, not a confidence estimate. Every valid return stays nonblack.
                if z.isFinite && z > 0 { pixels[y * width + x] = UInt8(64 + 191 * (1 - min(1, max(0, (z - 0.12) / 0.33)))) }
            }
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider,
                decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return }
        let image = UIImage(cgImage: cg, scale: 1, orientation: .right)
        DispatchQueue.main.async { self.rawDepthPreview = image; self.depthPreviewStatus = "LiDAR depth · unmirrored · fused sensor output" }
    }
    func dataOutputSynchronizer(_ synchronizer: AVCaptureDataOutputSynchronizer, didOutput collection: AVCaptureSynchronizedDataCollection) {
        let measured = collection.synchronizedData(for: depth) as? AVCaptureSynchronizedDepthData
        updateDepthPreview(measured)
        guard let folder else { return }
        guard frameCount < 150 else { finish(reason: "frame-count-limit"); return }
        let rgb = collection.synchronizedData(for: video) as? AVCaptureSynchronizedSampleBufferData
        guard let stamp = rgb?.timestamp ?? measured?.timestamp else { return }
        if origin == nil, stamp.isNumeric { origin = stamp }
        let id = "\(captureID)-frame-\(frameCount)"
        var row: [String: Any] = ["id": id, "sequence": frameCount, "capture_clock_timestamp": time(stamp), "relative_seconds": origin.map { seconds(CMTimeSubtract(stamp, $0)) } ?? NSNull(), "head_pose": NSNull(), "head_pose_missing_reason": "not-measured", "landmark_correspondences": [], "audio_alignment": "no-audio-in-this-deliberate-scan; cross-capture-alignment-not-measured", "sensor": "rear-lidar", "confidence": NSNull(), "confidence_missing_reason": "AVDepthData-does-not-expose-per-pixel-confidence"]
        frameCount += 1
        if let rgb { row["rgb_timestamp"] = time(rgb.timestamp) }
        if let measured { row["depth_timestamp"] = time(measured.timestamp) }
        do {
            if let rgb, !rgb.sampleBufferWasDropped, let buffer = CMSampleBufferGetImageBuffer(rgb.sampleBuffer) {
                let image = CIImage(cvPixelBuffer: buffer)
                guard let color = CGColorSpace(name: CGColorSpace.sRGB), let jpeg = imageContext.jpegRepresentation(of: image, colorSpace: color, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]) else { throw CaptureError.message("RGB image encoding failed.") }
                row["rgb"] = try artifact(jpeg, name: "\(id).jpg", folder: folder)
                row["rgb_timestamp"] = time(rgb.timestamp); row["rgb_presentation_timestamp"] = time(CMSampleBufferGetPresentationTimeStamp(rgb.sampleBuffer))
                row["rgb_dimensions"] = [CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer)]
                row["rgb_dropped"] = false
            } else {
                row["rgb"] = NSNull(); row["rgb_dropped"] = true; row["rgb_drop_reason"] = rgb.map { "\($0.droppedReason.rawValue)" } ?? "synchronized-output-absent"
            }
            if let measured, !measured.depthDataWasDropped {
                let raw = measured.depthData
                let converted = raw.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
                let buffer = converted.depthDataMap
                guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { throw CaptureError.message("Depth buffer lock failed.") }
                defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
                let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer), stride = CVPixelBufferGetBytesPerRow(buffer)
                guard width > 0, height > 0, width <= 640, height <= 480, stride >= width * MemoryLayout<Float32>.size else { throw CaptureError.message("Depth output exceeded the selected bounded format.") }
                guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw CaptureError.message("Depth buffer is unavailable.") }
                var packed = Data(capacity: width * height * MemoryLayout<Float32>.size)
                for y in 0..<height { packed.append(base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self), count: width * MemoryLayout<Float32>.size) }
                row["depth"] = try artifact(packed, name: "\(id).depth.f32", folder: folder)
                row["depth_timestamp"] = time(measured.timestamp); row["depth_dropped"] = false
                row["depth_dimensions"] = [width, height]; row["depth_unit"] = "m"; row["depth_storage"] = "row-major-little-endian-float32-packed"
                row["source_depth_pixel_format"] = raw.depthDataType; row["export_depth_pixel_format"] = converted.depthDataType
                row["depth_filtered"] = raw.isDepthDataFiltered; row["depth_accuracy"] = raw.depthDataAccuracy.rawValue; row["depth_accuracy_label"] = raw.depthDataAccuracy == .absolute ? "absolute" : "relative"; row["depth_quality"] = raw.depthDataQuality.rawValue
                var validCount = 0
                for y in 0..<height {
                    let samples = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
                    for x in 0..<width { if samples[x].isFinite && samples[x] > 0 { validCount += 1 } }
                }
                row["positive_finite_depth_fraction"] = Double(validCount) / Double(width * height)
                if validCount > 0 { validDepthFrames += 1 }
                row["depth_invalid_values"] = "Nonfinite and nonpositive values are preserved; consumers must mask them."
                row["depth_map_orientation"] = "native-output-unmirrored; no EXIF rotation applied"
                if let c = converted.cameraCalibrationData, Self.validCalibration(c) {
                    let matrix = c.intrinsicMatrix, extrinsic = c.extrinsicMatrix
                    row["calibration"] = ["intrinsics_row_major": (0..<3).map { r in (0..<3).map { col in matrix[col][r] } }, "intrinsic_reference_dimensions": [c.intrinsicMatrixReferenceDimensions.width, c.intrinsicMatrixReferenceDimensions.height], "extrinsics_3x4_row_major": (0..<3).map { r in (0..<4).map { col in extrinsic[col][r] } }, "extrinsics_semantics": "AVCameraCalibrationData extrinsicMatrix; not world or head pose", "pixel_size_mm": c.pixelSize, "lens_distortion_center": [c.lensDistortionCenter.x, c.lensDistortionCenter.y], "lens_distortion_table_base64": c.lensDistortionLookupTable?.base64EncodedString() as Any? ?? NSNull(), "inverse_lens_distortion_table_base64": c.inverseLensDistortionLookupTable?.base64EncodedString() as Any? ?? NSNull()]
                } else { row["calibration"] = NSNull(); row["calibration_missing_reason"] = converted.cameraCalibrationData == nil ? "not-provided-by-camera" : "nonfinite-or-invalid-camera-calibration" }
                if let rgb { row["rgb_depth_timestamp_delta_seconds"] = seconds(CMTimeSubtract(rgb.timestamp, measured.timestamp)) }
            } else {
                row["depth"] = NSNull(); row["depth_dropped"] = true; row["depth_drop_reason"] = measured.map { "\($0.droppedReason.rawValue)" } ?? "synchronized-output-absent"
            }
            frames.append(row)
            DispatchQueue.main.async { self.status = "Captured \(self.frameCount) synchronized callbacks. Hold comfortably." }
        } catch {
            row["write_error"] = error.localizedDescription; frames.append(row); finish(reason: "capture-write-failure")
        }
    }
    private static func validCalibration(_ calibration: AVCameraCalibrationData) -> Bool {
        let k = calibration.intrinsicMatrix, e = calibration.extrinsicMatrix
        let size = calibration.intrinsicMatrixReferenceDimensions
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
              calibration.pixelSize.isFinite, calibration.pixelSize > 0,
              calibration.lensDistortionCenter.x.isFinite, calibration.lensDistortionCenter.y.isFinite,
              k[0][0] > 0, k[1][1] > 0 else { return false }
        return (0..<3).allSatisfy { r in (0..<3).allSatisfy { c in k[c][r].isFinite } }
            && (0..<3).allSatisfy { r in (0..<4).allSatisfy { c in e[c][r].isFinite } }
    }
    private func finish(reason: String) {
        guard let current = folder else { return }
        folder = nil; timeout?.cancel(); timeout = nil
        DispatchQueue.main.async { self.recording = false; self.exporting = true; self.status = "Saving private capture…" }
        let manifest: [String: Any] = ["schema_version": "singing-native-rgbd-1.0.0", "capture_id": captureID, "collection_session_id": sessionID as Any? ?? NSNull(), "created_at": startedAt, "ended_at": ISO8601DateFormatter().string(from: Date()), "stop_reason": reason, "task": task, "capture_mode": "separate-rear-lidar-held-pose", "sensor": "rear-lidar", "confidence_available": false, "hardware_acceptance": "not-established-by-software", "limits": ["max_callbacks": 150, "max_duration_seconds": 10, "max_artifact_bytes": 120 * 1024 * 1024], "device": deviceDescription, "timebase": ["source": "AVCaptureDataOutputSynchronizer capture clock", "origin": origin.map { time($0) } as Any? ?? NSNull(), "host_clock_alignment": "not-measured", "absolute_sync_uncertainty_seconds": NSNull()], "filtering_requested": false, "audio": ["status": "missing", "reason": "deliberate-rear-scan-no-microphone-owned", "clock_relation": "not-measured", "sync_uncertainty_seconds": NSNull(), "samples": []], "geometry": ["interpretation": "visible-depth-samples-only", "hidden_surface": "not-measured", "world_pose": "not-measured", "head_pose": "not-measured", "measurement_noise": "not-calibrated"], "frames": frames]
        if validDepthFrames == 0 { DispatchQueue.main.async { self.capability = "insufficient-quality" } }
        pendingExport = (current, manifest, frames.count)
        savePendingExport()
    }
    func retryExport() {
        queue.async {
            guard self.folder == nil, self.pendingExport != nil else { return }
            self.savePendingExport()
        }
    }
    private func savePendingExport() {
        guard let pending = pendingExport else { return }
        DispatchQueue.main.async { self.exporting = true; self.status = "Saving private capture…" }
        let current = pending.folder
        do {
            let data = try JSONSerialization.data(withJSONObject: pending.manifest, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: current.appendingPathComponent("manifest.json"), options: [.atomic, .completeFileProtection])
            let archive = current.appendingPathExtension("zip")
            // Replace only this failed capture's partial ZIP; raw files remain intact.
            if FileManager.default.fileExists(atPath: archive.path) { try FileManager.default.removeItem(at: archive) }
            try CaptureZip.create(folder: current, destination: archive)
            try (archive as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
            pendingExport = nil
            DispatchQueue.main.async { self.exporting = false; self.retryAvailable = false; self.archiveURL = archive; self.status = "Saved \(pending.count) callbacks. Depth validity still needs review."; self.onSaved?(archive, pending.manifest["stop_reason"] as? String ?? "unknown", pending.manifest["capture_id"] as? String ?? "") }
        } catch { DispatchQueue.main.async { self.exporting = false; self.retryAvailable = true; self.capability = "failed"; self.status = "Capture files retained locally. Free storage or unlock the phone, then retry saving. Export failed: \(error.localizedDescription)" } }
    }
}
