# memory-recall-inject — M0.5 Recall 注入插件

## 目标

在 `before_prompt_build` 阶段查询 atoms.db，将相关记忆以 `prependContext` 形式注入 prompt，实现 session 开始时自动 recall。

## 设计原则

- **最小化**：只做 recall + 注入，不做其他逻辑
- **非阻塞**：hook timeout 内必须完成（默认 30s，建议 15s）
- **幂等**：每次 turn 都查，但只注入与当前话题相关的记忆
- **不扰民**：注入内容简洁，≤500 字

## 技术方案

### Hook 选择
- `before_prompt_build`（plugin hook）— 唯一可注入 `prependContext` 的时机

### 注入策略
1. 从 `event.messages` 提取最后 1-2 条用户消息作为 query
2. 调用 `atoms-db.js` 的 `recall()` 方法
3. 取 top 3，过滤掉 importance < 0.5 的
4. 格式化为 `[记忆片段]` 列表，注入 `prependContext`

### 目录结构
```
plugins/
  memory-recall-inject/
    package.json
    openclaw-plugin.json    ← 插件元数据
    plugin/
      index.ts             ← 入口 + before_prompt_build handler
      recall.ts           ← recall 逻辑封装
    tsconfig.json
```

### openclaw-plugin.json
```json
{
  "id": "memory-recall-inject",
  "name": "Memory Recall Inject",
  "version": "0.1.0",
  "slots": ["contextEngine"]
}
```

等等 — `before_prompt_build` 是 agent turn hook，不需要 slot。这个插件不占用任何 slot。

### 关键代码

```typescript
// plugin/index.ts
api.on("before_prompt_build", async (event) => {
  const query = extractQueryFromMessages(event.messages);
  if (!query) return;
  
  const results = await recall(query, { top: 3, minScore: 0.5 });
  if (results.length === 0) return;
  
  const text = results
    .map(a => `[记忆] ${a.content}`)
    .join("\n");
  
  return { prependContext: text };
});
```

### 依赖
- `atoms-db.js`（已在 `memory/scripts/` 下）
- 从插件目录引用：`../../memory/scripts/atoms-db.js`（相对路径）

## 测试验证

1. 手动触发一次对话，检查 prependContext 是否注入
2. 对比有/无插件的 recall 质量
3. 测量 hook 执行时间（必须 < 15s）

## 风险

- atoms-db.js 路径耦合：插件和 memory/scripts 必须在同一 workspace
- 每次 turn 都查 atoms.db：性能需监控
- 注入内容可能暴露私人记忆：只注入与当前话题相关的（关键词匹配）

## 最终方案（已实现）

### 单文件插件 index.js
- 移除了 TypeScript/tsconfig（简化原型阶段）
- 直接用 `.js` ESM 模块
- 入口：`memory/plugins/memory-recall-inject/index.js`

### openclaw-plugin.json
```json
{
  "id": "memory-recall-inject",
  "activation": { "onStartup": true },
  "name": "Memory Recall Inject",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "topAtoms": { "type": "integer", "default": 3 },
      "minScore": { "type": "number", "default": 0.5 },
      "maxChars": { "type": "integer", "default": 500 },
      "timeoutMs": { "type": "integer", "default": 15000 }
    }
  }
}
```


### 路径解析
- thisFile: `<workspace>/memory/plugins/memory-recall-inject/index.js`
- workspaceRoot: `dirname(dirname(dirname(pluginDir)))` = workspace 根目录 ✅
- atoms-db.js: `<workspaceRoot>/memory/scripts/atoms-db.js` ✅


### Hook 返回值
```javascript
return { prependContext: text };
```
- prependContext 是 before_prompt_build 唯一支持的注入字段
- M0.5 阶段用它注入记忆片段

### 错误处理
- atoms-db.js 加载失败：console.warn + return（静默，不阻断 hook）
- recall 无结果：return（正常路径）

### 安装
```bash
openclaw plugins install ./memory/plugins/memory-recall-inject --link
openclaw gateway restart
```