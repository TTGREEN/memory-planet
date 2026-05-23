# 知识图谱总览

> 生成时间：2026-05-18
> 更新频率：按需（重要节点变化时更新）

---

## 知识节点列表

| ID | Name | Category | Chars | Source | Date |
|----|------|----------|-------|--------|------|
| n1 | openclaw_core | core-system | 9,361 | docs+源码 | 2026-05 |
| n2 | memory_planet | architecture | 4,573+2,657 | 设计文档 | 2026-05 |
| n3 | scrapling | open-source-project | - | GitHub | - |
| n4 | ruflo | open-source-project | - | GitHub | - |
| n5 | atoms_recall_pipeline | implementation | - | 源码 | 2026-05 |
| n6 | e_activation | implementation | - | 公式+源码 | 2026-05 |
| n7 | tier_system | implementation | - | 源码 | 2026-05 |
| n8 | star_soul_core | implementation | - | 源码 | 2026-05 |
| n9 | self_improvement | meta | - | 实践 | 2026-05 |
| n10 | errors_and_corrections | meta | - | 实践 | 2026-05 |
| n11 | memory_planet_v2 | architecture | - | 设计文档 | 2026-05 |

---

## 关系边列表

| Source | Target | Relation Type | Weight |
|--------|--------|---------------|--------|
| openclaw_core | memory_planet | INTERPRETS | 高 |
| memory_planet | openclaw_core | EXTENDS | 高 |
| memory_planet_v2 | memory_planet | EVOLVES_FROM | 高 |
| scrapling | atoms_recall_pipeline | INSPIRED | 中 |
| ruflo | 5_phase_retrieval | INSPIRED | 中 |
| atoms_recall_pipeline | memory_planet | IMPLEMENTS | 高 |
| star_soul_core | memory_planet | IMPLEMENTS | 高 |
| tier_system | memory_planet | IMPLEMENTS | 高 |
| e_activation | tier_system | DRIVES | 高 |

---

## 当前知识规模统计

- **节点总数**：11
- **关系边总数**：9
- **总字符量**：~18,000+（不含 GitHub 项目）
- **Category 分布**：
  - Core System：1
  - Architecture：2
  - Open Source Projects：2
  - Implementation：5
  - Meta：2
  - Interdisciplinary Theory：6

---

## 核心架构图

```
openclaw_core
    │
    ├── INTERPRETS ──→ memory_planet
    │                      │
    │                      ├── EXTENDS → openclaw_core
    │                      ├── EVOLVES → memory_planet_v2
    │                      │
    │                      └── IMPLEMENTED BY:
    │                              ├── atoms_recall_pipeline
    │                              ├── tier_system
    │                              └── star_soul_core
    │
    └── INSPIRED BY:
            ├── scrapling → atoms_recall_pipeline
            └── ruflo → 5_phase_retrieval

驱动关系：
e_activation ─DRIVES→ tier_system
self_improvement ← META
errors_and_corrections ← META

### 跨学科理论基础（v2落地核心）

#### physics_dissipative_structures
- name: 耗散结构理论
- category: interdisciplinary_theory
- origin: Ilya Prigogine, 热力学
- key_concept: 系统处于"远离平衡态"时，通过吸收外部能量可跃迁到更高维度的有序状态
- relevance: 记忆星球 L0 范式产生 = 认知系统的耗散结构跃迁

#### shannon_entropy
- name: 香农信息熵
- category: interdisciplinary_theory
- formula: H(X) = -Σ P(x_i) log P(x_i)
- origin: Claude Shannon, 信息论
- key_concept: 唯一正确解时熵=0；多种冲突解时熵极大
- relevance: 局部认知熵 = 记忆系统中的"混乱度"

#### hegel_dialectics
- name: 黑格尔辩证法（正反合）
- category: interdisciplinary_theory
- origin: G.W.F. Hegel
- key_concept: 没有矛盾（正与反）就不会产生更高维度的真理（合）
- relevance: evolve() 的哲学基础

#### pearl_causal_inference
- name: Pearl 因果推断（Do-Calculus）
- category: interdisciplinary_theory
- origin: Judea Pearl, The Book of Why
- key_concept: 因果阶梯三级：关联(Association) → 干预(Intervention) → 反事实(Counterfactual)
- relevance: 分形因果拓扑（节点二）的理论基础

#### quantum_collapse
- name: 量子态坍缩
- category: interdisciplinary_theory
- key_concept: 叠加态 → 被观测 → 坍缩为确定态
- relevance: 全息概率态（节点一）的隐喻基础

#### embodied_cognition
- name: 具身认知
- category: interdisciplinary_theory
- origin: 实用主义哲学 (Pragmatism)
- key_concept: 知识的最终归宿是行动，不能改变行动的"真理"等于无用信息
- relevance: 跨维技能投射（节点四）

---

## 关系边列表（扩展）

| Source | Target | Relation Type | Weight |
|--------|--------|---------------|--------|
| shannon_entropy | local_cognitive_entropy | MEASURES | 高 |
| physics_dissipative_structures | entropy_driven_evolution | EXPLAINS | 高 |
| hegel_dialectics | paradigm_shift_trigger | MOTIVATES | 高 |
| pearl_causal_inference | fractal_causal_topology | ENABLES | 高 |
| quantum_collapse | holographic_probabilistic_memory | INSPIRES | 中 |
| embodied_cognition | transdimensional_skill_projection | MOTIVATES | 高 |

---

## 当前知识规模统计（更新后）

- **节点总数**：17（+6）
- **关系边总数**：15（+6）
```

---

_最后更新：2026-05-18_