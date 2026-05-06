# get_cookie.ps1 - 用 PowerShell 静默启动 Chrome 获取 1688 cookie
# Chrome 窗口会在后台打开，完成后自动关闭
param(
    [string]$OutFile = "$PSScriptRoot\token_cache.json",
    [string]$Keywords = "项链"
)

$ErrorActionPreference = "Stop"
$CHROME = "C:\Users\Administrator\AppData\Local\Chromium\Application\chrome.exe"

# 检查 Chrome 是否存在
if (!(Test-Path $CHROME)) {
    Write-Error "Chrome not found at $CHROME"
    exit 1
}

Write-Host "Starting Chrome to fetch 1688 cookies..."

# 用 --headless=new 打开 1688，等待 cookie 建立后立即关闭
# headless 模式更快，且不会被检测干扰
$proc = Start-Process $CHROME -ArgumentList @(
    "--headless=new",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--window-size=1920,1080",
    "--user-data-dir=$env:TEMP\chrome_cookie_tmp",
    "https://h5api.m.1688.com/"
) -PassThru -WindowStyle Hidden

Start-Sleep 3

# 强制终止获取 cookie 的进程
if (!$proc.HasExited) {
    Stop-Process $proc.Id -Force -ErrorAction SilentlyContinue
}

# 读取临时 profile 的 cookie
$cookieFile = "$env:TEMP\chrome_cookie_tmp\Default\Network\Cookies"
if (Test-Path $cookieFile) {
    Write-Host "Cookie file found, reading..."

    $bytes = [System.IO.File]::ReadAllBytes($cookieFile)
    # 用 Python 读取 SQLite cookie 更可靠
    $pyScript = @"
import sqlite3, json, os, sys
cookie_file = r"$cookieFile"
tmp = os.path.join(os.environ["TEMP"], "1688_ck_copy.db")
try:
    import shutil
    shutil.copy2(cookie_file, tmp)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT host_key, name, value FROM cookies WHERE host_key LIKE '%1688%'")
    rows = cur.fetchall()
    conn.close()
    cks = []
    for r in rows:
        cks.append({"domain": r["host_key"], "name": r["name"], "value": r["value"]})
    mtk = next((c for c in cks if c["name"] == "_m_h5_tk"), None)
    result = {"cookie_jar": {c["name"]: c["value"] for c in cks}, "mtk_value": mtk["value"] if mtk else None, "mtk_domain": mtk["domain"] if mtk else None, "timestamp": __import__("time").time()}
    print(json.dumps(result, ensure_ascii=False))
    os.unlink(tmp)
except Exception as e:
    print("ERROR:" + str(e), file=sys.stderr)
    sys.exit(1)
"@

    $tmpPy = "$env:TEMP\read_ck.ps1"
    $BOM = [byte[]](0xEF, 0xBB, 0xBF)
    [System.IO.File]::WriteAllBytes($tmpPy, $BOM)
    [System.IO.File]::AppendAllText($tmpPy, $pyScript, [System.Text.Encoding]::UTF8)

    $result = & python $tmpPy 2>&1
    Remove-Item $tmpPy -Force -ErrorAction SilentlyContinue

    if ($result -and !$result.ToString().StartsWith("ERROR")) {
        $result | Out-File -FilePath $OutFile -Encoding UTF8
        Write-Host "Cookie saved to $OutFile"
        Write-Host $result
    } else {
        Write-Host "Python cookie read failed: $result"
    }
} else {
    Write-Host "Cookie file not found (Chrome headless may not support cookie persistence)"
}

# 清理临时 profile
Remove-Item "$env:TEMP\chrome_cookie_tmp" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done."
