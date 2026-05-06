# 微信（WeChat）渠道接入参考

## 插件信息

- **插件名称**：openclaw-weixin（插件 ID: `openclaw-weixin`）
- **npm 包**：`@tencent-weixin/openclaw-weixin`
- **预装版本**：v1.0.2
- **维护方**：腾讯官方
- **预装状态**：✅ 已预装（disabled），无需安装，手动配置启用
- **配置 key**：`channels.openclaw-weixin`
- **官方 API**：https://ilinkai.weixin.qq.com

## 一、前置条件

- OpenClaw Gateway 运行中
- 网络能访问 `https://ilinkai.weixin.qq.com`（国内 API）

---

## 二、启用与登录

插件已预装，默认未启用。无需 `npm install -g openclaw`（新版已自动注入 openclaw PATH）。

### 步骤一：启用渠道

通过 CLI 启用（需同时启用 channel 和 plugin）：

```bash
openclaw config set channels.openclaw-weixin.enabled true
openclaw config set plugins.entries.openclaw-weixin.enabled true
```

或直接编辑 `~/.stepclaw/openclaw.json`：

```json
{
  "channels": { "openclaw-weixin": { "enabled": true } },
  "plugins": { "entries": { "openclaw-weixin": { "enabled": true } } }
}
```

也可通过 `config.patch` 工具（Agent 调用）：

```json
{
  "action": "config.patch",
  "raw": "{\"channels\":{\"openclaw-weixin\":{\"enabled\":true}},\"plugins\":{\"entries\":{\"openclaw-weixin\":{\"enabled\":true}}}}"
}
```

> **Agent 注意**：`config.patch` 必须用 `raw`（JSON 字符串），不能用 `patch` 字段，否则报 `"error": "raw required"`。

### 步骤二：扫码登录

```bash
openclaw channels login --channel openclaw-weixin
```

> **Agent 注意**：Windows 下可能先输出 `Warning: PTY spawn failed ...retrying without PTY`，**这是正常的**，命令仍在后台运行。用 `process poll/log` 轮询对应 session 等待二维码输出即可。

终端自动显示二维码，用微信扫码确认授权即可。凭证自动保存到：

- `~/.stepclaw/openclaw-weixin/accounts/<accountId>.json`
- `~/.stepclaw/openclaw-weixin/accounts.json`（账户索引）

### 步骤三：重启网关

```bash
openclaw gateway restart
```

---

## 三、坑点汇总

### 3.1 安全警告（误报）

安装时会提示：

```
WARNING: Plugin "openclaw-weixin" contains dangerous code patterns:
Environment variable access combined with network send — possible credential harvesting
```

这是插件读取凭证并发送到微信 API 的正常行为，忽略即可。

### 3.2 命令名称易混淆

- 插件命令是 **`plugins`**（复数），不是 `plugin`。`openclaw plugin add ...` 会报 `unknown command 'plugin'`
- 渠道名是 **`openclaw-weixin`**，不是 `weixin`。使用 `--channel weixin` 会报 `Unsupported channel: weixin`

### 3.3 二维码过期与自动刷新

二维码有有效期，过期后终端会尝试自动刷新（次数与提示以实际输出为准）：

```
⏳ 二维码已过期，正在刷新...(x/y)
🔄 新二维码已生成，请重新扫描
```

若自动刷新仍失败或次数用尽，需重新运行 `openclaw channels login --channel openclaw-weixin`。准备好微信后再执行命令，生成后立即扫描。

### 3.4 Windows 终端二维码乱码

Windows 终端可能因编码问题（UTF-8 被解释为 GBK）导致二维码显示为乱码：

```
鈻勨杽鈻勨杽鈻勨杽鈻勨杽...
```

**处理优先级**：优先尝试终端二维码 → 乱码时改用桌面二维码图片方案（见 3.7）。

### 3.5 凭证权限

```bash
chmod 600 ~/.stepclaw/openclaw-weixin/accounts/*.json
```

### 3.6 多账号支持

每次扫码登录都会创建一个新的账号条目，支持多个微信号同时在线。

```bash
cat ~/.stepclaw/openclaw-weixin/accounts.json
```

### 3.7 桌面二维码图片方案（终端方案失败时的备选）

当终端二维码无法正常显示或扫描困难时，生成图片文件到桌面。

**macOS**（需要 `qrencode`）：

```bash
curl -s "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3" -o /tmp/qr.json
QR_URL=$(python3 -c "import json; d=json.load(open('/tmp/qr.json')); print(d['qrcode_img_content'])")
qrencode -o ~/Desktop/weixin-qr.png -s 10 -m 2 "$QR_URL"
open ~/Desktop/weixin-qr.png   # macOS 自动打开
```

**Windows PowerShell**（需要 `pip install segno`）：

> segno 是纯 Python 库、无需 Pillow，避免 Windows 上 qrcode + Pillow 的兼容性问题。

```powershell
Invoke-RestMethod -Uri "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3" -OutFile $env:TEMP\qr.json
python -c "
import json, segno, os
with open(os.path.join(os.environ['TEMP'], 'qr.json')) as f:
    url = json.load(f)['qrcode_img_content']
qr = segno.make(url, error='h')
desktop = os.path.join(os.path.expanduser('~'), 'Desktop', 'weixin-qr.png')
qr.save(desktop, scale=10, border=4)
print('二维码已保存到桌面: ' + desktop)
"
Start-Process "$env:USERPROFILE\Desktop\weixin-qr.png"
```

### 3.8 消息路由到错误渠道（session 共享）

**现象**：微信消息显示在网页聊天中，微信端收不到回复。

**原因**：OpenClaw 默认将同一用户的消息路由到同一 session（`agent:main:main`），微信和网页聊天共享会话。

**说明**：这是正常行为，非 bug。如需隔离，需为微信创建独立 session 或使用不同 agent。

### 3.9 发送消息需指定 accountId

**现象**：Agent 用 `message` 工具发送微信消息时报错 `accountId is required`。

**解决**：发送时必须显式指定 `accountId`：

```json
{
  "action": "send",
  "channel": "openclaw-weixin",
  "accountId": "<accountId>",
  "target": "用户微信ID@im.wechat"
}
```

accountId 可从 `~/.stepclaw/openclaw-weixin/accounts.json` 获取。

### 3.10 CLI 诊断命令报错不影响流程

**现象**：`openclaw plugins list` 等 CLI 命令可能无输出且退出码 1（尤其 Windows 上 PATH 或 stepclaw-core 环境问题）。

**处理**：不要纠结 CLI 诊断失败，跳过继续跑流程。可改用 `gateway config.get` 查看配置和插件状态。

### 3.11 插件需要在两处启用

插件状态显示 `loaded` 但发消息无回复时，检查是否**同时**启用了 `channels` 和 `plugins.entries`：

```json
{
  "channels": { "openclaw-weixin": { "enabled": true } },
  "plugins": { "entries": { "openclaw-weixin": { "enabled": true } } }
}
```

只设 `channels` 不设 `plugins.entries`（或反过来）会导致消息不通。

配置修改后若消息仍不通，提示用户在悬浮输入框下方点击**齿轮按钮**打开设置弹窗，手动点击**重启 StepClaw**。

### 3.12 凭证文件格式

扫码后凭证自动写入，手动修复时注意格式：

```
~/.stepclaw/openclaw-weixin/
├── accounts.json                    # 字符串数组: ["4f2b2731a3a8-im-bot"]
└── accounts/
    └── 4f2b2731a3a8-im-bot.json     # 账号数据
```

账号数据关键字段：

```json
{
  "token": "4f2b2731a3a8@im.bot:xxxxxx",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "userId": "o6cq81-xxx@im.wechat"
}
```

- `accounts.json` 是**字符串数组**，不是对象
- 账号 ID 用 normalized 格式（`@` `.` 替换为 `-`），如 `4f2b2731a3a8-im-bot`
- token 字段名是 `token`，不是 `bot_token`

### 3.13 扫码后凭证未自动写入

Windows 上 `openclaw channels login` 可能因 PTY 问题导致凭证未自动保存。Workaround：手动调用 API 获取二维码，扫码后按 3.12 格式手动写入凭证文件。

### 3.14 凭证路径由 OPENCLAW_STATE_DIR 决定

文档中 `~/.stepclaw/` 路径来自环境变量 `OPENCLAW_STATE_DIR`（阶跃 AI 桌面端默认值）。若手动操作凭证文件，**先确认实际路径**：

```bash
echo $OPENCLAW_STATE_DIR
# 或
openclaw config get --key state.dir
```

常见错误：将凭证写入 `~/.openclaw/`（OpenClaw 上游默认），但桌面端实际读取 `~/.stepclaw/`，导致插件找不到账号。

---

### 3.15 直接提供扫码链接（最后手段）

> **Agent 提示**：勿优先向用户抛出网页链接。只有在用户已依次尝试 **终端扫码（步骤二）**、**桌面二维码图片（3.7）** 等常规方式仍无法完成登录后，才允许将接口返回的 **`qrcode_img_content` 网页链接** 直接提供给用户，由其在手机浏览器中打开并完成扫码。

---

---

## 四、排障流程

```bash
# 检查渠道状态
openclaw channels list
openclaw channels status

# 检查插件加载状态
openclaw plugins list
openclaw plugins info openclaw-weixin

# 检查凭证文件
ls -la ~/.stepclaw/openclaw-weixin/accounts/

# 检查 API 连通性
curl -sI --connect-timeout 5 "https://ilinkai.weixin.qq.com"

# 实时查看日志
tail -f ~/.stepclaw/logs/openclaw.log | grep -i weixin

# 重启 Gateway
openclaw gateway restart
```

---

## 五、API 参考

| 接口         | 路径           | 说明                    |
| ------------ | -------------- | ----------------------- |
| getUpdates   | `getupdates`   | 长轮询获取新消息        |
| sendMessage  | `sendmessage`  | 发送消息                |
| getUploadUrl | `getuploadurl` | 获取 CDN 上传预签名 URL |
| getConfig    | `getconfig`    | 获取账号配置            |
| sendTyping   | `sendtyping`   | 发送/取消输入状态       |

基础地址：`https://ilinkai.weixin.qq.com`

二维码相关：

- **获取二维码**: `GET /ilink/bot/get_bot_qrcode?bot_type=3`
- **查询扫码状态**: `GET /ilink/bot/get_qrcode_status?qrcode={qrcode}`

响应示例：

```json
{
  "qrcode": "xxxxxxxx",
  "qrcode_img_content": "https://liteapp.weixin.qq.com/q/xxx?qrcode=xxx&bot_type=3",
  "ret": 0
}
```

---

## 六、文件位置

| 类型     | 路径                                        |
| -------- | ------------------------------------------- |
| 插件目录 | `~/.stepclaw/extensions/openclaw-weixin`    |
| 配置文件 | `~/.stepclaw/openclaw.json`                 |
| 账号数据 | `~/.stepclaw/openclaw-weixin/accounts/`     |
| 账户索引 | `~/.stepclaw/openclaw-weixin/accounts.json` |

---

## 七、相关文档

- 插件 README：`~/.stepclaw/extensions/openclaw-weixin/README.zh_CN.md`
- OpenClaw 文档：https://docs.openclaw.ai

> 若出现 `fetch failed` 等网络报错，可能与代理有关。
