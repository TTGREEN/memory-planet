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
- [x] 安装 openclawmp CLI（1.0.2）
- [x] 复制 StepClaw 技能到 workspace/skills/：skill-vetter、channel-config、openclawmp、self-improving、executing-plans
- [ ] openclawmp 安装资产需 token（请仕泽提供）
- [ ] 初始化 USER.md（仕泽信息已填）
- [ ] 考虑安装 find-skills、skill-creator 等其他 StepClaw 技能

---

_Last updated: 2026-05-06_