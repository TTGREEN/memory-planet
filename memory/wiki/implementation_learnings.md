# 实现知识点 - Implementation Learnings

> 记录日期：2026-05-18
> 用途：沉淀今日核心实现细节，供后续查阅

---

## 1. Hybrid Recall Pipeline（三路信号融合）

- **理解时间**: 2026-05-18
- **内容**: 三路独立召回信号（recency / semantic / episodic）在 recall_recall() 阶段进行加权融合，最终通过 E_total = w_r×E_r + w_s×E_s + w_e×E_e 计算综合激活值
- **出处**: `scripts/atoms-db.js` → recall_recall()
- **关键洞察**: 三路信号各自独立演化再加权融合，比单一信号更鲁棒；权重参数（w_r, w_s, w_e）可动态调整以适应不同场景
- **代码位置**: `recall_recall()` ~ line 380-420

---

## 2. E_activation 公式

- **理解时间**: 2026-05-18
- **内容**: E = E_r × (1 - 0.2×Δt_c) + E_s × ρ_ref × (1 + 0.1×episodic_count)
  - Δt_c：冷却时间增量
  - ρ_ref：引用结构权重因子（refStruct）
  - episodic_count：经验引用次数
- **出处**: `scripts/atoms-db.js` → 公式定义
- **关键洞察**: 熵减机制：系统倾向于选择更可预测、更结构化的记忆路径；引用次数越多，后续激活权重越高（马太效应）
- **代码位置**: E_total 计算块

---

## 3. _parseEmbedding 兼容 Ollama [[...]] 格式

- **理解时间**: 2026-05-18
- **内容**: Ollama 返回的 embedding 格式为 `[[0.123, -0.456, ...]]`（双层数组），需要先 JSON.parse 解析外层，再取 [0] 获取实际向量数组
- **出处**: `scripts/star-soul-core-runner.js` → _parseEmbedding()
- **关键洞察**: 不同 embedding provider 输出格式不一致，需要在入口处做标准化；只支持 Ollama，OpenAI 格式未测试
- **代码位置**: `_parseEmbedding()` ~ line 90-105

---

## 4. Tier promotion/subside 固化逻辑

- **理解时间**: 2026-05-18
- **内容**: 
  - promotion（升级）：当 E_total > threshold 且连续 N 个周期保持 → 升至上一层
  - subside（降级）：当 use_count 持续低迷或 E_total 低于下限 → 降一层
  - 双向上下界：防止频繁跳动，设置冷却期
- **出处**: `scripts/atoms-db.js` → tier promotion logic
- **关键洞察**: 升级是熵减（有序化），降级是熵增（无序化）；降级不删除数据，只是降低检查频率
- **代码位置**: `recalls_check_tier_drift()` ~ line 500-540

---

## 5. star_soul_core_runner.js 独立进程 + stdio IPC

- **理解时间**: 2026-05-18
- **内容**: star-soul-core-runner.js 作为独立 Node.js 子进程运行，通过 stdio（stdin/stdout）进行 JSON-RPC 风格通信；主进程写入命令，子进程返回结果
- **出处**: `scripts/star-soul-core-runner.js`
- **关键洞察**: stdio IPC 比 socket 更轻量，适合单机器内的 agent-to-agent 通信；需要处理 stdout 缓冲和行边界问题
- **代码位置**: 主进程 spawn + stdin.write / stdout.on('data')

---

## 6. atoms-db.js schema M0→M1 同步

- **理解时间**: 2026-05-18
- **内容**: schema 从 M0（create_at, last_access, use_count）迁移到 M1（增加 ref_struct, episodic_count, tier, E_total 等），迁移脚本处理向后兼容
- **出处**: `scripts/atoms-db.js` → migration logic
- **关键洞察**: schema 变更不是原子替换，需要 migration 脚本处理旧数据的字段映射；重复运行 migration 是幂等的
- **代码位置**: migration block ~ line 50-80

---

## 7. 熵减驱动进化的哲学含义

- **理解时间**: 2026-05-18
- **内容**: E_activation 机制本质是：用信息熵作为选择压，让记忆系统自发地向"更可预测、更结构化、更少不确定"的方向演化；这与物理熵减（生命/智能）同构
- **出处**: 跨学科洞察
- **关键洞察**: 记忆不只是存储，更是"有意义的选择"——系统在学习什么值得记住，什么值得遗忘
- **代码位置**: 理念层面，非具体代码

---

_最后更新：2026-05-18_