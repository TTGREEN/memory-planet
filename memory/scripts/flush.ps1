# flush.ps1 — Session End Checkpoint
# 在 session 结束时运行，统一将当前 session 的状态分发到多个 memory 文件
# 用法：.\flush.ps1 -Working "当前工作" -Blocked "阻塞原因" -Next "下一步" [-Projects "project1,project2"]
# 示例：.\flush.ps1 -Working "设计记忆系统" -Projects "memory-system"

param(
    [Parameter(Mandatory=$true)]
    [string]$Working,
    
    [string]$Blocked = "",
    
    [Parameter(Mandatory=$true)]
    [string]$Next,
    
    [string]$Projects = "",
    [string]$Lessons = ""
)

$ErrorActionPreference = "Stop"
$today = Get-Date -Format "yyyy-MM-dd"
$now = Get-Date -Format "HH:mm"
$memoryRoot = "C:\Users\Administrator\.openclaw\workspace\memory"

function Add-DatedEntry {
    param($file, $entry)
    $dated = "[$today $now] $entry"
    Add-Content -Path $file -Value "`n$dated" -Encoding UTF8
}

# 1. Update daily log
$dailyLog = "$memoryRoot\daily-logs\$today.md"
if (-not (Test-Path $dailyLog)) {
    New-Item -ItemType File -Path $dailyLog -Force | Out-Null
}

$projectsStr = if ($Projects) { "**Projects:** $Projects" } else { "" }
$blockedStr = if ($Blocked) { "**Blocked:** $Blocked" } else { "" }
$nextStr = if ($Next) { "**Next:** $Next" } else { "" }
$lessonsStr = if ($Lessons) { "**Lessons:** $Lessons" } else { "" }

$logEntry = @"
### Session — $today $now
$projectsStr
**Working:** $Working
$blockedStr
$nextStr
$lessonsStr

"@
if ($logEntry.Trim() -ne "") {
    Add-Content -Path $dailyLog -Value $logEntry -Encoding UTF8
}

# 2. Update MEMORY.md open threads
$memoryFile = "C:\Users\Administrator\.openclaw\workspace\MEMORY.md"
if ($Blocked) {
    $threadLine = "- [ ] **$today** $Blocked"
    $content = Get-Content $memoryFile -Raw -Encoding UTF8
    if ($content -notlike "*$Blocked*") {
        $content = $content -replace "(## 🔥 Open Threads.*?)(---)", "`$1$threadLine`n`$2"
        # Very simple approach: just append to open threads section
        $newContent = Get-Content $memoryFile -Encoding UTF8
        $inSection = $false
        $newLines = @()
        foreach ($line in $newContent) {
            $newLines += $line
            if ($line -match "## 🔥 Open Threads") { $inSection = $true; continue }
            if ($inSection -and $line -match "^---") { 
                $newLines += "- [ ] **$today** $Blocked"
                $inSection = $false
            }
        }
        Set-Content -Path $memoryFile -Value $newLines -Encoding UTF8
    }
}

# 3. Update per-project state files
if ($Projects) {
    foreach ($proj in $Projects.Split(",")) {
        $proj = $proj.Trim()
        if (-not $proj) { continue }
        $stateFile = "$memoryRoot\state\$proj.md"
        if (-not (Test-Path (Split-Path $stateFile))) {
            New-Item -ItemType File -Path $stateFile -Force | Out-Null
        }
        $existing = Test-Path $stateFile
        $stateEntry = @"

[$today] $Working
"@
        Add-Content -Path $stateFile -Value $stateEntry -Encoding UTF8
    }
}

# 4. Add lessons to topic files if specified
if ($Lessons) {
    $topicFile = "$memoryRoot\topics\memory-system.md"
    if (Test-Path $topicFile) {
        Add-DatedEntry $topicFile "[LESSON] $Lessons"
    }
}

Write-Host "✅ flush completed: $today $now"
Write-Host "  - Daily log: $dailyLog"
if ($Projects) { Write-Host "  - Projects: $Projects" }
if ($Lessons) { Write-Host "  - Lessons: $Lessons" }
