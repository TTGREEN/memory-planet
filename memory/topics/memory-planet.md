# Memory Planet 记忆星球 — 架构文档

## 版本与状态

**M0 进行中** | 最后更新：2026-05-12

---

## 核心概念

### 三维记忆模型

| 维度 | 定义 | 计算时机 | 落表 |
|------|------|----------|------|
| **confidence** | 信息可信度，证据强度 | 写入时，长期不变 | 是（memory_atom.confidence）|
| **importance** | 长期价值，长期重要度 | 每日周期性更新 | 是（memory_atom.importance）|
| **salience** | 此刻相关性，当前上下文相关度 | 每次 recall 时实时算 | 否 |

### 软门控公式

```
final_importance = importance × (0.5 + 0.5 × confidence)
```

- confidence=1.0 → 门控全开，importance 不打折
- confidence=0.5 → 门控开 75%
- confidence=0.1 → 门控开 55%（新记忆不归零）

### M0 importance 公式

```
M0_importance = 0.3 × human_pin + 0.2 × staleness_decay + 0.5
final_importance = M0_importance × (0.5 + 0.5 × confidence)

staleness_decay = exp(-age_days / τ)
τ = 10 天（半衰期 ≈ 7 天）
```

### τ 值选择

- 默认：τ=10 天（半衰期 ≈ 7 天）
- 允许范围：7-14 天
- τ=30 天适合数据量大、召回行为稳定后（M1/M2）

### human_pin 设计

- **二值 0/1**，不是累加强度
- pin=1 时，M0_importance 系数 +0.3
- pin 不锁死 staleness_decay 为 1.0，只提供下限保护

---

## 系统架构（M0）

```
对话输入
  ↓
Event Ingest Layer（memory.js ingest）
  ↓ atoms.db（./storage/atoms.db）
  ↓ 同步 → memory/daily-logs/YYYY-MM-DD.md（单向，atoms.db 为主）
  ↓
OpenClaw 原生层
  ↓
Star Soul Core M0（memory.js recall，不独立进程）
  ↓ → recall 结果
```

---

## atoms.db Schema（M0）

路径：`./storage/atoms.db`

```sql
CREATE TABLE memory_atom (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.5,
  importance  REAL NOT NULL DEFAULT 0.5,
  human_pin   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- M1 再加：event_log, relation, claim, evidence
```

---

## CLI 命令

```bash
# ingest 一个 atom
node memory.js ingest "仕泽喜欢赛博朋克风格" --confidence 0.9 --pin --type fact

# recall 测试
node memory.js recall "赛博朋克" --top 5

# 列出所有 atom
node memory.js atoms list

# pin 一个 atom
node memory.js atoms pin <atom-id>

# 批量更新 importance（每日 cron）
node memory.js atoms update-importance
```

---

## Recall 算法（M0）

```
RecallScore =
  0.4 × sim_score          (关键词命中密度)
+ 0.2 × recency           (基于 created_at 的 staleness_decay)
+ 0.2 × importance         (memory_atom.importance)
+ 0.1 × salience           (词匹配密度，实时算)
+ 0.1 × relation_density   (M0=0，没有 relation 数据)
```

权重可配置：`atoms-db.js` 的 `RECALL_WEIGHTS` 对象。

---

## 同步层设计

- **单向**：atoms.db → OpenClaw session corpus
- atoms.db 永远是主，OpenClaw 原生层是镜像
- 同步方式：每次 ingest 后 append 到 `memory/daily-logs/YYYY-MM-DD.md`
- 格式：`<!-- atom:{id} type:{type} -->{content}`

---

## M0 → M5 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | atoms.db 建表 + memory.js ingest/recall + τ=10 + human_pin 二值 | ✅ 进行中 |
| M0.5 | recall 结果通过 bootstrap hook 自动进上下文 | 🔲 待做 |
| M1 | active-memory 召回 + memory_relation/memory_claim 表 | 🔲 待做 |
| M2 | memory-wiki 编译 + governance（冲突检测、审计）| 🔲 待做 |
| M3 | Star Soul Core 独立进程（方案B）| 🔲 待做 |
| M4 | Docker 部署 + REST API | 🔲 待做 |
| M5 | 完整星魂内核（recall rank / 演化 / civilization clustering）| 🔲 待做 |

---

## 已完成

- ✅ atoms.db 建表（./storage/atoms.db）
- ✅ memory.js ingest 命令（支持 --confidence / --pin / --type）
- ✅ memory.js recall 命令（关键词召回 + 评分排序）
- ✅ atoms-db.js 核心模块（ingest / recall / importance 更新 / pin）
- ✅ 同步层（atoms.db → daily-logs/YYYY-MM-DD.md）
- ✅ 第一条测试 atom：仕泽喜欢赛博朋克风格（id: 174da478，confidence=0.9，importance=0.950，pin=1）

---

## 待解决问题

1. recall 结果如何自动进 OpenClaw 上下文？（bootstrap hook 方案）
2. importance 每日更新 cron 如何配置？（Gateway cron 或 Windows Task Scheduler）
3. 权重参数（A/B 测试）— 当前权重是拍脑袋，M1 需要用历史对话数据回测验证