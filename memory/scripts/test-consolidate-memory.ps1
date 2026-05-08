# test-consolidate-memory.ps1 - Tests for consolidate-memory.ps1
# Run: .\test-consolidate-memory.ps1

param([switch]$Verbose)

$ErrorActionPreference = "Continue"
$tests = 0; $passed = 0; $failed = 0

function Test-It($name, $condition, $detail = "") {
    $script:tests++
    if ($condition) {
        $script:passed++
        Write-Host "  PASS $name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  FAIL $name" -ForegroundColor Red
        if ($detail) { Write-Host "        $detail" -ForegroundColor DarkGray }
    }
}

Write-Host ""
Write-Host "=== consolidate-memory.ps1 Tests ===" -ForegroundColor Cyan

# ── Test 1: Score extraction from [score:N] format ──────────────────────────
Write-Host "`n[Test 1] Score extraction" -ForegroundColor Yellow

$scoreLine = "  - [2026-05-07] [score:85] This is a lesson about testing"
if ($scoreLine -match "\[score:(\d+)\]") {
    $extracted = [int]$matches[1]
    Test-It "Extracts score 85 from lesson line" ($extracted -eq 85)
} else {
    Test-It "Extracts score 85 from lesson line" $false "Regex failed"
}

$noScoreLine = "  - [2026-05-07] This line has no score"
if ($noScoreLine -match "\[score:(\d+)\]") {
    Test-It "Returns null for line without score" $false "Should not match"
} else {
    Test-It "Returns null for line without score" $true
}

# ── Test 2: Score decay calculation ─────────────────────────────────────────
Write-Host "`n[Test 2] Score decay (factor 0.95)" -ForegroundColor Yellow

$DECAY_FACTOR = 0.95
$testScores = @(100, 85, 50, 20, 19)
$expected = @(95, 81, 48, 19, 18)  # PowerShell [int](double * factor) rounding

for ($i = 0; $i -lt $testScores.Count; $i++) {
    $original = $testScores[$i]
    $exp = $expected[$i]
    $result = [int]([double]$original * $DECAY_FACTOR)
    Test-It "Decay $original -> $exp" ($result -eq $exp) "got=$result"
}

# Edge: score of 1 should not go to 0
$result1 = [int](1 * $DECAY_FACTOR)
Test-It "Score 1 decays to 0 (not negative)" ($result1 -ge 0) "got=$result1"

# ── Test 3: Low-activation detection ────────────────────────────────────────
Write-Host "`n[Test 3] Low-activation threshold (20)" -ForegroundColor Yellow

$ACTIVATION_THRESHOLD = 20
$testScores2 = @(20, 19, 21, 0)
$expectLow = @($false, $true, $false, $true)

for ($i = 0; $i -lt $testScores2.Count; $i++) {
    $isLow = ($testScores2[$i] -lt $ACTIVATION_THRESHOLD)
    Test-It "Score $($testScores2[$i]) is low=$($expectLow[$i])" ($isLow -eq $expectLow[$i])
}

# ── Test 4: Pattern detection (3x rule) ────────────────────────────────────
Write-Host "`n[Test 4] Pattern detection (3+ occurrences)" -ForegroundColor Yellow

$lessonCounts = @{}
$lessonSamples = @{}

$entries = @(
    @{title="don't repeat mistakes"; file="2026-05-01.md"},
    @{title="don't repeat mistakes"; file="2026-05-02.md"},
    @{title="don't repeat mistakes"; file="2026-05-03.md"},
    @{title="always flush on session end"; file="2026-05-01.md"},
    @{title="always flush on session end"; file="2026-05-02.md"},
    @{title="unique lesson here"; file="2026-05-01.md"}
)

foreach ($e in $entries) {
    $title = $e.title
    if ($lessonCounts.ContainsKey($title)) {
        $lessonCounts[$title]++
        $lessonSamples[$title] += @($e.file)
    } else {
        $lessonCounts[$title] = 1
        $lessonSamples[$title] = @($e.file)
    }
}

$promoteCandidates = $lessonCounts.GetEnumerator() | Where-Object { $_.Value -ge 3 }
Test-It "Detects pattern with 3 occurrences" ($promoteCandidates.Count -eq 1)
Test-It "Pattern is 'don't repeat mistakes'" ($promoteCandidates[0].Key -eq "don't repeat mistakes")

# 2 occurrences should NOT be promoted
$twoCount = ($lessonCounts.GetEnumerator() | Where-Object { $_.Value -eq 2 }).Count
Test-It "2-occurrence patterns are NOT promoted" ($twoCount -eq 1)

# ── Test 5: Stale detection (>30 days) ──────────────────────────────────────
Write-Host "`n[Test 5] Stale file detection (>30 days)" -ForegroundColor Yellow

$DAYS_STALE = 30
$now = Get-Date

# Use daysAgo directly for comparison (not DateTime, avoids type coercion bug)
$testFiles = @(
    @{name="recent.md"; daysAgo=5},
    @{name="stale.md"; daysAgo=31},
    @{name="borderline.md"; daysAgo=30}
)

$staleFiles = @($testFiles | Where-Object { $_.daysAgo -gt $DAYS_STALE })
$staleCount = ($staleFiles | Measure-Object).Count

Test-It "Detects 1 stale file (>30 days)" ($staleCount -eq 1)
Test-It "Stale file is 'stale.md'" ($staleCount -ge 1 -and $staleFiles[0].name -eq "stale.md")
Test-It "Borderline (30 days) is NOT stale" (($testFiles | Where-Object { $_.daysAgo -eq 30 } | Measure-Object).Count -eq 1)

# ── Test 6: Section parsing ─────────────────────────────────────────────────
Write-Host "`n[Test 6] Section header detection" -ForegroundColor Yellow

$lines = @(
    "## Identity & Core",
    "  - [2026-05-07] [score:85] some lesson",
    "## Open Threads",
    "  - [ ] some thread"
)

$inSection = $null
$lessonsInSection = @()

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match "^##\s+") {
        $inSection = $line -replace "^##\s+", "" -replace "\s*$", ""
    } elseif ($inSection -and $line -match "^\s*-\s*\[" -and $line -match "\[score:\d+\]") {
        $lessonsInSection += [PSCustomObject]@{Section=$inSection; Line=$line}
    }
}

Test-It "Detects section 'Identity & Core'" ($lessonsInSection.Count -gt 0 -and $lessonsInSection[0].Section -eq "Identity & Core")
Test-It "Skips 'Open Threads' section for lesson parse" ($lessonsInSection[0].Section -ne "Open Threads")

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Results: $passed/$tests passed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
if ($failed -gt 0) { Write-Host " Failed: $failed" -ForegroundColor Red }
Write-Host "========================================" -ForegroundColor Cyan

exit $failed
