# build-search-index.ps1 - Build/Update FTS5 search index for daily logs
# Usage: .\build-search-index.ps1 [-Verbose]
# Suggested cron: daily

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$memoryRoot = "C:\Users\Administrator\.openclaw\workspace\memory"
$DB_PATH = "$memoryRoot\logs.db"
$DAILY_LOGS = "$memoryRoot\daily-logs"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Building FTS5 Search Index" -ForegroundColor Cyan
Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (-not $sqlite) {
    Write-Host "sqlite3 not found in PATH" -ForegroundColor Red
    exit 1
}

# Create DB schema
$createSchema = @"
CREATE TABLE IF NOT EXISTS daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    date TEXT,
    content TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"@
$createSchema | sqlite3 $DB_PATH

$createFts = 'CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(filename, date, content, content="daily_logs", content_rowid="id");'
$createFts | sqlite3 $DB_PATH 2>$null

# Index all logs
$logFiles = Get-ChildItem "$DAILY_LOGS\*.md" -ErrorAction SilentlyContinue | Sort-Object Name
$indexed = 0
$errors = 0

foreach ($logFile in $logFiles) {
    $filename = $logFile.Name
    $date = if ($filename -match "(\d{4}-\d{2}-\d{2})") { $matches[1] } else { "unknown" }
    $content = Get-Content $logFile.FullName -Raw -Encoding UTF8

    # Use single-quoted strings for SQLite to avoid PowerShell interpolation issues
    # Single-quote in content: replace ' with ''
    $contentSql = $content -replace "'", "''"
    $filenameSql = $filename -replace "'", "''"

    try {
        $deleteSql = "DELETE FROM daily_logs WHERE filename = '$filenameSql';"
        $insertSql = "INSERT INTO daily_logs (filename, date, content) VALUES ('$filenameSql', '$date', '$contentSql');"
        $deleteSql | sqlite3 $DB_PATH
        $insertSql | sqlite3 $DB_PATH
        $indexed++
        if ($Verbose) { Write-Host "  indexed: $filename" -ForegroundColor Green }
    } catch {
        Write-Host "  ERROR $filename : $_" -ForegroundColor Red
        $errors++
    }
}

# Rebuild FTS index
try {
    "INSERT INTO logs_fts(logs_fts) VALUES('rebuild');" | sqlite3 $DB_PATH 2>$null | Out-Null
} catch {}

$size = if (Test-Path $DB_PATH) { (Get-Item $DB_PATH).Length / 1KB } else { 0 }
$count = "SELECT COUNT(*) FROM daily_logs;" | sqlite3 $DB_PATH 2>$null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Indexed: $indexed files | Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })
Write-Host "DB size: $([Math]::Round($size, 1)) KB | Total entries: $count" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

exit $errors
