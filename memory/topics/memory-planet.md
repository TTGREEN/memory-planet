**状态：M0 ✅ | M0.5 ✅ | M1 ✅ | M1.5 ✅ | M2 ✅ | M3 ✅ | M4 ✅ | M4.5 ✅ | M5 🔄 Node 2+4 进行中**  
**最后更新：2026-05-21**

---

## 核心概念

### 三维记忆模型

| 维度 | 定义 | 计算时机 | 落表 |
|------|------|----------|------|
| **confidence** | 信息可信度，证据强度 | 写入时，长期不变 | ✅ |
| **importance** | 长期价值，长期重要度 | 每日周期性更新 + 写入时算 | ✅ |
| **salience** | 此刻相关性，当前上下文相关度 | 每次 recall 时实时算 | ❌ |
| **e_activation** | 9维激活能（白皮书公式） | 每次 recall 时实时算 | ❌ |

### 软门控公式

```
final_importance = importance × (0.5 + 0.5 × confidence)
```

### M0 importance 公式

```
M0_importance = 0.3 × human_pin + 0.2 × staleness_decay + 0.5
staleness_decay = exp(-age_days / τ)   τ=10天（半衰期≈7天）
final_importance = M0_importance × (0.5 + 0.5 × confidence)
```

---

## 9维激活能公式（白皮书 v1.0.0）

```
E_activation = [ I × ((1 + C) / 2) ] × S × ln(e + Σ w_i × D_i)
```

**D_i 6因子权重：**
- Frequency: 0.24（placeholder：基于 last_recalled_at 推算）
- Relevance: 0.30（S 的 proxy）
- QueryDiversity: 0.20（placeholder）
- Recency: 0.30（stalenessDecay 推导）
- Consolidation: 0.20（placeholder：需 Dreaming 数据）
- ConceptualRichness: 0.20（content length proxy: len/200）

**已集成到 hybridRecall** — `hybrid_rrf = hybrid + E_act × 0.1`

---

## atoms.db Schema（实际状态）

路径：`./storage/atoms.db`

```sql
-- 核心 atom 表
CREATE TABLE memory_atom (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0.5,
  importance      REAL NOT NULL DEFAULT 0.5,
  human_pin       INTEGER NOT NULL DEFAULT 0,
  namespace       TEXT NOT NULL DEFAULT 'default',
  embedding       TEXT,
  tier            TEXT NOT NULL DEFAULT 'L2',       -- L0/L1/L2/L3
  last_recalled_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- M1 GraphRAG
CREATE TABLE claims (
  id               TEXT PRIMARY KEY,
  atom_id          TEXT REFERENCES memory_atom(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  predicate        TEXT NOT NULL,
  object           TEXT NOT NULL,
  conceptual_depth INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE relations (
  source_id      TEXT REFERENCES memory_atom(id) ON DELETE CASCADE,
  target_id      TEXT REFERENCES memory_atom(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL,
  weight         REAL NOT NULL DEFAULT 1.0,
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE TABLE _meta (key TEXT PRIMARY KEY, val TEXT);
```

---

## 已实现的 recall 管道

```
hybridRecall(query)
  ├─ Keyword pipeline (RRF + MMR diversity)
  │    ├─ query expansion (中文不展开，英文5变体)
  │    ├─ keyword scoring (sim + recency + importance + pin boost)
  │    └─ RRF across variants → kw_score
  ├─ Embedding pipeline (Ollama mxbai-embed-large)
  │    ├─ cosine similarity → emb_score
  │    └─ RRF across ranked → emb_score
  ├─ Structural similarity (SequenceMatcher, 无需 embedding)
  │    ├─ keyword overlap (40%)
  │    ├─ namespace match (20%)
  │    ├─ importance proximity (20%)
  │    └─ length proximity (20%)
  ├─ Hybrid fusion (normalize kwN + embN, 加权求和)
  ├─ E_activation boost (+10% 权重)
  └─ last_recalled_at 自动更新
```

---

## CLI 命令

```bash
# ingest
node memory.js atoms ingest "记忆内容" --confidence 0.9 --namespace identity

# recall
node memory.js atoms recall "查询词" --top 5

# claims
node memory.js atoms claim add <atom-id> <subject> <predicate> <object>
node memory.js atoms claim list <atom-id>

# relations
node memory.js atoms relation add <source-id> <target-id> <type> [--weight 0.8]
node memory.js atoms relation list <atom-id>

# importance 每日更新
node memory.js atoms update-importance
```

---

## 同步层

- **单向**：atoms.db → daily-logs/YYYY-MM-DD.md
- atoms.db 永远是主
- 每次 ingest 后 append 到当日日志，格式：`<!-- atom:{id} type:{type} -->`

---

## M0 → M5 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | atoms.db 建表 + ingest/recall + τ=10 + human_pin | ✅ 完成 |
| M0.5 | recall 结果 bootstrap hook 自动注入上下文 | ✅ 完成 |
| M1 | claims/relations 表 + ingestClaim/ingestRelation API + CLI | ✅ |
| M1.5 | 向量空间（sqlite-vec vec0 KNN + /api/vec-search 端点） | ✅ |
| M2 | Star Soul Core 独立进程（stdio IPC + CLI，cron 调度） | ✅ |
| Phase 1 | 熵减驱动引擎（Shannon熵 + 熵触发 evolve + LLM-as-Judge） | ✅ |
| Phase 2 | 分形因果拓扑（extractCausalTriplets + drillDown + 因果自动抽取） | ✅ |
| 节点一平替 | 高斯相似度召回（probabilistic-recall.js，gaussianSim + temperature=20） | ✅ |
| 节点四平替 | isolated-vm 极轻量沙盒（skill-sandbox.js，V8 Isolate + 50ms超时 + RLAIF闭环） | ✅ |
| M3 | 矛盾检测框架（contradiction-engine.js：scan/verify/evolve + cron 每日 02:00） | ✅ 框架完成，待数据验证 |
| M4 | PM2 部署 + REST API（ecosystem.config.js + memory-api-server.js） | ✅ |
| 节点二 | causal-topology-builder.js（LLM 因果抽取，写入 claims + relations） | ✅ |
| 节点二 | Fractal drill-down（claims 表读取 CAUSE/FOLLOWS/PRECEDES 链 + fractalChain depth-2） | ✅ |
| 节点四 | projected_skills 表 + Generative TDD（RLAIF 闭环，最多 3 次尝试） | ✅ |
| 节点四 | star-soul-core 自动调用 skill-sandbox 对每个新 paradigm shift 生成验证代码 | ✅ |
| M5 | 完整星魂内核（因果拓扑 + 技能投射） | 🔄 Node 2+4 进行中 |

---

## 待解决问题

> 大部分已解决，剩余调参验证任务（标注 * 的需要真实数据）

1. **relation_density 权重*** — claims/relations 已积累足够数据，可调参
2. **E_activation 调参*** — 6个 Dreaming 因子需要真实数据验证权重
3. **因果拓扑密度** — causal-topology-builder 需持续运行以积累足够 CAUSE/EFFECT 链接
4. **Paradigm shift 技能验证** — projected_skills RLAIF 闭环效果待下一次 dream-entropy 触发验证

---

_Last updated: 2026-05-21_