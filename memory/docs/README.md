# Memory Planet v2.0 —— 端云协同的轻量级 AI 认知操作系统 (Cognitive OS)

> **GitHub:** [TTGREEN/memory-planet](https://github.com/TTGREEN/memory-planet)  
> **License:** MIT

---

## 核心价值

Memory Planet v2.0 是一款专为有限硬件/端侧环境设计的**端云协同 AI 认知操作系统**。它彻底打破了传统 RAG（检索增强生成）死板、高延迟、易造成上下文爆栈的局限，首次将现代操作系统（OS）的虚拟内存分页（Paging）、写入预写日志（WAL）、以及 Git 式分支治理机制引入 Agent 的记忆与信念管理中。

通过本地轻量级控制内核（基于 OpenClaw 与 SQLite/sqlite-vec）与云端高阶大模型（Claude, GPT, Gemini 等）的深度解耦，本项目在极低本地算力消耗下，实现了智能体长周期运行的连续人格、自进化因果拓扑世界观、以及工业级的安全容错。

---

## 核心技术创新

### 1. 架构解耦：确定性本地内核与云端不确定性推理
- 将控制权（Control Plane）彻底收回到本地高效的硬编码逻辑和状态机中
- 云端模型仅作为推理面（Reasoning Plane）的算力外包
- "单大脑序列化人格切换"技术（Explorer/Guardian/Skeptic/Optimizer），显存与 Token 消耗降低 **80%**

### 2. 异步影子编译（Asynchronous Shadow Compilation）
- 借鉴数据库 WAL（预写日志）思想
- Draft Atom 在百毫秒内写入 SQLite 缓存池并直接触发响应
- 后台守护进程利用离线空闲时间进行语义编译、边界标注和因果绑定
- **在线交互零延迟、长效记忆自动生长**

### 3. 认知虚拟内存分页系统（Cognitive Virtual Memory Paging）
- 将 LLM 的上下文窗口视为"高速缓存（L1/L2 Cache）"
- 将 `ephemeral_pages` 表视为"虚拟内存 Swap 空间"
- "缺页中断（Page Fault）"机制按需换入/换出
- **解开了长会话的 Token 死锁**

### 4. 灰度知识发布与安全熔断链路（Canary Knowledge Pathway）
- 全生命周期知识流转：`Draft → Canary → Verified → Committed`
- 未验证知识降权调用（禁止高危写操作、强制自我核验）
- 跨情境正向收益验证后才允许入库
- **从根本上防止"认知污染"**

### 5. 分支治理平面与人类架构师 CLI 防线（Branch-based Governance & HITL）
- Git 式认知分支模型：任何知识变更以 RFC 提案形式提交
- 多自我议会（Skeptic + Optimizer）在沙盒中进行对抗模拟
- 无法自动达成共识时无缝唤醒人类确认界面
- **兼顾自主进化与绝对可控**

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 本地内核 | OpenClaw + SQLite + sqlite-vec（向量搜索）|
| 云端推理 | Claude / GPT / Gemini（按需调用）|
| 控制面 | Node.js + 硬编码状态机 |
| 向量模型 | Ollama + mxbai-embed-large |
| 进程管理 | PM2 |
| 沙盒隔离 | isolated-vm（V8 Isolate） |

---

## 项目结构

```
memory-planet/
├── scripts/              # 核心引擎
│   ├── atoms-db.js       # SQLite 数据库 + 向量内核
│   ├── memory.js          # 统一 CLI（ingest/recall/claim/relation/governance）
│   ├── memory-governor.js # M0 记忆治理（tier 维护）
│   ├── governance-plane.js # RFC 分支治理 CLI
│   ├── star-soul-core-runner.js # 星魂内核（熵减驱动 + paradigm shift 生成）
│   ├── contradiction-engine.js # 矛盾检测框架
│   ├── skill-sandbox.js  # 极轻量沙盒 + Generative TDD
│   ├── dream-entropy-worker.js # 断点续传 worker
│   ├── memory-api-server.js # REST API（PM2 部署）
│   └── claim-extractor.js # LLM Claim 三元组抽取
├── tests/
│   └── e2e-test.js       # 端到端测试（6 Phase，51 项断言）
├── topics/
│   └── memory-planet.md  # 完整架构文档
└── storage/
    └── atoms.db          # SQLite 数据库
```

---

## AI 协同开发栈

| 工具 | 角色 |
|------|------|
| **ChatGPT** | 总工程师 + 哲学家，顶层认知动力学设计 |
| **Gemini** | 首席系统架构师 + 性能优化，"异步影子编译"、"虚拟内存换页" |
| **Claude Code** | 全栈核心工程师，核心引擎编写与重构 |
| **OpenClaw** | 底座连接器与代理网关网格 |

---

## 快速开始

```bash
# 1. 安装依赖
cd scripts
npm install

# 2. 初始化数据库
node memory.js atoms ingest "你好，世界" --namespace identity

# 3. 查询记忆
node memory.js atoms recall "你好" --top 5

# 4. 运行 E2E 测试
node tests/e2e-test.js all

# 5. 启动星魂内核
node star-soul-core-runner.js status
```

---

## 架构演进

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | atoms-db + ingest/recall + τ=10 + human_pin | ✅ |
| M0.5 | recall 结果 bootstrap hook 自动注入上下文 | ✅ |
| M1 | claims/relations + GraphRAG 三元组抽取 | ✅ |
| M1.5 | sqlite-vec 向量空间（KNN） | ✅ |
| M2 | Star Soul Core 独立进程（熵减 + paradigm shift） | ✅ |
| M3 | 矛盾检测框架（LLM-as-Judge） | ✅ |
| M4 | REST API + PM2 部署 | ✅ |
| M4.5 | Skill Sandbox + Generative TDD | ✅ |
| M5 | 完整因果拓扑 + 技能投射 | ✅ |

---

## 相关论文 / 参考文献（待补充）

- 认知虚拟内存分页：[Paging](https://en.wikipedia.org/wiki/Paging)
- RRF (Reciprocal Rank Fusion)：[CFG](https://plg.uwaterloo.ca/~olczak/sigir/fusion/ComparativeStudy.pdf)
- WAL (Write-Ahead Logging)：[Wikipedia](https://en.wikipedia.org/wiki/Write-ahead_logging)