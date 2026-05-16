# GitHub 项目学习成果
## 日期：2026-05-15
## 来源：仕泽指定的 4 个 GitHub 项目

---

## 1. ruvnet/ruflo — Multi-agent orchestration for Claude Code

**项目定位：** 为 Claude Code 增加多 agent 编排能力（98 agents, 60+ commands, 30 skills, 32 plugins）

### 核心架构
```
Ruflo (CLI/MCP) → Router → Swarm → Agents → Memory → LLM Providers
                     ↑
                     └────── Learning Loop (self-optimizing)
```

### 插件生态（最值得学习的部分）
| 插件 | 功能 |
|------|------|
| ruflo-core | 基础：server, health checks, plugin discovery |
| ruflo-swarm | 多 agent 团队协调，topology（hierarchical/mesh/ring/star）|
| ruflo-autopilot | agent 自主循环 |
| ruflo-loop-workers | 定时后台任务 |
| ruflo-workflows | 可复用多步骤模板 |
| ruflo-federation | 跨机器安全通信 |
| **ruflo-rag-memory** | **HNSW 向量搜索 + 5-phase retrieval** |
| ruflo-agentdb | SQLite + vector_indexes 持久化 |
| ruflo-ruvector | GPU 加速搜索、Graph RAG、103 tools |

### 5-phase retrieval pipeline（最高价值）
1. **Query expansion** — 模板生成变体（无 LLM 开销）
2. **Multi-query fan-out + RRF** — 多变体查询 + Reciprocal Rank Fusion
3. **Recency boost** — 指数衰减（已有 stalenessDecay）
4. **MMR diversity** — token-Jaccard Maximal Marginal Relevance 重排
5. **Session round-robin** — 跨 session 结果交错

### Namespace 隔离模式
```
patterns    — 成功的代码/设计模式
tasks       — 任务上下文和结果
solutions   — Bug 修复和解决方案
feedback    — 用户反馈和纠正
security    — 安全漏洞模式
claude-memories — Claude Code 原生记忆
```

### Swarm Anti-Drift 默认配置
```
topology:   hierarchical  — 协调者捕获分歧
maxAgents:  6-8           — 小团队减少漂移
strategy:   specialized   — 清晰角色无重叠
consensus:  raft          — 领导者维持权威状态
memory:     hybrid        — SQLite + AgentDB
```

### 对我的价值
- **立即采用**：5-phase retrieval pipeline（增强 atoms recall）
- **立即采用**：namespace 隔离（atoms 分类）
- 长期参考：swarm 协调模式（未来多 agent 场景）

---

## 2. VectifyAI/PageIndex — Vectorless, Reasoning-based RAG

**项目定位：** 不用向量数据库，用文档结构树 + LLM 推理做检索（FinanceBench 98.7% 准确率）

### 核心洞察：向量检索的根本问题
- **Query 和知识空间不匹配**：query 表达意图，不是内容
- **语义相似 ≠ 实际相关**：专业文档大量近义段落但相关性不同
- **硬 chunking 破坏语义完整性**：固定大小切分切断句子/段落/章节
- **无法整合对话历史**：每次查询独立，不知道之前问过什么

### PageIndex 两步法
1. **生成文档的"ToC"树结构索引**
2. **基于树的推理检索（Tree Search）**

### LLM 友好的 ToC 索引格式
```json
{
  "node_id": "0006",
  "title": "Financial Stability",
  "start_index": 21,
  "end_index": 22,
  "summary": "The Federal Reserve ...",
  "sub_nodes": [
    {
      "node_id": "0007",
      "title": "Monitoring Financial Vulnerabilities",
      "start_index": 22,
      "end_index": 28,
      "summary": "The Federal Reserve's monitoring ..."
    }
  ]
}
```

### 迭代推理检索循环
```
读 ToC → 理解文档结构
    ↓
选择最可能相关的章节
    ↓
提取相关内容
    ↓
信息充分？
  ↙         ↘
是             否
 ↓             ↓
生成答案    回到第一步选择下一章节
```

### 对我的价值
- **重要认知**：atoms recall 当前是 flat 关键词匹配，未来应走向结构化索引
- **可以借鉴**：文档结构索引思路 → atoms 按主题/项目组织成树
- **参考**：tree search 推理模式 → recall 时做多跳推理
- 注：当前 atoms 数据量（70 条）还不需要这个，1000+ 条时考虑

---

## 3. CloakHQ/CloakBrowser — Stealth Chromium

**项目定位：** C++ 源码级指纹修改的 Chromium，绕过 bot 检测（49 个源码补丁）

### 技术架构
- **不是 JS 注入**：是真实的 Chromium binary，指纹在 C++ 源码层修改
- **49 个源码补丁**：canvas, WebGL, audio, fonts, GPU, screen, WebRTC, network timing, automation signals, CDP input behavior
- **humanize=True**：人-like 鼠标曲线、键盘时序、滚动模式
- **reCAPTCHA v3 score: 0.9**（人类级别）

### 三行代码迁移
```python
# Playwright → CloakBrowser（只需换 import）
- from playwright.sync_api import sync_playwright
- pw = sync_playwright().start()
- browser = pw.chromium.launch()
+ from cloakbrowser import launch
+ browser = launch()
```

### 对我的价值
- **无直接价值**：这是浏览器反检测工具，与记忆系统无关
- **间接价值**：browser-automation skill 未来可能需要时，知道有这么个方案
- 技术思维值得学：**源码级 patch 而非表层配置**

---

## 4. bytedance/UI-TARS-desktop — Multimodal AI Agent Stack

**项目定位：** 多模态 AI Agent 技术栈：CLI/Web UI + Desktop GUI Agent + MCP + Event Stream

### 核心产品
1. **Agent TARS**：终端/电脑/浏览器/产品的多模态 Agent
2. **UI-TARS Desktop**：本地/远程计算机和浏览器操作

### 关键架构
- **MCP 工具集成**：Model Context Protocol
- **Hybrid Browser Agent**：GUI Agent + DOM 双模式
- **Event Stream 调试**：追踪数据流、可视化 tool calls
- **Remote Computer/Browser Operator**：远程控制

### Event Stream 架构
```
Tool Call → Event Stream → 可视化
                      ↓
              数据流追踪和调试
```

### 对我的价值
- **Event Stream 调试**：未来 heartbeat/debug 时可以借鉴这个模式
- **Hybrid Agent 双模式**：未来 GUI 操作场景的参考架构
- MCP 工具集成：browser-automation skill 已有，了解其运作方式

---

## 总结：我要集成的核心能力

### 高优先级（立即做）
1. **ruflo 5-phase retrieval → atoms recall 增强**
   - 添加 query variants 生成（模板，无 LLM）
   - 添加 RRF (Reciprocal Rank Fusion) 多变体结果融合
   - 添加 MMR diversity 重排

2. **ruflo namespace 隔离 → atoms 分类体系**
   - 为 atoms 添加 atom_namespace 字段
   - 分类：identity / project / preference / fact / learning / task

### 中优先级（下一步）
3. **PageIndex tree-index 思路 → atoms 索引优化（M1）**
   - 当 atoms 超过 200 条时，构建主题索引
   - 不再是 flat 搜索，而是结构化推理

4. **UI-TARS Event Stream → 调试日志架构**
   - 为 memory.js 的 recall/health 等操作加结构化日志

### 低优先级（长期参考）
5. **CloakBrowser 源码级 patch 思维**
   - 解决问题时考虑更底层的方案

---

## 5. D4Vinci/Scrapling — Adaptive Web Scraping Framework

**项目定位：** 从单次请求到完整爬取的 adaptive Web Scraping 框架（PyPI: scrapling 0.4.8, ~33k stars）

### 三大组件
| 组件 | 功能 | 核心依赖 |
|------|------|----------|
| **Parser** | HTML解析（lxml + CSS/XPath） | lxml, cssselect |
| **Fetchers** | HTTP/浏览器抓取（隐身/动态） | curl_cffi, playwright |
| **Spiders** | 完整爬虫框架（并发/暂停恢复） | anyio |

### Parser 架构（最核心）
```python
from scrapling.parser import Selector
page = Selector(html)
quotes = page.css('.quote')  # CSS
quotes = page.xpath('//div[@class="quote"]')  # XPath
```
- **不继承 lxml.html.HtmlElement**（pickle 问题）
- `__slots__` 优化内存
- **延迟计算**：tag/text/attrib 首次访问时才计算并缓存
- 支持 CSS、XPath、BeautifulSoup风格 find_all、文本搜索、正则

### Adaptive（自适应元素跟踪）
**解决问题：** 网站改版后选择器失效

```python
# 首次保存元素特征
page.css('.product', identifier='main-product', auto_save=True)
# 网站结构变更后，auto relocate
products = page.css('.product', adaptive=True)
```

**原理：** 元素指纹存 SQLite（tag/text/attributes/path/parent/siblings），变更后遍历 DOM 计算相似度，≥40% 即匹配。

### find_similar（最值得借鉴）
```python
first = page.css('.quote')[0]
similar = first.find_similar()  # 找结构相似元素
```
- 计算 depth = count(ancestor::*)
- 构建 XPath: //parent/grandparent/tag
- 找所有同深度、同路径元素
- 比较 attributes（忽略 href/src）
- similarity_threshold 默认 20%

**对 Memory Planet 的价值：** 不需要 embedding，用结构相似度（namespace + importance + content length + keyword overlap）找相似 atom。

### Lazy Import 模式
```python
# fetchers/__init__.py 用 __getattr__ 延迟导入
_LAZY_IMPORTS = {
    "Fetcher": ("scrapling.fetchers.requests", "Fetcher"),
    ...
}
def __getattr__(name):
    if name in _LAZY_IMPORTS:
        module = __import__(module_path, fromlist=[class_name])
        return getattr(module, class_name)
```
Parser 不依赖浏览器，pip install scrapling 即可用 Selector。

### 性能基准
| 操作 | Scrapling | vs BS4 |
|------|-----------|--------|
| 文本提取（5000元素） | 2.02ms | 1.0x |
| BS4 + html5lib | 3391ms | ~1679x |

接近理论极限，和 Parsel/Scrapy 一个级别。

### 关键设计模式
1. **Adaptive Storage**：SQLite 存元素指纹，变更后 relocate
2. **Lazy Import**：Parser 独立，Fetchers 按需加载
3. **多 Session 路由**：Spider 内 HTTP/隐身浏览器/动态浏览器按需路由

### 小范围测试结果
- 测试文件：E:\test\Scrapling\test_parser.py
- 11项测试全部通过 ✅
- CSS/XPath/find_similar/attribute/text/regex/urljoin 全部验证

---

_Learned: 2026-05-15_
_Tested: E:\test\Scrapling\test_parser.py (11/11 passed)_
