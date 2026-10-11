import Foundation

/// Nhật ký chẩn đoán (app.log trong thư mục dữ liệu). Chỉ ghi sự kiện, không ghi nội dung dự án.
/// Khi có sự cố mất dữ liệu, tệp này cho biết app đã đọc gì lúc mở, ghi gì, và thoát ra sao.
final class AppLog {
    static let shared = AppLog()

    private static let maxBytes = 256 * 1024
    private let queue = DispatchQueue(label: "academic-gantt.log")
    private var url: URL?
    private let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    func configure(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        queue.sync { self.url = directory.appendingPathComponent("app.log") }
    }

    func write(_ message: String) {
        NSLog("AcademicGantt: %@", message)
        let line = "\(formatter.string(from: Date())) \(message)\n"
        queue.async {
            guard let url = self.url, let data = line.data(using: .utf8) else { return }
            self.trimIfNeeded(url)
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: url)
            }
        }
    }

    /// Chờ mọi dòng đang xếp hàng được ghi xong (dùng trước khi thoát).
    func flush() {
        queue.sync {}
    }

    // Giữ nửa cuối khi tệp vượt quá giới hạn.
    private func trimIfNeeded(_ url: URL) {
        guard let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
              size > AppLog.maxBytes,
              let data = try? Data(contentsOf: url) else { return }
        let tail = data.suffix(AppLog.maxBytes / 2)
        try? Data(tail).write(to: url, options: .atomic)
    }
}
