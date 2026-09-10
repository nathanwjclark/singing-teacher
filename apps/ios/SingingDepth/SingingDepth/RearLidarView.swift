import SwiftUI

struct RearLidarView: View {
    @ObservedObject var capture: RearLidarCapture
    let close: () -> Void
    @State private var pose = "Relaxed neutral held pose"
    @State private var sharing = false
    private var busy: Bool { capture.recording || capture.exporting }
    var body: some View {
        VStack(spacing: 12) {
            Text("Optional rear LiDAR scan").font(.headline)
            CameraPreview(session: capture.session).frame(height: 220).clipped()
            if let image = capture.rawDepthPreview {
                Image(uiImage: image).resizable().scaledToFit().frame(height: 110)
                Text(capture.depthPreviewStatus).font(.caption)
            }
            Text(capture.status).font(.callout)
            Text("Capability: \(capture.capability)").font(.caption)
            TextField("Held pose description", text: $pose).textFieldStyle(.roundedBorder).disabled(busy)
            Text("This separate rear-camera scan records visible surfaces, not the geometry of an earlier sung note. No audio is recorded. Keep the phone outside your mouth; missing returns stay missing.").font(.footnote)
            HStack {
                Button("Start rear scan") { capture.start(pose: pose) }
                    .disabled(!capture.ready || busy || capture.retryAvailable || pose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Stop") { capture.stop(reason: "user-stop") }.disabled(!capture.recording)
            }.buttonStyle(.borderedProminent)
            if capture.retryAvailable { Button("Retry saving scan") { capture.retryExport() }.disabled(capture.exporting) }
            Button("Share rear scan") { sharing = true }.disabled(busy || capture.archiveURL == nil)
            Button("Return to front camera", action: close).disabled(busy)
        }.padding().interactiveDismissDisabled(busy)
        .sheet(isPresented: $sharing) { if let url = capture.archiveURL { ShareCapture(url: url) } }
    }
}
