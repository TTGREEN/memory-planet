# 微博（Weibo）渠道接入参考

## 插件信息

- **插件名称**：`wecode-ai/openclaw-weibo`
- **维护方**：社区维护（wecode-ai），非官方插件
- **预装状态**：❌ 未预装，需手动安装
- **安装方式**：git clone + 本地安装
- **源码仓库**：https://gitee.com/wecode-ai/openclaw-weibo
- **许可证**：MIT

## 安装与接入

```bash
# 1. 克隆仓库
git clone https://gitee.com/wecode-ai/openclaw-weibo.git

# 2. 进入目录并安装插件
cd openclaw-weibo
openclaw plugins install .

# 3. 重启网关
openclaw gateway restart
```

## 获取凭证

1. 打开微博客户端，私信 [@微博龙虾助手](https://weibo.com/u/6808810981)
2. 发送消息：`连接龙虾`
3. 收到回复，获取 AppId 和 AppSecret
4. 如需重置凭证，发送 `重置凭证`

## 配置凭证

```bash
openclaw config set channels.weibo.appId <APP_ID>
openclaw config set channels.weibo.appSecret <APP_SECRET>
openclaw config set channels.weibo.enabled true
openclaw gateway restart
```

## 内置 Skills

| Skill 类别 | 能力说明                      |
| ---------- | ----------------------------- |
| **私信**   | 接收私信、发送私信、@提及检测 |
| **内容**   | 读取微博、发布微博、评论管理  |

## 注意事项

- 该插件由社区维护，非 OpenClaw 官方插件
- 插件通过域名 `open-im.api.weibo.com` 调用微博接口
- 遇到问题可在 Gitee 仓库提 Issue
