# 数据采集知识库

> 本文件沉淀数据采集的学习经验和 API 验证结果
> 最后更新：2026-05-12

---

## 验证成功的 API（5/5）

| API | 端点 | 验证状态 | 备注 |
|-----|------|----------|------|
| GitHub REST API | `api.github.com/repos/...` | ✅ | 需要 User-Agent header |
| Weather | `wttr.in/{city}?format=3` | ✅ | 纯文本，响应快 |
| NPM Registry | `registry.npmjs.org/{pkg}` | ✅ | JSON，无认证 |
| IP 定位 | `ip-api.com/json/` | ✅ | 免费限额 |
| Browser Automation | 百度 → 搜索 → 截图 | ✅ | Playwright 驱动 |

---

## 关键经验

### Node.js HTTP GET
```javascript
// 必须带 User-Agent header，否则很多 API 会拒绝
const res = await fetch(url, {
  headers: { 'User-Agent': 'node' }
});
```

### PowerShell 特殊字符
- URL 中 `&` 在字符串里会被解析为后台执行符
- 解决：URL 用单引号包裹，或用 `-Raw` 参数

---

## 进行中项目

### 1688 Chrome 扩展
- **状态**: 待仕泽确认扩展已正确安装
- **目标**: 采集 1688 商品标题、关键词、价格、销量
- **验证**: 扩展功能 + 本地服务器（`E:\browser-test\`）

### 下一步确认
- 数据采集的精确目标（商品哪些字段？）
- 采集频率和存储格式
- 是否需要增量采集

---

_Last updated: 2026-05-12_