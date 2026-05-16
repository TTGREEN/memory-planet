# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## Claude Code 模型调度

仕泽的 Claude Code 配置了 3 套模型，我来判定任务难度切换：

| 难度 | 判断标准 | 使用模型 | 原因 |
|------|----------|----------|------|
| **简单** | 快速文件编辑、单行改动、简单脚本 | `step-3.5-flash-2603` | 最便宜、最快 |
| **中等** | 脚本编写调试、中等复杂度分析 | `step-router-v1` | 性价比平衡 |
| **复杂** | 架构设计、深度调试（多文件/多模块）、复杂推理 | `MiniMax-M2.7` | 最强能力 |

**切换方法**：Claude Code TUI 中输入 `/model <model-name>`

**API 配置**：
- MiniMax-M2.7: `sk-cp-th4jymz24` @ `api.minimaxi.com/anthropic`
- step-router-v1 / step-3.5-flash-2603: `CY09Dm9ixc86h1WTebnMmq17AS762wclRISL1TfXVzKj53x5q0RZ0DfB3UJxEsRL` @ `api.stepfun.com/step_plan/v1`

配置文件：`~/.claude/settings.json`

---

## AI Model Switching（Claude Code）

- Simple tasks → `step-3.5-flash-2603`
- Medium tasks → `step-router-v1`
- Complex tasks → `MiniMax-M2.7`

---

## SSH

- home-server → 192.168.1.100, user: admin

## TTS

- Preferred voice: "中文" / Chinese voice
- Language: 中文 (Chinese)

---

## Session 调试参考

（参考 mavis-doctor 双 ID 模式）

OpenClaw session 结构：
- `main session` = 仕泽的主对话入口，长期存在
- `sub-session` = 临时分叉，用于后台任务或并行工作
- `session key` = UUID 格式，用于 sessions 系列工具定位

调试命令：
- `sessions_list` → 列出所有可见 session（含 label、最后消息预览）
- `sessions_history sessionKey --limit 5` → 看某个 session 的尾端，判断在跑什么
- `sessions_send sessionKey "message"` → 往目标 session 发消息，让它执行

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)