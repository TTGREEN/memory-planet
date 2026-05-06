---
name: openclaw-channel-config
description: >
  OpenClaw 国内渠道接入配置 Skill。当用户提到以下场景时触发：
  - 配置、启用、禁用、调整 OpenClaw 的 channel/渠道设置
  - 接入 QQ、企业微信（企微/WeCom）、飞书（Feishu/Lark）、钉钉（DingTalk）、微博（Weibo）等国内 IM 渠道
  - 渠道凭证（appId、appSecret、corpId、agentId、Bot ID、Secret、token）配置
  - 扫码认证、Pairing 配对、OAuth 授权流程
  - DM（私聊）/群组消息策略（requireMention、groupPolicy、threadSession）
  - 渠道插件安装、升级、日志排查、连接状态检查
  - openclaw.json 中 channels 配置项的增删改查
  - 渠道插件的内置 Skills 使用（飞书文档/多维表格/日历/任务、钉钉文档、企微通讯录等）
---

# OpenClaw 国内渠道接入配置 Skill

本 Skill 提供接入国内主流 IM 渠道的完整指南。**核心原则：Agent 直接执行，不让用户手动运行命令。**

各渠道详细参考文档见 [references/](references/) 目录。

---

## 核心原则（Agent 必读）

### ❌ 不要这样做

- 不要回复"运行以下命令"然后列出命令让用户执行
- 不要让用户手动编辑配置文件
- 不要假设用户懂技术细节

### ✅ 正确做法

1. **Agent 直接执行检查** — 用 `exec` 或 `gateway` 工具查看插件状态和配置
2. **给出简洁选项** — 用 1-2 句话说明现状，提供 2-3 个清晰选项
3. **用户选择后，Agent 直接执行** — 用 `exec`、`gateway config.patch` 等工具完成配置
4. **只让用户做必须人工做的事** — 如扫码授权、提供凭证

### 标准交互流程示例

```
用户：我要链接飞书

Agent（执行检查）→ 查看插件状态、现有配置
Agent（回复）→ "飞书插件已安装但未配置。两个选择：
              A. 我自动帮你创建飞书应用（推荐）
              B. 你已有 App ID 和 Secret，直接配置"

用户：A

Agent（执行）→ 运行自动配置工具（设置足够长的超时，如 5 分钟）
Agent（回复）→ "已创建应用，请用手机飞书扫这个码完成授权：[链接]"

用户：（扫码完成）

Agent（必须执行验证）→
  1. 运行 npx @larksuite/openclaw-lark-tools doctor 检查凭证
  2. 如果检测到 App ID 和 Secret → 重启网关 → "飞书已连接，可以使用了"
  3. 如果没检测到 → 明确告知用户并进入手动配置流程

【关键】Agent 绝不能假设凭证已写入，必须验证后再继续！
```

### 自动配置失败后的手动配置流程

如果自动配置工具未能正确写入凭证：

```
Agent（回复）→ "自动配置未完成，需要手动提供凭证。请：
  1. 打开 https://open.feishu.cn/app
  2. 找到刚创建的应用（名称含 OpenClaw）
  3. 进入「凭证与基础信息」
  4. 复制 App ID 和 App Secret 给我"

用户提供凭证后，Agent（执行）：
  1. 使用 gateway config.patch 写入配置
  2. 重启网关
  3. 验证连接
```

---

## 一、通用架构

### 1.1 核心配置文件

`openclaw.json`（默认路径 `~/.stepclaw/openclaw.json`），所有渠道以 `channels` 对象管理。

### 1.2 Agent 操作工具

| 操作          | 工具/命令                                              |
| ------------- | ------------------------------------------------------ |
| 查看插件状态  | `exec: openclaw plugins list`                          |
| 查看/修改配置 | `gateway: config.get / config.patch`                   |
| 重启网关      | `exec: openclaw gateway restart` 或 `gateway: restart` |
| 查看日志      | `exec: openclaw logs --follow`                         |

### 1.3 预装渠道的标准启用流程

> **重要**：StepClaw 环境已预装官方飞书、钉钉、QQ、企微、微信插件（状态为 disabled）。社区版飞书内置已禁用。
> **Agent 直接执行配置，无需用户手动操作。**

**Agent 执行流程：**

1. **检查现状** — `openclaw plugins list` 确认插件状态
2. **询问用户** — 提供选项（自动创建 / 已有凭证）
3. **获取凭证** — 自动创建 或 让用户提供
4. **写入配置** — `gateway config.patch` 直接写入
5. **启用渠道** — 设置 `enabled: true`
6. **重启网关** — `openclaw gateway restart`
7. **验证连接** — 查看日志确认

### 1.4 通用配置字段

| 字段             | 类型    | 说明                                  |
| ---------------- | ------- | ------------------------------------- |
| `enabled`        | boolean | 是否启用该渠道                        |
| `requireMention` | boolean | 群聊中是否需要 @机器人 才响应         |
| `groupPolicy`    | string  | `"open"` / `"whitelist"` / `"closed"` |
| `groups`         | object  | 特定群的自定义规则                    |
| `streaming`      | boolean | 是否启用流式输出                      |

---

## 二、渠道速查表

| 渠道           | 插件 ID                 | npm 包                                 | 预装版本      | 配置 key                      | 维护方         | 详细参考                                         |
| -------------- | ----------------------- | -------------------------------------- | ------------- | ----------------------------- | -------------- | ------------------------------------------------ |
| 飞书（官方版） | `openclaw-lark`         | `@larksuite/openclaw-lark`             | ✅ v2026.3.18 | `channels.feishu`             | 飞书官方       | [references/feishu.md](references/feishu.md)     |
| 飞书（社区版） | `feishu`                | `@openclaw/feishu`                     | ⛔ 内置已禁用 | `channels.feishu`             | 社区 @m1heng   | [references/feishu.md](references/feishu.md)     |
| 企业微信       | `wecom-openclaw-plugin` | `@wecom/wecom-openclaw-plugin`         | ✅ v1.0.13    | `channels.wecom`              | 企微官方       | [references/wecom.md](references/wecom.md)       |
| 钉钉           | `dingtalk-connector`    | `@dingtalk-real-ai/dingtalk-connector` | ✅ v0.7.10    | `channels.dingtalk-connector` | 钉钉 Real AI   | [references/dingtalk.md](references/dingtalk.md) |
| QQ             | `openclaw-qqbot`        | `@tencent-connect/openclaw-qqbot`      | ✅ v1.6.3     | `channels.qqbot`              | 腾讯官方       | [references/qqbot.md](references/qqbot.md)       |
| 微信           | `openclaw-weixin`       | `@tencent-weixin/openclaw-weixin`      | ✅ v1.0.2     | `channels.openclaw-weixin`    | 腾讯官方       | [references/weixin.md](references/weixin.md)     |
| 微博           | `openclaw-weibo`        | —                                      | ❌ 未预装     | `channels.openclaw-weibo`     | 社区 wecode-ai | [references/weibo.md](references/weibo.md)       |

### 飞书双版本说明

**二选一启用**，不要同时启用（两者共享 channel ID `feishu`）：

- **官方版**（plugin ID: `openclaw-lark`）：飞书官方维护，功能更完整，推荐优先使用。
- **社区版**（plugin ID: `feishu`）：社区维护。

> ⚠️ **plugin ID ≠ channel ID**：官方版 plugin ID 是 `openclaw-lark`，但 channel ID 是 `feishu`。
> 配置 key 统一为 `channels.feishu`，**不要用 `channels.openclaw-lark`**（会导致 `unknown channel id` 启动失败）。

---

## 三、各渠道接入指南（Agent 执行版）

### 3.1 飞书接入

> **详细参考**：[references/feishu.md](references/feishu.md)

推荐使用**官方版**（`openclaw-lark`）。

**场景 A：从零开始（Agent 自动创建应用）**

Agent 直接执行自动配置工具（**设置足够长的超时，如 300 秒**）：

```bash
npx -y @larksuite/openclaw-lark-tools install --verbose
```

该命令会：

1. 在飞书开放平台创建应用
2. 自动申请所需权限
3. 配置事件订阅
4. 生成授权二维码和链接
5. **等待用户扫码并轮询获取凭证**

**Agent 回复用户**："已创建飞书应用，请用手机飞书 App 打开以下链接完成授权：[链接]"

用户扫码完成后，Agent **必须执行验证步骤**：

```bash
# 步骤 1：验证凭证是否成功写入
npx @larksuite/openclaw-lark-tools doctor

# 步骤 2：检查配置中是否存在 appId 和 appSecret
gateway config.get
# 确认 channels.feishu.appId 和 appSecret 字段存在且有值

# 步骤 3：如果验证通过，重启网关
gateway restart
```

**【关键】验证失败的处理：**
如果 doctor 命令返回 "App ID or Secret missing"，说明自动配置未完成，Agent 必须：

1. 明确告知用户"凭证未自动获取到"
2. 请用户手动从飞书开放平台复制 App ID 和 App Secret
3. 使用场景 B 的手动配置方式写入

**场景 B：已有飞书应用凭证（手动配置）**

当自动配置失败或用户已有凭证时，Agent 直接写入配置：

**步骤 1：获取凭证**

- 请用户提供 App ID 和 App Secret
- 或引导用户从飞书开放平台复制（https://open.feishu.cn/app → 应用详情 → 凭证与基础信息）

**步骤 2：Agent 使用 gateway config.patch 写入配置**

```javascript
gateway.config.patch({
  channels: {
    feishu: {
      appId: '<APP_ID>',
      appSecret: '<APP_SECRET>',
      enabled: true,
      // 可选配置：
      requireMention: true, // 群聊是否需要 @机器人
      groupPolicy: 'open', // 群聊策略：open/whitelist/closed
      streaming: true, // 是否启用流式输出
    },
  },
});
```

**步骤 3：重启网关**

```bash
gateway restart
```

**步骤 4：验证配置**

```bash
npx @larksuite/openclaw-lark-tools doctor
```

**配置字段说明：**
| 字段 | 必填 | 说明 |
| ---------------- | ---- | ---------------------------------------------------- |
| `appId` | ✅ | 飞书应用的 App ID |
| `appSecret` | ✅ | 飞书应用的 App Secret |
| `enabled` | ✅ | 是否启用该渠道 |
| `requireMention` | ❌ | 群聊中是否需要 @机器人 才响应（默认 true） |
| `groupPolicy` | ❌ | 群聊策略："open"/"whitelist"/"closed"（默认 "open"） |
| `streaming` | ❌ | 是否启用流式输出（默认 false） |

### 3.2 钉钉接入

> **详细参考**：[references/dingtalk.md](references/dingtalk.md)

插件已预装。Agent 询问用户是否已有凭证：

**Agent 执行配置**：

```javascript
gateway.config.patch({
  channels: {
    'dingtalk-connector': {
      clientId: '<CLIENT_ID>',
      clientSecret: '<CLIENT_SECRET>',
      robotCode: '<ROBOT_CODE>',
      enabled: true,
    },
  },
});
```

然后重启网关。

### 3.3 企业微信接入

> **详细参考**：[references/wecom.md](references/wecom.md)

插件已预装。**Source 标识已配置为 `step-fun`**，无需再向用户索要。

**场景 A：从零开始（没有 Bot ID 和 Secret）**

Agent 自动生成扫码 HTML 页面（source 使用 `step-fun`），用户扫码后获取 botId 和 secret，Agent 写入配置。

**场景 B：已有 Bot ID 和 Secret**

Agent 直接写入配置：

```javascript
gateway.config.patch({
  channels: {
    wecom: {
      botId: '<BOT_ID>',
      secret: '<SECRET>',
      enabled: true,
    },
  },
});
```

然后重启网关。

### 3.4 QQ 接入

> **详细参考**：[references/qqbot.md](references/qqbot.md)

插件已预装。Agent 询问用户是否已有凭证：

**Agent 执行配置**：

```javascript
gateway.config.patch({
  channels: {
    qqbot: {
      appId: '<APP_ID>',
      token: '<TOKEN>',
      appSecret: '<APP_SECRET>',
      enabled: true,
    },
  },
});
```

然后重启网关。

### 3.5 微博接入

> **详细参考**：[references/weibo.md](references/weibo.md)

微博插件**未预装**，Agent 先执行安装：

```bash
git clone https://gitee.com/wecode-ai/openclaw-weibo.git /tmp/openclaw-weibo
openclaw plugins install /tmp/openclaw-weibo
```

然后让用户私信 @微博龙虾助手 发送"连接龙虾"获取凭证，Agent 再写入配置。

### 3.6 微信接入

> **详细参考**：[references/weixin.md](references/weixin.md)

插件已预装。Agent 启用后引导用户扫码登录：

```javascript
gateway.config.patch({
  channels: {
    'openclaw-weixin': { enabled: true },
  },
});
```

然后执行登录：

```bash
openclaw channels login --channel openclaw-weixin
```

重启网关并等待用户完成扫码授权。二维码有效期 5 分钟，远程场景见 references/weixin.md。

---

## 四、各渠道内置 Skills 速查

> 所有预装渠道的内置 Skills 随插件启用后自动注册，无需单独安装。

### 4.1 飞书

| Skill 类别   | 能力说明                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| **消息**     | 消息读取（群聊/单聊历史、话题回复）、消息发送（含卡片）、消息回复、消息搜索、图片/文件下载 |
| **文档**     | 创建云文档、更新云文档、读取云文档内容                                                     |
| **多维表格** | 创建/管理多维表格、数据表、字段、记录（增删改查、批量操作、高级筛选）、视图                |
| **电子表格** | 创建、编辑、查看电子表格                                                                   |
| **日历日程** | 日历管理、日程管理（创建/查询/修改/删除/搜索）、参会人管理、忙闲查询                       |
| **任务**     | 任务管理（创建/查询/更新/完成）、清单管理、子任务、评论                                    |
| **额外**     | 流式输出卡片、合并转发消息识别、表情发送                                                   |

### 4.2 企业微信（需插件 >= 1.0.9）

| Skill 类别   | 能力说明                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| **消息**     | 接收用户消息（文本、图片、语音、视频、位置、链接）、发送应用消息、被动回复 |
| **通讯录**   | 读取部门/成员信息、搜索通讯录                                              |
| **应用管理** | 自定义菜单管理、应用会话管理                                               |
| **智能表格** | 通过 Webhook 接收外部数据写入智能表格                                      |
| **企微 API** | 通过 Bot ID + Secret 获取 access token，调用文档 API 等企微应用 API        |

### 4.3 钉钉

| Skill 类别   | 能力说明                                                                               |
| ------------ | -------------------------------------------------------------------------------------- |
| **消息**     | 收发消息（文本/Markdown/图片/语音/AI Card 流式）、表情、消息撤回                       |
| **富媒体**   | JPEG/PNG 图片接收、视觉模型集成、图片识别                                              |
| **文件解析** | Word（.docx）、PDF（.pdf）、文本文件（.txt/.md/.json）、二进制文件（.xlsx/.pptx/.zip） |
| **钉钉文档** | 创建文档、追加内容、搜索文档、列举文档（读取功能暂不可用）                             |
| **多 Agent** | 多机器人绑定不同 Agent、独立会话隔离                                                   |
| **异步模式** | 即时回执 + 后台处理 + 推送结果                                                         |

### 4.4 QQ

| Skill 类别   | 能力说明                                                             |
| ------------ | -------------------------------------------------------------------- |
| **消息**     | 接收群聊 @消息、私聊消息、频道消息；发送文本/图片/Markdown/Embed/Ark |
| **频道**     | 频道管理、子频道管理                                                 |
| **事件**     | 群成员变动、频道变动等事件订阅                                       |
| **定时任务** | qqbot-cron 定时任务管理                                              |
| **媒体处理** | qqbot-media 媒体文件处理                                             |

### 4.5 微博

| Skill 类别 | 能力说明                      |
| ---------- | ----------------------------- |
| **私信**   | 接收私信、发送私信、@提及检测 |
| **内容**   | 读取微博、发布微博、评论管理  |

---

## 五、排障流程（Agent 执行）

```
Step 1 → Agent 检查插件状态
         exec: openclaw plugins list

Step 2 → Agent 检查配置
         gateway: config.get

Step 3 → Agent 验证凭证有效性
         查看配置中的凭证字段是否已填充真实值

Step 4 → Agent 重启网关
         exec: openclaw gateway restart
         或 gateway: restart

Step 5 → Agent 检查网络连通性
         确认可访问对应平台 API 端点

Step 6 → Agent 查看日志
         exec: openclaw logs --follow
         关注 "error"、"failed"、"timeout"

Step 7 → Agent 使用渠道专属诊断命令
         飞书：exec: npx @larksuite/openclaw-lark-tools doctor
         企微：exec: openclaw pairing list wecom
```

### 常见问题速查

| 现象                                                        | 可能原因                        | Agent 解决方案                                                                                                          |
| ----------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 配置后无响应                                                | 未重启网关                      | Agent 执行 `openclaw gateway restart`                                                                                   |
| 插件预装但未加载                                            | 未启用（enabled: false）        | Agent 设置 `enabled: true` 并重启                                                                                       |
| 认证失败                                                    | 凭证错误或过期                  | Agent 重新获取凭证并更新配置                                                                                            |
| 群聊不回复                                                  | `requireMention` 为 true 但未 @ | 建议用户 @机器人，或改为 `false`                                                                                        |
| 连接断开                                                    | 网络不稳定或 token 过期         | Agent 检查网络，刷新 token                                                                                              |
| 飞书应用创建失败                                            | 权限不足                        | Agent 尝试加 `sudo` 执行                                                                                                |
| `cannot find module xxx`                                    | 插件依赖未安装                  | Agent 进入插件目录执行 `npm install`                                                                                    |
| `Cannot find package '@whiskeysockets/baileys'`（StepClaw） | stub 未同步到 `node_modules`    | 先执行 `openclaw repair`；若无该命令，用环境变量 `STEPCLAW_CORE_CLI` 指向的 `stepclaw-core` 执行 `repair`，再重试原 CLI |
| channel_id 写错                                             | 配置 key 与插件 ID 不匹配       | Agent 用 `openclaw plugins list` 确认                                                                                   |
| **自动配置后凭证缺失**                                      | **进程超时或中断**              | **Agent 必须验证凭证，失败则转手动配置**                                                                                |
| **用户说扫码完了但连不上**                                  | **Agent 未验证凭证就重启**      | **Agent 应先运行 doctor 验证，再重启**                                                                                  |
| 飞书机器人对话无输入框（企业号）                            | 机器人应用未通过企业管理员审批  | 告知用户联系管理员在飞书管理后台审批发布该应用，通过后输入框自动出现                                                    |
| 飞书机器人对话无输入框（个人号）                            | 未配置事件接收方式              | 引导用户前往飞书开放平台 → 应用后台 → 事件与回调 → 开启「使用长连接接收事件」，重新打开对话                             |

---

## 六、最佳实践

- **Agent 直接执行配置**，不让用户手动编辑文件
- 凭证不要硬编码在版本控制中，使用环境变量或 secrets 管理
- 生产环境建议 `requireMention: true`，避免机器人过度响应
- 使用 `groupPolicy: "whitelist"` 精确控制机器人活跃的群
- 多个渠道可同时启用，建议先单渠道测试通过后再逐步添加
- 定期轮换 token 和密钥
- 飞书建议先拿个人账号测试，确认稳定后再接入工作环境
- 企微
