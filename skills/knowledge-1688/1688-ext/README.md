# 1688 标题采集器 · 语义推荐版 v3.0

## 功能特性
- ✅ 语义关键词推荐（基于 Ollama embedding）
- ✅ BM25 文本匹配（本地关键词库）
- ✅ mtop API 商品获取（相似推荐）
- ✅ 5000+ 高频关键词内置
- ✅ 本地 embedding，隐私安全

## 环境要求
1. **Chrome** 浏览器（推荐 v88+）
2. **Ollama** 服务运行中，且允许跨域（CORS）
3. **模型**：`nomic-embed-text`（已导出）

## 安装步骤

### 1. 启动 Ollama（带 CORS）
```powershell
# 临时（当前会话）
$env:OLLAMA_ORIGINS="*"
Start-Process "E:\Ollama\Program\ollama.exe" -ArgumentList "serve"

# 永久（用户环境变量）
# 系统属性 → 环境变量 → 用户变量 → 新建
# 变量名: OLLAMA_ORIGINS
# 变量值: *
```
验证：访问 `http://localhost:11434/api/tags`，应返回模型列表。

### 2. 加载 Chrome 扩展
1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择目录：
   ```
   C:\Users\Administrator\.openclaw\workspace\skills\knowledge-1688-scraper\1688-ext\
   ```
5. 扩展图标出现在工具栏

### 3. 使用扩展
1. 点击扩展图标
2. 输入关键词（如"项链"、"手链"）
3. 点击"搜索"
4. 查看推荐关键词（基于语义相似度）
5. （未来）点击关键词查看对应商品

## 技术架构

### 数据流
```
用户输入 → Popup
    ↓ 发送 search 消息
Background Service Worker
    ↓ 1. BM25 文本匹配（keywords.json）
    ↓ 2. 语义重排（Ollama embedding）
    ↓ 3. 返回 top 5 关键词
Popup 展示（mock 商品）
```

### 核心文件
- `background.browser.js`：语义服务、mtop 客户端、消息路由
- `popup/popup.enhanced.js`：UI 交互
- `keywords.json`：高频关键词库（5000 条）
- `semantic_ranker.js`：语义排序算法（BM25 40% + 语义 60%）

## 开发调试

### 查看 Background 日志
1. 扩展管理页 → 点击 "Service Worker" 链接
2. 查看 Console 输出

### 测试语义推荐（独立脚本）
```bash
cd skills/knowledge-1688-mtop-api
node test_integration_simple.js
```

### 全量批量处理（21 万关键词）
```bash
cd skills/knowledge-1688-mtop-api
node batch_embed_keywords.js
```
预计耗时：~3 小时（Ollama 本地）

## 已知问题
- ❌ mtop 搜索接口未实现（当前 mock 商品数据）
- ⚠️ 需要手动设置 Ollama CORS
- ⚠️ 首次加载关键词需 5000 条 JSON 解析（~100ms）

## 后续规划
1. 实现 mtop 关键词搜索（`/search` 接口）
2. 商品去重、价格排序
3. 支持商品详情采集（点击商品）
4. 历史搜索记录

## 联系
有问题提 issue 或联系开发者。

---

**版本**：v3.0.0（2026-04-25）
**状态**：语义推荐核心功能完成 ✅
