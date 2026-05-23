# 知识清单 - Knowledge Manifest

> 按 Category 组织 | 最后更新：2026-05-18

---

## Core System

### openclaw_core
- **文件路径**: `~/.openclaw/` + 源码
- **Size**: ~9,361 chars
- **Key Concepts**: Agent 架构、session 管理、tool 系统、channel 接入
- **Coverage**: OpenClaw 核心框架、plugin 系统、skill 加载
- **Last Updated**: 2026-05

---

## Architecture

### memory_planet
- **文件路径**: `memory/topics/memory-system.md` + `memory/ARCHITECTURE.md`
- **Size**: 4,573 + 2,657 chars
- **Key Concepts**: Tiered Memory、Recall Pipeline、热/温/冷分层、E_activation
- **Coverage**: 记忆系统完整设计（三路召回、tier 升降级）
- **Last Updated**: 2026-05-18

### memory_planet_v2
- **文件路径**: 设计文档（TODO）
- **Size**: -
- **Key Concepts**: VAE/Gaussian embedding、Pearl Do-calculus、Docker 沙盒、RLHF 反馈
- **Coverage**: v2 规划中（4 个核心节点待实现）
- **Last Updated**: 2026-05-18

---

## Open Source Projects

### scrapling
- **文件路径**: GitHub: scrapling
- **Size**: -
- **Key Concepts**: Web scraping framework
- **Coverage**: 灵感来源：atoms_recall_pipeline 的召回模式
- **Last Updated**: -

### ruflo
- **文件路径**: GitHub: ruflo
- **Size**: -
- **Key Concepts**: -
- **Coverage**: 灵感来源：5_phase_retrieval
- **Last Updated**: -

---

## Implementation

### atoms_recall_pipeline
- **文件路径**: `scripts/atoms-db.js`
- **Key Concepts**: Hybrid Recall Pipeline、三路信号融合（recency/semantic/episodic）
- **Coverage**: 完整实现
- **Last Updated**: 2026-05-18

### e_activation
- **文件路径**: `scripts/atoms-db.js`（公式）
- **Key Concepts**: 熵减驱动激活、refStruct 结构、tier promotion
- **Coverage**: 核心公式实现
- **Last Updated**: 2026-05-18

### tier_system
- **文件路径**: `scripts/atoms-db.js`
- **Key Concepts**: M0/M1/M2 分层、promotion/subside 逻辑、s倦怠值计算
- **Coverage**: 完整实现
- **Last Updated**: 2026-05-18

### star_soul_core
- **文件路径**: `scripts/star-soul-core-runner.js`
- **Key Concepts**: 独立进程 + stdio IPC、hybrid recall、tier-driven
- **Coverage**: 完整实现
- **Last Updated**: 2026-05-18

---

## Meta

### self_improvement
- **文件路径**: `memory/daily-logs/` + `skills/self-improving/`
- **Key Concepts**: 纠错记录、模式识别、自我优化循环
- **Coverage**: 持续积累中
- **Last Updated**: 2026-05-18

### errors_and_corrections
- **文件路径**: `memory/wiki/self_corrections.md`
- **Key Concepts**: schema sync 失败、duplicate module path、PowerShell .Count 陷阱等
- **Coverage**: 2026-05-18 纠错记录
- **Last Updated**: 2026-05-18

---

## Interdisciplinary Theory

### physics_dissipative_structures
- **文件路径**: 理论文献（Ilya Prigogine）
- **Key Concepts**: 远离平衡态系统通过外部能量跃迁到更高维度有序状态
- **Coverage**: 记忆星球 L0 范式产生 = 认知系统的耗散结构跃迁
- **Last Updated**: 2026-05-18

### shannon_entropy
- **文件路径**: 信息论（Claude Shannon）
- **Formula**: H(X) = -Σ P(x_i) log P(x_i)
- **Key Concepts**: 唯一正确解时熵=0；多种冲突解时熵极大
- **Coverage**: 局部认知熵 = 记忆系统中的"混乱度"
- **Last Updated**: 2026-05-18

### hegel_dialectics
- **文件路径**: 哲学文献（G.W.F. Hegel）
- **Key Concepts**: 正反合辩证法；矛盾驱动真理跃迁
- **Coverage**: evolve() 的哲学基础
- **Last Updated**: 2026-05-18

### pearl_causal_inference
- **文件路径**: The Book of Why（Judea Pearl）
- **Key Concepts**: 因果阶梯三级：关联 → 干预 → 反事实
- **Coverage**: 分形因果拓扑（节点二）的理论基础
- **Last Updated**: 2026-05-18

### quantum_collapse
- **文件路径**: 量子力学
- **Key Concepts**: 叠加态 → 被观测 → 坍缩为确定态
- **Coverage**: 全息概率态（节点一）的隐喻基础
- **Last Updated**: 2026-05-18

### embodied_cognition
- **文件路径**: 实用主义哲学 (Pragmatism)
- **Key Concepts**: 知识最终归宿是行动；不能改变行动的"真理"等于无用信息
- **Coverage**: 跨维技能投射（节点四）
- **Last Updated**: 2026-05-18

---


_最后更新：2026-05-18_