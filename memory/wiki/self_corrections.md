# 纠错记录 - Self Corrections

> 记录日期：2026-05-18
> 用途：踩坑记录，防止重蹈覆辙

---

## 1. schema sync 失败

- **发现问题**: atoms-db.js 源码中的 schema 定义与实际运行中的 db 不同步
- **错误现象**: 新增字段（ref_struct, episodic_count）在 migration 后仍然缺失，导致 undefined 报错
- **根因**: 源码更新后 migration 脚本没有同步更新，且没有版本号追踪
- **修复方式**: 添加 schema_version 字段，migration 时对比版本号逐步执行
- **教训**: schema 变更需要版本化，不能靠"加了就算"

---

## 2. duplicate module path

- **发现问题**: better-sqlite3 require 路径出现重复定义
- **错误现象**: `Error: Cannot find module 'better-sqlite3'` 但明明安装了
- **根因**: 多个 package.json 或 node_modules 层级导致模块解析不一致
- **修复方式**: 使用绝对路径 require('C:/.../node_modules/better-sqlite3')
- **教训**: 跨项目复用模块时，require 路径要明确，不要依赖 NODE_PATH

---

## 3. ATOMS_DB_PATH defined twice

- **发现问题**: ATOMS_DB_PATH 在不同文件中重复定义
- **错误现象**: PowerShell 环境变量污染，导致路径指向错误位置
- **根因**: .env 和 process.env 同时设置，且优先级不明确
- **修复方式**: 统一使用单一定义点，移除重复定义
- **教训**: 常量只在一处定义，使用时只读不写

---

## 4. E_activation duplicate refStruct

- **发现问题**: E_activation 计算中 refStruct 被重复引用两次
- **错误现象**: 权重计算偏大，E_total 比预期高 30%+
- **根因**: 代码复制时保留了原 refStruct 逻辑，忘记调整参数
- **修复方式**: 重构为统一公式，refStruct 只参与一次计算
- **教训**: 复制粘贴后一定要检查参数来源和个数是否一致

---

## 5. PowerShell .Count 陷阱

- **发现问题**: PowerShell 中 `.Count` 在数组为空时返回 `1` 而不是 `0`
- **错误现象**: 空数组判断失效，导致意外进入分支
- **根因**: PowerShell 的 `.Count` 对 scalar 返回 1，对 array 返回实际长度
- **修复方式**: 使用 `$array.Count -gt 0` 或 `$array.Length -gt 0` 代替
- **教训**: PowerShell 和 Bash/JS 的数组边界行为不同，要单独注意

---

## 6. MEMORY.md 过大导致 Bootstrap 截断

- **发现问题**: MEMORY.md 超过 200 行限制，导致后续内容在启动时被截断
- **错误现象**: Bootstrap 阶段加载 MEMORY.md 但只显示前 200 行，AGENTS.md 等后续文件无法加载
- **根因**: 长期积累导致 MEMORY.md 臃肿，没有定期整理
- **修复方式**: 重新执行 MEMORY.md 整理，将内容分散到 topic 文件，MEMORY.md 只保留指针索引
- **教训**: MEMORY.md 有 200 行硬性上限，内容型知识应该放到 topic 文件而不是 index 文件

---

_最后更新：2026-05-18_