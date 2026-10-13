using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace AcademicGantt;

/// <summary>
/// Tham số dòng lệnh dành cho kiểm thử tự động trên CI (người dùng bình thường không bao giờ dùng tới):
///   --self-test                          kiểm tra nhanh: cầu nối JS, ghi dữ liệu, sao lưu, nhật ký, lịch
///   --selftest-phase write|verify|reload kịch bản "tắt rồi mở lại" (bắt buộc kèm --data-dir)
///   --selftest-exit close|hold           cách thoát sau pha write (hold: chờ bị kill)
///   --selftest-marker X                  dấu hiệu để so khớp dữ liệu giữa pha write và verify
///   --data-dir DIR                       thư mục dữ liệu riêng cho bài kiểm tra
/// </summary>
public sealed class LaunchOptions
{
    public bool Smoke;
    public string? Phase;
    public string ExitMode = "close";
    public string Marker = "A";
    public string? DataDir;

    public bool IsAnySelfTest => Smoke || Phase != null;

    public static LaunchOptions Parse(string[] args)
    {
        var o = new LaunchOptions();
        for (int i = 0; i < args.Length; i++)
        {
            string? next = i + 1 < args.Length ? args[i + 1] : null;
            switch (args[i])
            {
                case "--self-test": o.Smoke = true; break;
                case "--selftest-phase": o.Phase = next; i++; break;
                case "--selftest-exit": if (next != null) o.ExitMode = next; i++; break;
                case "--selftest-marker": if (next != null) o.Marker = next; i++; break;
                case "--data-dir": o.DataDir = next; i++; break;
            }
        }
        return o;
    }
}

internal static class Program
{
    public static string Version =>
        System.Reflection.Assembly.GetExecutingAssembly()
            .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>()
            .Select(a => a.InformationalVersion.Split('+')[0])
            .FirstOrDefault() ?? "0";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var options = LaunchOptions.Parse(args);
        var dataDir = options.DataDir
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AcademicGantt");

        // Mỗi thư mục dữ liệu chỉ cho một tiến trình ghi, tránh hai cửa sổ ghi đè lên nhau.
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(dataDir).ToLowerInvariant())))[..16];
        using var mutex = new Mutex(true, "Local\\AcademicGantt-" + hash, out bool first);
        if (!first)
        {
            if (!options.IsAnySelfTest)
                MessageBox.Show("Academic Gantt đang chạy rồi. Hãy chuyển sang cửa sổ đang mở.", "Academic Gantt",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 2;
        }

        Application.ThreadException += (_, e) => AppLog.Write("lỗi chưa xử lý: " + e.Exception);
        try
        {
            Directory.CreateDirectory(dataDir);
            if (options.Smoke) SeedSelfTest(dataDir);
            AppLog.Init(dataDir);
            AppLog.Write($"khởi động Academic Gantt {Version} (Windows {Environment.OSVersion.Version})");
            Application.Run(new MainForm(options, dataDir));
        }
        catch (Exception e)
        {
            AppLog.Write("lỗi nghiêm trọng: " + e);
            if (!options.IsAnySelfTest)
                MessageBox.Show("Academic Gantt gặp lỗi và phải đóng:\n\n" + e.Message + "\n\nChi tiết nằm trong:\n" +
                                Path.Combine(dataDir, "app.log"), "Academic Gantt", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return Environment.ExitCode;
    }

    private static void SeedSelfTest(string dataDir)
    {
        foreach (var f in new[] { "storage.json", "app.log" }) { try { File.Delete(Path.Combine(dataDir, f)); } catch { } }
        try { Directory.Delete(Path.Combine(dataDir, "backups"), true); } catch { }
        File.WriteAllText(Path.Combine(dataDir, "storage.json"), "{\"__selftest_seed\":\"ok\"}");
    }
}
