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
            guard self.values[key] != value else { return }
            self.values[key] = value
            self.scheduleFlush()
        }
    }

    func remove(_ key: String) {
        queue.async {
            guard self.values.removeValue(forKey: key) != nil else { return }
            self.scheduleFlush()
        }
    }

    func clear() {
        queue.async {
            guard !self.values.isEmpty else { return }
            self.values.removeAll()
            self.scheduleFlush()
        }
    }

    /// Gộp nhiều khóa cùng lúc (ảnh chụp localStorage). Chỉ thêm/cập nhật, không bao giờ xóa khóa.
    func merge(_ entries: [String: String]) {
        queue.async {
            var changed = false
            for (key, value) in entries where self.values[key] != value {
                self.values[key] = value
                changed = true
            }
            if changed { self.scheduleFlush() }
        }
    }

    /// Ghi ngay mọi thay đổi còn chờ rồi mới trả về (dùng khi thoát app).
    func waitUntilFlushed() {
        queue.sync {
            self.pendingFlush?.cancel()
            self.pendingFlush = nil
            if self.dirty { self.flush() }
        }
    }

    // Gộp các lần ghi dồn dập (mỗi phím gõ đều lưu) thành một lần ghi sau 0,2 giây.
    private var dirty = false
    private var pendingFlush: DispatchWorkItem?

    private func scheduleFlush() {
        dirty = true
        guard pendingFlush == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.pendingFlush = nil
            if self.dirty { self.flush() }
        }
        pendingFlush = item
        queue.asyncAfter(deadline: .now() + 0.2, execute: item)
    }

    private func flush() {
        do {
            let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: file, options: .atomic)
            dirty = false
        } catch {
            NSLog("AcademicGantt: không ghi được dữ liệu: \(error)")
        }
    }
}
