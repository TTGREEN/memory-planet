# Memory Planet v2.0 — 认知操作系统路线图

## 来源
仕泽白皮书迭代（v1.3 Enhanced → v1.7 → v2.0 最终版）
学习完成时间：2026-05-22

## v2.0 核心哲学
- **代码驱动确定性，模型驱动不确定性**
- **小模型控制流，大模型推理流**
- 控制面（Control Plane）与数据/推理面（Data/Reasoning Plane）解耦

## 已知约束
- Node.js + SQLite（sqlite-vec）本地运行
- 有限硬件环境，算力需优化
- 生产环境不能阻塞用户对话
- 人类作为最后一道防线（Human-in-the-Loop）

---

## 实现路线图

### P0 — Heartbeat（核心心脏起搏）✅

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P0.1 | atoms-db.js CRUD | ✅ | 基础 atoms 读写 |
| P0.2 | 异步影子编译管道 | ✅ | Draft → Shadow Compiler → Verified Commit |
| P0.3 | memory-governor.js Meta-Controller | ✅ | 状态机 + 情境结界门控 |
| P0.4 | ephemeral_pages 表（Scratchpad 换页）| ✅ | L0.5 工作记忆持久化 |
| P0.5 | Canary Knowledge Pathway | ✅ | Draft → Canary → Verified → Committed |

### P1 — Memory Paging（思维分页）✅

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P1.1 | LRU Scratchpad 管理器 | ✅ | getScratchpadLRU + enforceScratchpadBudget |
| P1.2 | Page Fault 换入机制 | ✅ | pageFaultSwapIn + touchScratchpadPage |
| P1.3 | Context Watermark Monitor | ✅ | 70%水位线自动换出 |
| P1.4 | Session Termination Compression | ✅ | compressSessionScratchpad 增强 |

### P2 — Governance（人类治理）✅

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P2.1 | Governance CLI | ✅ | RFC Proposal / Merge 交互界面 |
| P2.2 | Branch-based Shared Governance | ✅ | 分支隔离 + Merge Conflict 检测 |
| P2.3 | HITL 兜底机制 | ✅ | 冲突率 > 30% 挂起等待人工确认 |

### P3 — Dream-Deep（离线演化）✅

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| P3.1 | 后台离线 Worker | ✅ | 拓扑剪枝 + 认知回归测试 |
| P3.2 | Long-Horizon Eval Harness | ✅ | 四类长期评测 |
| P3.3 | Boredom Drive | ✅ | 无聊驱动触发整理 |
| P3.4 | Federated Memory Pre-Check | ✅ | 全局晋升预检 |

---

**2026-05-22 完成：P0 → P1 → P2 → P3 全部落地 🎉**

---

## 当前实现基础（v2.0 完整版）

### 数据层（Data/Reasoning Plane）
- `atoms-db.js` — SQLite 向量+关系存储，hybridRecall + Scratchpad + Canary Pipeline ✅
- `memory-governor.js` — 三层心智状态机 + 边界门控 + Meta-Controller + Boredom Drive + Long-Horizon Eval ✅
- `memory.js` CLI — atoms 管理入口 ✅
- `memory-api-server.js` — REST API（端口 18792）✅
- `contradiction-engine.js` — 矛盾检测 ✅
- `causal-topology-builder.js` — 因果拓扑构建 ✅

### 控制层（Control Plane）
- `governance-plane.js` — RFC + HITL + Branch Governance + Federated Pre-Check ✅

---

## 核心设计决策

### 1. 写入管道（异步影子编译）
```
用户输入 → Draft Atom（瞬时写入） → 后台 Shadow Compiler → Verified Commit → Committed
```

### 2. Scratchpad 分页
```
Context Window = L1/L2 Cache
ephemeral_pages(SQLite) = Swap
Page Fault → 按需换入
Session End → Compression → 关键片段入 Memory Compiler
```

### 3. Governance 层级
```
Draft → Canary（受限，降权执行） → Verified → Committed → Deprecated/RolledBack
```

### 4. Meta-Controller 路由规则（硬编码 If/Else）
```javascript
// 简单任务 → 直接召回，不调用大模型
// 复杂推理 → 触发 Slow Path
// 高 pain_index → 绕过门控，直接写入 MINDBASE
// 未验证假说 → 进入 Canary 状态
```

---

## 参考文件
- `E:\Users\Administrator\Desktop\记忆系统迭代过程\v2最终版.txt`
- `E:\Users\Administrator\Desktop\记忆系统迭代过程\Memory_Planet_Whitepaper_v1.7.docx`
- `E:\Users\Administrator\Desktop\记忆系统迭代过程\Memory_Planet_Whitepaper_v1.6_Control_Plane_Runtime_Patch.docx`
- `C:\Users\Administrator\.openclaw\workspace\memory\scripts\AUDIT.md`
- `C:\Users\Administrator\Downloads\Memory-Planet-v1.2-Whitepaper.md`

---

_Last updated: 2026-05-22 17:30_
_状态：✅ P0 → P1 → P2 → P3 全部完成_