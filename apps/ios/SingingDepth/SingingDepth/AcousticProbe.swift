import SwiftUI
import AVFoundation
import CryptoKit
import UniformTypeIdentifiers

/// One audio owner, explicit capture only. Digital gain is not an acoustic pressure calibration.
final class AcousticProbe: ObservableObject {
    @Published var status = "Prepare the built-in speaker/microphone route. No sound plays automatically."
    @Published private(set) var running = false
    @Published private(set) var ready = false
    @Published private(set) var levelValid = false
    @Published private(set) var archiveURL: URL?
    @Published var pose = "Neutral/open mouth"
    @Published var placement = ""
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queue = DispatchQueue(label: "singing.probe.archive")
    private let lock = NSLock()
    private var raw = Data()
    private var buffers: [[String: Any]] = []
    private var accepting = false
    private var rate = 48000.0
    private var timeline: [Float] = []
    private var scheduledHost: UInt64 = 0
    private var level: [String: Any] = [:]
    private var levelSource = Data()
    private var config: [String: Any] = [:]
    private var signature = ""
    private var volume: Float = 0
    private var tokens: [NSObjectProtocol] = []
    private var volumeObservation: NSKeyValueObservation?
    private var timer: DispatchWorkItem?
    private var tapInstalled = false
    private var capturePose = "", capturePlacement = ""
    private var firstHost: UInt64?
    private let protocolID = "external-sweep-pilot-1"
    init() {
        engine.attach(player)
        for name in [AVAudioSession.routeChangeNotification, AVAudioSession.interruptionNotification, AVAudioSession.mediaServicesWereResetNotification] {
            tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.levelValid = false; self?.ready = false; self?.stop(reason: "route-or-session-interruption")
            })
        }
        volumeObservation = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.levelValid = false; self?.stop(reason: "output-volume-changed") }
        }
    }
    deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
    private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func routeDescription() -> [String: Any] {
        let s = AVAudioSession.sharedInstance()
        func ports(_ p: [AVAudioSessionPortDescription]) -> [[String: Any]] { p.map { ["type": $0.portType.rawValue, "uid": $0.uid, "name": $0.portName, "dataSource": $0.selectedDataSource?.dataSourceName ?? "unknown"] } }
        return ["inputs": ports(s.currentRoute.inputs), "outputs": ports(s.currentRoute.outputs), "sampleRateHz": s.sampleRate, "outputVolume": s.outputVolume, "category": s.category.rawValue, "mode": s.mode.rawValue, "categoryOptions": s.categoryOptions.rawValue, "inputLatencySeconds": s.inputLatency, "outputLatencySeconds": s.outputLatency, "ioBufferDurationSeconds": s.ioBufferDuration, "inputChannels": s.inputNumberOfChannels, "outputChannels": s.outputNumberOfChannels, "processingVerifiedAbsent": false, "measurementModeRequested": true, "voiceProcessingEnabled": engine.inputNode.isVoiceProcessingEnabled, "device": UIDevice.current.model, "systemVersion": UIDevice.current.systemVersion]
    }
    func prepare() {
        guard !running else { return }
        AVAudioApplication.requestRecordPermission { allowed in DispatchQueue.main.async {
            guard allowed else { self.status = "Microphone permission is required."; return }
            do {
                let s = AVAudioSession.sharedInstance()
                try s.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
                try s.setPreferredSampleRate(48000); try s.setActive(true)
                guard s.currentRoute.inputs.allSatisfy({ $0.portType == .builtInMic }), !s.currentRoute.inputs.isEmpty,
                      s.currentRoute.outputs.allSatisfy({ $0.portType == .builtInSpeaker }), !s.currentRoute.outputs.isEmpty else { throw CaptureError.message("Use the built-in speaker and microphone; headphones and Bluetooth are unsupported.") }
                self.rate = self.engine.inputNode.outputFormat(forBus: 0).sampleRate
                guard self.rate >= 16000 else { throw CaptureError.message("Unsupported sample rate.") }
                self.config = self.routeDescription()
                self.signature = self.digest(try JSONSerialization.data(withJSONObject: self.config, options: [.sortedKeys]))
                self.volume = s.outputVolume; self.levelValid = false; self.ready = true
                self.status = "Route prepared. Export the route request, then import a reviewed physical level check before playback."
            } catch { self.ready = false; self.status = error.localizedDescription }
        } }
    }
    func exportRequest() {
        do {
            let value: [String: Any] = ["schemaVersion": "probe-level-request-1.0.0", "routeSignature": signature, "route": config, "protocolId": protocolID, "bandHz": [300,6000], "durationSeconds": 1, "peakDigitalAmplitude": 0.01, "repetitions": 3, "placementId": placement, "note": "A reviewed protocol and calibrated instrument measurement at this device/placement are required. This request is not a valid level check."]
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("probe-level-request.json")
            try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted,.sortedKeys]).write(to: url, options: [.atomic,.completeFileProtection]); archiveURL = url
        } catch { status = error.localizedDescription }
    }
    func importLevel(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let d = try Data(contentsOf: url)
            guard let c = try JSONSerialization.jsonObject(with: d) as? [String: Any],
                  c["schemaVersion"] as? String == "probe-level-check-1.0.0",
                  c["routeSignature"] as? String == signature, c["protocolId"] as? String == protocolID,
                  c["placementId"] as? String == placement, !placement.isEmpty,
                  c["approvedForHumanPlayback"] as? Bool == true,
                  let measured = c["measuredPeakDbSPL"] as? Double, let limit = c["limitPeakDbSPL"] as? Double,
                  measured.isFinite, limit.isFinite, measured > 0, measured <= limit, limit <= 70,
                  let expiry = c["expiresAt"] as? String, let date = ISO8601DateFormatter().date(from: expiry), date > Date(),
                  ["calibratedInstrument", "instrumentCalibrationEvidence", "measurementEvidence", "reviewer", "id"].allSatisfy({ !(c[$0] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { throw CaptureError.message("Level check missing, expired, over the protocol cap, or mismatched to this route/placement. Playback remains locked.") }
            levelSource = d; level = c; level["sourceSha256"] = digest(d); levelValid = true
            status = "Level-check record accepted for this route and placement. Keep volume and placement unchanged. This is operator-supplied evidence, not an app measurement."
        } catch { levelValid = false; status = error.localizedDescription }
    }
    func start() {
        guard ready, levelValid, !running else { return }
        guard placement == level["placementId"] as? String,
              AVAudioSession.sharedInstance().outputVolume == volume,
              let expiry = level["expiresAt"] as? String, let date = ISO8601DateFormatter().date(from: expiry), date > Date() else { levelValid = false; status = "Level check invalidated. Prepare and check the route again."; return }
        do {
            let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
            // Three 1-second sweeps separated by 0.5 seconds silence, with 0.5 seconds at each edge.
            let count = Int(rate * 5); timeline = Array(repeating: 0, count: count)
            let length = Int(rate), k = log(6000.0 / 300.0)
            for repetition in 0..<3 {
                let start = Int(rate * (0.5 + Double(repetition) * 1.5))
                for i in 0..<length {
                    let t = Double(i)/rate, ramp = min(1, min(t / 0.02, (1-t)/0.02))
                    timeline[start+i] = Float(0.01 * (0.5 - 0.5*cos(.pi*ramp)) * sin(2 * .pi * 300 * (exp(k*t)-1)/k))
                }
            }
            let drive = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
            drive.frameLength = AVAudioFrameCount(count)
            timeline.withUnsafeBufferPointer { drive.floatChannelData![0].update(from: $0.baseAddress!, count: count) }
            engine.connect(player, to: engine.mainMixerNode, format: format)
            player.volume = 1; engine.mainMixerNode.outputVolume = 1
            let inputFormat = engine.inputNode.outputFormat(forBus: 0)
            lock.lock(); raw = Data(); buffers = []; firstHost = nil; accepting = true; lock.unlock()
            engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, time in
                guard let self, let data = buffer.floatChannelData else { return }
                self.lock.lock(); defer { self.lock.unlock() }
                guard self.accepting else { return }
                let n = Int(buffer.frameLength), start = self.raw.count / 4
                self.raw.append(UnsafeBufferPointer(start: data[0], count: n))
                if self.firstHost == nil, time.isHostTimeValid { self.firstHost = time.hostTime }
                var clipped = 0; for i in 0..<n { if abs(data[0][i]) >= 0.999 { clipped += 1 } }
                self.buffers.append(["startSample": start, "sampleCount": n, "hostTime": time.isHostTimeValid ? String(time.hostTime) as Any : NSNull(), "sampleTime": time.isSampleTimeValid ? time.sampleTime as Any : NSNull(), "sampleRateHz": time.sampleRate, "clippedSamples": clipped, "sourceChannels": buffer.format.channelCount, "retainedChannel": 0, "asbdFormatID": buffer.format.streamDescription.pointee.mFormatID, "asbdFormatFlags": buffer.format.streamDescription.pointee.mFormatFlags, "bitsPerChannel": buffer.format.streamDescription.pointee.mBitsPerChannel])
            }
            tapInstalled = true
            engine.prepare(); try engine.start()
            scheduledHost = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.2)
            player.scheduleBuffer(drive, at: AVAudioTime(hostTime: scheduledHost))
            player.play()
            capturePose = pose; capturePlacement = placement; running = true; status = "Recording three probes. Stop cancels playback immediately."
            let end = DispatchWorkItem { [weak self] in self?.stop(reason: "completed") }; timer = end
            DispatchQueue.main.asyncAfter(deadline: .now()+5.7, execute: end)
        } catch {
            player.stop(); engine.stop(); if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
            lock.lock(); accepting = false; lock.unlock(); status = "Probe start failed: \(error.localizedDescription)"
        }
    }
    func stop(reason: String) {
        player.stop(); engine.stop(); timer?.cancel(); timer = nil
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        lock.lock(); accepting = false
        let received = raw, stamps = buffers, host = firstHost
        lock.unlock()
        guard running else { return }; running = false; ready = false
        status = "Saving private probe recording…"
        let drive = timeline.withUnsafeBufferPointer { Data(buffer: $0) }
        let sr = rate, scheduled = scheduledHost, route = config, checked = level, p = capturePose, place = capturePlacement
        let checkedSource = levelSource
        queue.async {
            do {
                let id = UUID().uuidString
                let root = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let folder = root.appendingPathComponent("probe-\(id)"); try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try (folder as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
                func artifact(_ data: Data, _ name: String) throws -> [String: Any] {
                    try data.write(to: folder.appendingPathComponent(name), options: [.atomic,.completeFileProtection])
                    return ["path": name, "sha256": self.digest(data), "byteCount": data.count, "format": "float32-le", "channels": 1, "sampleCount": data.count/4]
                }
                let offset = host.map { (AVAudioTime.seconds(forHostTime: scheduled) - AVAudioTime.seconds(forHostTime: $0))*sr }
                let segments: [[String: Any]] = (0..<3).map { i in
                    let start = Int(sr*(0.5+Double(i)*1.5))
                    return ["driveStartSample": start, "receivedStartSample": offset.map { Int($0.rounded())+start } as Any? ?? NSNull(), "sampleCount": Int(sr), "repetition": i]
                }
                try checkedSource.write(to: folder.appendingPathComponent("level-check.json"), options: [.atomic,.completeFileProtection])
                var discontinuities: [[String: Any]] = []
                for i in stamps.indices.dropFirst() {
                    if let previous = stamps[i-1]["sampleTime"] as? Int64, let current = stamps[i]["sampleTime"] as? Int64, let n = stamps[i-1]["sampleCount"] as? Int, current != previous + Int64(n) {
                        discontinuities.append(["bufferIndex": i, "missingOrOverlappingSamples": current - previous - Int64(n)])
                    }
                }
                let manifest: [String: Any] = ["schemaVersion": "probe-native-1.0.0", "captureId": id, "provenance": "human-recording", "createdAt": ISO8601DateFormatter().string(from: Date()), "sampleRateHz": sr, "drive": try artifact(drive,"drive.f32le"), "received": try artifact(received,"received.f32le"), "segments": segments, "buffers": stamps, "bufferDiscontinuities": discontinuities, "playbackSchedule": ["hostTime": String(scheduled), "hostClock": "mach_absolute_time", "actualAcousticStartVerified": false], "timing": ["support": "estimated", "uncertaintySeconds": NSNull(), "method": "native-host-clock-unverified-acoustic-delay", "absolutePhaseSupported": false], "protocol": ["id": self.protocolID, "bandHz": [300,6000], "gain": 0.01, "durationSeconds": 1, "preSeconds": 0.5, "postSeconds": 0.5, "repetitions": 3, "envelope": "20ms-raised-cosine", "waveform": "deterministic-log-sine"], "route": route, "calibration": ["levelCheck": checked, "levelCheckArtifact": ["path": "level-check.json", "sha256": self.digest(checkedSource), "byteCount": checkedSource.count], "deviceResponseCalibrated": false, "placementId": place], "pose": p, "stopReason": reason, "failures": reason == "completed" ? [] : [reason], "rgbDepth": ["available": false, "reason": "standalone-audio-exclusive-owner"], "resultState": "captured", "includedInFit": false]
                try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted,.sortedKeys]).write(to: folder.appendingPathComponent("manifest.json"), options: [.atomic,.completeFileProtection])
                let zip = root.appendingPathComponent("probe-\(id).zip"); try CaptureZip.create(folder: folder, destination: zip)
                DispatchQueue.main.async { self.archiveURL = zip; self.status = "Private probe saved (\(reason)). Response usability requires import and analysis. Prepare route again for another capture." }
            } catch { DispatchQueue.main.async { self.status = "Export failed: \(error.localizedDescription). Raw files already written remain private on this phone." } }
        }
    }
}

struct AcousticProbeView: View {
    @ObservedObject var probe: AcousticProbe
    @State private var importing = false
    @State private var sharing = false
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 14) {
            Text("Acoustic mapping").font(.title2.bold())
            Text("Keep the phone outside the mouth. Hold one comfortable pose without singing. Three short audible sweeps measure recorded response changes; they do not scan hidden anatomy.")
            Text(probe.status).font(.callout).accessibilityIdentifier("probe-status")
            TextField("Placement ID (change after moving phone)", text: $probe.placement).textFieldStyle(.roundedBorder).disabled(probe.running)
            Picker("Pose", selection: $probe.pose) {
                ForEach(["Neutral/open mouth", "Comfortable ah", "Return to baseline"], id: \.self) { Text($0) }
            }.disabled(probe.running)
            Button("Prepare route (silent)") { probe.prepare() }.disabled(probe.running)
            Button("Export route / level-check request") { probe.exportRequest(); sharing = true }.disabled(!probe.ready || probe.running || probe.placement.isEmpty)
            Button("Import reviewed output-level check") { importing = true }.disabled(!probe.ready || probe.running)
            Text("Playback is locked until a calibrated-instrument output-level check and protocol review match this route, volume and placement. Digital volume alone is not a level check. Moving the phone requires a new placement ID and check.").font(.caption)
            HStack {
                Button("Start 3 probes") { probe.start() }.disabled(!probe.ready || !probe.levelValid || probe.running)
                Button("Stop") { probe.stop(reason: "user-stop") }.disabled(!probe.running)
            }.buttonStyle(.borderedProminent)
            Button("Share latest private export") { sharing = true }.disabled(probe.archiveURL == nil || probe.running)
            Text("Audio-only: camera and depth capture pause while this mode owns the microphone. Route, interruption, volume change or leaving the app stops playback. Nothing uploads automatically.").font(.caption).foregroundStyle(.secondary)
        } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in if case .success(let url) = result { probe.importLevel(url) } }
        .sheet(isPresented: $sharing) { if let url = probe.archiveURL { ShareCapture(url: url) } }
    }
}
