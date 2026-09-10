import Foundation
import CryptoKit

/// Small uncompressed ZIP writer. No network transfer and no archive dependencies.
/// Capture limits keep entries under classic ZIP's 4 GiB/65535-entry bounds.
enum CaptureZip {
    /// Preserve both original archives byte-for-byte, linked by explicit sequential-session metadata.
    static func linkedSession(id: String, video: URL, sound: URL, soundStopReason: String) throws -> URL {
        let root = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = root.appendingPathComponent("session-\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try (folder as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
        func retained(_ source: URL) throws -> [String: Any] {
            let target = folder.appendingPathComponent(source.lastPathComponent)
            try FileManager.default.copyItem(at: source, to: target)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
            let data = try Data(contentsOf: target)
            return ["path": target.lastPathComponent, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), "byteCount": data.count]
        }
        let manifest: [String: Any] = ["schemaVersion": "singing-collection-session-1.0.0", "sessionId": id,
            "videoDepth": try retained(video), "sound": try retained(sound), "soundStopReason": soundStopReason,
            "phaseOrder": ["video-depth", "sound"], "simultaneous": false, "sameAnatomicalPoseVerified": false,
            "includedInFit": false, "note": "Original raw capture packages retained unchanged. Response and depth usability need analysis."]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: folder.appendingPathComponent("session.json"), options: [.atomic, .completeFileProtection])
        let archive = folder.appendingPathExtension("zip")
        try create(folder: folder, destination: archive)
        try (archive as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
        return archive
    }
    private static let crcTable: [UInt32] = (0..<256).map { i in
        var c = UInt32(i); for _ in 0..<8 { c = (c & 1) == 1 ? 0xedb88320 ^ (c >> 1) : c >> 1 }; return c
    }
    private static func crc(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xffffffff
        for byte in data { c = crcTable[Int((c ^ UInt32(byte)) & 255)] ^ (c >> 8) }
        return c ^ 0xffffffff
    }
    static func create(folder: URL, destination: URL) throws {
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey]).filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard files.count < 65535 else { throw CaptureError.message("Too many capture files for archive.") }
        FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete])
        let handle = try FileHandle(forWritingTo: destination); defer { try? handle.close() }
        var central = Data()
        for file in files {
            let bytes = try Data(contentsOf: file), name = Data(file.lastPathComponent.utf8), offset = try handle.offset()
            guard bytes.count < Int(UInt32.max), offset < UInt64(UInt32.max), name.count < 65535 else { throw CaptureError.message("Capture archive exceeds supported size.") }
            let checksum = crc(bytes), size = UInt32(bytes.count)
            var header = Data(); header.u32(0x04034b50); header.u16(20); header.u16(0x800); header.u16(0); header.u16(0); header.u16(0x21); header.u32(checksum); header.u32(size); header.u32(size); header.u16(UInt16(name.count)); header.u16(0); header.append(name)
            try handle.write(contentsOf: header); try handle.write(contentsOf: bytes)
            central.u32(0x02014b50); central.u16(20); central.u16(20); central.u16(0x800); central.u16(0); central.u16(0); central.u16(0x21); central.u32(checksum); central.u32(size); central.u32(size); central.u16(UInt16(name.count)); central.u16(0); central.u16(0); central.u16(0); central.u16(0); central.u32(0); central.u32(UInt32(offset)); central.append(name)
        }
        let centralOffset = try handle.offset()
        guard centralOffset < UInt64(UInt32.max), central.count < Int(UInt32.max) else { throw CaptureError.message("Capture archive too large.") }
        try handle.write(contentsOf: central)
        var end = Data(); end.u32(0x06054b50); end.u16(0); end.u16(0); end.u16(UInt16(files.count)); end.u16(UInt16(files.count)); end.u32(UInt32(central.count)); end.u32(UInt32(centralOffset)); end.u16(0)
        try handle.write(contentsOf: end); try handle.synchronize()
    }
}
private extension Data {
    mutating func u16(_ value: UInt16) { var n = value.littleEndian; Swift.withUnsafeBytes(of: &n) { append(contentsOf: $0) } }
    mutating func u32(_ value: UInt32) { var n = value.littleEndian; Swift.withUnsafeBytes(of: &n) { append(contentsOf: $0) } }
}
