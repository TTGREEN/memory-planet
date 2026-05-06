# MEMORY.md - Long-Term Memory

_Curated memory — distilled wisdom, not raw logs. Updated periodically._

---

## 🧠 About Me

- **Identity:** 未完成初始化（见 IDENTITY.md）
- **Current Session:** 2026-05-06, running on LTSC, model: MiniMax-M2.7
- **Core Workspace:** C:\Users\Administrator\.openclaw\workspace
- **OpenClaw Version:** 2026.5.4 (latest: 2026.5.4)

---

## 👤 About My Human

- **Name:** 仕泽
- **What to call them:** 仕泽
- **Pronouns:** _(unknown)_
- **Timezone:** Asia/Shanghai (GMT+8)
- **Notes:** 2026-05-06 首次对话，让我分析了 E:\stepai 的三个项目；喜欢系统性分析，讲究逻辑和深度；希望我也能不断进化

**对我的设定：**
- 我的名字：**小虾** 🦐
- 风格：幽默但有边界，严谨而不死板

---

## 🗂️ Key Learnings

### 2026-05-06 13:37 更新版分析

**目录结构变化（对比上午）：**
- StepFun.new → 重命名为 StepFun（当前主版本）
- 新增 StepFun.old（原 StepFun 旧版本，2026/4/27）
- StepClaw 无变化

**StepFun（融合版）:**
- resources/stepclaw-bundle/ 已嵌入（openclaw@^2026.3.13）
- 6个 IM 插件（.tgz 包）：dingtalk/lark/qq/weixin/wecom/insight
- 10个技能（与 StepFun.old 相同）
- 插件未直接安装到 extensions/，以 .tgz 包形式存在

**关键差异：**
- StepFun 的 stepclaw-bundle 有完整 node_modules（400+包）
- StepFun.old 是纯 Electron 桌面应用（旧版）
- 6个插件版本与 StepClaw 一致（dingtalk@0.7.10, lark@2026.3.18等）

**结论更新：**
- StepFun = StepFun.old + stepclaw-bundle（融合版）✅
- StepFun.old = 纯桌面应用（旧版）
- StepClaw = Agent 核心（未变）
- 建议：用 StepFun 作为主力，它融合了两者优势

---

## 🏗️ System Config

- **Gateway Mode:** local
- **Primary Model:** minimax/MiniMax-M2.7（context 204800, max tokens 131072）
- **Heartbeat:** 30m intervals
- **Tools Profile:** coding
- **Installed Plugins:** minimax (enabled), xai, xiaomi, zai providers
- **Enabled Channels:** none configured yet

---

## 📌 Active Patterns

- 每次对话后写日记到 `memory/YYYY-MM-DD.md`
- 重要决定后更新 MEMORY.md
- 不在 group chat 中过度发言
- HEARTBEAT_OK 用于无需回复的轮次

---

## 🚨 Flags & Todos

- [x] 创建 MEMORY.md（长期记忆文件）
- [x] 创建 memory/ 日记目录 + heartbeat-state.json
- [x] 更新 AGENTS.md：加入 Self-Improving Framework（ HOT/WARM/COLD 三层记忆机制）
- [x] 更新 AGENTS.md：强化 Heartbeats 部分，增加主动检查清单
- [x] 更新 HEARTBEAT.md：加入主动检查项（内存维护、系统健康、项目状态）
- [x] openclawmp CLI 安装（1.0.2）
- [x] openclawmp token 写入成功（sk_0fe87...faa1）
- [x] openclawmp skill 官方版安装成功（v1.0.7，assetId: f3ab5236724cf9b7f4cbf6bda8478a6e）
- [x] workspace/skills/openclawmp 已更新为官方最新版本
- [ ] 考虑安装 find-skills、skill-creator 等其他 StepClaw 技能

---

---

## 🗂️ 历史踩坑（来自 2026-04-25~27 备份）

### 系统配置
- `gateway.cmd` 添加 `OPENCLAW_NO_RESPAWN=1` 防 respawn 循环
- bonjour 配置项在 2026.4.23+ 版本不支持 → `discovery.mdns.mode="off"`
- PowerShell exec 输出需重定向到 UTF-8 文件再读取（直接 print 会崩溃）
- MEMORY.md 保持在 200行/~25KB 以内（当时 16K 字符超限才压缩）

### 技能质量
- 质量循环：generate→enhance→audit 闭环，10/10 可达 6/6 分
- 重复模式阈值≥3次再生成技能（防噪音）
- 防重复机制：自动跳过已存在技能（--force 覆盖）
- 阈值策略：重复模式识别 ≥3 次，避免过度生成

### 1688项目（参考）
- Ollama nomic-embed-text 对中文单词向量不稳定 → 转换为描述性句子
- 关键词路径 KEYWORDS_FILE 不能硬编码 → 用 __dirname 向上查找

---

## 🗂️ 历史生态学习（来自 GitHub 8项目学习报告 2026-04-25）

### 最佳模式可借鉴
1. **STATUS.md 项目跟踪**（Claw-auto-coding）— 每个项目一个状态文件，跟踪进度/阻塞/下一步
2. **认知闭环**（Consciousness Engine）— Perception→Engine→Memory→Learning→Reflection
3. **独立监控服务架构**（openclaw-buddy）— Go+React 独立控制台，WebSocket 实时推送
4. **技能优化工具包**（skill-optimization）— 基于历史任务轨迹自动生成技能模板

### 项目状态文件规范（待实施）
- `memory/projects/<name>/STATUS.md` — 进度、阻塞、下一步
- `memory/projects/<name>/log.md` — 变更记录

---

## 📦 备份技能清单（原始 28 个，2026-04-27）

| 技能 | 质量 | 状态 |
|------|------|------|
| proactivity | 4/6 | ⭐ 待深入整合到 AGENTS.md |
| self-learning | 2/6 | ✅ 已整合（consolidate-memory） |
| self-reflection | 2/6 | ✅ 部分整合（self-improving） |
| skill-creator | 2/6 | 参考思路（复杂度过高） |
| monitor-agent | 2/6 | 参考思路（需泛化） |
| auto_* (10个) | 各2/6 | ❌ 无实际内容，占位符 |
| knowledge-1688-* | 各1/6 | ❌ 1688专用，与当前无关 |
| 其他 | 1-4/6 | ❌ 领域专用或低价值 |

---

_Last updated: 2026-05-06_