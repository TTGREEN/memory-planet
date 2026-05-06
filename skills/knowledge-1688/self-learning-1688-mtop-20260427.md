# 自主学习成果：1688 MTOP API 签名机制深度解析

## 📅 学习日期
2026-04-27

## 🎯 学习方向
**当前项目深化**：1688 商品爬取插件开发中的 mtop 搜索接口调用与反爬虫对抗

## 📚 知识来源

### 主要参考资料
1. **《某宝sign参数逆向分析》** (CSDN, 2026-02)
   - sign 生成的核心算法：`md5(appKey + t + token + data)`
   - token 来自 `_m_h5_tk` cookie 的第一部分
   - 使用 DOM 断点 + Charles 抓包定位加密位置

2. **《逆向实战：某宝主搜API的x-sign/x-miniwua签名生成与调用全解析》** (CSDN, 2026-04)
   - x-sign 和 x-miniwua 双重签名验证
   - 关键参数：deviceId, utdid(22位设备ID), timestamp, appKey, api, data
   - utdid 生成规则：前8位时间戳16进制 + 中间6位随机 + 后8位设备信息哈希

3. **《高效爬取某宝：Python JS 逆向与多线程结合实践》** (腾讯云, 2026-01)
   - 技术栈：execjs 执行 JS 逆向代码 + ThreadPoolExecutor 多线程
   - appKey: 12574478 (Taobao)
   - _m_h5_tk 格式：`token_t_random`
   - Cookie 需要从响应头动态更新

4. **《如何计算阿里系Ajax请求中的sign签名》** (鲲鹏网络, 2021-10)
   - 针对 1688 的 sign 计算详细流程
   - JS 函数 h(a) 实现自定义位运算加密
   - Python 调用 JS 代码 via execjs

5. **《从0到1，用Python写一套"会呼吸"的1688商品详情爬虫》** (CSDN, 2026-04-22)
   - **2025年9月更新**：搜索列表页全部走 mtop 接口，cookie 有效期缩短到15分钟
   - **2025年3月更新**：全面启用 x5sec 参数与 acsign 签名
   - 技术选型：Selenium 4.11（过滑块） + 自建加密函数 + asyncio + aiohttp + 代理池

## 🔑 核心知识点

### 1. Sign 签名算法（基础版）
```javascript
// JS 原始逻辑
function generateSign(appKey, timestamp, token, data) {
  const str = appKey + timestamp + token + data;
  return md5(str);
}

// Python 等效实现
import hashlib
def generate_sign(app_key, t, token, data_str):
  sign_str = app_key + t + token + data_str
  return hashlib.md5(sign_str.encode()).hexdigest()
```

**参数说明**：
- `appKey`: 应用密钥（Taobao: 12574478，1688 需实际抓包获取）
- `t`: 13位时间戳（毫秒）
- `token`: `_m_h5_tk` 分割后的第一部分（`split('_')[0]`）
- `data`: 请求体 JSON 字符串（无空格压缩格式）

### 2. _m_h5_tk 生成与维护
```javascript
function generateMtk(token, t) {
  return token + '_' + t + '_' + Math.floor(Math.random() * 1000);
}
```

**生命周期**：
1. 首次请求：从响应头 `Set-Cookie` 提取 `_m_h5_tk`
2. 每次请求前：基于当前 token 生成新的 _m_h5_tk
3. 每次请求后：从响应头更新 _m_h5_tk（token 部分可能变化）
4. **重要**：2025年9月后，cookie 有效期缩短至15分钟，需频繁刷新

### 3. 完整请求参数示例（1688 搜索接口）
```python
# 目标接口（推测）
BASE_URL = "https://h5api.m.1688.com/h5/mtop.1688.search.core/1.0/"

# 请求头
headers = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 8.1.0; Xiaomi 8 Build/OPM1.171019.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Referer": "https://s.1688.com/",
  "Cookie": f"_m_h5_tk={encrypted_mtk};",
  "Host": "h5api.m.1688.com",
  "Content-Type": "application/x-www-form-urlencoded"
}

# 请求体 (x-www-form-urlencoded)
payload = {
  "jsv": "2.6.1",
  "appKey": app_key,
  "t": timestamp,
  "sign": sign,
  "data": data_json_str
}
```

### 4. 2025年新增反爬机制
| 时间 | 更新 | 影响 |
|------|------|------|
| 2025-03 | x5sec 参数 + acsign 签名 | 需要逆向新加密逻辑 |
| 2025-09 | 搜索页全转 mtop 接口 | 传统 HTML 解析失效 |
| 2025-09 | Cookie 有效期 → 15 min | 需频繁刷新 token |

**x5sec 可能格式**：`x5sec=xxx;` 类似淘宝的 `_m_h5_tk_enc`，用于加密验证

### 5. 设备指纹参数（x-miniwua / utdid）
```python
def generate_utdid():
  # 22位设备ID
  # 格式：前8位(时间戳16进制) + 中6位(随机) + 后8位(设备哈希)
  import time, random, hashlib
  ts_hex = hex(int(time.time()))[2:10].zfill(8)
  rand_chars = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))
  device_hash = hashlib.md5(f"{ts_hex}{rand_chars}".encode()).hexdigest()[:8]
  return (ts_hex + rand_chars + device_hash).lower()
```

### 6. 多线程异步优化（生产环境建议）
```python
# asyncio + aiohttp 方案（推荐）
import aiohttp
import asyncio

async def fetch_page(session, keyword, page):
  # 生成加密参数
  # 发送请求
  # 更新 cookies
  pass

async def main():
  connector = aiohttp.TCPConnector(limit=100)  # 并发连接数
  async with aiohttp.ClientSession(connector=connector) as session:
    tasks = [fetch_page(session, "关键词", i) for i in range(1, 11)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
```

## 💡 实践验证计划

### 实验目标
1. 捕获 1688 搜索页面的真实 mtop 请求
2. 提取 appKey、api 接口名、实际参数结构
3. 用 Python 复现 sign 生成
4. 成功发起一次合法请求并获取 JSON 数据

### 实验步骤
1. **环境准备**
   - 安装 Playwright（比 Selenium 更快，支持自动下载浏览器）
   - 配置代理（建议 2c 住宅代理）
   - Node.js 环境（用于 execjs）

2. **抓包分析**
   - 打开 1688 搜索页：`https://s.1688.com/s/offer_search.htm`
   - F12 → Network → XHR/Fetch
   - 搜索关键词，找到 `mtop.1688.search.core` 相关请求
   - 复制 Request Headers 和 Request Payload

3. **JS 逆向**
   - 在 Sources 面板搜索 `mtop`、`sign`、`_m_h5_tk`
   - 定位加密函数，提取核心逻辑
   - 保存为 `1688_encrypt.js`

4. **Python 封装**
   - 用 execjs 调用 JS 函数
   - 或者用 Python 重写加密逻辑（性能更好）

5. **测试**
   - 单页请求验证
   - 多页循环（注意请求间隔 >0.5s）
   - 错误处理（retry 机制）

## 📊 实验记录（待实际执行）

### 抓包结果模板
```
接口 URL: https://h5api.m.1688.com/h5/mtop.xxx/1.0/
appKey: ??? (需捕获)
api: mtop.1688.search.core/1.0
t: 1703625600000
sign: 32位md5
_m_h5_tk: token_t_random
data: {"q":"手机","pageNo":1,"pageSize":20,...}
```

### 预期问题
1. **appKey 未知** → 需要从 JS 代码或抓包提取
2. **acsign 参数** → 2025年新增，需额外逆向
3. **x5sec 验证** → 可能在请求头，需分析
4. **Cookie 绑定 IP** → 需使用会话保持的代理

## 🧹 清理清单（实验完成后）
- [ ] 删除 PlayGround 临时目录
- [ ] 清除测试产生的缓存文件
- [ ] 清理代理 IP 列表（如有）
- [ ] 更新 MEMORY.md 保留核心结论

## 📝 总结（学习成果）

### ✅ 已掌握
- sign 生成的核心算法：`md5(appKey + t + token + data)`
- _m_h5_tk 的结构与维护策略
- 1688 反爬虫策略的演进 timeline（2024-2025）
- 多线程异步爬取的工程化方案
- 代理池与指纹随机化的必要性

### ⚠️ 待验证
- 1688 实际使用的 appKey 值（可能与淘宝不同）
- 2025年新增的 x5sec/acsign 具体算法
- mtop 接口的完整参数结构（需实际抓包）
- Cookie 15分钟有效期的刷新机制

### 🎯 可应用于当前项目
1. **优先级 P0**：实现 sign 生成模块（支持 JS 调用和 Python 双模式）
2. **优先级 P1**：设计 Cookie 池管理（自动刷新、轮换）
3. **优先级 P2**：集成 asyncio 异步下载器
4. **优先级 P3**：添加代理支持与失败重试

### 🔗 相关技能
- `web-scraping`：网页抓取基础
- `stealth-browser-pro`：浏览器自动化反检测
- `concurrency-pool`：并发控制方案
- `knowledge-fetch-self-grow`：知识检索技能（本实验所用）

---

**实验状态**：知识学习完成，待实际代码验证
**预估验证时间**：2-3 小时
**价值评估**：⭐⭐⭐⭐⭐（直接解决项目核心卡点）
