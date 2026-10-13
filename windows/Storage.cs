using System.Text;
using System.Text.Json;

namespace AcademicGantt;

/// <summary>
/// Kho dữ liệu khóa → chuỗi, lưu trong storage.json. Ghi nguyên tử (tệp tạm rồi thay thế), gộp các lần ghi
/// trong 0,2 giây, chỉ báo thành công sau khi dữ liệu đã nằm trên đĩa. Có sao lưu và tự khôi phục khi tệp hỏng.
/// </summary>
public sealed class Storage
{
    public const int MaxBackups = 20;

    private readonly object _lock = new();
    private readonly Dictionary<string, string> _data = new(StringComparer.Ordinal);
    private readonly List<TaskCompletionSource<string?>> _waiters = new();
    private readonly System.Threading.Timer _timer;
    private bool _dirty;

    public string Directory { get; }
    public string File => Path.Combine(Directory, "storage.json");
    public string BackupsDirectory => Path.Combine(Directory, "backups");

    public Storage(string directory)
    {
        Directory = directory;
        System.IO.Directory.CreateDirectory(Directory);
        _timer = new System.Threading.Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
        Load();
    }

    // ---- Đọc ----

    private void Load()
    {
        Dictionary<string, string>? loaded = null;
        string? failure = null;
        if (System.IO.File.Exists(File))
        {
            loaded = TryRead(File, out failure);
            if (loaded == null || loaded.Count == 0)
            {
                // Tệp rỗng / hỏng: cất đi rồi khôi phục từ bản sao lưu mới nhất.
                if (new FileInfo(File).Length > 0)
                {
                    var bad = Path.Combine(Directory, $"storage.bad-{DateTime.Now:yyyyMMdd-HHmmss}.json");
                    try { System.IO.File.Move(File, bad); } catch { }
                }
                AppLog.Write($"storage.json không dùng được ({failure ?? "rỗng"}), thử khôi phục từ sao lưu");
                loaded = null;
            }
        }
        if (loaded == null)
        {
            foreach (var backup in ListBackups())
            {
                loaded = TryRead(backup, out _);
                if (loaded != null && loaded.Count > 0)
                {
                    AppLog.Write($"đã khôi phục dữ liệu từ {Path.GetFileName(backup)}");
                    _dirty = true;
                    break;
                }
                loaded = null;
            }
        }
        if (loaded != null)
        {
            foreach (var kv in loaded) _data[kv.Key] = kv.Value;
        }
        AppLog.Write($"đọc dữ liệu: {_data.Count} khóa");
        if (_dirty) Flush();
        AutoBackup();
    }

    private static Dictionary<string, string>? TryRead(string path, out string? failure)
    {
        failure = null;
        try
        {
            var text = TextCodec.Decode(System.IO.File.ReadAllBytes(path));
            if (text == null) { failure = "không giải mã được"; return null; }
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) { failure = "không phải đối tượng JSON"; return null; }
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (p.Value.ValueKind == JsonValueKind.String) result[p.Name] = p.Value.GetString() ?? "";
            }
            return result;
        }
        catch (Exception e)
        {
            failure = e.Message;
            return null;
        }
    }

    public Dictionary<string, string> Snapshot()
    {
        lock (_lock) return new Dictionary<string, string>(_data);
    }

    // ---- Ghi ----

    /// <summary>Hoàn tất (null = thành công, khác null = thông báo lỗi) sau khi dữ liệu đã nằm trên đĩa.</summary>
    public Task<string?> SetAsync(string key, string value)
    {
        var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_lock)
        {
            _data[key] = value;
            _dirty = true;
            _waiters.Add(tcs);
        }
        _timer.Change(200, Timeout.Infinite);
        return tcs.Task;
    }

    public void Remove(string key)
    {
        lock (_lock) { _data.Remove(key); _dirty = true; }
        _timer.Change(200, Timeout.Infinite);
    }

    public void Clear()
    {
        lock (_lock) { _data.Clear(); _dirty = true; }
        _timer.Change(200, Timeout.Infinite);
    }

    /// <summary>Ghi ngay mọi thay đổi đang chờ (dùng khi thoát và trong kiểm thử).</summary>
    public void Flush()
    {
        List<TaskCompletionSource<string?>> waiters;
        string json;
        lock (_lock)
        {
            if (!_dirty && _waiters.Count == 0) return;
            waiters = new List<TaskCompletionSource<string?>>(_waiters);
            _waiters.Clear();
            _dirty = false;
            json = JsonSerializer.Serialize(_data, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        }
        string? error = null;
        try
        {
            WriteAtomic(File, json);
        }
        catch (Exception e)
        {
            error = e.Message;
            lock (_lock) _dirty = true;   // thử lại ở lần ghi sau
            AppLog.Write($"ghi storage.json thất bại: {e.Message}");
        }
        foreach (var w in waiters) w.TrySetResult(error);
    }

    private static void WriteAtomic(string path, string content)
    {
        var tmp = path + ".tmp";
        using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = new UTF8Encoding(false).GetBytes(content);
            fs.Write(bytes, 0, bytes.Length);
            fs.Flush(true);   // buộc ghi xuống đĩa trước khi thay thế
        }
        if (System.IO.File.Exists(path)) System.IO.File.Replace(tmp, path, null);
        else System.IO.File.Move(tmp, path);
    }

    // ---- Sao lưu ----

    private IEnumerable<string> ListBackups()
    {
        if (!System.IO.Directory.Exists(BackupsDirectory)) return Array.Empty<string>();
        return System.IO.Directory.GetFiles(BackupsDirectory, "storage-*.json")
            .OrderByDescending(f => Path.GetFileName(f), StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Mỗi lần mở app: sao lưu nếu dữ liệu khác bản sao lưu mới nhất; giữ 20 bản.</summary>
    private void AutoBackup()
    {
        try
        {
            string json;
            lock (_lock)
            {
                if (_data.Count == 0) return;
                json = Serialize();
            }
            var latest = ListBackups().FirstOrDefault(f => !Path.GetFileName(f).Contains("import") && !Path.GetFileName(f).Contains("reset"));
            if (latest != null && TextCodec.Decode(System.IO.File.ReadAllBytes(latest)) == json) return;
            WriteBackup(json, null);
            Prune();
        }
        catch (Exception e) { AppLog.Write($"sao lưu tự động thất bại: {e.Message}"); }
    }

    public bool BackupNow(string label)
    {
        try
        {
            Flush();
            string json;
            lock (_lock)
            {
                if (_data.Count == 0) return false;
                json = Serialize();
            }
            WriteBackup(json, label);
            Prune();
            return true;
        }
        catch (Exception e)
        {
            AppLog.Write($"sao lưu '{label}' thất bại: {e.Message}");
            return false;
        }
    }

    private string Serialize() =>
        JsonSerializer.Serialize(_data, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

    private void WriteBackup(string json, string? label)
    {
        System.IO.Directory.CreateDirectory(BackupsDirectory);
        var safe = label == null ? "" : "-" + new string(label.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_').ToArray());
        var name = $"storage-{DateTime.Now:yyyyMMdd-HHmmss}{safe}.json";
        var path = Path.Combine(BackupsDirectory, name);
        for (int i = 2; System.IO.File.Exists(path); i++) path = Path.Combine(BackupsDirectory, $"storage-{DateTime.Now:yyyyMMdd-HHmmss}{safe}-{i}.json");
        WriteAtomic(path, json);
    }

    private void Prune()
    {
        foreach (var old in ListBackups().Skip(MaxBackups * 2))
        {
            try { System.IO.File.Delete(old); } catch { }
        }
    }
}

public static class TextCodec
{
    /// <summary>Giải mã UTF-8 (có/không BOM) hoặc UTF-16; null nếu không đọc được.</summary>
    public static string? Decode(byte[] data)
    {
        try
        {
            if (data.Length >= 2 && ((data[0] == 0xFF && data[1] == 0xFE) || (data[0] == 0xFE && data[1] == 0xFF)))
            {
                var enc = data[0] == 0xFF ? new UnicodeEncoding(false, true) : new UnicodeEncoding(true, true);
                return enc.GetString(data, 2, data.Length - 2);
            }
            var strict = new UTF8Encoding(false, true);
            var text = strict.GetString(data);
            return text.Length > 0 && text[0] == '﻿' ? text.Substring(1) : text;
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }
}

public static class AppLog
{
    private static readonly object Gate = new();
    private static string? _path;

    public static void Init(string directory)
    {
        _path = Path.Combine(directory, "app.log");
        try
        {
            if (File.Exists(_path) && new FileInfo(_path).Length > 512 * 1024)
                File.Move(_path, _path + ".old", true);
        }
        catch { }
    }

    public static void Write(string message)
    {
        if (_path == null) return;
        try
        {
            lock (Gate) File.AppendAllText(_path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }
}
