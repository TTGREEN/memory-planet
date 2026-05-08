# scan-project.ps1 - Project Structure Scanner
# 快速了解项目全貌：文件树、key files、git状态、最近变更
# 用法：.\scan-project.ps1 -Path <目录> [-MaxDepth 3]
# 示例：.\scan-project.ps1 -Path E:\stepai\clawdaddy -MaxDepth 2

param(
    [Parameter(Mandatory=$true)]
    [string]$Path,
    [int]$MaxDepth = 3,
    [switch]$GitOnly
)

$ErrorActionPreference = "Continue"

function Get-Size($path) {
    try {
        $info = Get-Item $path -ErrorAction SilentlyContinue
        if ($info.PSIsContainer) {
            $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
            if ($null -eq $size) { return "?" }
            if ($size -gt 1GB) { return "{0:N1}GB" -f ($size/1GB) }
            if ($size -gt 1MB) { return "{0:N0}MB" -f ($size/1MB) }
            return "{0:N0}KB" -f ($size/1KB)
        }
        $bytes = $info.Length
        if ($bytes -gt 1MB) { return "{0:N1}MB" -f ($bytes/1MB) }
        return "{0:N0}KB" -f ($bytes/1KB)
    } catch { return "?" }
}

function Get-KnowledgeFiles($dir) {
    $result = @()
    foreach ($name in @("README.md", "AGENTS.md", "CONTEXT.md", "STATUS.md", "TODO.md", "CHANGELOG.md", "CLAUDE.md")) {
        $f = Join-Path $dir $name -ErrorAction SilentlyContinue
        if (Test-Path $f) { $result += $name }
    }
    return $result
}

function Get-Subdirs($dir, $depth) {
    if ($depth -le 0) { return @() }
    $dirs = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Select-Object -First 20
    $out = @()
    foreach ($d in $dirs) {
        $rel = $d.FullName.Replace($Path, ".").Replace("\", "/")
        $subs = Get-Subdirs $d.FullName ($depth - 1)
        $out += [PSCustomObject]@{
            name = $d.Name
            path = $rel
            subdirs = $subs.Count
            size = Get-Size $d.FullName
            children = $subs
        }
    }
    return $out
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Project Scanner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $Path)) {
    Write-Host "Path not found: $Path" -ForegroundColor Red
    exit 1
}

$info = Get-Item $Path
$isDir = $info.PSIsContainer

Write-Host "`nPath: $Path" -ForegroundColor White
Write-Host "Type: $(if ($isDir) { 'Directory' } else { 'File' })" -ForegroundColor DarkGray
if ($isDir) { Write-Host "Size: $(Get-Size $Path)" -ForegroundColor DarkGray }
Write-Host "Modified: $($info.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))" -ForegroundColor DarkGray

# ── Git Status ────────────────────────────────────────────────────────────────
Write-Host "`n[Git]" -ForegroundColor Yellow
if ($isDir) {
    $gitDir = Join-Path $Path ".git"
    if (Test-Path $gitDir) {
        try {
            Push-Location $Path
            $branch = git rev-parse --abbrev-ref HEAD 2>$null
            $status = git status --porcelain 2>$null
            $aheadBehind = git rev-list --left-right --count HEAD...@{u} 2>$null

            Write-Host "  Branch: $branch" -ForegroundColor Green
            if ($status) {
                $lines = $status -split "`n" | Where-Object { $_ }
                $changed = ($lines | Where-Object { $_.Trim() -ne "" }).Count
                Write-Host "  Changed files: $changed" -ForegroundColor $(if ($changed -gt 0) { "Yellow" } else { "Green" })
                if (-not $GitOnly) {
                    $lines | Select-Object -First 10 | ForEach-Object {
                        $color = if ($_.StartsWith("??")) { "DarkGray" } elseif ($_.StartsWith("M") -or $_.StartsWith(" A")) { "Yellow" } else { "White" }
                        Write-Host "    $_" -ForegroundColor $color
                    }
                    if ($lines.Count -gt 10) {
                        Write-Host "    ... and $($lines.Count - 10) more" -ForegroundColor DarkGray
                    }
                }
            } else {
                Write-Host "  Clean (no changes)" -ForegroundColor Green
            }

            if ($aheadBehind -and $aheadBehind -ne "0 0") {
                Write-Host "  Ahead/behind: $aheadBehind" -ForegroundColor DarkGray
            }

            Pop-Location
        } catch {
            Write-Host "  Git error: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "  Not a git repository" -ForegroundColor DarkGray
    }
}

# ── Key Files ────────────────────────────────────────────────────────────────
Write-Host "`n[Knowledge Files]" -ForegroundColor Yellow
$knownFiles = Get-KnowledgeFiles $Path
if ($knownFiles.Count -eq 0) {
    Write-Host "  None found" -ForegroundColor DarkGray
} else {
    foreach ($kf in $knownFiles) {
        $f = Join-Path $Path $kf -ErrorAction SilentlyContinue
        $size = Get-Size $f
        $lines = (Get-Content $f -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host "  $kf ($lines lines, $size)" -ForegroundColor Green
    }
}

# ── Package/Config Files ─────────────────────────────────────────────────────
Write-Host "`n[Config/Package Files]" -ForegroundColor Yellow
if ($isDir) {
    $configPatterns = @("package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod", "Makefile", "Dockerfile", ".env", "openclaw.json")
    $found = @()
    Get-ChildItem $Path -File -ErrorAction SilentlyContinue | ForEach-Object {
        if ($configPatterns -contains $_.Name) {
            $found += $_.Name
        }
    }
    if ($found.Count -eq 0) {
        Write-Host "  None found" -ForegroundColor DarkGray
    } else {
        $found | ForEach-Object { Write-Host "  $_" -ForegroundColor Cyan }
    }
}

# ── Directory Tree ─────────────────────────────────────────────────────────────
if ($isDir -and -not $GitOnly) {
    Write-Host "`n[Directory Tree (depth=$MaxDepth)]" -ForegroundColor Yellow
    $dirs = Get-Subdirs $Path $MaxDepth
    foreach ($d in $dirs | Select-Object -First 15) {
        $sizeStr = if ($d.size -and $d.size -ne "?") { " [$($d.size)]" } else { "" }
        Write-Host "  $($d.path)/$sizeStr" -ForegroundColor DarkGray
    }
}

# ── Node.js specific (if package.json exists) ────────────────────────────────
$pkgJson = Join-Path $Path "package.json"
if (Test-Path $pkgJson) {
    Write-Host "`n[Node.js]" -ForegroundColor Yellow
    try {
        $pkg = Get-Content $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "  Name: $($pkg.name)" -ForegroundColor White
        Write-Host "  Version: $($pkg.version)" -ForegroundColor DarkGray
        if ($pkg.dependencies) {
            $depCount = ($pkg.dependencies | Get-Member -MemberType NoteProperty).Count
            Write-Host "  Dependencies: $depCount" -ForegroundColor DarkGray
        }
        if ($pkg.devDependencies) {
            $devDepCount = ($pkg.devDependencies | Get-Member -MemberType NoteProperty).Count
            Write-Host "  DevDependencies: $devDepCount" -ForegroundColor DarkGray
        }
        if ($pkg.scripts) {
            $scripts = $pkg.scripts.PSObject.Properties.Name | Select-Object -First 5
            Write-Host "  Scripts: $($scripts -join ', ')" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  Could not parse package.json" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Scan complete: $Path" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
