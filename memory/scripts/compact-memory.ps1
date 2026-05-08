# compact-memory.ps1 - Context Compression for MEMORY.md
# When MEMORY.md exceeds 180 lines, compact it by removing low-score entries
# Usage: .\compact-memory.ps1 [-DryRun] [-Verbose]

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$workspaceRoot = "C:\Users\Administrator\.openclaw\workspace"
$MEMORY_FILE = "$workspaceRoot\MEMORY.md"
$COMPRESS_AT = 180
$TARGET_LINES = 150
$HARD_LIMIT = 200

function Get-ActivationScore($line) {
    if ($line -match "\[score:(\d+)\]") {
        return [int]$matches[1]
    }
    return 100
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " MEMORY.md Context Compression" -ForegroundColor Cyan
Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Load current MEMORY.md
if (-not (Test-Path $MEMORY_FILE)) {
    Write-Host "MEMORY.md not found: $MEMORY_FILE" -ForegroundColor Red
    exit 1
}

$raw = Get-Content $MEMORY_FILE -Encoding UTF8
$lines = @($raw)
$totalLines = $lines.Count

Write-Host "`nCurrent: $totalLines lines"

if ($totalLines -le $COMPRESS_AT) {
    Write-Host "Below compress threshold ($COMPRESS_AT), no action needed" -ForegroundColor Green
    exit 0
}

Write-Host "Above $COMPRESS_AT lines - starting compression..." -ForegroundColor Yellow

# Parse entries and sections
$entries = @()
$inSection = $null

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match "^##\s+") {
        $inSection = $line -replace "^##\s+", "" -replace "\s*$", ""
    } elseif ($inSection -and $line -match "^\s*-\s*\[" -and $line -match "\[score:\d+\]") {
        $entries += [PSCustomObject]@{
            Index = $i
            Section = $inSection
            Score = Get-ActivationScore -line $line
            Raw = $line
            Date = if ($line -match "^\s*-\s*\[(\d{4}-\d{2}-\d{2})\]") { $matches[1] } else { "0000-00-00" }
        }
    }
}

# Sort by score ascending, remove lowest-score entries first
$entries = $entries | Sort-Object Score
$currentLines = $totalLines
$removed = 0

Write-Host "`n[Remove] Low-score entries (score < 20):" -ForegroundColor Cyan

foreach ($entry in $entries) {
    if ($currentLines -le $TARGET_LINES) { break }
    if ($entry.Score -lt 20) {
        Write-Host "  Remove [$($entry.Section):$($entry.Index)] score=$($entry.Score)" -ForegroundColor Yellow
        Write-Host "    $($entry.Raw.Substring(0, [Math]::Min(50, $entry.Raw.Length)))"
        $lines[$entry.Index] = $null
        $currentLines--
        $removed++
    }
}

# Merge duplicate entries (same section, similar title)
Write-Host "`n[Merge] Duplicate entries:" -ForegroundColor Cyan

$seen = @{}
$dupesRemoved = 0

foreach ($entry in $entries) {
    if ($null -eq $entry.Index) { continue }
    if ($entry.Raw -match "^\s*-\s*\[\d{4}-\d{2}-\d{2}\]\s*\*\*?([^\*\[?]+)\*\*?") {
        $title = $matches[1].Trim()
    } else { continue }
    if ($title.Length -lt 5) { continue }

    $key = "$($entry.Section)|$title"
    if ($seen.ContainsKey($key)) {
        $existing = $seen[$key]
        if ($entry.Score -gt $existing.Score) {
            $lines[$existing.Index] = $null
            $seen[$key] = $entry
            Write-Host "  Merge: kept score=$($entry.Score) over=$($existing.Score): $title"
        } else {
            $lines[$entry.Index] = $null
        }
        $dupesRemoved++
    } else {
        $seen[$key] = $entry
    }
}

if ($dupesRemoved -eq 0) {
    Write-Host "  No duplicates found to merge" -ForegroundColor Green
}

# Compact empty lines (max 2 consecutive)
$compacted = @()
$emptyCount = 0
foreach ($line in $lines) {
    if ($line -match "^\s*$") {
        $emptyCount++
        if ($emptyCount -le 2) { $compacted += $line }
    } else {
        $emptyCount = 0
        $compacted += $line
    }
}

$finalLines = $compacted.Count

Write-Host "`nResult: $totalLines -> $finalLines lines (removed $removed entries)" -ForegroundColor Cyan

if ($finalLines -gt $HARD_LIMIT) {
    Write-Host "Compression insufficient: still $($finalLines) > $HARD_LIMIT lines" -ForegroundColor Red
    Write-Host "Manual review required" -ForegroundColor Yellow
    exit 1
}

if ($DryRun) {
    Write-Host "`nDryRun: write skipped" -ForegroundColor Yellow
} else {
    Set-Content -Path $MEMORY_FILE -Value $compacted -Encoding UTF8
    Write-Host "MEMORY.md compressed: $totalLines -> $finalLines lines" -ForegroundColor Green
}

Write-Host "========================================" -ForegroundColor Cyan
exit 0
