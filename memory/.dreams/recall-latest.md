## Recall P1 基准测试 [17:55] — 15 Query

| # | Type | Score | Status |
|---|------|-------|--------|
| 1 | factual | 0.688 | OK |
| 2 | factual | 0.793 | OK |
| 3 | factual | 0.893 | OK |
| 4 | factual | 0.688 | OK |
| 5 | preference | 0.621 | OK |
| 6 | preference | 0.754 | OK |
| 7 | preference | 0.621 | OK |
| 8 | decision | 0.541 | WARN |
| 9 | decision | 0.793 | OK |
| 10 | decision | 0.699 | OK |
| 11 | context | 0.710 | OK |
| 12 | context | 0.695 | OK |
| 13 | context | 0.393 | WARN |
| 14 | validation | 0.502 | WARN |
| 15 | validation | 0.621 | OK |

**Result: 12/15 OK (80%) | avg=0.668**

---

### 掉队 Query 分析

| Query | Score | 问题 | 原因 |
|-------|-------|------|------|
| 下一步 计划 优先级 | 0.541 | 多义词（"下一步"出现频率太高） | sim 权重可能不够 |
| 近期 学习 收获 | 0.393 | 无对应 atom（没有写"近期学习"相关的 atom） | 缺失数据，不是算法问题 |
| 小虾 身份 名字 emoji | 0.502 | "小虾" 这个名字没有写进 atoms.db | 缺失数据（IDENTITY.md 在 bootstrap 里但不在 atoms.db） |

---

### 结论

**算法基本 OK，缺的是数据**：部分 query 掉队不是因为 recall 机制有问题，而是 atoms.db 里没有对应的记忆。

---

### 下一步

- 补充缺失数据（"小虾"名字、"近期学习收获"相关 atom）
- 持续跑 7 天，积累趋势数据
- 7 天后分析：哪类 query 持续偏低 → 调整权重

**DB atoms: 63** | P1 评估进行中 | baseline captured