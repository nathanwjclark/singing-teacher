import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

@main
struct SingingDepthApp: App {
    @StateObject private var capture = DepthCapture()
    var body: some Scene {
        WindowGroup { ContentView(capture: capture) }
    }
}

struct ContentView: View {
    @ObservedObject var capture: DepthCapture
    @StateObject private var probe = AcousticProbe()
    @State private var pose = "Comfortable ah — hold still"
    @State private var addSound = false
    @State private var setupExpanded = false
    @State private var setupActive = false
    @State private var importing = false
    @State private var sharing = false
    @State private var shareURL: URL?
    @State private var latestSessionURL: URL?
    @State private var sessionID: String?
    @State private var depthURL: URL?
    @State private var awaitingSound = false
    @State private var busy = false
    @State private var bundling = false
    @State private var phase = ""
    @Environment(\.scenePhase) private var scenePhase

    private var working: Bool { bundling || busy || capture.recording || capture.exporting || probe.running || probe.exporting }
    var body: some View {
        VStack(spacing: 10) {
            Text("Mouth capture").font(.title2.bold())
            CameraPreview(session: capture.session)
                .frame(minHeight: 190, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .topLeading) {
                    Text(probe.running ? "Sound measurement · camera paused" : capture.recording ? "Recording video + depth" : setupActive ? "Sound setup · camera paused" : capture.ready ? "Preview · not recording" : "Camera paused")
                        .font(.caption.bold()).foregroundStyle(.white).padding(8)
                        .background(capture.recording || probe.running ? Color.red : Color.black.opacity(0.7), in: Capsule())
                        .padding(10).accessibilityIdentifier("capture-mode")
                }
                .overlay(alignment: .bottomTrailing) {
                    VStack(spacing: 3) {
                        if let rawDepth = capture.rawDepthPreview, capture.ready {
                            Image(uiImage: rawDepth).resizable().interpolation(.none).scaledToFit().frame(width: 76, height: 125)
                            Text("Raw depth\nblack = missing").font(.system(size: 9)).multilineTextAlignment(.center)
                        } else { Text(capture.ready ? capture.depthPreviewStatus : "Depth paused").font(.caption2) }
                    }.foregroundStyle(.white).padding(5).background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 6)).padding(8)
                    .accessibilityLabel("Unmirrored raw depth preview. Black pixels have no depth return.")
                }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(phase.isEmpty ? capture.status : phase).font(.callout).accessibilityIdentifier("capture-status")
                    Picker("Capture task", selection: $pose) {
                        Text("Comfortable ah — hold still").tag("Comfortable ah — hold still")
                        Text("Visible tongue — comfortable hold").tag("Visible tongue — comfortable hold")
                        Text("Relaxed neutral").tag("Relaxed neutral")
                    }.disabled(working)
                    Text("Frame your whole mouth. Keep the phone steady for the selected pose. If depth is missing, move the phone farther away. Video ends after ten seconds; Stop ends the entire capture.").font(.footnote)
                    Toggle("Add sound measurement after video", isOn: $addSound).disabled(working || setupActive)
                    if addSound {
                        Text(probe.hasLevelCheck ? "After video saves, hold still without singing for three short sounds. The route and level check are verified again before playback." : "Sound measurement needs a reviewed output-level check. Set it up below, or turn this off to capture video and voice normally.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("Advanced sound setup", isExpanded: $setupExpanded) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("A physical level check must match this phone, volume and placement. Nothing plays during setup.").font(.caption)
                            TextField("Placement ID", text: $probe.placement).textFieldStyle(.roundedBorder).disabled(working)
                            Text(probe.status).font(.caption).accessibilityIdentifier("probe-status")
                            Button("Prepare sound route (silent)") { prepareSetup() }.disabled(working)
                            Button("Export level-check request") { probe.exportRequest(); presentShare(probe.archiveURL) }.disabled(!setupActive || !probe.ready || probe.placement.isEmpty || working)
                            Button("Import reviewed level check") { importing = true }.disabled(!setupActive || !probe.ready || working)
                            if setupActive { Button("Return to camera") { finishSetup() }.disabled(working) }
                            Text("Keep the phone outside your mouth. Moving it or changing volume requires a matching check. Sound and depth run in successive phases; they are not simultaneous measurements.").font(.caption).foregroundStyle(.secondary)
                        }.padding(.top, 8)
                    }.disabled(working)
                    if capture.retryAvailable {
                        Button("Retry saving video") { awaitingSound = false; capture.retryExport() }.disabled(capture.exporting)
                    }
                    Text("Files stay private on this phone. The camera microphone records your voice as usual; optional sound measurement adds a separate response recording. Missing depth and hidden tissue are not reconstructed.").font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxHeight: 320)
            HStack {
                Button("Start capture") { startSequence() }
                    .disabled(!capture.ready || working || capture.retryAvailable || setupActive || (addSound && !probe.hasLevelCheck))
                Button("Stop") { stopSequence(reason: "user-stop") }.disabled(!working)
            }.buttonStyle(.borderedProminent)
            Button("Share latest private capture") { presentShare(latestSessionURL ?? capture.archiveURL) }
                .disabled(working || (latestSessionURL == nil && capture.archiveURL == nil))
        }.padding()
        .task {
            capture.onSaved = { url, reason, id in videoSaved(url: url, reason: reason, captureID: id) }
            probe.onSaved = { url, reason in soundSaved(url: url, reason: reason) }
            capture.requestCamera()
        }
        .onChange(of: capture.retryAvailable) { _, retry in
            if retry { awaitingSound = false; busy = false; phase = capture.status }
        }
        .onChange(of: scenePhase) { _, state in
            if state != .active { stopSequence(reason: "app-backgrounded") }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { probe.importLevel(url) }
        }
        .sheet(isPresented: $sharing) { if let url = shareURL { ShareCapture(url: url) } }
    }
    private func presentShare(_ url: URL?) { guard let url else { return }; shareURL = url; sharing = true }
    private func prepareSetup() {
        setupActive = true; probe.setModeActive(true)
        capture.setProbeMode(true) { if setupActive && scenePhase == .active { probe.prepare() } }
    }
    private func finishSetup() {
        setupActive = false; probe.setModeActive(false)
        capture.setProbeMode(false) {}; phase = ""
    }
    private func startSequence() {
        let id = UUID().uuidString
        sessionID = id; depthURL = nil; latestSessionURL = nil
        awaitingSound = addSound; busy = true; phase = "Recording video and depth…"
        capture.start(pose: pose, sessionID: id) { started in
            if !started { awaitingSound = false; busy = false; phase = capture.status }
        }
    }
    private func stopSequence(reason: String) {
        let hadSequence = busy || capture.recording || probe.running
        awaitingSound = false
        capture.stop(reason: reason); probe.stop(reason: reason)
        probe.setModeActive(false)
        if setupActive { setupActive = false }
        capture.setProbeMode(false) {}
        if hadSequence { phase = "Stopped. Saving any recorded data; no further sound will play." }
        // Export callbacks still finish an in-flight save; invalidated preparation cannot start playback.
        busy = false
    }
    private func videoSaved(url: URL, reason: String, captureID: String) {
        depthURL = url; latestSessionURL = url
        guard awaitingSound, reason == "ten-second-limit", scenePhase == .active else {
            awaitingSound = false; busy = false; phase = "Video and depth saved. \(reason == "ten-second-limit" ? "" : "Capture stopped; sound phase skipped.")"; return
        }
        phase = "Video saved. Checking sound route…"
        probe.setModeActive(true)
        capture.setProbeMode(true) {
            guard awaitingSound, scenePhase == .active else { return }
            probe.prepare { permitted in
                guard awaitingSound, scenePhase == .active else { return }
                awaitingSound = false
                guard permitted else { endWithoutSound("Video saved. Sound skipped: \(probe.status)"); return }
                probe.pose = pose
                if probe.start(sessionID: sessionID, depthCaptureID: captureID) {
                    phase = "Sound measurement: hold the same pose without singing. Stop ends playback immediately."
                } else { endWithoutSound("Video saved. Sound did not start: \(probe.status)") }
            }
        }
    }
    private func endWithoutSound(_ message: String) {
        busy = false; phase = message; probe.setModeActive(false); capture.setProbeMode(false) {}
    }
    private func soundSaved(url: URL?, reason: String) {
        probe.setModeActive(false); capture.setProbeMode(false) {}
        guard let url, let depthURL, let sessionID else {
            busy = false; phase = "Video saved. \(probe.status)"; return
        }
        busy = true; bundling = true; phase = "Saving linked video and sound capture…"
        DispatchQueue.global(qos: .utility).async {
            do {
                let combined = try CaptureZip.linkedSession(id: sessionID, video: depthURL, sound: url, soundStopReason: reason)
                DispatchQueue.main.async {
                    latestSessionURL = combined; busy = false; bundling = false
                    phase = "Video and sound saved together\(reason == "completed" ? "." : " (sound stopped early).") Ready to pull over USB or share."
                }
            } catch {
                DispatchQueue.main.async { busy = false; bundling = false; phase = "Video and sound saved separately; combined export failed: \(error.localizedDescription). Both originals remain on the phone." }
            }
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    class Preview: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
    func makeUIView(context: Context) -> Preview {
        let view = Preview(); view.preview.session = session; view.preview.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: Preview, context: Context) {}
}
struct ShareCapture: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
