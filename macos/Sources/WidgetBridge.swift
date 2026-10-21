import Foundation

// Đồng bộ ngược từ widget iPhone (Scriptable): widget ghi các thao tác "đánh dấu hoàn thành" vào
// gantt_actions.json trong iCloud Drive/Scriptable; trang Gantt đọc, áp dụng rồi ghi xác nhận vào
// gantt_actions_ack.json. Mỗi tệp chỉ có đúng một bên ghi nên iCloud không tạo bản xung đột.
// Đọc/ghi đi qua NSFileCoordinator (phối hợp với tiến trình iCloud) và chạy ngoài luồng chính,
// vì đọc một tệp iCloud chưa tải về có thể phải chờ mạng.
enum WidgetBridge {
    static let actionsFile = "gantt_actions.json"
    static let ackFile = "gantt_actions_ack.json"
    static let coursesFile = "gantt_courses.json"

    private static let queue = DispatchQueue(label: "academic-gantt.widget-bridge", qos: .utility)

    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents", isDirectory: true)
    }

    static var isAvailable: Bool { FileManager.default.fileExists(atPath: directory.path) }

    /// Nội dung gantt_actions.json (chuỗi rỗng nếu chưa có / chưa tải về), trả về trên luồng chính.
    static func readActions(_ completion: @escaping (String) -> Void) {
        queue.async {
            let text = readCoordinated(directory.appendingPathComponent(actionsFile))
            DispatchQueue.main.async { completion(text) }
        }
    }

    /// Ghi gantt_actions_ack.json (danh sách mã thao tác đã áp dụng). false nếu chưa có thư mục Scriptable.
    static func writeAck(_ content: String, _ completion: @escaping (Bool) -> Void) {
        queue.async {
            let ok = isAvailable && writeCoordinated(Data(content.utf8), to: directory.appendingPathComponent(ackFile))
            DispatchQueue.main.async { completion(ok) }
        }
    }

    /// Chép danh sách dự án cho widget đọc (gọi từ luồng ghi của StorageMirror). Bỏ qua nếu chưa cài Scriptable.
    static func exportCourses(_ json: String) {
        guard isAvailable else { return }
        _ = writeCoordinated(Data(json.utf8), to: directory.appendingPathComponent(coursesFile))
    }

    // MARK: - iCloud

    /// Tệp đã bị macOS "tối ưu dung lượng" (chỉ còn bản giữ chỗ .<tên>.icloud) hoặc chưa tải bản mới:
    /// yêu cầu tải về. Lần đọc sau (vài giây nữa) sẽ có dữ liệu.
    private static func requestDownloadIfNeeded(_ url: URL) {
        let placeholder = url.deletingLastPathComponent().appendingPathComponent("." + url.lastPathComponent + ".icloud")
        let fm = FileManager.default
        if fm.fileExists(atPath: placeholder.path) {
            try? fm.startDownloadingUbiquitousItem(at: url)
            return
        }
        guard fm.fileExists(atPath: url.path),
              let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
              let status = values.ubiquitousItemDownloadingStatus,
              status != .current else { return }
        try? fm.startDownloadingUbiquitousItem(at: url)
    }

    private static func readCoordinated(_ url: URL) -> String {
        requestDownloadIfNeeded(url)
        guard FileManager.default.fileExists(atPath: url.path) else { return "" }
        var text = ""
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
            if let data = try? Data(contentsOf: readURL), let s = String(data: data, encoding: .utf8) { text = s }
        }
        return text
    }

    private static func writeCoordinated(_ data: Data, to url: URL) -> Bool {
        var ok = false
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { writeURL in
            ok = (try? data.write(to: writeURL, options: .atomic)) != nil
        }
        return ok && coordError == nil
    }
}

/// Theo dõi thư mục Scriptable trên iCloud Drive: khi iCloud tải về tệp thao tác mới từ iPhone, báo ngay
/// cho trang (không phải đợi lượt hỏi định kỳ 15 giây).
final class WidgetFolderWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var pending: DispatchWorkItem?
    private let onChange: () -> Void

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
    }

    func start() {
        guard source == nil, WidgetBridge.isAvailable else { return }
        let fd = open(WidgetBridge.directory.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .extend], queue: .main)
        src.setEventHandler { [weak self] in self?.schedule() }
        src.setCancelHandler { close(fd) }
        source = src
        src.resume()
    }

    func stop() {
        pending?.cancel()
        source?.cancel()
        source = nil
    }

    // Gộp các sự kiện liên tiếp (iCloud thường ghi tệp tạm rồi đổi tên) thành một lần báo.
    private func schedule() {
        pending?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.onChange() }
        pending = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: item)
    }

    deinit { stop() }
}
