# Projects Index
# 所有项目的路径和当前状态，供 /project 命令使用

---

## 📂 Active Projects

> 无活动项目（系统刚刚初始化）

---

## 🔍 Usage

使用 `/project <name>` 时，Claude Code 会：
1. fuzzy-match 项目名 against 此 index
2. 读取 `memory/state/<name>.md` 的 ## State section
3. 加载相关的 topic files（根据 domain mapping）
4. 检查 today + yesterday daily logs 的 open threads

---

## 📋 All Projects

| Project | Path | Status | Last Session |
|---------|------|--------|-------------|

---

## 📝 Schema

每个项目的状态文件 `memory/state/<name>.md` 必须包含：

```
<!-- BEGIN STATE -->
## State
Last session: YYYY-MM-DD

Working: [当前工作]
Blocked: [阻塞原因]
Next: [下一步行动]
Recent:
- YYYY-MM-DD: 描述
<!-- END STATE -->
```

---

_Last updated: 2026-05-07 18:20_
