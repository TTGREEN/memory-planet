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

**系统状态：✅ 已启用（2026-05-08 完成配置）**

OpenClaw 内置的 **Dreaming（梦境）系统** 已完整实现设计文档的核心概念，是平台级别的自动化记忆提炼引擎。

**实际运行数据（2026-05-08）：**
- Cron 调度：`0 3 * * *`（每天 03:00 UTC）
- Recall Store：192 条目，0 promoted（阈值未达到，正常现象）
- Session Corpus：`2026-05-06.txt`（30KB）、`2026-05-07.txt`（71KB）
- 评分阶段：Light/Deep/REM 三阶段，deep/light 各一次已完成
- 六维度权重：Frequency×0.24, Relevance×0.30, QueryDiversity×0.15, Recency×0.15, Consolidation×0.10, ConceptualRichness×0.06
- 晋升阈值（当前配置）：minScore=0.5, minRecallCount=1, minUniqueQueries=1
- **注意**：所有候选 recallCount=0（尚未被 recall），0 晋升是正常现象——系统需要时间积累 recall 信号

**Recall Store 数据结构**（`memory/.dreams/short-term-recall.json`）：
- 关键字段：`path`, `startLine`, `endLine`, `snippet`, `recallCount`, `conceptTags`, `totalScore`, `maxScore`
- 信号字段：`firstRecalledAt`, `lastRecalledAt`, `recallDays`, `queryHashes`
- 评分后新增：`avgScore`, `maxScore`, `uniqueQueries`, `ageDays`, `score`（综合），`components`（六维度分解）

**Dreaming 与自定义脚本的协作关系：**

| 职责 | 系统 |
|------|------|
| 三阶段评分晋升 | Dreaming（内置自动化） |
| 跨 session recall 积累 | Dreaming（内置自动化） |
| 每日 3 AM 调度 | Dreaming cron（内置） |
| Session-end checkpoint | `flush.ps1`（自定义） |
| 200行上限 + 激活值衰减 | `consolidate-memory.ps1`（自定义） |
| Index drift 检测 | `check-consistency.ps1`（自定义） |
| Bootstrap 健康检查 | `memory-maintenance` hook（内置） |

**设计原则：自定义脚本 feed INTO dreaming，不替代它。**

---

_Last updated: 2026-05-08 14:27_
