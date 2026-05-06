# 历史记忆整合摘要
**来源：** `.openclaw_backup_20260427_112545`
**整合时间：** 2026-05-06
**用途：** 归档前提炼，后续可按需查阅

---

## 一、Github生态8项目最佳模式（2026-04-25）

### 1. STATUS.md 项目驱动（Claw-auto-coding）
- 每个项目一个 `STATUS.md`，跟踪进度/阻塞/下一步
- 单点事实原则，避免多人协作信息不一致

### 2. 独立监控服务（openclaw-buddy）
- Go + React 独立控制台，WebSocket 实时推送
- 自我修复：自动备份 + 异常检测 + 自动恢复

### 3. 认知闭环（Consciousness Engine）
- Perception → Engine → Memory → Learning → Reflection
- 主动推理，不是被动响应

### 4. 技能优化工具包（skill-optimization）
- 基于历史任务轨迹自动生成技能模板
- 质量循环：generate → enhance → audit 闭环

### 5. 模型/工具优先级可配置（Agent Optimization）
- `control-default-chain.json` 定义 Agent 执行顺序
- 根据任务类型动态选择模型

---

## 二、关键踩坑记录（2026-04-27）

### 系统配置踩坑
| 坑 | 解 |
|----|---|
| Gateway respawn 循环 | `gateway.cmd` 加 `OPENCLAW_NO_RESPAWN=1` |
| Bonjour 配置不支持 | `discovery.mdns.mode="off"` |
| PowerShell 输出 Unicode 崩溃 | 重定向到 UTF-8 文件再读取 |
| MEMORY.md 超限（16K字符） | 保持在 200行/~25KB 以内 |

### 1688 项目踩坑
| 坑 | 解 |
|----|---|
| nomic-embed-text 中文单词向量不稳定 | 转换为描述性句子后再计算 embedding |
| KEYWORDS_FILE 硬编码路径不存在 | 用 `__dirname` 向上查找 |
| server.js 第52行 `await` 在非 async 函数 | 修复函数签名为 `async loadKeywords()` |
| node_modules 72个包缺失 | `npm install` |
| Chrome 扩展目录位置错误 | 复制到标准位置后加载 |
| Playwright/Selenium/Puppeteer 全部被检测 | Chrome Extension 是唯一可行方案 |

---

## 三、1688 mtop API 逆向核心结论

### 签名算法（已验证）
```
sign = MD5(appKey + timestamp + token + data).toLowerCase()
appKey = "12574478"（1688固定）
```

### 2025年新反爬
- **x5sec**：加密字段（算法未知）
- **acsign**：额外签名层
- **utdid**：22位设备指纹
- **cookie 有效期**：长期 → **15分钟**

### 混合排序
```
final_score = 0.4 * norm(BM25) + 0.6 * semantic_sim
```

### 短文本 embedding 异常
- 单词级：`"银项链" vs "T恤"` → 相似度 0.9786 ❌
- 句子级：`"银项链 首饰 饰品" vs "T恤 衣服 服装"` → 0.4706 ✅

---

## 四、skill_quality_report.json 质量基准

| 等级 | 数量 | 代表技能 |
|------|------|----------|
| OK (≥4分) | 3 | agent-browser-clawdbot, chrome-extension-dev, proactivity |
| WARN (2-3分) | 26 | self-learning, monitor-agent, skill-creator... |
| FAIL (<2分) | 5 | code-quality, js-deobfuscator, knowledge-1688-scraper... |

**评分维度：** description / trigger / steps / examples / tools / code 各1分，满分6分

---

## 五、自我学习循环设计（来自 skill-creator）

### 质量循环闭环
```
generate → enhance → audit → 报告
```

### 重复模式阈值
- ≥3次相同类型任务 → 触发技能生成
- 防重复机制：已存在技能自动跳过（--force 覆盖）

### 12种任务类型模板
command / search / read_file / write_file / memory_operation / web_fetch / skill_management / monitoring / scheduling / edit_file / image_operation / audit / general

---

## 六、PlayGround 自学习设计

### 空间管理
- **总大小限制**：5GB
- 创建前检查剩余空间
- 超限时自动清理最旧已完成项目

### 自学习 Cron
```javascript
{
  name: 'self-learning-idle',
  schedule: { kind: 'cron', expr: '0 */2 * * *', tz: 'Asia/Shanghai' },
  sessionTarget: 'isolated',
  payload: { kind: 'agentTurn', message: '执行 self-learning...' },
  delivery: { mode: 'announce' }
}
```

### 核心原则
1. 绝不打扰用户（检测到活动立即停止）
2. 验证大于理论
3. 不产生技术债务（不留半成品）

---

*整理自：A、B、C、F 文件*
*原文位置：`memory/archive/2026-04-25.md` 等原始文件*
