# 钉钉（DingTalk）渠道接入参考

## 插件信息

- **插件名称**：`@dingtalk-real-ai/dingtalk-connector`（插件 ID: `dingtalk-connector`）
- **维护方**：钉钉 Real AI 团队
- **预装状态**：✅ 已预装 v0.7.9（disabled），无需安装，直接配置启用
- **升级命令**：`openclaw plugins update dingtalk-connector`
- **兼容性**：OpenClaw Gateway 0.4.0+
- **官方文档**：https://open.dingtalk.com/document/dingstart/install-openclaw-locally
- **源码仓库**：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector
- **问题反馈**：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues

## 接入流程

插件已预装，只需获取凭证并配置：

1. 在钉钉开放平台创建企业内部应用（https://open.dingtalk.com/ → 应用开发 → 创建企业内部应用）
2. 获取 Client ID、Client Secret
3. 配置机器人，获取 robotCode
4. 选择 Stream 模式（推荐）

```bash
openclaw config set channels.dingtalk-connector.clientId <CLIENT_ID>
openclaw config set channels.dingtalk-connector.clientSecret <CLIENT_SECRET>
openclaw config set channels.dingtalk-connector.robotCode <ROBOT_CODE>
openclaw config set channels.dingtalk-connector.enabled true
openclaw gateway restart
```

## 配置示例（openclaw.json）

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "{{钉钉应用 Client ID}}",
      "clientSecret": "{{钉钉应用 Client Secret}}",
      "robotCode": "{{机器人编码}}",
      "mode": "stream",
      "requireMention": true,
      "groupPolicy": "open",
      "streaming": true,
      "coolAppCode": "{{酷应用编码，可选}}",
      "separateSessionByConversation": true,
      "sharedMemoryAcrossConversations": false,
      "groupSessionScope": "group",
      "asyncMode": false,
      "ackText": "🫡 任务已接收，处理中..."
    }
  }
}
```

### 凭证字段说明

| 字段           | 必填 | 说明                             |
| -------------- | ---- | -------------------------------- |
| `clientId`     | 是   | 钉钉开放平台应用的 Client ID     |
| `clientSecret` | 是   | 钉钉开放平台应用的 Client Secret |
| `robotCode`    | 是   | 机器人编码                       |
| `coolAppCode`  | 否   | 酷应用编码（如需酷应用能力）     |

### 策略字段说明

| 字段                              | 默认值                       | 说明                                                  |
| --------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `mode`                            | `"stream"`                   | 连接模式：`"stream"`（推荐）/ `"http"`                |
| `requireMention`                  | `true`                       | 群聊中是否需要 @机器人 才响应                         |
| `groupPolicy`                     | `"open"`                     | 群组策略                                              |
| `streaming`                       | `true`                       | 是否启用流式输出                                      |
| `separateSessionByConversation`   | `true`                       | 按单聊/群聊/群区分独立会话                            |
| `sharedMemoryAcrossConversations` | `false`                      | 是否在不同会话间共享记忆                              |
| `groupSessionScope`               | `"group"`                    | `"group"`（群共享）/ `"group_sender"`（群内用户独立） |
| `asyncMode`                       | `false`                      | 异步模式：即时回执 + 后台处理 + 推送结果              |
| `ackText`                         | `"🫡 任务已接收，处理中..."` | 异步模式下的自定义回执消息                            |

### 多 Agent 配置示例

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret",
      "accounts": {
        "bot-a": {
          "clientId": "ding111",
          "clientSecret": "secret_a",
          "robotCode": "robot_a"
        },
        "bot-b": {
          "clientId": "ding222",
          "clientSecret": "secret_b",
          "robotCode": "robot_b"
        }
      },
      "bindings": [
        { "accountId": "bot-a", "agentId": "main" },
        { "accountId": "bot-b", "agentId": "coder" }
      ]
    }
  }
}
```

## 内置 Skills 详细说明

插件启用后所有 Skills 自动生效，无需单独安装。

### 1. 消息

- 收发消息（文本/Markdown/图片/语音/AI Card 流式输出）、表情、消息撤回

### 2. 富媒体接收

- JPEG/PNG 图片自动下载到 `~/.openclaw/workspace/media/inbound/`
- 下载的图片自动传递给视觉模型

### 3. 文件附件解析

- Word（.docx）：通过 mammoth 库提取文本注入 AI 上下文
- PDF（.pdf）：通过 pdf-parse 库提取文本注入 AI 上下文
- 文本文件（.txt/.md/.json）：内容直接注入消息
- 二进制文件（.xlsx/.pptx/.zip）：保存到磁盘并报告路径

### 4. 钉钉文档 API

- `docs.create()` - 在指定空间中创建新文档
- `docs.append()` - 在现有文档上追加 Markdown 内容
- `docs.search()` - 根据关键词搜索文档
- `docs.list()` - 列举指定空间下的所有文档
- `docs.read()` - ⚠️ 当前不可用（MCP 未提供读取 tool）

### 5. 多 Agent 路由

- 多个钉钉机器人分别绑定到不同 Agent，独立会话空间

### 6. 异步模式

- 即时回执 → 后台处理 → 主动推送结果

## 权限要求

- `Card.Streaming.Write`：AI Card 流式写入
- `qyapi_robot_sendmsg`：机器人发消息
- 需在钉钉开放平台配置事件订阅

## 凭证获取入口

钉钉开放平台 → 应用开发 → 企业内部应用
https://open.dingtalk.com/

## 注意事项

- 推荐使用 Stream 模式
- 会话超时由 Gateway 统一管理（`gateway.session.reset.idleMinutes`），插件内的 `sessionTimeout` 已废弃
- 多 Agent 场景需配置 `accounts` 和 `bindings`
