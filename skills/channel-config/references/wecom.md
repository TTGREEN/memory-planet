# 企业微信（WeCom）渠道接入参考

## 插件信息

- **插件名称**：@wecom/wecom-openclaw-plugin（插件 ID: `wecom-openclaw-plugin`）
- **维护方**：企业微信官方
- **预装状态**：✅ 已预装（disabled），无需安装，直接配置启用
- **版本要求**：内置技能需 >= 1.0.9
- **官方文档**：https://work.weixin.qq.com/

## 接入流程

插件已预装。企微接入需扫码创建机器人获取凭证。

### 第一步：获取 source

向企业微信侧申请，获取唯一 source 标识。

### 第二步：扫码创建机器人

Agent 生成包含 WecomAIBotSDK 的 HTML 扫码页面，用户在浏览器中打开并扫码。

页面要求：

- 引入 `https://wwcdn.weixin.qq.com/node/wework/js/wecom-aibot-sdk@0.1.0.min.js`
- 点击按钮调用 `WecomAIBotSDK.openBotInfoAuthWindow({ source, onCreated, onError })`
- onCreated 回调中展示 botId 和 secret，提供一键复制功能
- ⚠️ **注意**：SDK 实际返回的字段名是**全小写** `botid`（不是驼峰 `botId`），取值时必须用大小写不敏感的方式匹配，或同时尝试 `payload.botid || payload.botId`

扫码页面模板见下方"扫码页面模板"章节。

### 第三步：配置 OpenClaw

获取到 botId 和 secret 后：

```bash
openclaw config set channels.wecom.botId <BOT_ID>
openclaw config set channels.wecom.secret <SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

或使用交互式：`openclaw channels add`

## 配置参考

| 配置路径                             | 说明                  | 选项                            | 默认值                          |
| ------------------------------------ | --------------------- | ------------------------------- | ------------------------------- |
| `channels.wecom.botId`               | 企微机器人 ID         | —                               | —                               |
| `channels.wecom.secret`              | 企微机器人密钥        | —                               | —                               |
| `channels.wecom.enabled`             | 是否启用渠道          | true/false                      | false                           |
| `channels.wecom.websocketUrl`        | WebSocket 端点        | —                               | wss://openws.work.weixin.qq.com |
| `channels.wecom.dmPolicy`            | 私聊访问策略          | pairing/open/allowlist/disabled | open                            |
| `channels.wecom.allowFrom`           | 私聊白名单（用户 ID） | —                               | []                              |
| `channels.wecom.groupPolicy`         | 群聊访问策略          | open/allowlist/disabled         | open                            |
| `channels.wecom.groupAllowFrom`      | 群聊白名单（群 ID）   | —                               | []                              |
| `channels.wecom.sendThinkingMessage` | 发送"思考中"占位消息  | true/false                      | true                            |

## 访问控制

### 私聊访问策略（dmPolicy）

| 策略        | 说明                                                  |
| ----------- | ----------------------------------------------------- |
| `open`      | 所有用户可直接私聊（默认）                            |
| `pairing`   | 需要审批配对，`openclaw pairing approve wecom <CODE>` |
| `allowlist` | 仅白名单用户可私聊，配置 `allowFrom`                  |
| `disabled`  | 禁用所有私聊                                          |

### 群聊访问策略（groupPolicy）

| 策略        | 说明                                  |
| ----------- | ------------------------------------- |
| `open`      | 所有群聊消息均响应（默认）            |
| `allowlist` | 仅白名单群响应，配置 `groupAllowFrom` |
| `disabled`  | 禁用所有群聊                          |

## 内置 Skills

| Skill 类别   | 能力说明                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| **消息**     | 接收用户消息（文本、图片、语音、视频、位置、链接）、发送应用消息、被动回复 |
| **通讯录**   | 读取部门/成员信息、搜索通讯录                                              |
| **应用管理** | 自定义菜单管理、应用会话管理                                               |
| **智能表格** | 通过 Webhook 接收外部数据写入智能表格                                      |
| **企微 API** | 通过 Bot ID + Secret 获取 access token，调用文档 API 等企微应用 API        |

## 扫码页面模板（HTML）

Agent 在配置企微时应自动生成此页面，将 `{{SOURCE}}` 替换为用户的 source：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>企业微信机器人 - 扫码创建</title>
    <style>
      body {
        font-family: -apple-system, sans-serif;
        max-width: 600px;
        margin: 40px auto;
        padding: 0 20px;
        background: #f5f5f5;
      }
      .card {
        background: white;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      h1 {
        font-size: 20px;
        margin-top: 0;
      }
      .btn {
        background: #07c160;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 16px;
        cursor: pointer;
      }
      .result {
        margin-top: 24px;
        display: none;
      }
      .field {
        margin: 16px 0;
      }
      .field label {
        font-weight: bold;
        display: block;
        margin-bottom: 4px;
      }
      .field .value {
        background: #f0f0f0;
        padding: 12px;
        border-radius: 6px;
        font-family: monospace;
        word-break: break-all;
      }
      .copy-btn {
        background: #1890ff;
        color: white;
        border: none;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        float: right;
      }
      .status {
        padding: 8px 12px;
        border-radius: 6px;
        margin-top: 12px;
      }
      .success {
        background: #f6ffed;
        color: #52c41a;
        border: 1px solid #b7eb8f;
      }
      .error {
        background: #fff2f0;
        color: #ff4d4f;
        border: 1px solid #ffccc7;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>🤖 企业微信 AI Bot 创建</h1>
      <ol>
        <li>点击"扫码创建机器人"按钮</li>
        <li>使用企业微信扫描弹出的二维码</li>
        <li>授权成功后，复制 Bot ID 和 Secret</li>
      </ol>
      <button class="btn" id="createBtn">扫码创建机器人</button>
      <div id="status"></div>
      <div class="result" id="result">
        <h2>✅ 创建成功</h2>
        <div class="field">
          <label>Bot ID</label>
          <div class="value">
            <span id="botId"></span
            ><button class="copy-btn" onclick="copyText('botId')">复制</button>
          </div>
        </div>
        <div class="field">
          <label>Secret</label>
          <div class="value">
            <span id="secret"></span
            ><button class="copy-btn" onclick="copyText('secret')">复制</button>
          </div>
        </div>
      </div>
    </div>
    <script src="https://wwcdn.weixin.qq.com/node/wework/js/wecom-aibot-sdk@0.1.0.min.js"></script>
    <script>
      const SOURCE = '{{SOURCE}}';
      function copyText(id) {
        navigator.clipboard.writeText(document.getElementById(id).textContent);
      }
      document.getElementById('createBtn').addEventListener('click', () => {
        document.getElementById('status').textContent = '等待扫码...';
        WecomAIBotSDK.openBotInfoAuthWindow({
          source: SOURCE,
          onCreated: bot => {
            // SDK 返回字段名为全小写 botid（非驼峰 botId），需兼容处理
            document.getElementById('botId').textContent =
              bot.botid || bot.botId || '';
            document.getElementById('secret').textContent = bot.secret || '';
            document.getElementById('result').style.display = 'block';
          },
          onError: e => {
            document.getElementById('status').textContent =
              '失败: ' + (e.message || e.code);
          },
        });
      });
    </script>
  </body>
</html>
```

## 诊断命令

| 命令                                    | 说明               |
| --------------------------------------- | ------------------ |
| `openclaw config get channels.wecom`    | 查看企微渠道配置   |
| `openclaw channels add`                 | 交互式添加企微渠道 |
| `openclaw pairing list wecom`           | 查看待审批配对请求 |
| `openclaw pairing approve wecom <CODE>` | 审批配对请求       |

## 凭证获取入口

- **Source 标识**：`step-fun`（已配置，Agent 生成扫码页面时直接使用此值）
- 企业微信开放平台：https://work.weixin.qq.com/

## 注意事项

- 建议新建企业来完整体验所有功能，避免影响生产环境
- 前端不要长期存储 secret，获取后立即通过 HTTPS 发给后端
- 弹窗被拦截时，确保调用发生在用户点击事件中
- Agent 生成扫码页面时，自动替换 SOURCE 并提供给用户
