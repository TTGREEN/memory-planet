# 安装本地服务依赖（Node.js）
npm install express cors sqlite3 ollama

# 如果 ollama 包安装失败，可改用 node-fetch 手动调用
# npm install node-fetch@2

Write-Host "✅ 依赖安装完成" -ForegroundColor Green
Write-Host "启动服务: npm start (在 local-server 目录)"
