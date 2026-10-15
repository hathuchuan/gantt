import AppKit
import EventKit

struct BridgeError: Error {
    let code: String
    let message: String
}

/// Đọc Apple Calendar qua EventKit (thay cho AppleScript + sync_server.py).
/// EventKit tự khai triển sự kiện lặp lại (kể cả ngoại lệ), nên không cần tự phân tích RRULE.
final class CalendarBridge {
    /// Lấy sự kiện từ hôm nay đến hết ngày thứ 180 (giống sync_server.py).
    static let daysAhead = 180

    static let deniedMessage = """
    Academic Gantt chưa được cấp quyền đọc Lịch (Calendar).
    Vào System Settings → Privacy & Security → Calendars, bật quyền (Full Access) cho Academic Gantt rồi thử lại.
    """

    private var store = EKEventStore()
    private let queue = DispatchQueue(label: "academic-gantt.calendar")

    static var authorizationStatusDescription: String {
        String(describing: EKEventStore.authorizationStatus(for: .event).rawValue)
    }

    private func withAccess(_ body: @escaping (Result<EKEventStore, BridgeError>) -> Void) {
        queue.async {
            let before = EKEventStore.authorizationStatus(for: .event)
            let completion: EKEventStoreRequestAccessCompletionHandler = { granted, _ in
                self.queue.async {
                    guard granted else {
                        body(.failure(BridgeError(code: "denied", message: CalendarBridge.deniedMessage)))
                        return
                    }
                    if before == .notDetermined {
                        // Kho tạo trước khi được cấp quyền có thể trả về danh sách lịch rỗng.
                        self.store = EKEventStore()
                    }
                    body(.success(self.store))
                }
            }
            if #available(macOS 14.0, *) {
                self.store.requestFullAccessToEvents(completion: completion)
            } else {
                self.store.requestAccess(to: .event, completion: completion)
            }
        }
    }

    func listCalendars(completion: @escaping (Result<[[String: Any]], BridgeError>) -> Void) {
        withAccess { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let store):
                let items = store.calendars(for: .event)
                    .sorted { (($0.source?.title ?? ""), $0.title) < (($1.source?.title ?? ""), $1.title) }
                    .map { cal -> [String: Any] in
                        [
                            "id": cal.calendarIdentifier,
                            "title": cal.title,
                            "source": cal.source?.title ?? "",
                            "color": CalendarBridge.hex(cal.color)
                        ]
                    }
                completion(.success(items))
            }
        }
    }

    func fetchEvents(calendarIds: [String], completion: @escaping (Result<[[String: Any]], BridgeError>) -> Void) {
        withAccess { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let store):
                let wanted = Set(calendarIds)
                let calendars = store.calendars(for: .event).filter { wanted.contains($0.calendarIdentifier) }
                // calendars rỗng trong predicate nghĩa là "mọi lịch", nên phải chặn trước.
                guard !calendars.isEmpty else {
                    completion(.success([]))
                    return
                }
                completion(.success(CalendarBridge.collectEvents(store: store, calendars: calendars)))
            }
        }
    }

    private static func collectEvents(store: EKEventStore, calendars: [EKCalendar]) -> [[String: Any]] {
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        let end = cal.date(byAdding: .day, value: daysAhead + 1, to: start)
            ?? start.addingTimeInterval(Double(daysAhead + 1) * 86_400)
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)

        let dayFormatter = makeFormatter("yyyy-MM-dd")
        let timeFormatter = makeFormatter("HH:mm")

        var items: [[String: Any]] = []
        for event in store.events(matching: predicate) {
            guard let startDate = event.startDate, startDate >= start, startDate < end else { continue }
            let title = (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if title.isEmpty { continue }

            var item: [String: Any] = [
                "title": title,
                "teachDate": dayFormatter.string(from: startDate),
                "calendar": event.calendar?.title ?? "",
                "source": event.calendar?.source?.title ?? "",
                "location": (event.location ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            ]
            if !event.isAllDay, let endDate = event.endDate {
                item["startTime"] = timeFormatter.string(from: startDate)
                item["durationHours"] = Int((endDate.timeIntervalSince(startDate) / 3600).rounded())
            }
            items.append(item)
        }
        items.sort {
            let a = (($0["teachDate"] as? String) ?? "", ($0["startTime"] as? String) ?? "")
            let b = (($1["teachDate"] as? String) ?? "", ($1["startTime"] as? String) ?? "")
            return a < b
        }
        return items
    }

    private static func makeFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = format
        return formatter
    }

    private static func hex(_ color: NSColor?) -> String {
        guard let rgb = color?.usingColorSpace(.sRGB) else { return "#94a3b8" }
        func byte(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(rgb.redComponent), byte(rgb.greenComponent), byte(rgb.blueComponent))
    }
}
