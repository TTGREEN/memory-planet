# 飞书（Feishu / Lark）渠道接入参考

## 插件信息

- **官方版插件**：`@larksuite/openclaw-lark`（插件 ID: `openclaw-lark`）
- **社区版插件**：`@openclaw/feishu`（插件 ID: `feishu`）
- **维护方**：官方版由飞书官方维护，社区版由 @m1heng 维护
- **预装状态**：✅ 官方版 `@larksuite/openclaw-lark` 已预装 v2026.3.18（disabled）；社区版内置已被 StepClaw 禁用
- **配置 key**：⚠️ **统一使用 `channels.feishu`**（官方版和社区版注册的 channel ID 都是 `feishu`）
- **安装器**（仅首次创建应用时需要）：`npx -y @larksuite/openclaw-lark-tools install`
- **升级方式**：`npx -y @larksuite/openclaw-lark-tools update`
- **最低版本要求**：OpenClaw >= 2026.2.26（Linux/macOS）或 >= 2026.3.2（Windows）
- **官方文档**：https://www.feishu.cn/content/article/7613711414611463386
- **在线使用指南**：https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh

> ⚠️ **关键坑点：plugin ID ≠ channel ID**
>
> 官方版的 **plugin ID** 是 `openclaw-lark`（出现在 `plugins.entries`、`plugins.installs` 等位置），
> 但它注册的 **channel ID** 是 `feishu`（与社区版相同）。
>
> 配置 key 由 channel ID 决定，因此**两个版本的配置 key 都是 `channels.feishu`**，不是 `channels.openclaw-lark`。
>
> ```
> ✅ 正确：channels.feishu.appId
> ❌ 错误：channels.openclaw-lark.appId   ← 会导致 "unknown channel id" 启动失败
> ```
>
> 来源：`openclaw.plugin.json` 中 `"channels": ["feishu"]`
>
> 两个版本**不能同时启用**（共享同一个 channel ID `feishu`），二选一即可。

## 接入流程

### 场景 A：从零开始（没有飞书应用）

需要在**本地终端**运行安装器扫码创建应用（Agent 不能代执行，需要用户交互扫码）：

> **Windows 用户**：加 `--verbose` 参数，安装器会输出可点击的扫码链接。

```bash
# 在本地终端执行，不要通过 agent exec
npx -y @larksuite/openclaw-lark-tools install --verbose
```

安装器自动完成：创建飞书应用 → 申请权限 → 配置事件订阅 → 写入 openclaw.json → 发布应用。

**⚠️ 安装器完成后必须验证 + 手动启用：**

安装器写入凭证后 **`enabled` 默认是 `false`**，不会自动启用。这是"飞书没有回复"最常见的原因。

1. 验证凭证是否写入：

```bash
npx @larksuite/openclaw-lark-tools doctor
```

2. 确认配置中 `channels.feishu` 下存在 `appId` 和 `appSecret`
3. 启用渠道并重启网关：

```bash
openclaw config set channels.feishu.enabled true
openclaw gateway restart
```

4. 完成授权和最终验证：

```
/feishu auth     # 批量完成用户授权
/feishu doctor   # 最终验证
```

**验证失败的处理**：如果 doctor 报 "App ID or Secret missing"，说明安装器进程超时或中断，转场景 B 手动配置。

### 场景 B：已有飞书应用（有 App ID 和 App Secret）

官方版插件已预装，无需额外安装包，Agent 直接写入配置并启用：

```bash
openclaw config set channels.feishu.appId <APP_ID>
openclaw config set channels.feishu.appSecret <APP_SECRET>
openclaw config set channels.feishu.enabled true
openclaw gateway restart
```

### 诊断命令

| 命令                                              | 说明             |
| ------------------------------------------------- | ---------------- |
| `/feishu start`                                   | 确认是否安装成功 |
| `/feishu doctor`                                  | 检查配置是否正常 |
| `/feishu auth`                                    | 批量完成用户授权 |
| `npx @larksuite/openclaw-lark-tools doctor`       | 终端诊断         |
| `npx @larksuite/openclaw-lark-tools doctor --fix` | 自动修复         |
| `npx @larksuite/openclaw-lark-tools info`         | 查看版本信息     |
| `npx @larksuite/openclaw-lark-tools info --all`   | 查看详细配置信息 |

## 配置示例（openclaw.json）

配置 key 统一为 `channels.feishu`（无论使用官方版还是社区版）：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "{{飞书应用 Client ID}}",
      "appSecret": "{{飞书应用 Client Secret}}",
      "requireMention": true,
      "groupPolicy": "open",
      "dmPolicy": "open",
      "groups": {},
      "streaming": true,
      "footer": {
        "elapsed": true,
        "status": true
      },
      "threadSession": false
    }
  }
}
```

### 凭证字段说明

| 字段        | 必填 | 说明                                             |
| ----------- | ---- | ------------------------------------------------ |
| `appId`     | 是   | 飞书开放平台应用的 Client ID（格式 `cli_xxx`）   |
| `appSecret` | 是   | 飞书开放平台应用的 Client Secret                 |
| `enabled`   | 是   | 必须设为 `true` 才会启用（安装器默认写 `false`） |

### DM（私聊）策略 — `dmPolicy`

控制谁能跟机器人私聊。

| 值            | 说明                                                   |
| ------------- | ------------------------------------------------------ |
| `"open"`      | 所有人都能私聊机器人                                   |
| `"allowList"` | 只有允许列表中的用户才能私聊（可能是某些配置的默认值） |

> ⚠️ 如果用户反馈"私聊机器人没反应"，先检查 `dmPolicy` 是不是 `"allowList"`，以及用户是否在允许列表中。

### 群聊策略字段说明

| 字段             | 默认值   | 说明                                      |
| ---------------- | -------- | ----------------------------------------- |
| `requireMention` | `true`   | 群聊中是否需要 @机器人 才响应             |
| `groupPolicy`    | `"open"` | 群组策略："open" / "whitelist" / "closed" |

### 其他策略字段说明

| 字段             | 默认值  | 说明                           |
| ---------------- | ------- | ------------------------------ |
| `streaming`      | `true`  | 是否启用流式输出（打字机效果） |
| `threadSession`  | `false` | 是否使用话题模式管理会话       |
| `footer.elapsed` | `true`  | 消息底部是否显示耗时           |
| `footer.status`  | `true`  | 消息底部是否显示状态           |

### 群聊回复模式

**模式 1**：只有 @机器人 才回复（默认）

```bash
openclaw config set channels.feishu.requireMention true
```

**模式 2**：不用 @，所有消息都回复（需申请敏感权限 im:message.group_msg）

```bash
openclaw config set channels.feishu.requireMention false
```

**模式 3**：指定群需 @，其他群不用 @

```bash
openclaw config set channels.feishu.requireMention open
openclaw config set channels.feishu.groups.oc_xxxxxxxx.requireMention true
```

### 配置命令速查

```bash
# 开启/关闭流式输出
openclaw config set channels.feishu.streaming true

# 开启耗时显示
openclaw config set channels.feishu.footer.elapsed true

# 开启话题模式（多任务并行、独立上下文）
openclaw config set channels.feishu.threadSession true

# 修改私聊策略
openclaw config set channels.feishu.dmPolicy open
```

## 排障指南

### 💀 "飞书没有回复"（最常见问题）

按以下顺序排查，覆盖 90% 的情况：

| 排查步骤 | 检查项                  | 说明                                                          |
| -------- | ----------------------- | ------------------------------------------------------------- |
| Step 1   | `enabled` 是否为 `true` | 安装器写完凭证但**不会自动启用**，这是最常见原因              |
| Step 2   | 配置 key 是否正确       | 必须用 `channels.feishu`，**不要用** `channels.openclaw-lark` |
| Step 3   | `dmPolicy`              | 如果是私聊没回复，检查是不是 `"allowList"` 限制了             |
| Step 4   | 凭证有效性              | 运行 `npx @larksuite/openclaw-lark-tools doctor`              |
| Step 5   | 是否重启了网关          | 改完配置后必须重启                                            |
| Step 6   | 查看日志                | `openclaw logs --follow`，关注 error / failed / timeout       |

### 常见问题速查

| 现象                     | 可能原因                        | 解决方案                                 |
| ------------------------ | ------------------------------- | ---------------------------------------- |
| `unknown channel id`     | 误用了 `channels.openclaw-lark` | 改为 `channels.feishu`（见上方坑点说明） |
| 配置后无响应             | 未重启网关                      | `openclaw gateway restart`               |
| 插件预装但未加载         | `enabled: false`                | 设置 `enabled: true` 并重启              |
| 认证失败                 | 凭证错误或过期                  | 重新获取凭证并更新配置                   |
| 群聊不回复               | `requireMention` 为 true        | 告知用户 @机器人，或改为 `false`         |
| 私聊不回复               | `dmPolicy: "allowList"`         | 改为 `"open"` 或将用户加入允许列表       |
| 自动配置后凭证缺失       | 安装器进程超时或中断            | 转手动配置（场景 B）                     |
| 连接断开                 | 网络不稳定或 token 过期         | 检查网络，刷新 token                     |
| `cannot find module xxx` | 插件依赖未安装                  | 进入插件目录执行 `npm install`           |

## 内置 Skills 详细说明

飞书插件的所有 Skills 随插件启用后自动注册，无需单独安装。

### 1. 消息

| 能力     | 说明                            |
| -------- | ------------------------------- |
| 消息读取 | 读取群聊/单聊历史消息、话题回复 |
| 消息发送 | 主动发送消息（含卡片消息）      |
| 消息回复 | 回复特定消息                    |
| 消息搜索 | 搜索历史消息                    |
| 媒体下载 | 下载消息中的图片/文件           |

### 2. 文档

| 能力       | 说明               |
| ---------- | ------------------ |
| 创建云文档 | 创建新的飞书云文档 |
| 更新云文档 | 编辑已有云文档内容 |
| 读取云文档 | 读取云文档内容     |

### 3. 多维表格

| 能力       | 说明                             |
| ---------- | -------------------------------- |
| 表格管理   | 创建/管理多维表格                |
| 数据表操作 | 数据表增删改查                   |
| 字段管理   | 字段创建、修改                   |
| 记录操作   | 记录增删改查、批量操作、高级筛选 |
| 视图管理   | 视图创建与管理                   |

### 4. 电子表格

| 能力 | 说明             |
| ---- | ---------------- |
| 创建 | 创建新的电子表格 |
| 编辑 | 编辑电子表格内容 |
| 查看 | 查看电子表格数据 |

### 5. 日历日程

| 能力       | 说明                         |
| ---------- | ---------------------------- |
| 日历管理   | 日历的创建与管理             |
| 日程管理   | 日程创建/查询/修改/删除/搜索 |
| 参会人管理 | 管理日程参会人               |
| 忙闲查询   | 查询用户忙闲状态             |

### 6. 任务

| 能力     | 说明                    |
| -------- | ----------------------- |
| 任务管理 | 任务创建/查询/更新/完成 |
| 清单管理 | 任务清单管理            |
| 子任务   | 子任务创建与管理        |
| 评论     | 任务评论                |

## 权限要求

### Tenant 权限

- contact、docx、im、application、cardkit 等

### User 权限

- base、sheets、docs、calendar、task、wiki 等（50+ 权限点）

### 特殊权限

- 群聊免 @回复需申请敏感权限 `im:message.group_msg`
- 以用户身份发消息需额外开通 `im:message.send_as_user`

### 批量导入权限

在飞书开放平台 → 开发配置 → 权限管理 → 批量导入/导出权限，将以下 JSON 粘贴：

```json
{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "docx:document:readonly",
      "im:chat:read",
      "im:chat:update",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "application:application:self_manage",
      "cardkit:card:write",
      "cardkit:card:read"
    ],
    "user": [
      "contact:user.employee_id:readonly",
      "offline_access",
      "base:app:copy",
      "base:field:create",
      "base:field:delete",
      "base:field:read",
      "base:field:update",
      "base:record:create",
      "base:record:delete",
      "base:record:retrieve",
      "base:record:update",
      "base:table:create",
      "base:table:delete",
      "base:table:read",
      "base:table:update",
      "base:view:read",
      "base:view:write_only",
      "base:app:create",
      "base:app:update",
      "base:app:read",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:write_only",
      "docs:document:export",
      "docs:document.media:upload",
      "board:whiteboard:node:create",
      "board:whiteboard:node:read",
      "calendar:calendar:read",
      "calendar:calendar.event:create",
      "calendar:calendar.event:delete",
      "calendar:calendar.event:read",
      "calendar:calendar.event:reply",
      "calendar:calendar.event:update",
      "calendar:calendar.free_busy:read",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "contact:user:search",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.media:download",
      "docs:document.copy",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:file:download",
      "drive:file:upload",
      "im:chat.members:read",
      "im:chat:read",
      "im:message",
      "im:message.group_msg:get_as_user",
      "im:message.p2p_msg:get_as_user",
      "im:message:readonly",
      "search:docs:read",
      "search:message",
      "space:document:delete",
      "space:document:move",
      "space:document:retrieve",
      "task:comment:read",
      "task:comment:write",
      "task:task:read",
      "task:task:write",
      "task:task:writeonly",
      "task:tasklist:read",
      "task:tasklist:write",
      "wiki:node:copy",
      "wiki:node:create",
      "wiki:node:move",
      "wiki:node:read",
      "wiki:node:retrieve",
      "wiki:space:read",
      "wiki:space:retrieve",
      "wiki:space:write_only"
    ]
  }
}
```

## 凭证获取入口

飞书开放平台 → 创建应用 → 凭证与基础信息
https://open.feishu.cn/

## 注意事项

- 本插件处于快速迭代阶段，请关注官方更新日志
- 以用户身份发消息需额外开通权限，部分企业（如字节）不支持
- 建议先拿个人账号安全地测试，稳定后再接入工作环境
- **配置 key 统一为 `channels.feishu`**，不要用 `channels.openclaw-lark`（那是 plugin ID，不是 channel ID）
- **安装器不会自动启用渠道**，写完凭证后必须手动设 `enabled: true`
- **私聊不回复时先查 `dmPolicy`**，可能被设成了 `"allowList"`
