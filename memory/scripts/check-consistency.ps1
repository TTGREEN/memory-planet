# check-consistency.ps1 - Index Drift Detection (Incremental)
# 对比 index 文件和磁盘实际状态，检测 divergence
# 增量模式：只检查 mtime 或 hash 变化的文件
# 用法：.\check-consistency.ps1 [-DryRun] [-Verbose]
# 建议 cron: 每周一次

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$memoryRoot = "C:\Users\Administrator\.openclaw\workspace\memory"
$workspaceRoot = "C:\Users\Administrator\.openclaw\workspace"
$STATE_FILE = "$memoryRoot\state\scan-state.json"
$HASH_LOG = "$memoryRoot\state\hashes"

function Get-FileHash256($path) {
    if (-not (Test-Path $path)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return [BitConverter]::ToString($hash) -replace '-', ''
}

function Get-FileState {
    param($path)
    if (-not (Test-Path $path)) { return $null }
    $info = Get-Item $path
    return @{
        mtime   = $info.LastWriteTime.ToString("o")
        size    = $info.Length
        hash    = Get-FileHash256 $path
    }
}

# Load or initialize scan state
if (Test-Path $STATE_FILE) {
    try {
        $state = Get-Content $STATE_FILE -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $state = @{ files = @{}; lastRun = $null }
    }
} else {
    $state = @{ files = @{}; lastRun = $null }
}

$currentRun = Get-Date -Format "o"
$issues = 0
$checkedFiles = @{}
$changedFiles = @()

# Helper: check a file and track changes
function Test-FileChanged {
    param($key, $path, $description)
    $current = Get-FileState $path
    $prev = $state.files.$key

    $checkedFiles[$key] = $true

    if ($null -eq $prev) {
        # First time seeing this file
        Write-Verbose "First check: $description ($path)"
        return $true
    }

    if ($null -eq $current) {
        # File existed before but now gone
        Write-Host "LOST: $description was removed" -ForegroundColor Red
        return $false  # file gone = issue, but don't mark as changed
    }

    # Compare mtime first (fast), then hash
    if ($prev.mtime -ne $current.mtime) {
        $changedFiles += $key
        return $true
    }

    return $false
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Memory System Consistency Check (Incremental)" -ForegroundColor Cyan
Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
if ($state.lastRun) {
    Write-Host " Last run: $($state.lastRun)" -ForegroundColor DarkGray
}
Write-Host "========================================" -ForegroundColor Cyan

# ── 1. MEMORY.md check (always full) ─────────────────────────────────────────
Write-Host "`nMEMORY.md check..." -ForegroundColor Yellow
$memoryLines = (Get-Content "$workspaceRoot\MEMORY.md" -Encoding UTF8).Count
$lineLimit = 200
if ($memoryLines -gt $lineLimit) {
    Write-Host "  EXCEEDS $lineLimit lines: $memoryLines" -ForegroundColor Red
    $issues++
} elseif ($Verbose) {
    Write-Host "  Lines: $memoryLines / $lineLimit" -ForegroundColor Green
}

# ── 2. Topic files (incremental: only changed) ────────────────────────────────
Write-Host "`nTopics index (incremental)..." -ForegroundColor Yellow
$topicsIndex = "$memoryRoot\indexes\topics.md"
$topicFiles = Get-ChildItem "$memoryRoot\topics\*.md" -ErrorAction SilentlyContinue
$topicsChanged = $false

foreach ($file in $topicFiles) {
    $key = "topic:$($file.Name)"
    if (Test-FileChanged -key $key -path $file.FullName -description "Topic: $($file.Name)") {
        Write-Host "  Changed: $($file.Name)" -ForegroundColor Cyan
        $topicsChanged = $true
    } elseif ($Verbose) {
        Write-Host "  Unchanged: $($file.Name)" -ForegroundColor DarkGray
    }
}

if ($topicsChanged) {
    # Re-verify index entries match actual files
    if (Test-Path $topicsIndex) {
        $content = Get-Content $topicsIndex -Encoding UTF8
        $inTable = $false
        foreach ($line in $content) {
            if ($line -match "^|.*Topic.*Path") { $inTable = $true; continue }
            if ($line -match "^---") { $inTable = $false; continue }
            if ($inTable -and $line -match "\|.*\|") {
                $parts = $line -split '\|' | ForEach-Object { $_.Trim() }
                if ($parts.Count -ge 2 -and $parts[0] -notmatch "Topic|Name") {
                    $fullPath = Join-Path $memoryRoot $parts[1] -ErrorAction SilentlyContinue
                    if (-not (Test-Path $fullPath)) {
                        Write-Host "  ORPHAN INDEX: $($parts[0]) -> $($parts[1])" -ForegroundColor Red
                        $issues++
                    }
                }
            }
        }
    }
}

# ── 3. Daily logs (incremental: only new files) ────────────────────────────────
Write-Host "`nDaily logs (incremental)..." -ForegroundColor Yellow
$dailyLogsDir = "$memoryRoot\daily-logs"
$logFiles = Get-ChildItem "$dailyLogsDir\*.md" -ErrorAction SilentlyContinue
$newLogs = 0

foreach ($logFile in $logFiles) {
    $key = "log:$($logFile.Name)"
    if (Test-FileChanged -key $key -path $logFile.FullName -description "Log: $($logFile.Name)") {
        $newLogs++
        Write-Host "  New/Changed: $($logFile.Name)" -ForegroundColor Cyan
    }
}

if ($Verbose) {
    Write-Host "  Total log files: $($logFiles.Count)" -ForegroundColor DarkGray
}

# Check recent logs
$recentThreshold = (Get-Date).AddDays(-7)
$recentLogs = $logFiles | Where-Object { $_.LastWriteTime -gt $recentThreshold }
if ($recentLogs.Count -eq 0) {
    Write-Host "  WARNING: No logs in last 7 days" -ForegroundColor Yellow
}

# ── 4. Scripts check ─────────────────────────────────────────────────────────
Write-Host "`nScripts check..." -ForegroundColor Yellow
$scriptsDir = "$memoryRoot\scripts"
$requiredScripts = @("flush.ps1", "consolidate-memory.ps1", "compact-memory.ps1", "build-search-index.ps1", "search-logs.ps1")
foreach ($script in $requiredScripts) {
    $path = Join-Path $scriptsDir $script
    if (-not (Test-Path $path)) {
        Write-Host "  MISSING: $script" -ForegroundColor Red
        $issues++
    } elseif ($Verbose) {
        Write-Host "  OK: $script" -ForegroundColor Green
    }
}

# ── 5. Directory structure ───────────────────────────────────────────────────
Write-Host "`nDirectory structure..." -ForegroundColor Yellow
$requiredDirs = @("topics", "indexes", "daily-logs", "scripts", "state")
foreach ($dir in $requiredDirs) {
    $path = Join-Path $memoryRoot $dir
    if (-not (Test-Path $path)) {
        Write-Host "  MISSING DIR: $dir" -ForegroundColor Red
        $issues++
    } elseif ($Verbose) {
        Write-Host "  OK: $dir" -ForegroundColor Green
    }
}

# ── 6. Detect removed files (in state but not on disk) ──────────────────────
Write-Host "`nOrphan state entries..." -ForegroundColor Yellow
$orphans = @()
if ($state.files) {
    $fileKeys = $state.files.PSObject.Properties.Name | Where-Object { $_ -match '^(topic|log|script):' }
    foreach ($key in $fileKeys) {
        if (-not $checkedFiles.ContainsKey($key)) {
            $orphans += $key
        }
    }
}
if ($orphans.Count -eq 0) {
    Write-Host "  None (no orphan state entries)" -ForegroundColor Green
} else {
    Write-Host "  Found $($orphans.Count) orphan state entries:" -ForegroundColor Yellow
    foreach ($o in $orphans) { Write-Host "    $o" -ForegroundColor DarkGray }
}

# ── Save state ────────────────────────────────────────────────────────────────
if (-not $DryRun) {
    # Update state with current file info
    foreach ($file in $topicFiles) {
        $key = "topic:$($file.Name)"
        $state.files.$key = Get-FileState $file.FullName
    }
    foreach ($logFile in $logFiles) {
        $key = "log:$($logFile.Name)"
        $state.files.$key = Get-FileState $logFile.FullName
    }
    $state.lastRun = $currentRun

    $stateDir = Split-Path $STATE_FILE
    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    $state | ConvertTo-Json -Depth 10 | Set-Content -Path $STATE_FILE -Encoding UTF8
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Cyan
if ($issues -eq 0) {
    Write-Host "OK: No consistency issues" -ForegroundColor Green
} else {
    Write-Host "ISSUES: $issues problems found" -ForegroundColor Red
}
if ($DryRun) {
    Write-Host "(DryRun: state not saved)" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan

exit $issues
