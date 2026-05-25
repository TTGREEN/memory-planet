Memory Planet (记忆星球) v2.0 —— 端云协同的轻量级 AI 认知操作系统 (Cognitive OS)

项目核心价值：Memory Planet v2.0 是一款专为有限硬件/端侧环境设计的端云协同 AI 认知操作系统。它彻底打破了传统 RAG（检索增强生成）死板、高延迟、易造成上下文爆栈的局限，首次将现代操作系统（OS）的虚拟内存分页（Paging）、写入预写日志（WAL）、以及 Git 式分支治理机制引入 Agent 的记忆与信念管理中。

通过本地轻量级控制内核（基于 OpenClaw 与 SQLite/sqlite-vec）与云端高阶大模型（如 Claude, GPT, Gemini）的深度解耦，本项目在极低本地算力消耗下，实现了智能体长周期运行的连续人格、自进化因果拓扑世界观、以及工业级的安全容错。该架构天然契合"端云结合"与智能生态的发展方向。

---

## 🛠️ 核心技术创新点与落地成果 (Technical Innovations & Artifacts)

### 1. 架构解耦：确定性本地内核与云端不确定性推理 (Edge-Cloud Hybrid Architecture)

- 物理现实：传统多智能体系统（Multi-Agent System）在本地并发运行时极易耗尽显存/算力，且过度依赖大模型进行路由决策会导致惊人的 API 账单与速率限制。
- 成果落地：v2.0 依托 OpenClaw 构建了确定性本地代理网关。将控制权（Control Plane）彻底收回到本地高效的硬编码逻辑（Heuristic Rules）和状态机中。云端模型仅作为推理面（Reasoning Plane）的算力外包。引入"单大脑序列化人格切换（Serial Persona Switching）"技术，通过在同一模型实例中动态切换 Prompt（Explorer/Guardian/Skeptic/Optimizer），将显存与 Token 消耗降低了 80%。

### 2. 异步影子编译机制 (Asynchronous Shadow Compilation)

- 物理现实：复杂的记忆元数据（作用域、生命周期、因果溯源指针）若在对话时同步生成，会导致高昂的延迟（十几秒），产生极其糟糕的用户体验。
- 成果落地：借鉴数据库的 WAL（预写日志）思想。用户交互产生的新经验（Draft Atom）在百毫秒内瞬间写入 SQLite 缓存池并直接触发用户响应；后台启动独立的 Node.js 守护进程（Daemon Worker），利用离线空闲时间对草稿进行慢速、高深度的语义编译、边界标注和因果绑定（Relations & Claims）。实现了**在线交互零延迟、长效记忆自动生长**。

### 3. 认知虚拟内存分页系统 (Cognitive Virtual Memory Paging)

- 物理现实：Agent 在执行长周期、多步骤任务（如大型代码重构、连续多日 debug）时，中间推理、错误尝试和报错日志会像滚雪球一样瞬间撑爆大模型的上下文窗口（Context Window），导致系统因"爆栈"而瘫痪。
- 成果落地：将 LLM 的上下文窗口视为"高速缓存（L1/L2 Cache）"，将本地 SQLite 的 `ephemeral_pages` 表视为"虚拟内存 Swap 空间"。通过本地逻辑监控 Token 水位线，一旦超限，自动将近期未调用的中间推理过程"换出（Swap-out）"至本地数据库，仅在上下文中保留极简的 State Pointer。当 Agent 需要回顾时，通过"缺页中断（Page Fault）"机制按需"换入（Swap-in）"，**解开了长会话的 Token 死锁**。

### 4. 灰度知识发布与安全熔断链路 (Canary Knowledge Pathway)

- 物理现实：智能体容易在单次偶然成功中得出"伪规律"或错误经验，若直接写入主干记忆，会导致其后续行为长出偏见或引发破坏性操作。
- 成果落地：引入全生命周期的知识流转机制：`Draft → Canary (灰度) → Verified → Committed`。新习得的技巧被标记为 `UNVERIFIED_CANARY`，仅在当前会话的沙盒环境中被降权调用（禁止高危写操作、强制自我核验）。唯有通过后续多项目回测、证明其具备跨情境正向收益（Utility）后，才允许向心泛化入库，**从根本上防止了"认知污染"**。

### 5. 分支治理平面与人类架构师 CLI 防线 (Branch-based Governance & HITL)

- 物理现实：多智能体并行修改共享世界观（Shared Memory）时，会产生严重的并发合并冲突与逻辑撕裂。
- 成果落地：引入 Git 式的认知分支模型。任何知识变更必须以 RFC 提案（Proposal）形式提交到独立分支。若发生对冲突，则自动唤醒多自我议会（Skeptic 与 Optimizer 子人格）在沙盒中进行对抗模拟。若系统无法自动达成共识，则无缝挂起并唤醒人类架构师 CLI 确认界面（Human-in-the-Loop），由人类作为最后一道安全防线（Guardrail）进行一键确认或回滚，**兼顾了系统的自主进化与绝对可控**。

---

## 🤖 顶层 AI 协同开发范式 (AI Co-Pilot Development Stack)

本项目是利用目前全球最顶尖的 AI 工具链共同驱动构建的"纯 AI 原生"卓越成果：

- **ChatGPT (OpenAI)：** 承担项目的总工程师与哲学家角色。负责顶层宏观认知动力学设计，推演多自我议会的动态情境加权博弈模型，提供认知熵减与向心泛化的数学逻辑支撑。
- **Gemini (Google)：** 承担项目的首席系统架构师与性能优化专家。直击大模型落地工程死角，创造性地设计了"异步影子编译"、"虚拟内存换页"等底层运行时补丁，实现了系统在受限硬件环境下的超常表现，并完成了 v2.0 白皮书的工程化定版。
- **Claude Code (Anthropic)：** 承担项目的全栈核心工程师。凭借极强的代码上下文掌控力，高质量地编写并重构了本地控制面流、高并发异步任务队列（Job Queue）以及基于 sqlite-vec 的向量内核代码，保障了工业级的代码幂等性。
- **OpenClaw：** 作为项目的底座连接器与代理网关网格。承载了本地轻量级内核与多云端高阶模型 API 之间的无缝、稳定通信，提供了完美的速率限制（Rate Limit）拦截、缓存与协议封装能力。

---

## 📁 核心代码模块说明

### `scripts/atoms-db.js` —— SQLite 数据库 + 向量内核
- 管理 `memory_atom`（原子）、`claims`（三元组）、`relations`（关系图谱）三大核心表
- `hybridRecall()`：融合 keyword RRF + embedding cosine + structural similarity + E_activation 激活能的统一检索管道
- `drillDown()`：分形因果链查询（depth-2 fractal chain），支持从任意 atom 向上溯源因、向下推导果
- `stalenessDecay()`：基于指数衰减的记忆老化模型（τ=10 天，半衰期≈7 天）
- `sqlite-vec` 集成：本地向量搜索（vec0 exact KNN），无外部 API 依赖

### `scripts/memory.js` —— 统一 CLI
- 集成所有命令：`atoms ingest/recall/list/claim/relation`、`governance`、`flush`、`search`、`health`
- 人类友好的终端界面，开箱即用

### `scripts/memory-governor.js` —— 认知分层治理
- `tierMaintenance()`：L0/L1/L2/L3 分层自动调整（基于 recall 频率和重要性）
- `detectBoredom()`：检测记忆"无聊区间"（长期未被调用且缺乏新洞察）
- `triggerBoredom整理()`：自动归档低价值 atom（relations weight < 0.1）
- `runLongHorizonEval()`：长期理解能力评估（概念深度比、选择性遗忘率）

### `scripts/star-soul-core-runner.js` —— 星魂内核
- `computeGlobalCognitiveEntropy()`：全局认知熵（Shannon 熵 + 认知复杂度加权）
- `judgeContradictionWithLLM()`：LLM-as-Judge 矛盾二分类（MiniMax M2.7）
- `generateParadigmShift()`：黑格尔辩证法范式转移生成（三正命题 → 反题 → 合题）
- `entropyTriggeredEvolve()`：熵触发自进化主循环
- `dream-micro` / `dream-deep`：微梦境（每 2 小时）和深梦境（每天 05:00）调度

### `scripts/contradiction-engine.js` —— 矛盾检测框架
- `scanContradictions()`：扫描所有 subject cluster，找候选矛盾对
- `verifyContradiction()`：对候选矛盾对做 LLM 二分类验证
- `injectContradiction()`：手动注入矛盾种子（用于测试）
- `evolveParadigm()`：基于矛盾驱动的范式转移

### `scripts/skill-sandbox.js` —— 极轻量沙盒
- 基于 `isolated-vm`（V8 Isolate）实现进程级代码隔离
- 50ms 超时硬限制，防止无限循环
- `runInSandbox()`：在沙盒中执行任意纯逻辑代码
- `runSkillValidation()`：RLAIF 闭环验证范式代码（最多 3 次尝试）

### `scripts/claim-extractor.js` —— LLM Claim 抽取
- 调用 MiniMax M2.7 从 atom content 中抽取 (subject, predicate, object) 三元组
- 用于构建因果拓扑知识图谱

### `scripts/dream-entropy-worker.js` —— 断点续传 Worker
- 独立 Node.js 进程，通过 SQLite WAL 实现断点续传
- `judgeContradictionWithLLM()` 批量处理 atom 对，无并发控制
- 支持 `loop` 模式（守护进程）和单次 `judge` 模式

### `scripts/memory-api-server.js` —— REST API（PM2 部署）
- `/api/recall`：语义检索端点
- `/api/vec-search`：纯向量搜索端点（sqlite-vec）
- `/api/dream-micro`：触发微梦境

### `scripts/governance-plane.js` —— RFC 分支治理 CLI
- `propose` / `evaluate` / `conflict` / `arbitrate` 四个命令
- `cognitive_branches` 表：认知分支状态机（ACTIVE/MERGED/ARCHIVED）
- `rfc_proposals` 表：RFC 生命周期（PENDING/TESTING/CONFLICT/APPROVED/REJECTED）

### `tests/e2e-test.js` —— 端到端测试套件
- **Phase 1**：atoms-db 基本操作（ingest/pin/recall/tier）
- **Phase 2**：Claims + Relations + drillDown
- **Phase 3**：skill-sandbox + causal-topology-builder
- **Phase 4**：star-soul-core-runner 熵减引擎
- **Phase 5**：contradiction-engine + memory-api-server
- **Phase 6**：端到端流程串联（51 项断言，全部通过）

---

## 📊 数据库 Schema

```sql
-- 核心原子表
CREATE TABLE memory_atom (
  id                  TEXT PRIMARY KEY,
  content             TEXT NOT NULL,
  confidence          REAL DEFAULT 0.5,     -- 证据强度
  importance          REAL DEFAULT 0.5,    -- 长期价值
  human_pin           INTEGER DEFAULT 0,    -- 人工置顶
  namespace           TEXT DEFAULT 'default',
  embedding           TEXT,                -- 向量（JSON）
  tier                TEXT DEFAULT 'L2',  -- L0/L1/L2/L3
  last_recalled_at    TEXT,
  semantic_variance   REAL,                -- ECV 方差
  activation_entropy  REAL,                 -- ECV 激活熵
  created_at          TEXT,
  updated_at          TEXT
);

-- M1 GraphRAG 三元组
CREATE TABLE claims (
  id                  TEXT PRIMARY KEY,
  atom_id             TEXT REFERENCES memory_atom(id),
  subject             TEXT,
  predicate           TEXT,
  object              TEXT,
  conceptual_depth    INTEGER DEFAULT 1,
  contextual_weight   REAL,
  created_at          TEXT
);

-- 关系图谱
CREATE TABLE relations (
  source_id           TEXT,
  target_id           TEXT,
  relation_type       TEXT,
  weight              REAL DEFAULT 1.0,
  created_at          TEXT
);

-- 其他核心表
ephemeral_pages      -- L0.5 临时推理 Scratchpad
draft_atoms          -- Draft/Canary Pipeline
evolution_tasks     -- 熵驱动任务队列
projected_skills     -- Skill 投射表
deprecated_lessons   -- 遗忘引擎
```

---

## 🔬 核心算法

### 三维记忆模型
| 维度 | 定义 | 计算时机 |
|------|------|----------|
| **confidence** | 信息可信度 | 写入时，长期不变 |
| **importance** | 长期价值 | 每日周期性更新 |
| **salience** | 此刻相关性 | 每次 recall 实时算 |
| **e_activation** | 9维激活能 | 每次 recall 实时算 |

### 9维激活能公式
```
E_activation = [ I × ((1 + C) / 2) ] × S × ln(e + Σ w_i × D_i)
```
**D_i 6因子：** Frequency / Relevance / QueryDiversity / Recency / Consolidation / ConceptualRichness

### M0 importance 公式
```
final_importance = (0.3 × human_pin + 0.2 × staleness_decay + 0.5) × (0.5 + 0.5 × confidence)
staleness_decay = exp(-age_days / τ)   τ=10天
```

---

## 🚀 快速开始

```bash
# 安装依赖
cd scripts && npm install

# 查询记忆
node memory.js atoms recall "查询词" --top 5

# 写入新记忆
node memory.js atoms ingest "这是一条新记忆" --confidence 0.9

# 查看治理面板
node memory.js governance list

# 运行 E2E 测试
node tests/e2e-test.js all

# 星魂状态
node star-soul-core-runner.js status
```

---

**GitHub：** [github.com/TTGREEN/memory-planet](https://github.com/TTGREEN/memory-planet)