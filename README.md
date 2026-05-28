# Memory Planet v2.1 — 记忆星球

> 面向 AI Agent 的持久化记忆系统。持久化记忆、向量检索、层级知识库、Shadow Compiler。

## 架构

```
User Input → Memory Formation Hook (DRAFT → CANARY → VERIFIED)
                        ↓
              memory_atom (L0: raw facts)
                        ↓
           Shadow Compiler (L0 → L1 synthesis)
                        ↓
              wiki_blocks (L1: structured knowledge)
                        ↓
           Ollama + sqlite-vec (embedding / recall)

Session Start → memory-inject bootstrap hook (auto-inject relevant memories)
```

## 核心文件

| 文件 | 说明 |
|------|------|
| `memory/scripts/atoms-db.js` | DB 核心：CRUD、hybridRecall、pin/resolve、shadow compiler |
| `memory/scripts/memory.js` | CLI 入口：flush / atoms / recall / session-inject / shadow-compile |
| `memory/scripts/claim-extractor.js` | claim + causal triplet 提取（M1.5 graphrag） |
| `memory/scripts/task-worker.js` | Star Soul Core 后台进程（异步 embedding / claim extraction） |
| `memory/config.json` | 向量模型配置、数据库路径等 |

## CLI 命令

```bash
node memory/scripts/memory.js atoms list --limit 10   # 列出 atom
node memory/scripts/memory.js atoms recall "query" --top 5  # 向量检索
node memory/scripts/memory.js atoms pin <id>          # 固定 atom
node memory/scripts/memory.js atoms unpin <id>        # 解除固定
node memory/scripts/memory.js atoms info <id>         # 查看详情
node memory/scripts/memory.js atoms update-importance  # 重新计算重要性
node memory/scripts/memory.js flush                   # session 结束 checkpoint

# Shadow Compiler（需先确保有 atom 数据）
node memory/scripts/memory.js shadow-compile          # 生成 wiki_blocks

# Session 注入（测试用）
node memory/scripts/memory.js session-inject "用户上次聊了什么"
```

## 依赖

- Node.js 22+
- better-sqlite3
- sqlite-vec（向量检索）
- Ollama（本地 embedding）
- OpenClaw hooks 系统

## 配置

`memory/config.json`：
- `embedding.model`: 向量模型（默认 mxbai-embed-large）
- `db.path`: atoms.db 路径
- `ollama.baseUrl`: Ollama 服务地址