@echo off
taskkill /F /IM node.exe /FI "WINDOWTITLE eq 1688-local-server*" 2>nul
taskkill /F /IM node.exe /FI "COMMANDLINE eq *local-server*server.js*" 2>nul
echo ✅ 本地服务已停止
