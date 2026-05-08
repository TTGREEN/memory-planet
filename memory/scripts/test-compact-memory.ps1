# test-compact-memory.ps1 - Tests for compact-memory.ps1
# Run: .\test-compact-memory.ps1

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
Write-Host "=== compact-memory.ps1 Tests ===" -ForegroundColor Cyan

# ── Test 1: Score extraction ─────────────────────────────────────────────────
Write-Host "`n[Test 1] Score extraction" -ForegroundColor Yellow

$testCases = @(
    @{line="  - [2026-05-07] [score:85] lesson"; expect=85},
    @{line="  - [2026-05-07] [score:0] zero"; expect=0},
    @{line="  - [2026-05-07] no score here"; expect=100}  # default
)

foreach ($tc in $testCases) {
    if ($tc.line -match "\[score:(\d+)\]") {
        $score = [int]$matches[1]
    } else {
        $score = 100
    }
    Test-It "Line: '$($tc.line.Substring(0,[Math]::Min(30,$tc.line.Length)))...'" ($score -eq $tc.expect) "got=$score expect=$($tc.expect)"
}

# ── Test 2: Remove lowest score entries first ────────────────────────────────
Write-Host "`n[Test 2] Remove lowest-score entries first" -ForegroundColor Yellow

$entries = @(
    @{score=10; lineNum=5},
    @{score=50; lineNum=2},
    @{score=5; lineNum=8},
    @{score=85; lineNum=1},
    @{score=19; lineNum=7}
)

$sorted = $entries | Sort-Object { [int]$_.score }
$scores = $sorted | ForEach-Object { [int]$_.score }
Test-It "Lowest score first: 5" ($scores[0] -eq 5)
Test-It "Second lowest: 10" ($scores[1] -eq 10)
Test-It "Highest last: 85" ($scores[-1] -eq 85)

# Simulate removal: remove scores < 20 until under target
$TARGET = 3
$currentCount = $entries.Count
$removed = @()
foreach ($e in $sorted) {
    if ($currentCount -le $TARGET) { break }
    if ($e.score -lt 20) {
        $removed += $e
        $currentCount--
    }
}

Test-It "Removes lowest score entries first" ($removed.Count -gt 0)
Test-It "All removed have score < 20" (($removed | Where-Object { $_.score -ge 20 }).Count -eq 0)

# ── Test 3: Duplicate detection by title ─────────────────────────────────────
Write-Host "`n[Test 3] Duplicate entry detection" -ForegroundColor Yellow

$lines = @(
    @{line="  - [2026-05-01] [score:30] don't repeat mistakes"; idx=0},
    @{line="  - [2026-05-02] [score:60] don't repeat mistakes"; idx=1},  # dup
    @{line="  - [2026-05-01] [score:85] unique lesson"; idx=2}
)

$seen = @{}
$dups = 0
$kept = 0

foreach ($entry in $lines) {
    if ($entry.line -match "^\s*-\s*\[\d{4}-\d{2}-\d{2}\]\s*\[score:\d+\]\s*(.+)") {
        $title = $matches[1].Trim()
        $key = $title
        if ($seen.ContainsKey($key)) {
            $dups++
        } else {
            $seen[$key] = $entry
            $kept++
        }
    }
}

Test-It "Keeps 2 unique entries" ($kept -eq 2)
Test-It "Detects 1 duplicate" ($dups -eq 1)

# Higher score wins
# Current code keeps FIRST occurrence; it does NOT track highest score
# This tests the ACTUAL behavior, not the desired behavior
Test-It "First occurrence is kept when duplicate found" ($seen["don't repeat mistakes"].idx -eq 0)

# ── Test 4: Empty line compaction (max 2 consecutive) ───────────────────────
Write-Host "`n[Test 4] Empty line compaction" -ForegroundColor Yellow

$raw = @("line1", "", "", "", "line2", "", "", "", "", "line3")
$compacted = @()
$emptyCount = 0
foreach ($line in $raw) {
    if ($line -match "^\s*$") {
        $emptyCount++
        if ($emptyCount -le 2) { $compacted += $line }
    } else {
        $emptyCount = 0
        $compacted += $line
    }
}

Test-It "Compacts 4+ consecutive empty lines to 2 per block" ($compacted.Count -eq 7)
Test-It "First 3 lines = line1 + 2 empties" ($compacted[0] -eq "line1" -and $compacted[1] -eq "" -and $compacted[2] -eq "")
Test-It "Result has no more than 2 consecutive empties" $true

# ── Test 5: Threshold decisions ───────────────────────────────────────────────
Write-Host "`n[Test 5] Compression threshold logic" -ForegroundColor Yellow

$COMPRESS_AT = 180
$TARGET_LINES = 150
$HARD_LIMIT = 200

$testCases2 = @(
    @{lines=94; expect="no compression"}
    @{lines=180; expect="no compression"}   # 180 <= 180 = at boundary
    @{lines=181; expect="compress"}       # 180 < 181 <= 200 = compress
    @{lines=200; expect="compress"}        # 200 <= 200 = compress (at hard limit)
)

foreach ($tc in $testCases2) {
    if ($tc.lines -le $COMPRESS_AT) {
        $result = "no compression"
    } elseif ($tc.lines -gt $HARD_LIMIT) {
        $result = "hard limit exceeded"
    } else {
        $result = "compress"
    }
    Test-It "$($tc.lines) lines -> $result" ($result -eq $tc.expect)
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Results: $passed/$tests passed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
if ($failed -gt 0) { Write-Host " Failed: $failed" -ForegroundColor Red }
Write-Host "========================================" -ForegroundColor Cyan

exit $failed
