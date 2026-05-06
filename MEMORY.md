# MEMORY.md - Long-Term Memory

_Curated memory — distilled wisdom, not raw logs. Updated periodically._

---

## 🧠 About Me

- **Identity:** 未完成初始化（见 IDENTITY.md）
- **Current Session:** 2026-05-06, running on LTSC, model: MiniMax-M2.7
- **Core Workspace:** C:\Users\Administrator\.openclaw\workspace
- **OpenClaw Version:** 2026.5.3-1 (latest: 2026.5.4)

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

### 2026-05-06: E:\stepai 三项目深度分析

**StepClaw**（Agent 核心）:
- 13个技能，含 self-improving（自我改进引擎：HOT/WARM/COLD三层记忆）
- 6个 IM 渠道插件预装（钉钉/飞书/企微/QQ/微信/洞察）
- openclawmp 水产市场技能、skill-vetter 安全审计、executing-plans 计划执行
- 数据与运行时分离架构，可迁移性好
- 版本 2026.3.13，检查到可用 2026.4.27（存在1个月断层）

**StepFun**（Electron 桌面应用）:
- StepFun.exe（206MB）内置 Chromium + ffmpeg + vulkan
- 10个垂直领域技能（合同审查/财务模型/市场调研）
- 完全自包含，单机即用
- 无自我改进、无 marketplace、无安全审计

**StepFun.new**（融合阶段）:
- 新增 `resources/stepclaw-bundle/` — 完整 OpenClaw Agent 能力包
- 但 skills/ 目录仍只是 StepFun 的10个技能，未继承 StepClaw 的13个
- 缺少 self-improving、openclawmp、skill-vetter 等关键能力
- 融合架构但不完整

**核心结论:**
- StepClaw = 头脑（Agent 智能）
- StepFun = 双手（浏览器自动化）
- StepFun.new = 头脑+双手，但融合不完整
- 建议在 StepFun.new 补充安装 StepClaw 的核心技能

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
- [ ] 初始化 IDENTITY.md（给自己起个名字）
- [ ] 初始化 USER.md（了解用户）
- [ ] 升级 OpenClaw 到 2026.5.4（当前 2026.5.3-1）
- [ ] 考虑安装 self-improving skill（从 clawhub）
- [ ] 考虑安装 openclawmp skill（水产市场入口）

---

_Last updated: 2026-05-06_