# search-logs.ps1 - Full-text search across daily logs using SQLite FTS5
# Usage: .\search-logs.ps1 <query> [-Limit 10]
# Example: .\search-logs.ps1 "1688" -Limit 5

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Query,
    [int]$Limit = 10
)

$ErrorActionPreference = "Stop"
$memoryRoot = "C:\Users\Administrator\.openclaw\workspace\memory"
$DB_PATH = "$memoryRoot\logs.db"
$DAILY_LOGS = "$memoryRoot\daily-logs"

$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (-not $sqlite) {
    Write-Host "sqlite3 not found in PATH" -ForegroundColor Red
    exit 1
}

# Build index if DB doesn't exist or is empty
if (-not (Test-Path $DB_PATH)) {
    Write-Host "Building initial index..." -ForegroundColor Yellow
    & "$PSScriptRoot\build-search-index.ps1"
}

Write-Host "Searching daily logs for: $Query" -ForegroundColor Cyan
Write-Host "Limit: $Limit results`n" -ForegroundColor DarkGray

# Escape single quotes for SQLite
$querySql = $Query -replace "'", "''"

$searchSql = "SELECT filename, date, snippet(logs_fts, 2, '>>>', '<<<', '...', $Limit) AS snippet FROM logs_fts WHERE logs_fts MATCH '$querySql' ORDER BY rank LIMIT $Limit;"

try {
    $results = $searchSql | sqlite3 $DB_PATH 2>$null
} catch {
    Write-Host "Search error: $_" -ForegroundColor Red
    exit 1
}

if ($results.Count -eq 0 -or [string]::IsNullOrWhiteSpace($results)) {
    Write-Host "No results found for: $Query" -ForegroundColor Yellow
    exit 0
}

Write-Host "Results:`n" -ForegroundColor Green
$results -split "`n" | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return }
    $parts = $_ -split '\|'
    if ($parts.Count -ge 3) {
        Write-Host "File: $($parts[0]) ($($parts[1]))" -ForegroundColor Cyan
        Write-Host "  $($parts[2])"
        Write-Host ""
    } elseif ($parts.Count -eq 1) {
        Write-Host "$_" -ForegroundColor DarkGray
    }
}

$logCount = Get-ChildItem "$DAILY_LOGS\*.md" -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
Write-Host "────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "Searched $logCount log files | DB: $DB_PATH" -ForegroundColor DarkGray
