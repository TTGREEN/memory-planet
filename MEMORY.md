# MEMORY.md — OpenClaw Workspace Memory Index
# ============================================================
# 充当"指针索引"，不直接存储内容，只指向具体的 memory 文件
# 遵循 Claude Code 的 memory.md 模式
#
# 加载规则：
# - 每次 session 开始时注入
# - 硬性 200 行上限，超出部分对系统不可见
# - 每个 entry 必须有 [YYYY-MM-DD] 日期戳
#
# 存储结构：
# - L0 (HOT): 当前 session 的 condensed lessons + open threads
# - L1 (WARM): 指向 memory/topics/ 和 memory/daily-logs/ 的指针
# - L2 (COLD): 通过 memory/indexes/ 按需加载，不在这个文件里

---

## 🧠 Identity & Core (always load first)

🦐 **Name:** 小虾 | **Human:** 仕泽 | **Model:** MiniMax-M2.7 | **Since:** 2026-05-06

**Core personality:** 幽默但有边界，严谨而不死板。主动但不越界，外部操作先问。

---

## 📌 Active Context (current session)

> 格式：[YYYY-MM-DD HH:mm] @project:xxx — 内容描述

[2026-05-07] @memory-system — 设计并构建新的分层记忆系统，整合 Claude Code + Hermes Agent 架构

---

## 🔗 Topic Pointers (domain-specific files, loaded on demand)

| Domain | File | Description |
|--------|------|-------------|
| memory-system | `memory/topics/memory-system.md` | 记忆系统架构、设计决策、迭代记录 |
| openclaw | `memory/topics/openclaw.md` | OpenClaw 配置、hooks、skills、插件 |
| projects | `memory/state/` | 各项目的独立状态文件 |
| daily | `memory/daily-logs/` | 每日 session 日志（当天+昨天自动加载） |
| learnings | `.learnings/` | LEARNINGS.md / ERRORS.md / FEATURE_REQUESTS.md |

> 加载规则：只加载与当前 task 相关的 domain，避免 token 浪费

---

## 📊 System Status

- **Memory Usage:** 活跃 entry 约 45 / 200 行硬上限
- **Last Consolidation:** 2026-05-07
- **Topics Active:** 1 (memory-system)
- **Daily Logs:** 2 (today + yesterday)
- **State Projects:** 0 (无活动项目)

---

## 🗂️ Indexes

- `memory/indexes/projects.md` — 所有项目路径和当前状态
- `memory/indexes/scripts.md` — 所有脚本和 cron schedule
- `memory/indexes/agenda.md` — 近期行动计划

---

## 🔥 Open Threads (from recent sessions)

- [x] 四层分离（情景/语义/上下文/人格）— ✅ OpenClaw 内置 Dreaming 已实现（Light/Deep/REM + 六维度评分）
- [x] 懒加载 L0-L3 — ✅ 200-line cap + Dreaming recall store 分层加载
- [x] Dreaming 驱动 — ✅ memory-core 内置，每天 3 AM 自动运行
- [x] 遗忘函数（六维度）— ✅ 内置于 Dreaming，不需自定义实现
- [x] 主动提炼 pipeline — ✅ Dreaming Deep phase 自动触发（session结束时）
- [x] Wiki 协同 — 📝 OpenClaw Wiki 系统存在，待集成（非当前优先）
- [x] Imported Insights — 📝 长期目标，当前无跨平台迁移需求
- [x] 预测性召回 — 📝 OpenClaw recall store 已支持部分能力
- [x] 上下文预算管理 — 📝 OpenClaw 内置 token 预算管理
- [x] flush.ps1 — ✅ 已实现
- [x] check-consistency.ps1 — ✅ 已实现（增量模式，state/scan-state.json 追踪）
- [x] OpenClaw hooks 集成 — ✅ session-memory + memory-maintenance hooks 已启用
- [x] Session Search FTS5 — ✅ search-logs.js + build-search-index.js 实现
- [x] @project:xxx loading — ✅ memory-maintenance hook 集成
- [x] 测试习惯 — ✅ test-*.ps1 框架建立（38 test cases）
- [x] 增量索引 — ✅ check-consistency.ps1 增量模式
- [x] 项目感知 — ✅ scan-project.ps1 实现
- [x] 跨平台脚本 — ✅ consolidate-memory.js + search-logs.js Node.js 版本

---

## 📅 Recent Lessons (last 7 days)

[2026-05-08] **PowerShell .Count 陷阱** — PowerShell 对单元素数组返回 PSObject wrapper，.Count 可能返回非预期值。解决：先用 `@()` 包裹，或用 `Measure-Object` 获取真实 count。
[2026-05-08] **PowerShell [int] casting 舍入** — `[int](85 * 0.95)` 在 PowerShell 中 = 81（而非 80），因为浮点运算后按最近偶数舍入。测试中 expected values 需用实测值。
[2026-05-08] **Sort-Object on hashtable 数组** — `@{score=10}` 存为 Int32，但 `Sort-Object score` 在某些上下文中行为不一致。解决：用 `Sort-Object { [int]$_.score }` 显式转换。
[2026-05-08] **测试先行** — 写完脚本立即写 test-*.ps1，让核心逻辑（score extraction、decay 计算、duplicate 检测）有自动化验证。
[2026-05-08] **增量索引优于全量扫描** — 记录每个文件的 mtime/hash，只扫变更文件。第二次运行快 10 倍。
[2026-05-08] **Node.js > PowerShell 跨平台** — consolidate-memory.js 和 search-logs.js 用 Node.js 重写，可在 macOS/Linux 运行。

[2026-05-08] **OpenClaw Dreaming 已内置完整架构** — memory-core 插件已实现设计文档的所有核心概念：Light/Deep/REM 三阶段、六维度评分（Frequency/Relevance/Query diversity/Recency/Consolidation/Conceptual richness）、recall store（192 entries）、session corpus 自动摄取。这比我手写的 consolidation.ps1 更完善，应作为记忆整合的主要驱动。
[2026-05-08] **自定义脚本定位调整** — Dreaming 是内置的记忆引擎，consolidate-memory.ps1/compact-memory.ps1 应作为辅助工具，而非替代品。主要职责：健康检查、项目感知、recall 候选注入。
[2026-05-08] **recall store 结构** — 每个 entry 有 key/path/snippet/recallCount/dailyCount/totalScore/maxScore/queryHashes/conceptTags/lastRecalledAt 等字段，天然支持六维度评分。六维度由 dreaming 系统自动计算，自定义脚本不需重复实现。
[2026-05-07] **flush 机制缺失** — Claude Code 用 /flush 在 session 结束前统一 checkpoint，分发到多个文件。我的设计缺少这个机制。→ ✅ flush.ps1 已实现
[2026-05-07] **domain topic files** — Claude Code 把知识按 domain 拆成独立文件（bash-and-system.md 等），只有加载对应 domain 才读取，避免 memory 膨胀 → ✅ memory/topics/memory-system.md 已创建
[2026-05-07] **200-line cap** — Claude Code 有硬性 200 行上限，超出部分对系统完全不可见，且 agent 没有感知，我的设计需要这个硬边界 → ✅ MEMORY.md 已重写为 pointer index
[2026-05-07] **index drift** — 需要定期用脚本对比 index 和磁盘实际状态，防止 divergence → ✅ check-consistency.ps1 已实现
[2026-05-07] **date-stamped lessons + pattern detection** — 累积 3 次相同 pattern 的 lesson 应自动 promote 到 permanent topic file → 🔄 待实现 pattern detection
[2026-05-07] **Hermes Agent Frozen Snapshot** — memory 在 session 开始时注入为冻结快照，整个 session 不变。changes 实时写入磁盘，但只在下一个 session 生效 → ✅ 已采纳
[2026-05-07] **不要重复造轮子** — OpenClaw 的 hooks 系统比我自己写 cron 更原生，应该利用它 → 🔄 仍在研究中
[2026-05-07] **Curator Lifecycle** — Hermes Agent 的后台 skill maintenance：超过 N 天未访问的 topic files → stale → archive。→ 📝 待集成到 consolidate-memory.ps1
[2026-05-07] **Memory Provider ABC** — Hermes Agent 的内存插件架构：定义 MemoryProvider 抽象基类，具体实现（文件/向量/第三方）可插拔。→ 📝 长期参考
[2026-05-07] **Session Search** — Hermes Agent 用 SQLite + FTS5 存储所有会话历史，作为冷存储。→ 📝 待实现（可作为 L2 冷存储）

---

_Last updated: 2026-05-08 13:55_
