import Foundation

/// Bản sao bền vững của localStorage trên đĩa (storage.json).
/// Mỗi lần trang gọi localStorage.setItem/removeItem, bridge.js gửi sang đây để ghi lại.
final class StorageMirror {
    let directory: URL
    let file: URL
    /// Nội dung lúc khởi động, dùng để nạp lại vào localStorage.
    let initialValues: [String: String]

    private var values: [String: String]
    private let queue = DispatchQueue(label: "academic-gantt.storage")

    init(directory: URL) {
        self.directory = directory
        self.file = directory.appendingPathComponent("storage.json")
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)

        var loaded: [String: String] = [:]
        if fm.fileExists(atPath: file.path) {
            if let data = try? Data(contentsOf: file),
               let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] {
                loaded = obj
                // Giữ một bản sao lưu của lần chạy trước.
                let backup = directory.appendingPathComponent("storage.backup.json")
                try? fm.removeItem(at: backup)
                try? fm.copyItem(at: file, to: backup)
            } else {
                // Tệp hỏng: cất sang bên cạnh thay vì ghi đè mất dữ liệu.
                let stamp = Int(Date().timeIntervalSince1970)
                let aside = directory.appendingPathComponent("storage.corrupt-\(stamp).json")
                try? fm.moveItem(at: file, to: aside)
            }
        }
        initialValues = loaded
        values = loaded
    }

    static var defaultDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("AcademicGantt", isDirectory: true)
    }

    func set(_ key: String, _ value: String) {
        queue.async {
            self.values[key] = value
            self.flush()
        }
    }

    func remove(_ key: String) {
        queue.async {
            self.values.removeValue(forKey: key)
            self.flush()
        }
    }

    func clear() {
        queue.async {
            self.values.removeAll()
            self.flush()
        }
    }

    /// Chờ mọi thao tác ghi đang xếp hàng hoàn tất.
    func waitUntilFlushed() {
        queue.sync {}
    }

    private func flush() {
        do {
            let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: file, options: .atomic)
        } catch {
            NSLog("AcademicGantt: không ghi được dữ liệu: \(error)")
        }
    }
}
