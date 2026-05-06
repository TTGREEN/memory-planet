# 启动批量任务（后台 + 日志）
$LogFile = "$env:TEMP\batch_embed_log.txt"
$ScriptDir = "C:\Users\Administrator\.openclaw\workspace\skills\knowledge-1688-mtop-api"

Write-Host "🚀 启动批量 embedding 任务..." -ForegroundColor Green
Write-Host "📂 目录: $ScriptDir"
Write-Host "📝 日志: $LogFile"
Write-Host ""

# 启动进程（不等待）
$Job = Start-Job -ScriptBlock {
  cd $using:ScriptDir
  node batch_embed_keywords_v2.js 2>&1 | Tee-Object -FilePath $using:LogFile
}

Write-Host "✅ 任务已启动 (Job ID: $($Job.Id))"
Write-Host "📊 实时日志: Get-Content $LogFile -Wait"
Write-Host ""
Write-Host "监控命令："
Write-Host "  查看日志: Get-Content $LogFile -Tail 20 -Wait"
Write-Host "  检查进度: sqlite3 E:\1688标题生成\data\1688.db `"SELECT COUNT(*) as done FROM keyword_vectors;`""
Write-Host "  停止任务: Stop-Job $($Job.Id); Remove-Job $($Job.Id)"
Write-Host ""

# 保持窗口打开
Read-Host "按 Enter 退出（任务继续在后台运行）"
