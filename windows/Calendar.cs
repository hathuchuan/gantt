using System.Globalization;
using System.Runtime.InteropServices;
using Windows.ApplicationModel.Appointments;

namespace AcademicGantt;

public sealed class BridgeError : Exception
{
    public string Code { get; }
    public BridgeError(string code, string message) : base(message) { Code = code; }
}

public sealed record CalendarInfo(string Id, string Title, string Source, string Color);

public sealed record EventInfo(string Title, DateTime Start, DateTime End, bool AllDay, string Location, string Calendar);

/// <summary>Nguồn lịch trên Windows. Mỗi nguồn tự đặt tiền tố cho id lịch để gộp chung một danh sách.</summary>
public interface ICalendarProvider
{
    string Name { get; }
    string Prefix { get; }
    Task<List<CalendarInfo>> ListAsync();
    Task<List<EventInfo>> FetchAsync(IReadOnlyCollection<string> nativeIds, DateTime start, DateTime end);
}

/// <summary>
/// Gộp mọi nguồn lịch: ứng dụng Lịch (Calendar) của Windows (kho Appointments, gồm các tài khoản Outlook.com,
/// Microsoft 365, Exchange, Google, iCloud đã thêm vào Windows) và Outlook bản máy tính cổ điển (COM).
/// </summary>
public sealed class CalendarService
{
    public const int DaysAhead = 180;

    private readonly List<ICalendarProvider> _providers = new()
    {
        new WindowsCalendarProvider(),
        new OutlookComProvider()
    };

    public async Task<List<Dictionary<string, object>>> ListAsync()
    {
        var all = new List<CalendarInfo>();
        var errors = new List<(string Provider, Exception Error)>();
        foreach (var p in _providers)
        {
            try
            {
                foreach (var c in await p.ListAsync())
                    all.Add(c with { Id = p.Prefix + c.Id });
            }
            catch (Exception e)
            {
                AppLog.Write($"{p.Name}: không đọc được danh sách lịch: {e.GetType().Name}: {e.Message}");
                errors.Add((p.Name, e));
            }
        }
        if (all.Count == 0 && errors.Count > 0) throw Summarize(errors);

        return all
            .OrderBy(c => c.Source, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(c => c.Title, StringComparer.CurrentCultureIgnoreCase)
            .Select(c => new Dictionary<string, object>
            {
                ["id"] = c.Id, ["title"] = c.Title, ["source"] = c.Source, ["color"] = c.Color
            })
            .ToList();
    }

    public async Task<List<Dictionary<string, object>>> FetchAsync(IEnumerable<string> ids)
    {
        var today = DateTime.Today;
        var end = today.AddDays(DaysAhead + 1);
        var events = new List<EventInfo>();
        var errors = new List<(string Provider, Exception Error)>();
        var selected = ids.ToList();
        foreach (var p in _providers)
        {
            var mine = selected.Where(i => i.StartsWith(p.Prefix, StringComparison.Ordinal))
                .Select(i => i.Substring(p.Prefix.Length)).ToList();
            if (mine.Count == 0) continue;
            try { events.AddRange(await p.FetchAsync(mine, today, end)); }
            catch (Exception e)
            {
                AppLog.Write($"{p.Name}: không đọc được sự kiện: {e.GetType().Name}: {e.Message}");
                errors.Add((p.Name, e));
            }
        }
        if (events.Count == 0 && errors.Count > 0) throw Summarize(errors);

        var items = new List<Dictionary<string, object>>();
        foreach (var e in events.OrderBy(e => e.Start))
        {
            var title = (e.Title ?? "").Trim();
            if (title.Length == 0 || e.Start < today || e.Start >= end) continue;
            var item = new Dictionary<string, object>
            {
                ["title"] = title,
                ["teachDate"] = e.Start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["calendar"] = e.Calendar ?? "",
                ["location"] = (e.Location ?? "").Trim()
            };
            if (!e.AllDay)
            {
                item["startTime"] = e.Start.ToString("HH:mm", CultureInfo.InvariantCulture);
                item["durationHours"] = (int)Math.Round((e.End - e.Start).TotalHours, MidpointRounding.AwayFromZero);
            }
            items.Add(item);
        }
        return items;
    }

    private static BridgeError Summarize(List<(string Provider, Exception Error)> errors)
    {
        var denied = errors.Any(e => e.Error is UnauthorizedAccessException);
        var lines = errors.Select(e => $"• {e.Provider}: {e.Error.Message.Trim()}");
        var message = string.Join("\n", lines);
        if (denied)
        {
            message = "Academic Gantt chưa được cấp quyền đọc Lịch.\n" +
                      "Vào Cài đặt → Quyền riêng tư & bảo mật → Lịch, bật \"Cho phép ứng dụng truy cập lịch\" (và ứng dụng dành cho máy tính) rồi thử lại.\n\n" + message;
            return new BridgeError("denied", message);
        }
        message += "\n\nNếu lịch nằm trong \"Outlook mới\" hoặc dịch vụ không đồng bộ vào Windows, hãy xuất lịch ra tệp .ics rồi dùng chức năng nhập .ics.";
        return new BridgeError("unavailable", message);
    }
}

// ---------------------------------------------------------------------------------------------------------
// Ứng dụng Lịch của Windows (Windows.ApplicationModel.Appointments)
// ---------------------------------------------------------------------------------------------------------
public sealed class WindowsCalendarProvider : ICalendarProvider
{
    public string Name => "Lịch Windows";
    public string Prefix => "win:";

    private static async Task<AppointmentStore> OpenStoreAsync()
    {
        AppointmentStore? store;
        try
        {
            store = await AppointmentManager.RequestStoreAsync(AppointmentStoreAccessType.AllCalendarsReadOnly);
        }
        catch (UnauthorizedAccessException) { throw; }
        catch (Exception e) when (e is COMException || e is InvalidOperationException || e is System.IO.FileNotFoundException)
        {
            throw new InvalidOperationException("Windows không mở được kho lịch (" + e.Message.Trim() + ").");
        }
        if (store == null) throw new UnauthorizedAccessException("Windows từ chối quyền truy cập lịch.");
        return store;
    }

    public async Task<List<CalendarInfo>> ListAsync()
    {
        var store = await OpenStoreAsync();
        var calendars = await store.FindAppointmentCalendarsAsync(FindAppointmentCalendarsOptions.IncludeHidden);
        var result = new List<CalendarInfo>();
        foreach (var c in calendars)
        {
            var color = c.DisplayColor;
            result.Add(new CalendarInfo(
                c.LocalId,
                string.IsNullOrWhiteSpace(c.DisplayName) ? "(không tên)" : c.DisplayName,
                string.IsNullOrWhiteSpace(c.SourceDisplayName) ? "Lịch Windows" : c.SourceDisplayName,
                $"#{color.R:x2}{color.G:x2}{color.B:x2}"));
        }
        return result;
    }

    public async Task<List<EventInfo>> FetchAsync(IReadOnlyCollection<string> nativeIds, DateTime start, DateTime end)
    {
        var store = await OpenStoreAsync();
        var calendars = await store.FindAppointmentCalendarsAsync(FindAppointmentCalendarsOptions.IncludeHidden);
        var names = calendars.ToDictionary(c => c.LocalId, c => c.DisplayName, StringComparer.Ordinal);

        var options = new FindAppointmentsOptions { MaxCount = 10000, IncludeHidden = true };
        foreach (var id in nativeIds) options.CalendarIds.Add(id);
        foreach (var prop in AppointmentProperties.DefaultProperties) options.FetchProperties.Add(prop);

        var range = new DateTimeOffset(start);
        var appointments = await store.FindAppointmentsAsync(range, new DateTimeOffset(end) - range, options);

        var result = new List<EventInfo>();
        foreach (var a in appointments)
        {
            if (a.IsCanceledMeeting) continue;
            var s = a.StartTime.LocalDateTime;
            var e = s + a.Duration;
            names.TryGetValue(a.CalendarId ?? "", out var calName);
            result.Add(new EventInfo(a.Subject ?? "", s, e, a.AllDay, a.Location ?? "", calName ?? ""));
        }
        return result;
    }
}

// ---------------------------------------------------------------------------------------------------------
// Outlook bản máy tính cổ điển (COM, gắn muộn). "Outlook mới" không có COM nên không dùng được cách này.
// ---------------------------------------------------------------------------------------------------------
public sealed class OutlookComProvider : ICalendarProvider
{
    private const int OlAppointmentItem = 1;
    private const int OlMeetingCanceled = 5;
    private const int MaxItemsPerCalendar = 20000;

    public string Name => "Outlook";
    public string Prefix => "ol:";

    public Task<List<CalendarInfo>> ListAsync() => RunSta(ListCore);

    public Task<List<EventInfo>> FetchAsync(IReadOnlyCollection<string> nativeIds, DateTime start, DateTime end) =>
        RunSta(() => FetchCore(nativeIds, start, end));

    private static Task<T> RunSta<T>(Func<T> work)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try { tcs.SetResult(work()); }
            catch (Exception e) { tcs.SetException(e); }
        }) { IsBackground = true, Name = "outlook-com" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return tcs.Task;
    }

    private static dynamic OpenNamespace()
    {
        var type = Type.GetTypeFromProgID("Outlook.Application");
        if (type == null)
            throw new InvalidOperationException("Không tìm thấy Outlook bản máy tính (Outlook mới không hỗ trợ cách đọc này).");
        try
        {
            dynamic app = Activator.CreateInstance(type)!;
            return app.GetNamespace("MAPI");
        }
        catch (COMException e)
        {
            throw new InvalidOperationException("Không mở được Outlook: " + e.Message.Trim());
        }
    }

    private static List<CalendarInfo> ListCore()
    {
        dynamic ns = OpenNamespace();
        var result = new List<CalendarInfo>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (dynamic store in ns.Stores)
        {
            string storeName;
            try { storeName = (string)store.DisplayName; } catch { continue; }
            try
            {
                dynamic root = store.GetRootFolder();
                Walk(root, storeName, 0, result, seen);
            }
            catch (COMException e) { AppLog.Write($"Outlook: bỏ qua kho '{storeName}': {e.Message.Trim()}"); }
        }
        return result;
    }

    private static void Walk(dynamic folder, string storeName, int depth, List<CalendarInfo> result, HashSet<string> seen)
    {
        if (depth > 4) return;
        foreach (dynamic child in folder.Folders)
        {
            try
            {
                int type = (int)child.DefaultItemType;
                if (type == OlAppointmentItem)
                {
                    string id = (string)child.StoreID + "|" + (string)child.EntryID;
                    if (seen.Add(id))
                        result.Add(new CalendarInfo(id, (string)child.Name, "Outlook · " + storeName, "#0078d4"));
                }
                Walk(child, storeName, depth + 1, result, seen);
            }
            catch (COMException) { }
        }
    }

    private static List<EventInfo> FetchCore(IReadOnlyCollection<string> nativeIds, DateTime start, DateTime end)
    {
        dynamic ns = OpenNamespace();
        var us = CultureInfo.GetCultureInfo("en-US");
        var filter = $"[Start] >= '{start.ToString("g", us)}' AND [Start] < '{end.ToString("g", us)}'";
        var result = new List<EventInfo>();
        foreach (var id in nativeIds)
        {
            var parts = id.Split('|', 2);
            if (parts.Length != 2) continue;
            dynamic folder;
            try { folder = ns.GetFolderFromID(parts[1], parts[0]); }
            catch (COMException) { continue; }
            string calName = (string)folder.Name;

            dynamic items = folder.Items;
            items.Sort("[Start]");
            items.IncludeRecurrences = true;
            dynamic restricted = items.Restrict(filter);

            int count = 0;
            foreach (dynamic item in restricted)
            {
                if (++count > MaxItemsPerCalendar) break;
                try
                {
                    if ((int)item.Class != 26) continue;   // olAppointment
                    if ((int)item.MeetingStatus == OlMeetingCanceled) continue;
                    DateTime s = (DateTime)item.Start;
                    DateTime e = (DateTime)item.End;
                    if (s < start || s >= end) continue;
                    result.Add(new EventInfo((string)(item.Subject ?? ""), s, e, (bool)item.AllDayEvent,
                        (string)(item.Location ?? ""), calName));
                }
                catch (COMException) { }
            }
        }
        return result;
    }
}
