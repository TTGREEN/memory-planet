# 监控批量任务进度（每2分钟）
# 用法：powershell -File monitor_batch.ps1

$DB_PATH = 'E:\1688标题生成\data\1688.db'
$LOG_FILE = "$env:TEMP\batch_embed_log.txt"

function Get-Progress {
  # 查询数据库进度
  $total = sqlite3 $DB_PATH "SELECT COUNT(*) FROM keywords;" 2>$null
  $done = sqlite3 $DB_PATH "SELECT COUNT(*) FROM keyword_vectors;" 2>$null

  if ($total -and $done) {
    $pct = [math]::Round(($done / $total) * 100, 2)
    return "$done/$total ($pct%)"
  }
  return "N/A"
}

function Get-LastLogLines {
  if (Test-Path $LOG_FILE) {
    Get-Content $LOG_FILE -Tail 5 -ErrorAction SilentlyContinue
  } else {
    "日志文件不存在"
  }
}

# 循环监控
while ($true) {
  Clear-Host
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "⏰ 检查时间: $time" -ForegroundColor Cyan
  Write-Host ""

  # 数据库进度
  $progress = Get-Progress
  Write-Host "📊 数据库进度: $progress" -ForegroundColor Green

  # 进程状态
  $proc = Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.Path -like "*batch_embed*"}
  if ($proc) {
    Write-Host "🟢 任务运行中 (PID: $($proc.Id))" -ForegroundColor Green
    Write-Host "   内存: $([math]::Round($proc.WorkingSet64/1MB,1)) MB"
  } else {
    Write-Host "🔴 任务未运行" -ForegroundColor Red
  }

  # 最新日志
  Write-Host ""
  Write-Host "📋 最近日志:" -ForegroundColor Yellow
  Get-LastLogLines | ForEach-Object { Write-Host "   $_" }

  Write-Host ""
  Write-Host "─────────────────────────────────────"
  Write-Host "下次检查: 2 分钟后"
  Start-Sleep -Seconds 120
}
