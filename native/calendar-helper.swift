// Small EventKit command-line helper used by MD Editor.
//   calendar-helper list <fromISO> <toISO>
//   calendar-helper link <eventId> <occurrenceStartISO> <url>
// Prints JSON on stdout. On failure prints {"error": "..."} and exits 1.
import EventKit
import Foundation

let store = EKEventStore()
let iso = ISO8601DateFormatter()
iso.timeZone = TimeZone.current

func json(_ obj: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func fail(_ message: String) -> Never {
    print(json(["error": message]))
    exit(1)
}

func requestAccess() -> Bool {
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    let done: (Bool, Error?) -> Void = { granted, _ in
        ok = granted
        sem.signal()
    }
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: done)
    } else {
        store.requestAccess(to: .event, completion: done)
    }
    sem.wait()
    return ok
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage") }
guard requestAccess() else { fail("denied") }

switch args[1] {
case "list":
    guard args.count >= 4, let from = iso.date(from: args[2]), let to = iso.date(from: args[3]) else {
        fail("bad dates")
    }
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
    let out: [[String: Any]] = events.map { e in
        [
            "id": e.eventIdentifier ?? "",
            "title": e.title ?? "(No title)",
            "start": iso.string(from: e.startDate),
            "end": iso.string(from: e.endDate),
            "allDay": e.isAllDay,
            "calendar": e.calendar.title,
            "url": e.url?.absoluteString ?? "",
        ]
    }
    print(json(out))

case "link":
    guard args.count >= 5, let start = iso.date(from: args[3]), let link = URL(string: args[4]) else {
        fail("bad arguments")
    }
    let id = args[2]
    let predicate = store.predicateForEvents(
        withStart: start.addingTimeInterval(-60), end: start.addingTimeInterval(60), calendars: nil)
    guard let event = store.events(matching: predicate).first(where: { $0.eventIdentifier == id }) else {
        fail("event not found")
    }
    if event.url == nil || event.url?.scheme == "mdeditor" {
        event.url = link
    } else {
        // The event already has another URL: keep it and add the note link to the notes instead.
        let existing = event.notes.map { $0 + "\n" } ?? ""
        event.notes = existing + "Note: " + args[4]
    }
    do {
        try store.save(event, span: .thisEvent)
        print(json(["ok": true]))
    } catch {
        fail(error.localizedDescription)
    }

default:
    fail("unknown command")
}
