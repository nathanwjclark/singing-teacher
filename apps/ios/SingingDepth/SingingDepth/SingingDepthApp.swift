import SwiftUI
import AVFoundation

@main
struct SingingDepthApp: App {
    @StateObject private var capture = DepthCapture()
    var body: some Scene {
        WindowGroup { ContentView(capture: capture) }
    }
}

struct ContentView: View {
    @ObservedObject var capture: DepthCapture
    @State private var pose = "Comfortable ah — hold still"
    @State private var share = false
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        VStack(spacing: 12) {
            Text("Mouth surface capture").font(.title2.bold())
            CameraPreview(session: capture.session)
                .frame(maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .topLeading) {
                    Label(capture.recording ? "Recording" : capture.exporting ? "Saving capture" : capture.ready ? "Preview · not recording" : "Camera idle · not recording",
                          systemImage: capture.recording ? "record.circle.fill" : capture.exporting ? "square.and.arrow.down" : "eye")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(8)
                        .background(capture.recording ? Color.red : Color.black.opacity(0.7), in: Capsule())
                        .padding(10)
                        .accessibilityIdentifier("capture-mode")
                }
            Text(capture.status).font(.callout).accessibilityIdentifier("capture-status")
            Picker("Held pose", selection: $pose) {
                Text("Comfortable ah — hold still").tag("Comfortable ah — hold still")
                Text("Visible tongue — comfortable hold").tag("Visible tongue — comfortable hold")
                Text("Relaxed neutral").tag("Relaxed neutral")
            }.disabled(capture.recording)
            Text("Frame your whole mouth in the front camera. Hold one comfortable pose and keep the phone steady; do not sweep around your mouth. Capture ends after ten seconds or when you press Stop.").font(.footnote)
            HStack {
                Button("Start capture") { capture.start(pose: pose) }.disabled(!capture.ready || capture.recording || capture.exporting || capture.retryAvailable)
                Button("Stop") { capture.stop(reason: "user-stop") }.disabled(!capture.recording)
            }.buttonStyle(.borderedProminent)
            if capture.retryAvailable {
                Button("Retry saving capture") { capture.retryExport() }.disabled(capture.exporting)
            }
            Button("Share latest private capture") { share = true }.disabled(capture.archiveURL == nil || capture.exporting || capture.recording)
            Text("Front camera + available TrueDepth, with optional microphone audio. Depth can be missing inside the mouth; hidden tissue is not scanned. Files stay on this phone until you share.").font(.caption).foregroundStyle(.secondary)
        }.padding().task { capture.requestCamera() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { capture.stop(reason: "app-backgrounded") } }
        .sheet(isPresented: $share) { if let url = capture.archiveURL { ShareCapture(url: url) } }
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
