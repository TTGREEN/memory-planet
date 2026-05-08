# Topic: memory-system
# Domain-specific knowledge about this agent's memory system
# 格式规则：每个 entry 必须有 [YYYY-MM-DD]

---

## 📐 Architecture Decisions (2026-05-07)

### 三层架构（来自 Claude Code + Hermes Agent）

| Layer | Storage | Load Strategy |
|-------|---------|--------------|
| L0 (HOT) | MEMORY.md 内联 | 每次 session 注入，硬上限 200 行 |
| L1 (WARM) | memory/topics/*.md | 按需加载（@project:xxx 触发） |
| L2 (COLD) | memory/daily-logs/ + state/ | session 开始时加载当天+昨天的 daily log |

### 关键设计决策

1. **MEMORY.md = 指针索引，不存储实际内容**（Claude Code 模式）
2. **Frozen Snapshot**：session 开始时冻结，整个 session 不变。changes 实时写盘，但只在下一 session 生效（Hermes Agent 模式）
3. **200 行硬上限**：超出部分对系统完全不可见，没有感知机制
4. **date-stamped entries**：每个 entry 有 [YYYY-MM-DD]，支撑 rotation 和 pattern detection
5. **Domain Topic Files**：按 domain 拆分成独立文件，只有加载对应 domain 才读取

### 激活值衰减模型（待实现）

```
激活值范围：0-200（MAX_ACTIVATION = 200）
衰减率：0.95/week
遗忘阈值：activation < 20 → archive to daily-log
```

---

## 🔧 Components (已创建)

| Component | Path | Status |
|-----------|------|--------|
| MEMORY.md | MEMORY.md | ✅ 已更新为指针索引模式 |
| Topic Index | memory/indexes/topics.md | ✅ |
| Projects Index | memory/indexes/projects.md | ✅ |
| Daily Logs | memory/daily-logs/YYYY-MM-DD.md | ✅ |
| State Files | memory/state/*.md | 🏗️ 待实现 flush 命令 |
| Scripts | memory/scripts/ | 🏗️ 待实现 |

---

## 📋 Design Rules (来自 Claude Code ianlpaterson)

1. **Every file must be discoverable via index** — 没有 index 引用的文件等于不存在
2. **Every lesson must be date-stamped** — [YYYY-MM-DD] 格式
3. **Every write target must have a fixed schema** — 单一 writer，强制 schema
4. **Every cron job must be budgeted and alert on failure** — 失败必须报警
5. **Every index must have a staleness detector** — 定期对比 index vs 磁盘 reality
6. **Every fact lives in exactly one canonical location** — 删除副本
7. **Every file must fit its loading mechanism** — 硬边界驱动设计
8. **Don't rebuild what the platform provides natively** — 先用 OpenClaw hooks

---

## 🚧 TODOs

- [ ] **flush 命令**：session 结束前统一 checkpoint，分发到 daily-logs + topics + state
- [ ] **consolidation 逻辑**：激活值 < 20 时自动 archive
- [ ] **index drift 检测**：scripts/check-consistency.sh
- [ ] **pattern detection**：同一 pattern 出现 3 次则 promote to topic
- [ ] **cron/hooks 集成**：用 OpenClaw hooks 触发定期维护

---

## OpenClaw Dreaming Integration (2026-05-08)

### 系统概览

OpenClaw 内置的 **Dreaming（梦境）系统** 已完整实现五篇设计文档的核心概念，是平台级别的自动化记忆提炼引擎。

**实际运行数据（2026-05-08）：**
- 启用状态：`enabled: true`
- Cron 调度：`0 3 * * *`（每天 03:00 UTC = 上午 11:00 北京时间）
- Recall Store：192 条目（来自 session corpus 的语义块）
- 当前晋升数：0（阈值未达到，正常）

### 三阶段架构

| 阶段 | 文件位置 | 作用 |
|------|----------|------|
| **Light Sleep（浅睡）** | `memory/dreaming/light/YYYY-MM-DD.md` | 去重 + 候选生成；`confidence: 0.58`，`status: staged` |
| **Deep Sleep（深睡）** | `memory/dreaming/deep/YYYY-MM-DD.md` | 六维度评分 → 决定晋升；0 candidates（阈值未达）|
| **REM Sleep** | `memory/dreaming/rem/YYYY-MM-DD.md` | 跨日模式发现 → 持久洞察 |

### 六维度加权评分（Deep Sleep）

来自设计文档的实际权重：
- **Frequency（频率）** × 0.24 — recallCount 在 recall store 中的出现次数
- **Relevance（相关性）** × 0.30 — 与当前上下文的语义匹配度
- **Query Diversity（查询多样性）** × 0.15 — 不同 query hash 触发次数
- **Recency（时效性）** × 0.15 — 最后 recall 时间
- **Consolidation（巩固度）** × 0.10 — groundedCount（grounded 次数）
- **Conceptual Richness（概念深度）** × 0.06 — conceptTags 丰富程度

**晋升阈值（当前配置）：**
- `minScore: 0.8` — 综合得分需 ≥ 0.8
- `minRecallCount: 3` — recallCount 需 ≥ 3

当前所有候选 recallCount = 0，所以 0 晋升——这是**正常现象**，系统需要时间积累 recall 信号。

### Recall Store 数据结构

`memory/.dreams/short-term-recall.json` 中每条 entry 的关键字段：

```json
{
  "key": "memory:memory/.dreams/session-corpus/2026-05-07.txt:35:35",
  "path": "memory/.dreams/session-corpus/2026-05-07.txt",
  "startLine": 35,
  "endLine": 35,
  "snippet": "Assistant: 收到，仕泽！🦐 开始干活。...",
  "recallCount": 0,
  "dailyCount": 1,
  "groundedCount": 0,
  "totalScore": 0.58,
  "maxScore": 0.58,
  "firstRecalledAt": "2026-05-08T00:51:13.010Z",
  "lastRecalledAt": "2026-05-08T00:51:13.010Z",
  "conceptTags": ["收到", "开始", "干活", ...]
}
```

### Session Corpus 位置

`memory/.dreams/session-corpus/YYYY-MM-DD.txt`
- 当前有：`2026-05-06.txt`（30KB）和 `2026-05-07.txt`（71KB）
- 当前 session（2026-05-08）正在进行，UTC 日期为 2026-05-07，所以写入 `2026-05-07.txt`
- Corpus 按 **UTC 日期**归档，不是本地日期

### 与自定义脚本的协作关系

**Dreaming 负责（自动化）：**
- 三阶段评分和晋升
- 跨 session 的 recall 积累
- 每日 3 AM 定时运行
- 六维度信号的自动收集

**自定义脚本负责（半自动化）：**
- `flush.ps1` — session-end checkpoint，手动触发
- `consolidate-memory.ps1` — MEMORY.md 200行上限检查 + 激活值衰减
- `check-consistency.ps1` — index drift 检测
- `memory-maintenance` hook —  bootstrap 时运行健康检查 + 建议 session ingestion

**设计原则：自定义脚本 feed INTO dreaming，不替代它。**
- Dreaming 的 session-corpus 由 OpenClaw 自动 ingestion
- 自定义脚本产生的内容（daily-logs、topic files）通过 MEMORY.md 指针体系被 dreaming 间接引用
- 两套系统互补而非重叠

### Per-Project Context 的现状

当前 OpenClaw **不支持多 workspace 级别的内存隔离**。`memory/state/` 目录存在但为空，无项目级别的内存文件。`@project:xxx` 触发机制用于加载 topic 文件，不提供 workspace 隔离。

架构上，`memory/state/<project>.md` 是为将来项目准备的，但当前所有记忆都在单一 workspace 内管理。

_Last updated: 2026-05-08 14:00_
