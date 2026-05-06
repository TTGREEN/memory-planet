@echo off
cd /d "C:\Users\Administrator\.openclaw\workspace\skills\knowledge-1688-mtop-api"
echo 启动批量 embedding 任务（优化版）...
node batch_embed_keywords_v2.js
echo.
echo 任务已结束，按任意键退出...
pause
