# consolidate-memory.ps1 - Memory Consolidation and Forgetting Engine
# Usage: .\consolidate-memory.ps1 [-DryRun] [-Verbose]

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$memoryRoot = "C:\Users\Administrator\.openclaw\workspace\memory"
$workspaceRoot = "C:\Users\Administrator\.openclaw\workspace"
$ACTIVATION_THRESHOLD = 20
$DECAY_FACTOR = 0.95
$DAILY_LOGS = "$memoryRoot\daily-logs"
$TOPICS_DIR = "$memoryRoot\topics"

function Get-ActivationScore($line) {
    if ($line -match "\[score:(\d+)\]") {
        return [int]$matches[1]
    }
    return $null
}

function Update-ActivationScore($line, $newScore) {
    if ($line -match "\[score:\d+\]") {
        return $line -replace "\[score:\d+\]", "[score:$newScore]"
    }
    return $line
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Memory Consolidation and Forgetting" -ForegroundColor Cyan
Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. MEMORY.md line count check
$memoryFile = "$workspaceRoot\MEMORY.md"
$memoryLines = (Get-Content $memoryFile -Encoding UTF8).Count
$lineLimit = 200
$warnAt = 180

if ($memoryLines -gt $lineLimit) {
    Write-Host "MEMORY.md exceeds $lineLimit lines: $memoryLines" -ForegroundColor Red
} elseif ($memoryLines -gt $warnAt) {
    Write-Host "MEMORY.md approaching limit: $memoryLines / $lineLimit" -ForegroundColor Yellow
} else {
    Write-Host "MEMORY.md: $memoryLines / $lineLimit lines" -ForegroundColor Green
}

# 2. Score Decay across topic files
Write-Host "`n[Decay] Scanning topic files..." -ForegroundColor Cyan

$topicFiles = Get-ChildItem "$TOPICS_DIR\*.md" -ErrorAction SilentlyContinue
$decayedCount = 0

foreach ($file in $topicFiles) {
    $content = Get-Content $file.FullName -Encoding UTF8
    $newContent = $content | ForEach-Object {
        $line = $_
        $score = Get-ActivationScore -line $line
        if ($null -ne $score -and $score -gt 0) {
            $newScore = [int]($score * $DECAY_FACTOR)
            if ($newScore -lt $score) {
                $decayedCount++
                Update-ActivationScore -line $line -newScore $newScore
            } else { $line }
        } else { $line }
    }
    if (-not $DryRun -and $decayedCount -gt 0) {
        Set-Content -Path $file.FullName -Value $newContent -Encoding UTF8
    }
}

if ($decayedCount -gt 0) {
    Write-Host "  Decayed $decayedCount entries" -ForegroundColor Yellow
} elseif ($Verbose) {
    Write-Host "  No scores needed decay" -ForegroundColor Green
}

# 3. Low-activation entries
Write-Host "`n[Scan] Low-activation entries..." -ForegroundColor Cyan

$lowEntries = @()
foreach ($file in $topicFiles) {
    $content = Get-Content $file.FullName -Encoding UTF8
    $lineNum = 0
    foreach ($line in $content) {
        $lineNum++
        $score = Get-ActivationScore -line $line
        if ($null -ne $score -and $score -lt $ACTIVATION_THRESHOLD) {
            $lowEntries += [PSCustomObject]@{
                File = $file.Name
                Line = $lineNum
                Score = $score
                Preview = $line.Substring(0, [Math]::Min(70, $line.Length))
            }
        }
    }
}

if ($lowEntries.Count -eq 0) {
    Write-Host "  No low-activation entries (all >= $ACTIVATION_THRESHOLD)" -ForegroundColor Green
} else {
    Write-Host "  Found $($lowEntries.Count) entries with score < $ACTIVATION_THRESHOLD" -ForegroundColor Yellow
    $lowEntries | ForEach-Object {
        Write-Host "    [$($_.File):$($_.Line)] score=$($_.Score) | $($_.Preview)"
    }
}

# 4. Pattern Detection - 3x rule
Write-Host "`n[Pattern] Pattern detection (3x rule)..." -ForegroundColor Cyan

$lessonCounts = @{}
$lessonSamples = @{}

$logFiles = Get-ChildItem "$DAILY_LOGS\*.md" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 14

foreach ($logFile in $logFiles) {
    $content = Get-Content $logFile.FullName -Encoding UTF8
    foreach ($line in $content) {
        if ($line -match "^\s*-\s*\[\d{4}-\d{2}-\d{2}\]\s*\*\*?([^*\*\*]+)\*\*?") {
            $title = $matches[1].Trim()
            if ($title.Length -gt 5) {
                if ($lessonCounts.ContainsKey($title)) {
                    $lessonCounts[$title]++
                    $lessonSamples[$title] += @($logFile.Name)
                } else {
                    $lessonCounts[$title] = 1
                    $lessonSamples[$title] = @($logFile.Name)
                }
            }
        }
    }
}

$promoteCandidates = $lessonCounts.GetEnumerator() | Where-Object { $_.Value -ge 3 } | Sort-Object Value -Descending

if ($promoteCandidates.Count -eq 0) {
    Write-Host "  No patterns found (need 3+ occurrences)" -ForegroundColor Green
} else {
    Write-Host "  Found $($promoteCandidates.Count) patterns with 3+ occurrences:" -ForegroundColor Yellow
    foreach ($candidate in $promoteCandidates) {
        $files = $lessonSamples[$candidate.Key] -join ", "
        Write-Host "    HOT: '$($candidate.Key)' appeared $($candidate.Value)x in: $files"
    }
}

# 5. Stale Detection - topic files not accessed in 30 days
Write-Host "`n[Stale] Stale topic files check..." -ForegroundColor Cyan

$staleThreshold = (Get-Date).AddDays(-30)
$staleFiles = $topicFiles | Where-Object { $_.LastWriteTime -lt $staleThreshold }

if ($staleFiles.Count -eq 0) {
    Write-Host "  All topic files accessed in last 30 days" -ForegroundColor Green
} else {
    Write-Host "  Found $($staleFiles.Count) stale topic files (>30 days):" -ForegroundColor Yellow
    $staleFiles | ForEach-Object {
        Write-Host "    $($_.Name) (last modified: $($_.LastWriteTime.ToString('yyyy-MM-dd')))"
    }
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "DryRun: no changes made" -ForegroundColor Yellow
} else {
    Write-Host "Consolidation check complete" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Cyan

exit 0
