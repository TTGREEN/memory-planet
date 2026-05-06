---
name: knowledge-1688
description: "1688商品采集与分析技能。当用户提及 1688 项目、商品采集、标题生成、关键词挖掘、mtop API、1688反爬时触发。包含：mtop API客户端、Chrome扩展采集方案、BM25+语义混合排序、批量embedding、Chrome反检测方案。"
---

# Knowledge: 1688 商品采集与分析

**触发词**：1688、mtop、1688采集、1688标题、关键词挖掘、1688反爬、1688 API、1688_scraper

**注意**：本技能为仕泽专属 1688 项目知识库，仅当用户明确提及 1688 相关任务时调用。日常对话不加载此技能内容，避免占用 context。

---

## 目录结构

```
knowledge-1688/
├── SKILL.md                          # 本文件
├── LEARNING.md                       # mtop API + 语义排序完整学习报告（13KB）
├── self-learning-report-20260427.md  # self-learning 执行报告（1688 mtop 逆向）
├── self-learning-1688-mtop-20260427.md # mtop 专项学习文档
├── mtop_client.js                   # mtop API 客户端（签名 + token 管理）
├── semantic_ranker.js                 # BM25 + 语义混合排序器
├── embedding_manager.js              # 多 provider embedding 统一接口
├── keyword_service_semantic.js       # BM25 关键词服务
├── batch_embed_keywords_v2.js       # 批量向量化脚本（保守参数）
├── minimax_embedding.js             # MiniMax embedding 客户端
├── validate_semantic_ranking.js     # 语义排序验证脚本
├── export_keywords_for_extension.js  # 关键词导出（供 Chrome 扩展）
├── export_to_ext.js                 # 扩展数据导出
├── monitor_batch.ps1                # 批量任务监控脚本
├── install_deps.ps1                 # 依赖安装脚本
├── package.json / package-lock.json  # Node 依赖
├── run_batch_v2.cmd                 # 批量任务启动脚本
└── knowledge-1688-scraper/
    └── SKILL.md                     # 采集方案文档（Chrome扩展优先）
```

---

## 核心能力

### 1. Chrome 扩展采集（首选 ✅）
- 插件路径：`knowledge-1688/1688-ext/`
- 运行在真实 Chrome 中，**1688 无法检测**
- popup 支持：采集 / 导出 CSV / 复制标题
- 加载方式：Chrome → `chrome://extensions/` → 开发者模式 → 加载已解压扩展程序

### 2. mtop API（需登录 cookie）
- token 有效期约 **55 分钟**，过期需重新获取
- 签名：`MD5(token&timestamp&12574478&data_json)`
- 数据路径：`json.data.data.OFFER.items[i].data`
- 字段：`offerId`, `title`, `price`, `shopName`, `loginId`, `province`, `bookedCount`

### 3. 语义排序（BM25 + Embedding 混合）
- **短文本问题**：nomic-embed-text 对中文单词向量不稳定 → 转换为描述性句子
  - `"银项链"` → `"银项链 首饰 饰品"` → 句子级 embedding
- **混合公式**：`score = 0.4 * BM25 + 0.6 * semantic_sim`
- **性能**：50 候选 → 5 结果，< 2 秒

### 4. 1688 反检测结论
- Playwright/Selenium/Puppeteer 启动的 Chrome 全部被检测（`navigator.webdriver=true`）
- **唯一可行路径**：Chrome Extension（真实浏览器，无检测问题）

---

## mtop API 签名算法

```javascript
// 签名公式（已验证）
sign = MD5(appKey + timestamp + token + data).toLowerCase()

// 参数
appKey = "12574478"（1688 固定值）
timestamp = 13位毫秒时间戳
token = _m_h5_tk cookie 第一段
data = JSON字符串（无空格，按字典序排列字段）
```

### 2025 年新反爬参数
- **x5sec**：类似 `_m_h5_tk_enc` 的加密字段
- **acsign**：额外签名层（算法未知）
- **utdid**：22位设备指纹（需生成并保持）
- **cookie 有效期**：从长期 → **15分钟**

---

## 数据库结构

**路径**：`E:\1688标题生成\data\1688.db`（3.6 GB）

| 表 | 说明 |
|----|------|
| `products` | 13,648 商品（offerId, title, price, shopName, province...） |
| `keywords` | 212,896 关键词 |
| `keyword_vectors` | embedding 向量（已向量化的关键词） |

---

## 踩坑记录（P0级）

| 问题 | 根因 | 解决方案 |
|------|------|----------|
| `await` 在非 async 函数中 | `loadKeywords()` 未声明 async | 修复函数签名 |
| node_modules 72个包缺失 | express/cors 未安装 | `npm install` |
| Chrome 扩展未加载 | 目录位置错误 | 复制到标准位置后加载 |
| KEYWORDS_FILE 路径错误 | 硬编码路径不存在 | 用 `__dirname` 向上查找 |
| nomic-embed-text 向量异常 | 单词级 embedding 不稳定 | 转换为描述性句子 |

---

## 相关文档

- `LEARNING.md` — mtop API + 语义排序完整学习报告
- `self-learning-report-20260427.md` — 1688 mtop API 签名逆向完整执行记录
- `knowledge-1688-scraper/SKILL.md` — 采集方案对比与选择器文档

---

*最后更新：2026-04-27*
*来源：.openclaw_backup_20260427_112545*
