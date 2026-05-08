# Deep Learning Report — Claude Code + Hermes Agent 源码分析
# 生成时间: 2026-05-07
# 目标: 深度分析源码，提取可集成的架构设计

---

## 一、源码分析摘要

### Hermes Agent 源码结构（来自 AGENTS.md 开发文档）

```
hermes-agent/
├── run_agent.py              # AIAgent — 核心对话循环 (~12k LOC)
├── model_tools.py            # Tool 发现、分发、handle_function_call
├── hermes_state.py           # SessionDB — SQLite + FTS5 会话存储
├── agent/
│   ├── memory_manager.py     # 内存管理器编排
│   ├── memory_provider.py    # 内存提供者 ABC（插件基类）
│   ├── context_engine.py     # ContextEngine ABC（可插拔）
│   ├── context_compressor.py # 默认引擎 — 有损摘要
│   ├── prompt_builder.py     # 系统 prompt 装配
│   └── prompt_caching.py     # Anthropic prompt caching（cache breakpoints）
├── plugins/memory/           # 内存提供者插件（honcho, mem0, openviking...）
├── cron/                     # 调度器（jobs.py, scheduler.py）
└── gateway/session.py         # 会话持久化
```

### 关键架构发现

#### 1. Memory Provider 插件架构（最值得借鉴）

```
memory_manager.py   ← 编排层
       ↑
memory_provider.py  ← ABC（抽象基类），定义接口
       ↑
plugins/memory/     ← honcho.py, mem0.py, openviking.py...（具体实现）
```

**设计模式**：熟悉的插件模式。OpenClaw 的 hooks 系统已经是这个思路。

**可借鉴**：我的记忆系统应该定义一个 `MemoryProvider` 抽象接口，然后
文件型、向量型、第三方 API 型都可以作为具体实现插件。

#### 2. SessionDB + FTS5（Hermes 的会话搜索）

```python
# hermes_state.py — SQLite session store with FTS5
hermes_state.py  # SessionDB — SQLite session/store (FTS5 search)
gateway/session.py  # SessionStore — conversation persistence
```

**设计**：所有 CLI 和 messaging sessions 都存在 SQLite + FTS5。
agent 可以用 `session_search` 工具搜索历史对话。

**可借鉴**：OpenClaw 的会话历史可以用类似方式处理。
我目前的方案没有会话搜索能力——这是个明显缺失。

#### 3. Context Compression（上下文压缩）

```
agent/context_compressor.py   # Default engine — lossy summarization
agent/context_engine.py       # ContextEngine ABC (pluggable)
```

**设计**：当 context 超过阈值时，ContextEngine 会做有损摘要压缩。
这是一个独立的可插拔组件。

**可借鉴**：我的 200-line cap 本质上是一个硬压缩，但缺少智能摘要逻辑。
未来可以实现一个 `ContextCompressor`，当 MEMORY.md 接近 200 行时，
自动把低激活值 entries 压缩成更短的表述。

#### 4. Cron 系统（持久化定时任务）

```
cron/
├── jobs.py        # 任务定义 + 持久化（jobs.json）
└── scheduler.py   # 调度器
```

**设计**：
- 调度器 tick → 从 jobs.json 加载到期任务
- 创建 fresh AIAgent（无历史）
- 注入 attached skills 作为 context
- 运行 job prompt → 投送到目标 platform
- 更新 job state 和 next_run

**可借鉴**：OpenClaw 的 `cron` 工具（我已经看到过）可以做类似的事。
我的 consolidation 脚本可以作为 cron job 调度。

#### 5. Prompt Caching（Anthropic 特有）

```
agent/prompt_caching.py   # Anthropic cache breakpoints for prefix caching
```

**设计**：利用 Anthropic 的 cache control 特性，把不变的 system prompt 前缀
标记为 cacheable，减少每次 API 调用的 token 成本。

**可借鉴**：Frozen Snapshot 模式已经在做了（session 开始时注入，整 session 不变）。
但我还没有利用 cache control 特性——如果 OpenClaw 支持，这是一个优化方向。

---

## 二、Claude Code 源码分析（来自泄露 + 博客深度解读）

### 三层内存架构（已确认）

```
L1: In-Context Memory
  └─ 当前 context window，session 结束消失

L2: External File Memory (memory.md = Pointer Index)
  └─ memory.md 指向 domain-specific 文件：
     memory/project-context.md
     memory/decisions.md
     memory/code-patterns.md
     memory/user-preferences.md

L3: CLAUDE.md（项目级静态配置）
  └─ 每个项目目录的 CLAUDE.md，session 开始优先读取
```

### ianlpaterson 22天实践中提炼的 8 条设计规则（深度解读）

1. **Every file must be discoverable via index**
   → 没有 index 引用 = 对系统不存在
   → 我的方案：MEMORY.md 作为 pointer index，topics/indexes 目录

2. **Every lesson must be date-stamped [YYYY-MM-DD]**
   → 日期驱动 rotation 和 pattern detection
   → 我的方案：已采纳

3. **Every write target must have a fixed schema**
   → 单一 writer 强制执行 schema，避免格式漂移
   → flush.ps1 是唯一 writer

4. **Every cron job must be budgeted and alert on failure**
   → 静默失败不可接受
   → 我的方案：check-consistency.ps1 检测问题，需要接入报警

5. **Every index must have a staleness detector**
   → index 会 drift，必须定期对比 reality vs index
   → 我的方案：check-consistency.ps1 部分覆盖

6. **Every fact lives in exactly one canonical location**
   → 删除副本，保持单一真相源
   → 我的方案：MEMORY.md 只存指针，实际内容在 topic files

7. **Every file must fit its loading mechanism**
   → 200-line cap 是硬边界，驱动所有设计决策
   → 我的方案：已采纳

8. **Don't rebuild what the platform provides natively**
   → 先搞清楚平台内置了什么，再建自定义的
   → 我的方案：应该优先研究 OpenClaw hooks

---

## 三、我的系统对比分析

### 当前系统状态

| 组件 | 状态 | 来源 |
|------|------|------|
| MEMORY.md pointer index | ✅ | Claude Code |
| 200-line hard cap | ✅ | Claude Code |
| Frozen Snapshot | ✅ | Hermes Agent |
| Date-stamped lessons | ✅ | ianlpaterson |
| Domain topic files | ✅ | Claude Code |
| flush.ps1 | ✅ | ianlpaterson |
| Daily logs | ✅ | ianlpaterson |
| Project state files | ✅ | ianlpaterson |
| check-consistency.ps1 | ✅ | ianlpaterson |
| consolidate-memory.ps1 | 🏗️ stub | 自研 |
| Index drift detection | 🏗️ partial | 自研 |
| Pattern detection (3x promote) | ❌ | 缺失 |
| OpenClaw hooks 集成 | ❌ | 缺失 |
| Context compression | ❌ | 缺失 |
| Session search (FTS5) | ❌ | 缺失 |
| @project:xxx topic loading | ❌ | 缺失 |
| Memory provider plugin 架构 | ❌ | 缺失 |

### 新学到且值得集成的设计

#### 1. Curator Skill Lifecycle（来自 Hermes Agent）

Hermes Agent 有一个 background skill maintenance 系统：

```
curator/
  enabled: true
  interval_hours: X
  min_idle_hours: X
  stale_after_days: X      # 多久不活跃算 stale
  archive_after_days: X    # 多久后 archive
  backup:
```

**可借鉴**：我的 consolidate-memory.ps1 应该增加 curator 的逻辑：
- 检查每个 topic file 的最后修改时间
- 超过 N 天没访问的 → 标记为 stale
- 超过 M 天 stale → 移动到 archive/

#### 2. Session Search 作为 L2 冷存储（来自 Hermes Agent）

Hermes Agent 用 SQLite + FTS5 存储所有会话历史，
agent 可以用 `session_search` 工具搜索。

**可借鉴**：
- OpenClaw 的会话历史可以存入 SQLite + FTS5
- 作为 L2 冷存储：MEMORY.md 和 topic files 是"热"和"温"存储
-  session history 是真正的"冷"存储，只有搜索时才查

#### 3. Memory Provider 插件化（来自 Hermes Agent）

```python
# memory_provider.py — ABC
class MemoryProvider(ABC):
    def inject_context(): ...    # 注入到 system prompt
    def prefetch(): ...          # 每轮前预先抓取相关记忆
    def sync(): ...              # 同步对话到 provider
    def extract(): ...           # session 结束时提取记忆
```

**可借鉴**：我的记忆系统可以定义：
```javascript
// 轻量版 MemoryProvider 接口
interface MemoryProvider {
  load(memory: MemoryContext): Promise<void>   // 加载到 context
  save(entry: MemoryEntry): Promise<void>     // 写入新记忆
  search(query: string): Promise<MemoryEntry[]>  // 搜索
}
```

#### 4. Flush 的精确时机（来自 ianlpaterson）

ianlpaterson 的 flush 时机：
- 在 session 结束时运行，不是在每句话之后
- context 快满的时候先 flush 再 compact
- flush 只写入关键内容，不写废话

**可借鉴**：我的 flush.ps1 应该：
- 接受一个 `-Compact` flag：flush 后触发 compact
- 日志格式更精简，不写流水账

---

## 四、具体建议：我们的记忆系统应该如何改进

### 短期可实现（1-2 天）

#### 1. 增强 consolidate-memory.ps1

```powershell
# 增加以下逻辑：
# 1. stale detection：检查 topic files 最后修改时间
#    → 超过 30 天未访问的 → stale 标记
# 2. archive 执行：移动 stale entries 到 archive/
# 3. score decay：所有 score 乘以 0.95^weeks_elapsed
# 4. 简单 pattern detection：扫描相似 lesson 出现 3+ 次
```

#### 2. 实现 check-consistency.ps1 的完整版

```powershell
# 当前问题：PowerShell param 语法在 -ExecutionPolicy Bypass 下报错
# 解决：把脚本内容直接写入文件，用 -Command 执行
# 完整功能：
# 1. MEMORY.md 行数检查
# 2. topic files 存在性检查
# 3. index vs disk reality 对比
# 4. daily-logs 完整性检查（最近 7 天是否有记录）
# 5. scripts 存在性检查
# 6. 输出结构化结果供 cron 解析
```

#### 3. @project:xxx topic loading 机制

```powershell
# 在 session 开始的 bootstrap 流程中：
# 1. 读取 MEMORY.md 的 Active Context section
# 2. 提取 @project:xxx 模式
# 3. 根据 projects.md index 找到对应的 state file
# 4. 加载相关 topic files（domain mapping）
# 注意：这需要 OpenClaw 在 bootstrap 时支持自定义注入逻辑
```

### 中期目标（1 周）

#### 4. Context Compression（智能压缩）

```powershell
# 当 MEMORY.md 接近 200 行时（比如 >180 行）：
# 1. 识别低激活值 entries（score < 50）
# 2. 把这些 entries 压缩成更短的表述
# 3. 例如：
#    原始：[2026-05-01] [score:30] 在 Windows Server 上使用 Chocolatey 安装 Docker Desktop 的步骤有些繁琐，需要手动启动 Docker Desktop 服务
#    压缩：[2026-05-01] [score:30] Win Server + Chocolatey + Docker Desktop 启动繁琐（详见 memory/topics/docker.md）
```

#### 5. Session Search（会话历史搜索）

```powershell
# 利用 PowerShell + SQLite（或者简化的文本搜索）：
# 1. 每天的 daily-logs 建立索引
# 2. 支持 "search memory '关键词'" 查询
# 3. 返回相关 daily-log entries
```

#### 6. OpenClaw Hooks 集成

```powershell
# 利用 agent:bootstrap 钩子触发定期维护检查：
# 1. 每次 bootstrap 时检查"上次 consolidation 是否超过 7 天"
# 2. 如果超过，执行 consolidation
# 3. 这样就不需要外部 cron 了
```

### 长期目标（待定）

#### 7. Memory Provider 插件化

```javascript
// 抽象接口
interface MemoryProvider {
  load(context: MemoryContext): Promise<void>
  save(entry: MemoryEntry): Promise<void>  
  search(query: string): Promise<MemoryEntry[]>
  archive(entry: MemoryEntry): Promise<void>
}

// 实现
class FileMemoryProvider implements MemoryProvider { ... }  // 当前方案
class SqliteMemoryProvider implements MemoryProvider { ... }  // 未来支持 FTS5
class VectorMemoryProvider implements MemoryProvider { ... }  // 第三方向量存储
```

#### 8. Multi-Agent Memory（来自 Hermes Agent Issue #377）

Hermes Agent 的 roadmap 上有一个 "Shared Memory Pools between sub-agents"：

```
多个 sub-agents 之间共享 memory pool
→ 一个 agent 学到的教训，其他 agent 也能看到
→ 避免重复踩坑
```

**可借鉴**：如果未来 OpenClaw 支持多 agent 协作，
MEMORY.md 可以变成一个共享的 memory pool，
每个 agent 写入时需要加锁或使用 append-only 模式。

---

## 五、总结：我学到了什么，进步在哪里

### 学到的核心认知

1. **架构比实现更重要** — Claude Code 的 memory 架构是"pointer index + domain files"，这是一个设计选择，不是一个技术难度问题。这个架构让 memory 可以无限扩展而不影响加载速度。

2. **Frozen Snapshot 是性能优化的关键** — Hermes Agent 发现 session 开始时冻结 memory injected，可以利用 LLM 的 prefix cache 性能。这个优化不需要任何额外资源。

3. **Write discipline 比 Write capability 更重要** — ianlpaterson 的 flush 设计：单一 writer，强制执行 schema。这防止了 memory 文件随时间腐化（drift）。

4. **平台内置的功能要优先利用** — 不要重复造轮子。OpenClaw 的 hooks、cron、session 存储都是平台能力，应该优先集成。

5. **Index 是记忆系统的骨架** — 有了 index，memory 才是可发现、可审计、可维护的。没有 index 的 memory 等于不存在。

### 进步

| 方面 | 之前 | 现在 |
|------|------|------|
| 架构理解 | 知道有三层存储 | 理解了三层的加载策略和边界 |
| 设计决策 | 拍脑袋 | 有 8 条设计规则可循 |
| 源码阅读 | 只看 README | 能从开发文档读出架构设计意图 |
| 实践检验 | 空想 | 有 ianlpaterson 的 22 天实践经验支撑 |
| 工具选择 | 什么都要自己写 | 优先用 OpenClaw 平台能力 |

### 下一步行动

明天讨论后，如果同意方向，我会：

1. **Day 1**：修复 check-consistency.ps1，实现完整版
2. **Day 2**：实现 pattern detection（3x promote）
3. **Day 3**：集成 OpenClaw hooks，实现 bootstrap 维护触发
4. **Day 4**：实现 context compression（接近 200 行时自动压缩）
5. **Day 5**：实现 session search（FTS 或文本搜索）

---

_Last updated: 2026-05-07 18:30_