# OpenClaw 全体系知识库

> 小虾整理 | 最后更新：2026-05-13
> 来源：官方文档 + 源码分析

---

## 核心架构

### Gateway（消息中枢）

- **单一常驻进程**，掌控所有消息渠道（WhatsApp/Telegram/Discord/Signal/iMessage/WebChat/...）
- 控制平面客户端（macOS app / CLI / web UI）通过 **WebSocket** 连接（默认 `127.0.0.1:18789`）
- Nodes（macOS/iOS/Android/headless）也用 WebSocket 连接，声明 `role: node`
- Canvas host 服务于 Gateway HTTP 端口：`/__openclaw__/canvas/`
- 认证：shared-secret token 或 Tailscale Serve / trusted-proxy 模式

### Agent（运行时）

- Pi-agent-core 运行时执行 agent turns
- 支持模型：OpenAI / Anthropic / Ollama / OpenRouter / 本地模型等
- 工具系统：LLM 调用工具（read/exec/web_search 等）

### Session（会话隔离单位）

- 路由规则：
  - DMs → 默认共享 session（`main`）
  - Group chats → 按 group 隔离
  - Cron → fresh session per run
- 关键时间戳：
  - `sessionStartedAt`：每日重置基准（4AM 本地时间）
  - `lastInteractionAt`：idle timeout 基准
  - heartbeat/cron/exec **不**延长这两个时间

---

## 内存系统

### 三层架构

| 层 | 文件 | 说明 |
|----|------|------|
| L0 长期 | `MEMORY.md` | 200 行硬上限，每次 session 自动注入 |
| L1 每日 | `memory/YYYY-MM-DD.md` | 今天+昨天自动加载 |
| L2 Dreaming | `DREAMS.md` | Dreaming 输出，人类可读日志 |

**核心原则：模型只能看到写入磁盘的内容，OpenClaw 不跟踪内部状态**

### memory_search

- **Hybrid search**：向量相似度 + BM25 关键词
- 需要 embedding provider（OpenAI/Gemini/Ollama/Voyage/Mistral/Copilot）
- OpenClaw auto-detect API key，自动启用
- 支持 provider：`openai` / `gemini` / `ollama` / `local`（GGUF） / `bedrock` / `github-copilot` / `mistral` / `voyage`

### Dreaming（后台记忆整理）

- **Opt-in**，默认关闭
- 三相模型：
  1. **Light**：收集信号，staging 不写盘
  2. **Deep**：评分 promote 到 MEMORY.md（阈值：minScore + minRecallCount + minUniqueQueries）
  3. **REM**：主题反射，写入 DREAMS.md 日记，不写盘

**Deep ranking 六信号权重：**

| 信号 | 权重 | 说明 |
|------|------|------|
| Frequency | 0.24 | 短期信号积累次数 |
| Relevance | 0.30 | 平均检索质量 |
| Query diversity | 0.15 | 触发 recall 的不同 query 数 |
| Recency | 0.15 | 时间衰减新鲜度 |
| Consolidation | 0.10 | 多日重复强度 |
| Conceptual richness | 0.06 | 概念标签密度 |

### Active Memory 插件

- 在主回复**之前**运行的 blocking memory sub-agent
- 提升 reactive memory 的自然度（不用等用户说"记得..."）
- 配置：
  ```json
  {
    "plugins": { "entries": { "active-memory": {
      "enabled": true,
      "config": {
        "agents": ["main"],
        "allowedChatTypes": ["direct"],
        "modelFallback": "google/gemini-3-flash",
        "queryMode": "recent",
        "timeoutMs": 15000
      }
    }}}
  }
  ```
- 注入方式：`before_prompt_build` hook 注入 `prependContext`

---

## Hook 系统

### 两类 Hooks

| 类型 | 触发场景 | 使用方式 |
|------|---------|---------|
| **Internal hooks** | Gateway 事件（command:new/reset/stop、gateway:startup、agent:bootstrap） | `~/.openclaw/hooks/` + `openclaw hooks enable <name>` |
| **Plugin hooks** | agent 内部生命周期 | TypeScript plugin，通过 `api.on()` 注册 |

### Internal Hooks 事件列表

| 事件 | 触发时机 |
|------|---------|
| `command:new` | `/new` 命令 |
| `command:reset` | `/reset` 命令 |
| `command:stop` | `/stop` 命令 |
| `agent:bootstrap` | bootstrap 文件加载后、系统 prompt 生成前，**可修改 bootstrapFiles** |
| `gateway:startup` | channels 启动 + hooks 加载完成后 |
| `gateway:shutdown` | Gateway 开始关闭 |
| `message:received` | 任意渠道收到消息 |
| `session:compact:before/after` | compaction 前后 |

### Plugin Hooks 关键事件

| Hook | 阶段 | 可返回 |
|------|------|--------|
| `before_model_resolve` | session 消息加载前 | `providerOverride` / `modelOverride` |
| `before_prompt_build` | session 消息已加载，prompt 提交前 | `prependContext` / `appendContext` / `systemPrompt` |
| `before_tool_call` | tool 执行前 | `block: true`（终止）/ `params`（改写）/ `requireApproval` |
| `before_agent_reply` | 模型调用前 | synthetic reply 或 silence |
| `after_tool_call` | tool 执行后 | 观察结果 |
| `agent_end` | agent turn 结束后 | 观察，无权修改 |
| `session_start/session_end` | session 生命周期边界 | 观察 |
| `gateway_start/gateway_stop` | Gateway 生命周期 | 启动/清理插件服务 |

### 决策规则（关键！）

- `block: true` / `cancel: true` = **terminal**，终止后续 handler
- `block: false` / `cancel: false` = **no-op**，不覆盖已有决定
- `priority` 数值越高越先执行

### agent:bootstrap 的限制

- 在 bootstrap 文件加载后、系统 prompt 生成前触发
- **可以修改 `context.bootstrapFiles` 数组**（增删文件）
- **不能**在 session 开始后动态注入 recall 结果到当前 context
- 因为这时候 prompt 还没有组装完成，没有 channel/session context

### M0.5 的最佳候选：before_prompt_build

- session 消息已加载，在 prompt 提交给模型之前
- **可返回 `prependContext`**，每次 turn 都会添加到 context 开头
- 是目前看到的最可能实现 M0.5 注入 recall 结果的 hook

---

## Heartbeat 系统

### 机制

- 定期主 session agent turn（**默认 30m**）
- 读取 `HEARTBEAT.md` 检查清单
- 回复 `HEARTBEAT_OK` 静默，有内容则发送到 `target`
- `isolatedSession: true` 可开启 fresh session（省 token）
- `lightContext: true` 只注入 HEARTBEAT.md（最省 token）

### HEARTBEAT.md tasks block

```markdown
tasks:
- name: inbox-triage
  interval: 30m
  prompt: "Check for urgent unread emails"
- name: calendar-scan
  interval: 2h
  prompt: "Check upcoming meetings"
```

- 只执行到期的 task，避免每次全量运行
- task 时间戳存在 session state（`heartbeatTaskState`）

### activeHours

```json
{ "activeHours": { "start": "09:00", "end": "22:00", "timezone": "Asia/Shanghai" } }
```

- 限制心跳只在指定时段运行，省 token

---

## Cron 系统

### 执行风格

| 风格 | `--session` 值 | 特点 |
|------|---------------|------|
| Main session | `main` | system event 唤醒下次 heartbeat |
| Isolated | `isolated` | 独立 fresh session（`cron:<jobId>`） |
| Current | `current` | 绑定创建时 session |
| Custom | `session:<id>` | 持久化 named session |

### isolated run 特性

- 创建独立 `cron:<jobId>` session
- 带 session retention 清理（默认 24h）
- **Stagger**：top-of-hour cron 自动 stagger 5min 避免峰值
- **Provider preflight**：Ollama 等 loopback provider down 时 skip（不失败），5min 缓存结果
- 支持 `--tools` 限制工具集

### 投递模式

| 模式 | 行为 |
|------|------|
| `announce` | agent 未主动发则 runner 补发 |
| `webhook` | POST finished event 到 URL |
| `none` | 仅运行，无投递 |

### 时间格式

- `--at "2026-05-13T16:00:00+08:00"`：带时区
- `--at "20m"`：相对时间（20 分钟后）
- `--cron "0 6 * * *"`：crontab 表达式
- **注意**：day-of-month 和 day-of-week 是 **OR 逻辑**（不是 AND）

---

## Compaction 系统

### 触发时机

- **Auto**：context 接近 limit（context_overflow 错误自动重试）
- **Manual**：`/compact [指令]`
- compaction 前自动 memory flush（提醒 agent 保存重要 notes）

### 核心概念

- **Compaction** = 总结旧消息，保留于 transcript（summarize + replace）
- **Pruning** = 裁剪 tool output，不保存（trim only），更轻量
- Successor transcripts：`truncateAfterCompaction: true` 不覆盖原文件，创建新 active + 归档旧的
- 保留策略：`compaction.memoryFlush.model` 可指定本地模型做 memory flush

### 工具调用配对保护

OpenClaw 在 split 时保证 tool call 和 toolResult 配对不会拆分

---

## Plugin SDK

### 导入规范（重要！）

```typescript
// ✅ 正确：从具体子路径导入
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// ❌ 错误：禁止直接从 openclaw/plugin-sdk 导入
import { ... } from "openclaw/plugin-sdk"; // 循环依赖！
```

### 独占 Slot（只能有一个插件注册）

- `registerContextEngine(id, factory)`
- `registerMemoryCapability(capability)`
- `registerMemoryPromptSection(builder)`
- `registerMemoryFlushPlan(resolver)`
- `registerMemoryRuntime(runtime)`
- `registerMemoryEmbeddingProvider(adapter)`

### Plugin 可注册的内容

| 方法 | 功能 |
|------|------|
| `registerTool(tool, opts?)` | Agent tool |
| `registerCommand(def)` | 绕过 LLM 的命令 |
| `registerHook(events, handler, opts?)` | 生命周期 hook |
| `registerHttpRoute(params)` | Gateway HTTP 端点 |
| `registerGatewayMethod(name, handler)` | Gateway RPC 方法 |
| `registerService(service)` | 后台服务 |
| `registerSessionExtension(...)` | 插件私有 session state |
| `enqueueNextTurnInjection(...)` | 下一次 turn 注入 exactly-once |
| `registerTrustedToolPolicy(...)` | 可信的 tool policy（bundled only） |

### allowConversationAccess

外部插件使用 `llm_input` / `llm_output` / `before_agent_finalize` / `agent_end` 必须设置：

```json
{ "plugins": { "entries": { "my-plugin": { "hooks": { "allowConversationAccess": true } } } } }
```

---

## Config 优先级

```
per-account > per-channel > channel defaults > agents.list[] > agents.defaults > 内嵌默认
```

---

## 与 Memory Planet 的关系

### 关键发现

1. **bootstrap hook 不能动态注入 recall 结果**
   - `agent:bootstrap` 在 session 开始时触发，但这时候还没有 channel/session context
   - 无法根据当前 query 动态生成 recall 结果

2. **M0.5 的最佳候选：before_prompt_build**
   - 在每次 prompt 构建时触发，session 消息已加载
   - 可返回 `prependContext` 注入 recall 结果
   - 每次 turn 都会添加，是实现"在 session 开始时注入相关记忆"的正确位置

3. **Heartbeat 是最快看到效果的路径**
   - 30m 间隔，`isolatedSession: true` 可大幅省 token
   - 但无法主动在 session 开始时注入

4. **memory-core 已内置 Dreaming + memory_search**
   - Dreaming 六信号评分已完整实现
   - memory_search hybrid search 已完整实现
   - Active Memory 已内置 blocking recall sub-agent
   - **不需要重复造轮子**，Memory Planet 应该站在巨人肩上

5. **HEARTBEAT.md tasks block 是更好的心跳任务管理**
   - 比当前的 `heartbeat-state.json` 轮询方式更 native
   - 值得参考

---

## CLI 常用命令

```bash
openclaw status              # 状态概览
openclaw gateway status      # Gateway 状态
openclaw sessions --json     # 所有 session
openclaw cron list           # Cron 任务列表
openclaw cron runs --id <id> --limit 20  # Cron 执行历史
openclaw hooks list          # 所有 hooks
openclaw hooks enable <name> # 启用 hook
openclaw memory status       # 记忆系统状态
openclaw memory promote      # 预览/应用 memory promote
openclaw logs --follow       # 实时日志
openclaw doctor              # 诊断
```

---

_Last updated: 2026-05-13_