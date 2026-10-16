import Foundation

// Đồng bộ ngược từ widget iPhone (Scriptable): widget ghi các thao tác "đánh dấu hoàn thành" vào
// gantt_actions.json trong iCloud Drive/Scriptable; trang Gantt đọc, áp dụng rồi ghi xác nhận vào
// gantt_actions_ack.json. Mỗi tệp chỉ có đúng một bên ghi nên iCloud không tạo bản xung đột.
enum WidgetBridge {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents", isDirectory: true)
    }

    /// Nội dung gantt_actions.json, hoặc chuỗi rỗng nếu chưa có / chưa đọc được.
    static func readActions() -> String {
        let url = directory.appendingPathComponent("gantt_actions.json")
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }

    /// Ghi gantt_actions_ack.json (danh sách mã thao tác đã áp dụng). Trả về false nếu chưa có thư mục Scriptable.
    @discardableResult
    static func writeAck(_ content: String) -> Bool {
        guard FileManager.default.fileExists(atPath: directory.path) else { return false }
        let url = directory.appendingPathComponent("gantt_actions_ack.json")
        return (try? Data(content.utf8).write(to: url, options: .atomic)) != nil
    }
}
