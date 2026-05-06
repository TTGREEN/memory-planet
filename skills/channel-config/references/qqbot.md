# QQ Bot 渠道接入参考

## 插件信息

- **插件名称**：`@tencent-connect/openclaw-qqbot`（插件 ID: `openclaw-qqbot`）
- **维护方**：腾讯官方（tencent-connect）
- **预装状态**：✅ 已预装 v1.5.7（disabled），无需安装，直接配置启用
- **官方入口**：https://q.qq.com/qqbot/openclaw/login.html
- **源码仓库**：https://github.com/tencent-connect/openclaw-qqbot

## 接入流程

插件已预装，只需获取凭证并配置：

1. 在 QQ 开放平台创建机器人（https://q.qq.com/）
2. 获取 AppID、Token、AppSecret
3. 配置 Intents（消息意图）

```bash
openclaw config set channels.qqbot.appId <APP_ID>
openclaw config set channels.qqbot.token <TOKEN>
openclaw config set channels.qqbot.appSecret <APP_SECRET>
openclaw config set channels.qqbot.enabled true
openclaw gateway restart
```

## 配置示例（openclaw.json）

```json
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "{{QQ 机器人 AppID}}",
      "token": "{{QQ 机器人 Token}}",
      "appSecret": "{{QQ 机器人 AppSecret}}",
      "sandbox": false,
      "intents": [
        "GROUP_AT_MESSAGE_CREATE",
        "C2C_MESSAGE_CREATE",
        "DIRECT_MESSAGE_CREATE"
      ],
      "requireMention": true,
      "groupPolicy": "open"
    }
  }
}
```

### 凭证字段说明

| 字段        | 必填 | 说明                          |
| ----------- | ---- | ----------------------------- |
| `appId`     | 是   | QQ 开放平台机器人的 AppID     |
| `token`     | 是   | QQ 开放平台机器人的 Token     |
| `appSecret` | 是   | QQ 开放平台机器人的 AppSecret |

### 策略字段说明

| 字段             | 默认值   | 说明                          |
| ---------------- | -------- | ----------------------------- |
| `sandbox`        | `false`  | 是否使用沙箱环境              |
| `intents`        | `[]`     | 消息意图列表                  |
| `requireMention` | `true`   | 群聊中是否需要 @机器人 才响应 |
| `groupPolicy`    | `"open"` | 群组策略                      |

### Intents 说明

| Intent                    | 说明                     |
| ------------------------- | ------------------------ |
| `GROUP_AT_MESSAGE_CREATE` | 群聊 @消息               |
| `C2C_MESSAGE_CREATE`      | 私聊消息                 |
| `DIRECT_MESSAGE_CREATE`   | 频道私信                 |
| `GUILD_MESSAGES`          | 频道消息（仅私域机器人） |

## 内置 Skills

| Skill 类别   | 能力说明                                                             |
| ------------ | -------------------------------------------------------------------- |
| **消息**     | 接收群聊 @消息、私聊消息、频道消息；发送文本/图片/Markdown/Embed/Ark |
| **频道**     | 频道管理、子频道管理                                                 |
| **事件**     | 群成员变动、频道变动等事件订阅                                       |
| **定时任务** | qqbot-cron 定时任务管理                                              |
| **媒体处理** | qqbot-media 媒体文件处理                                             |

## 凭证获取入口

QQ 开放平台 → 机器人 → 创建机器人
https://q.qq.com/

## 注意事项

- 群聊场景需 `GROUP_AT_MESSAGE_CREATE` intent
- 私聊场景需 `C2C_MESSAGE_CREATE` intent
- 频道私信需 `DIRECT_MESSAGE_CREATE` intent
