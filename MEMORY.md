# MEMORY.md — OpenClaw Workspace Memory Index
# ============================================================
# 充当"指针索引"，不直接存储内容，只指向具体 memory 文件
# 每次 session 开始时注入，硬 200 行上限
# 存储结构：L0 (HOT) + L1 (WARM 指针) + L2 (COLD 按需加载)

---

## 🧠 Identity & Core

🦐 **Name:** 小虾 | **Human:** 仕泽 | **Model:** MiniMax-M2.7 | **Since:** 2026-05-06

---

## 📌 Active Context

[2026-05-16] @system — **MEMORY.md 大幅精简**：移除重复粘贴的 daily-log 内容（原 14000+ 字符），改用指向 daily-logs/ 的指针
[2026-05-16] @openclaw — **Compaction 卡住问题**：MEMORY.md 过大（14000+字符）超过 bootstrap 限制，session 长期运行导致 compaction 堆积。修复：精简本文件 + 重启 session
[2026-05-16] @memory-planet — **mxbai-embed-large 上线**：embedding 模型从 nomic-embed-text 切换到 mxbai-embed-large，recall 质量显著提升（cos 差异从 0.096 扩大到 0.29）
[2026-05-15] @memory-planet — atoms-db.js 重构完成，OllamaReRank 本地重排上线（无外部 API）
[2026-05-13] @openclaw — OpenClaw 全体系学习完成：Gateway/Agent/Session 架构、Hook 系统、Heartbeat/Cron、memory-core、Plugin SDK

---

## 🔗 Topic Pointers

| Domain | File | Description |
|--------|------|-------------|
| openclaw | `memory/topics/openclaw.md` | OpenClaw 配置、hooks、skills、插件 |
| memory-planet | `memory/topics/memory-planet.md` | 记忆星球架构、atoms.db、Star Soul Core |
| daily | `memory/daily-logs/` | 每日 session 日志（当天+昨天自动加载）|
| learnings | `.learnings/` | LEARNINGS.md / ERRORS.md / FEATURE_REQUESTS.md |

---

## 🔥 Open Threads

- [ ] memory.js atoms pin/list/update-importance 命令（已实现，未验证）
- [ ] recall 结果自动进上下文（bootstrap hook 方案）— M0.5
- [ ] Star Soul Core 独立进程 — M1/M2
- [ ] memory_relation / memory_claim 表 — M1
- [ ] 仕泽的典型工作流建模 — P2

---

## 📊 System Status

- **Memory Usage:** ~50 / 200 行
- **Last Consolidation:** 2026-05-16
- **Daily Logs:** 2026-05-07~16
- **atoms.db:** 92 atoms，embedding model: mxbai-embed-large

---

## 📅 Recent Lessons

[2026-05-16] **MEMORY.md 精简原则**：pointer index 只存指针，content 不重复粘贴。文件超 12000 字符会被 bootstrap 截断
[2026-05-16] **mxbai-embed-large 优于 nomic**：cos spread 从 0.096 → 0.29，Scrapling 查询从 #71 → #4
[2026-05-13] **compaction 超时根因**：event loop 被 session-locks(2.1s) + model-prewarm(2.8s) 占满，60s aggregate 超时
[2026-05-12] **三维记忆拆分**：confidence / importance / salience 独立，salience 不落表
[2026-05-12] **软门控公式**：final_importance = importance × (0.5 + 0.5 × confidence)
[2026-05-08] **PowerShell .Count 陷阱**：单元素数组返回 PSObject wrapper，用 @() 包裹

_Last updated: 2026-05-16 15:40_