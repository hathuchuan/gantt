# Kiểm thử "tắt rồi mở lại" trên bản .exe thật: thoát êm, bị kill, tải lại trang, tệp dữ liệu hỏng.
# Dùng: powershell -File windows/tests/persist.ps1 -Exe path\to\AcademicGantt.exe
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$failures = 0

function Run-Phase([string]$Dir, [string[]]$PhaseArgs, [switch]$KillAfterWrite) {
    $result = Join-Path $Dir 'selftest-result.txt'
    Remove-Item $result -ErrorAction SilentlyContinue
    $args = @('--data-dir', $Dir) + $PhaseArgs
    $p = Start-Process -FilePath $Exe -ArgumentList $args -PassThru
    if ($KillAfterWrite) {
        $deadline = (Get-Date).AddSeconds(90)
        while ((Get-Date) -lt $deadline -and -not (Test-Path $result)) { Start-Sleep -Milliseconds 300 }
        Start-Sleep -Milliseconds 500
        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }   # giống kill -9 / mất điện đột ngột
        $p.WaitForExit()
    } elseif (-not $p.WaitForExit(90000)) {
        Stop-Process -Id $p.Id -Force
        return "TIMEOUT"
    }
    if (Test-Path $result) { return (Get-Content $result -Raw) }
    return "NO RESULT (exit $($p.ExitCode))"
}

function Check([string]$Name, [string]$Output) {
    if ($Output -like 'PASS*') { Write-Host "PASS $Name" }
    else { Write-Host "FAIL $Name :: $Output"; $script:failures++ }
}

function New-Dir { $d = Join-Path ([IO.Path]::GetTempPath()) ("gantt-" + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $d | Out-Null; $d }

# 1. Thoát êm (đóng cửa sổ)
$d = New-Dir
Check 'write (đóng cửa sổ)' (Run-Phase $d @('--selftest-phase', 'write', '--selftest-marker', 'M1'))
Check 'verify sau khi đóng cửa sổ' (Run-Phase $d @('--selftest-phase', 'verify', '--selftest-marker', 'M1'))

# 2. Bị kill ngay sau khi lưu
$d = New-Dir
Check 'write (chờ bị kill)' (Run-Phase $d @('--selftest-phase', 'write', '--selftest-exit', 'hold', '--selftest-marker', 'M2') -KillAfterWrite)
Check 'verify sau kill' (Run-Phase $d @('--selftest-phase', 'verify', '--selftest-marker', 'M2'))

# 3. Tải lại trang (F5) phải thấy dữ liệu mới nhất
$d = New-Dir
Check 'write trước tải lại' (Run-Phase $d @('--selftest-phase', 'write', '--selftest-marker', 'M3'))
Check 'verify sau tải lại trang' (Run-Phase $d @('--selftest-phase', 'reload', '--selftest-marker', 'M3'))

# 4. storage.json hỏng / rỗng → tự khôi phục từ sao lưu
$d = New-Dir
Check 'write trước khi làm hỏng tệp' (Run-Phase $d @('--selftest-phase', 'write', '--selftest-marker', 'M4'))
Check 'verify (tạo bản sao lưu)' (Run-Phase $d @('--selftest-phase', 'verify', '--selftest-marker', 'M4'))
Set-Content -Path (Join-Path $d 'storage.json') -Value '{ hong ' -NoNewline
Check 'verify sau khi storage.json hỏng' (Run-Phase $d @('--selftest-phase', 'verify', '--selftest-marker', 'M4'))
Set-Content -Path (Join-Path $d 'storage.json') -Value '' -NoNewline
Check 'verify sau khi storage.json rỗng' (Run-Phase $d @('--selftest-phase', 'verify', '--selftest-marker', 'M4'))

if ($failures -gt 0) { Write-Host "$failures kiểm thử thất bại"; exit 1 }
Write-Host 'Tất cả kiểm thử đạt'
