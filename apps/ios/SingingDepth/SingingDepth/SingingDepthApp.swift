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
            CameraPreview(session: capture.session).frame(maxHeight: .infinity).clipShape(RoundedRectangle(cornerRadius: 14))
            Text(capture.status).font(.callout).accessibilityIdentifier("capture-status")
            Picker("Held pose", selection: $pose) {
                Text("Comfortable ah — hold still").tag("Comfortable ah — hold still")
                Text("Visible tongue — comfortable hold").tag("Visible tongue — comfortable hold")
                Text("Relaxed neutral").tag("Relaxed neutral")
            }.disabled(capture.recording)
            Text("Hold one comfortable pose per capture. Keep the phone steady. Ten-second limit. Stop if uncomfortable. Separate poses are separate surfaces; hidden tissue is not scanned.").font(.footnote)
            HStack {
                Button("Start capture") { capture.start(pose: pose) }.disabled(!capture.ready || capture.recording || capture.exporting)
                Button("Stop") { capture.stop(reason: "user-stop") }.disabled(!capture.recording)
            }.buttonStyle(.borderedProminent)
            Button("Share latest private capture") { share = true }.disabled(capture.archiveURL == nil || capture.exporting || capture.recording)
            Text("RGB + measured TrueDepth, with audio when microphone access is allowed. No internal anatomy or measured head pose. Files stay on this phone until you share.").font(.caption).foregroundStyle(.secondary)
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
