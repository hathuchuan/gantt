import Foundation

/// Kho dữ liệu của ứng dụng: tệp storage.json trong ~/Library/Application Support/AcademicGantt.
/// Tệp này là nguồn chuẩn; trang web chỉ giữ một bản sao trong bộ nhớ (GanttNative.bootState).
final class StorageMirror {
    enum Source: String {
        case none       // chưa có dữ liệu (lần chạy đầu)
        case file       // storage.json
        case backup     // storage.json hỏng hoặc rỗng nên lấy từ bản sao lưu
    }

    let directory: URL
    let file: URL
    let backupsDirectory: URL
    let loadedFrom: Source
    /// Nội dung đã đọc từ đĩa lúc khởi động (dùng cho kiểm thử và nhật ký).
    let initialValues: [String: String]

    private static let maxBackups = 20

    private var values: [String: String]
    private let queue = DispatchQueue(label: "academic-gantt.storage")
    private var dirty = false
    private var pendingFlush: DispatchWorkItem?
    private var waiters: [(Error?) -> Void] = []
    private var failedFlushes = 0

    init(directory: URL) {
        let fileURL = directory.appendingPathComponent("storage.json")
        let backupsURL = directory.appendingPathComponent("backups", isDirectory: true)
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        try? fm.createDirectory(at: backupsURL, withIntermediateDirectories: true)

        var loaded: [String: String] = [:]
        var source = Source.none

        let current = StorageMirror.read(fileURL)
        if let good = current, StorageMirror.hasData(good) {
            loaded = good
            source = .file
            StorageMirror.backupRawFile(fileURL, into: backupsURL)
        } else if let rescued = StorageMirror.newestBackup(in: backupsURL, legacy: directory) {
            // storage.json thiếu, hỏng hoặc rỗng trong khi đã có bản sao lưu có dữ liệu: dùng bản sao lưu.
            loaded = rescued.values
            source = .backup
            let reason = (current == nil) ? "thiếu hoặc hỏng" : "rỗng"
            AppLog.shared.write("storage.json không dùng được (\(reason)); khôi phục từ \(rescued.url.lastPathComponent)")
            if fm.fileExists(atPath: fileURL.path) {
                let stamp = Int(Date().timeIntervalSince1970)
                try? fm.moveItem(at: fileURL, to: directory.appendingPathComponent("storage.bad-\(stamp).json"))
            }
        } else if let partial = current {
            loaded = partial
            source = .file
        }

        self.directory = directory
        self.file = fileURL
        self.backupsDirectory = backupsURL
        self.loadedFrom = source
        self.initialValues = loaded
        self.values = loaded
        // Bảo đảm tệp chính tồn tại và khớp với dữ liệu đã nạp (đặc biệt khi khôi phục từ bản sao lưu).
        if source == .backup {
            self.dirty = true
            self.queue.async { self.flush() }
        }
    }

    static var defaultDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("AcademicGantt", isDirectory: true)
    }

    // MARK: - Đọc

    /// Chỉ giữ các giá trị dạng chuỗi (localStorage chỉ có chuỗi).
    private static func read(_ url: URL) -> [String: String]? {
        guard let data = try? Data(contentsOf: url), !data.isEmpty,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        var out: [String: String] = [:]
        for (key, value) in object {
            if let text = value as? String { out[key] = text }
        }
        return out
    }

    /// Có khóa chứa danh sách dự án hay không ("[]" vẫn tính là có: người dùng đã xóa hết dự án).
    private static func hasData(_ values: [String: String]) -> Bool {
        guard let courses = values["academic_smart_gantt"] else { return false }
        return !courses.isEmpty
    }

    private static func newestBackup(in dir: URL, legacy: URL) -> (url: URL, values: [String: String])? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if let names = try? fm.contentsOfDirectory(atPath: dir.path) {
            candidates += names.filter { $0.hasSuffix(".json") }.sorted(by: >).map { dir.appendingPathComponent($0) }
        }
        // Bản sao lưu cũ của phiên bản 3.0.x / 3.1.0.
        candidates.append(legacy.appendingPathComponent("storage.backup.json"))
        for url in candidates {
            if let values = read(url), hasData(values) { return (url, values) }
        }
        return nil
    }

    // MARK: - Sao lưu

    /// Sao lưu nguyên văn storage.json theo mốc thời gian (chỉ khi khác bản mới nhất), giữ tối đa 20 bản.
    private static func backupRawFile(_ file: URL, into dir: URL) {
        let fm = FileManager.default
        guard let data = try? Data(contentsOf: file), !data.isEmpty else { return }
        let names = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? [])
            .filter { $0.hasPrefix("storage-") && $0.hasSuffix(".json") }
            .sorted()
        if let last = names.last, let lastData = try? Data(contentsOf: dir.appendingPathComponent(last)), lastData == data {
            return
        }
        let name = "storage-\(stamp()).json"
        try? data.write(to: dir.appendingPathComponent(name), options: .atomic)
        let all = names + [name]
        if all.count > maxBackups {
            for old in all.prefix(all.count - maxBackups) {
                try? fm.removeItem(at: dir.appendingPathComponent(old))
            }
        }
    }

    /// Sao lưu ngay trạng thái hiện tại (trước thao tác phá hủy như nạp JSON).
    @discardableResult
    func backupNow(label: String) -> Bool {
        queue.sync { () -> Bool in
            if self.dirty { self.flush() }
            guard let data = try? Data(contentsOf: self.file), !data.isEmpty else { return false }
            let safeLabel = label.filter { $0.isLetter || $0.isNumber || $0 == "-" }
            let name = "storage-\(StorageMirror.stamp())-\(safeLabel).json"
            do {
                try data.write(to: self.backupsDirectory.appendingPathComponent(name), options: .atomic)
                return true
            } catch {
                AppLog.shared.write("sao lưu trước \(label) thất bại: \(error)")
                return false
            }
        }
    }

    private static func stamp() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd-HHmmss"
        return f.string(from: Date())
    }

    // MARK: - Ghi

    func snapshot() -> [String: String] {
        queue.sync { () -> [String: String] in self.values }
    }

    func stats() -> (keys: Int, bytes: Int) {
        queue.sync { () -> (keys: Int, bytes: Int) in
            var bytes = 0
            for value in self.values.values { bytes += value.utf8.count }
            return (keys: self.values.count, bytes: bytes)
        }
    }

    /// Đặt một khóa. `completion` được gọi sau khi dữ liệu đã nằm trên đĩa (hoặc khi ghi thất bại).
    func set(_ key: String, _ value: String, completion: ((Error?) -> Void)? = nil) {
        queue.async {
            if self.values[key] != value {
                self.values[key] = value
                self.dirty = true
            }
            if let completion = completion { self.waiters.append(completion) }
            if self.dirty {
                self.scheduleFlush()
            } else {
                self.drainWaiters(nil)
            }
        }
    }

    func remove(_ key: String) {
        queue.async {
            guard self.values.removeValue(forKey: key) != nil else { return }
            self.dirty = true
            self.scheduleFlush()
        }
    }

    func clear() {
        queue.async {
            guard !self.values.isEmpty else { return }
            self.values.removeAll()
            self.dirty = true
            self.scheduleFlush()
        }
    }

    /// Gộp nhiều khóa cùng lúc (ảnh chụp trạng thái trang). Chỉ thêm/cập nhật, không bao giờ xóa khóa.
    func merge(_ entries: [String: String]) {
        queue.async {
            var changed = false
            for (key, value) in entries where self.values[key] != value {
                self.values[key] = value
                changed = true
            }
            if changed {
                self.dirty = true
                self.scheduleFlush()
            }
        }
    }

    /// Ghi ngay mọi thay đổi còn chờ rồi mới trả về (dùng khi thoát app). Trả về true nếu đã ghi sạch.
    @discardableResult
    func waitUntilFlushed() -> Bool {
        queue.sync { () -> Bool in
            self.pendingFlush?.cancel()
            self.pendingFlush = nil
            if self.dirty { self.flush() }
            return !self.dirty
        }
    }

    // Gộp các lần ghi dồn dập (mỗi phím gõ đều lưu) thành một lần ghi sau 0,2 giây.
    private func scheduleFlush() {
        guard pendingFlush == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.pendingFlush = nil
            if self.dirty { self.flush() }
        }
        pendingFlush = item
        queue.asyncAfter(deadline: .now() + 0.2, execute: item)
    }

    /// Chép danh sách dự án sang thư mục Scriptable trên iCloud Drive để widget iPhone đọc (bỏ qua nếu chưa cài Scriptable).
    private func exportForWidget() {
        guard let courses = values["academic_smart_gantt"], !courses.isEmpty else { return }
        WidgetBridge.exportCourses(courses)
    }

    private func drainWaiters(_ error: Error?) {
        let list = waiters
        waiters.removeAll()
        for waiter in list { waiter(error) }
    }

    // Chạy trên `queue`.
    private func flush() {
        do {
            let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: file, options: .atomic)
            exportForWidget()
            if failedFlushes > 0 { AppLog.shared.write("ghi dữ liệu đã hoạt động lại sau \(failedFlushes) lần lỗi") }
            failedFlushes = 0
            dirty = false
            drainWaiters(nil)
        } catch {
            failedFlushes += 1
            if failedFlushes <= 3 { AppLog.shared.write("ghi dữ liệu thất bại (lần \(failedFlushes)): \(error)") }
            drainWaiters(error)
            // Thử lại sau, để dữ liệu không nằm chết trong bộ nhớ nếu lỗi chỉ là tạm thời.
            let delay = min(Double(1 << min(failedFlushes, 5)), 30)
            pendingFlush?.cancel()
            let item = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                self.pendingFlush = nil
                if self.dirty { self.flush() }
            }
            pendingFlush = item
            queue.asyncAfter(deadline: .now() + delay, execute: item)
        }
    }
}
