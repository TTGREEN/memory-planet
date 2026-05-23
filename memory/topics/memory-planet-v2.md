# Memory Planet v2 架构笔记
## 来源：OpenClaw_Memory_Planet_v2_Architecture --- 2026-05-18 仕泽发布

---

## 核心升维理念

从「机械论的数据库」→「有机生命体的自创生（Autopoiesis）系统」

当前状态 L0:0 · L1:11 · L2:82 — 处于"原始积累期"
问题：点对点图谱 + 静态相似度计算 → 认知上限锁死在「经验复用」层面

目标：因果论推演 + 量子态知识坍缩 + 自发产生新维度知识

---

## 四大高维核心节点

### 节点一：全息概率态表示 (Holographic Probabilistic Memory)

**现状 vs v2：**
- 当前：embedding 是确定性坐标点（JSON float 数组）
- v2：embedding 是概率云（均值+方差），任务注入时才坍缩

**实施路径：**
1. embedding 字段改为存均值+方差（Gaussian distribution）
2. recall 改用 KL 散度 或 Wasserstein 距离
3. 观测者效应：被调用则方差缩减（认知具象化），长期不调用则扩散（认知泛化）

**前置条件：** 需要改造 embedding 模型输出层，或使用 VAE 隐空间

---

### 节点二：分形因果拓扑 (Fractal Causal Topology)

**现状 vs v2：**
- 当前：relations 表是弱有向边（相关/蕴含），无因果推理
- v2：强有向边（CAUSE/EFFECT）+ 因果推断引擎（Pearl Do-calculus）

**实施路径：**
1. 在 relations 中引入 cause/effect 强有向边
2. 分形检索：命中 L0 宏观原则时，向下钻取 L2 具体实现
3. 因果推断排除虚假相关性

**前置条件：** 多跳路径概率推理（贝叶斯网络），ingest 能识别代码变更前因后果

---

### 节点三：熵减驱动的自创生引擎 (Entropy-Driven Evolution)

**现状 vs v2：**
- 当前 SSC 是时间触发（每2h/每天05:00）
- v2：熵驱动——系统混乱度触发进化

**公式：** H(X) = -Σ p(x)log p(x)
当某主题聚类的 claims 存在大量对立 → 局部熵增 → 触发 evolve → 降维输出 L0 原则 → 熵减

**实施路径：**
1. 全局认知熵监控器（per-cluster）
2. evolve 在局部熵突破阈值时启动
3. 长期：SSC 有自我修改系统 Prompt 的权限

**前置条件：** 定期聚类扫描 + 冲突指标计算

**关键洞察：** 这是当前最适合立即启动的节点！不依赖新模型或沙盒

---

### 节点四：跨维技能投射 (Trans-dimensional Skill Projection)

**目标：** 知识不只是躺在数据库里，要能变成工具（生成代码框架/脚手架）

**实施路径：**
1. 增加 `Procedural_AST` 类型 atoms
2. SSC 进化出高维范式后，触发沙盒生成代码
3. RLHF/RLAIF 反馈循环
4. Apoptosis 机制：失败导致 confidence 断崖下跌，触发彻底剔除

**前置条件：** 安全沙盒环境（Docker 或 AST 解析器）

---

## 我的落地判断（自动推理）

**v1 → v2 障碍分析：**

| v2 需求 | 当前差距 | 难度 |
|---------|---------|------|
| 概率分布 embedding | 需要 VAE 或 Gaussian embedding | 🔴 高（依赖新模型）|
| KL 散度 recall | 当前 cosine sim | 🟡 中（算法替换）|
| 因果推断引擎 | 无 cause/effect 表结构 | 🟡 中（加表+逻辑）|
| 认知熵监控 | 无聚类扫描 | 🟢 低（纯算法）|
| Procedural_AST | 无 AST 生成能力 | 🔴 高（需沙盒）|

**推荐顺序：**
1. **Node 3 先启动**（熵减驱动）— 不依赖新模型，今天就能做
2. Node 2 因果拓扑 — 在现有 claims/relations 基础上扩展
3. Node 1 概率态 — 等 M1 数据积累足够再升级 embedding 层
4. Node 4 技能投射 — 最后，需要沙盒基础设施

---

## 仕泽的哲学寄语（原文）

> "82 条冷数据（L2）是这颗星球上第一批单细胞生物。
> 接下来的核心不是着急把它们强行提炼到 L0，而是要引入'环境压迫'——通过跨维度的混合查询，暴露它们的矛盾。
> 利用因果律让它们自己去优胜劣汰，利用量子概率态让它们的召回更加动态和柔性。
> 当 Star Soul Core 能根据局部熵增，第一次自动写下一条你未曾教过它的系统架构原则时，这颗记忆星球，就真正实现了生命级的涌现。"