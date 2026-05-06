/**
 * 1688标题采集 - 最终方案
 * 
 * 策略1: mtop API (feng25927 逆向) - 需要 _m_h5_tk token
 * 策略2: 导入 Chrome 已登录 cookie → mtop API
 * 策略3: Chrome Extension → 真实浏览器 DOM 采集（如果插件可用）
 * 
 * 依赖: Node.js, 无需 pip install
 * 用法: node collect_1688.js <关键词> [页码]
 */

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ─────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────
function parseJSONP(raw) {
  const m = raw.match(/callback\s*\(\s*(\{.*\})\s*\)\s*$/s);
  if (m) return JSON.parse(m[1]);
  return JSON.parse(raw);
}

async function httpGet(url, headers = {}) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, cookies: res.headers["set-cookie"] }));
    });
    req.on("error", e => resolve({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

// ─────────────────────────────────────────
// mtop API 调用 (feng25927 逆向)
// ─────────────────────────────────────────
const APP_KEY = "12574478";
const APP_ID = "32517";

async function mtopRequest(keyword, page = 1, token = null) {
  const t = Date.now().toString();
  const paramsDict = {
    verticalProductFlag: "pccps",
    searchScene: "pcOfferSearch",
    charset: "utf8",
    beginPage: page,
    pageSize: 60,
    keywords: keyword,
    method: "getOfferList"
  };
  const paramsStr = JSON.stringify(paramsDict);
  const dataDict = { appId: APP_ID, params: paramsStr };
  const data = JSON.stringify(dataDict);

  // Sign 算法 (feng25927): MD5(token&timestamp&appKey&data)
  const signInput = token ? `${token}&${t}&${APP_KEY}&${data}` : `&${t}&${APP_KEY}&${data}`;
  const sign = crypto.createHash("md5").update(signInput).digest("hex");

  const query = [
    `jsv=2.7.4`, `appKey=${APP_KEY}`, `t=${t}`, `sign=${sign}`,
    `api=mtop.relationrecommend.WirelessRecommend.recommend`, `v=2.0`,
    `type=jsonp`, `timeout=20000`,
    `data=${encodeURIComponent(data)}`
  ].join("&");

  const url = `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/?${query}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Referer": "https://s.1688.com/",
    "Origin": "https://s.1688.com",
    "Accept": "*/*"
  };
  if (token) headers["Cookie"] = `_m_h5_tk=${token.split(".")[0]}; _m_h5_tk_enc=a82b218cc28f60d9f55480cb7526ecf6`;

  const res = await httpGet(url, headers);
  if (res.error) return { success: false, error: res.error };

  try {
    const json = parseJSONP(res.body);
    if (json.ret && json.ret[0] && json.ret[0].startsWith("FAIL")) {
      const errMsg = json.ret[0].split("::")[1] || json.ret[0];
      return { success: false, error: errMsg, raw: res.body.slice(0, 200) };
    }
    // 解析 mtop 响应 → 提取标题列表
    const items = parseMtopResult(json);
    return { success: true, data: items, total: items.length };
  } catch(e) {
    return { success: false, error: "parse error: " + e.message, raw: res.body.slice(0, 200) };
  }
}

function parseMtopResult(json) {
  // mtop 返回格式: { data: { result: [...offers...] } }
  // offer 字段: offerId, subject(标题), price(价格), ... 
  const result = json && json.data && json.data.result;
  if (!result) return [];
  
  const raw = typeof result === "string" ? JSON.parse(result) : result;
  const offers = Array.isArray(raw) ? raw : (raw.moduleList || raw.result || []);
  
  return offers
    .filter(o => o && o.offerId)
    .map(o => ({
      offerId: String(o.offerId),
      title: o.subject || o.title || "",
      price: o.price || "",
      shopName: o.shopName || "",
      link: `https://detail.1688.com/offer/${o.offerId}.html`
    }))
    .filter(o => o.title && o.title.length > 5);
}

// ─────────────────────────────────────────
// 策略2: 从 Chrome 导出 cookie (Windows)
// ─────────────────────────────────────────
async function getCookiesFromChrome(domain) {
  const chromeCookiePath = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Google",
    "Chrome",
    "User Data",
    "Default",
    "Network",
    "Cookies"
  );
  const tmpCookiePath = path.join(os.tmpdir(), "1688_cookies.json");

  // Windows 用 PowerShell 读取 Chrome Cookie (SQLite)
  const ps = `
Add-Type -AssemblyName System.Data.SQLite -ErrorAction SilentlyContinue;
$db = "${chromeCookiePath.replace(/\\/g, "\\\\")}";
if (!(Test-Path $db)) { Write-Output '{"error":"Chrome cookie file not found"}'; exit; }
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$db;ReadOnly=True");
$conn.Open();
$cmd = $conn.CreateCommand();
$cmd.CommandText = "SELECT host_key, name, value, path, expires_utc FROM cookies WHERE host_key LIKE '%1688%'";
$reader = $cmd.ExecuteReader();
$cookies = @();
while ($reader.Read()) {
  $cookies += @{
    host = $reader.GetString(0);
    name = $reader.GetString(1);
    value = $reader.GetString(2);
    path = $reader.GetString(3);
    exp = $reader.GetInt64(4);
  };
}
$reader.Close(); $conn.Close();
$cookies | ConvertTo-Json -Depth 3
`;

  return new Promise((resolve) => {
    const outFile = path.join(os.tmpdir(), "chrome_cookies_" + Date.now() + ".json");
    const psFile = path.join(os.tmpdir(), "get_cookies_" + Date.now() + ".ps1");
    
    // Write PS with UTF-8 BOM
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(psFile, BOM);
    fs.appendFileSync(psFile, ps, "utf8");
    
    exec(`powershell -ExecutionPolicy Bypass -File "${psFile}" 2>&1`, { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(psFile); } catch(e) {}
      if (err || stderr) {
        resolve({ error: "PowerShell error: " + (err ? err.message : stderr.slice(0, 200)) });
        return;
      }
      try {
        const raw = JSON.parse(stdout.trim());
        if (Array.isArray(raw)) {
          resolve({ cookies: raw });
        } else {
          resolve({ cookies: [], detail: stdout.slice(0, 200) });
        }
      } catch(e) {
        resolve({ error: "Parse error: " + stdout.slice(0, 200) });
      }
    });
  });
}

// ─────────────────────────────────────────
// 策略3: Chrome Extension DOM 采集
// (需要插件加载到 Chrome, 这里作为备用检测)
// ─────────────────────────────────────────
function checkExtensionAvailable() {
  // 检查用户Chrome是否安装了1688插件
  return new Promise((resolve) => {
    // 这种方式无法直接检测extension，只能提示用户手动操作
    resolve({ available: false, hint: "请在 Chrome 地址栏输入 chrome://extensions/ 加载插件" });
  });
}

// ─────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────
async function main() {
  const keyword = process.argv[2] || "项链";
  const page = parseInt(process.argv[3] || "1", 10);

  console.log(`\n🔍 1688标题采集 | 关键词: ${keyword} | 页码: ${page}\n`);
  console.log("=".repeat(60));

  // 步骤1: 尝试从 Chrome 读取 cookie
  console.log("\n[1/3] 从 Chrome 读取 cookie...");
  const cookieResult = await getCookiesFromChrome("1688.com");
  
  let token = null;
  if (cookieResult.cookies && cookieResult.cookies.length > 0) {
    const mtk = cookieResult.cookies.find(c => c.name === "_m_h5_tk");
    if (mtk) {
      token = mtk.value;
      console.log(`✅ 找到 _m_h5_tk: ${token.slice(0, 30)}...`);
    } else {
      console.log("⚠️ Chrome 有其他 1688 cookie 但没有 _m_h5_tk");
      console.log("  找到的 cookie:", cookieResult.cookies.map(c => c.name).join(", "));
    }
  } else if (cookieResult.error) {
    console.log("❌ Chrome cookie 读取失败:", cookieResult.error);
    console.log("   提示: 确保 Chrome 已关闭(或者用 --user-data-dir 指定Profile)");
  } else {
    console.log("⚠️ Chrome 中未找到 1688 cookie");
  }

  // 步骤2: 调用 mtop API
  console.log("\n[2/3] 调用 mtop API...");
  const result = await mtopRequest(keyword, page, token);

  if (result.success) {
    console.log(`✅ 采集成功! 共 ${result.data.length} 条\n`);
    
    // 输出CSV (Console表格)
    console.log("序号\tofferId\t\t\t标题\t\t\t\t\t\t\t\t\t价格");
    console.log("-".repeat(80));
    result.data.forEach((item, i) => {
      const titleShort = item.title.length > 25 ? item.title.slice(0, 25) + "..." : item.title;
      console.log(`${i+1}\t${item.offerId}\t${titleShort}\t\t${item.price}`);
    });

    // 保存到文件
    const outFile = path.join(os.tmpdir(), `1688_${keyword}_${Date.now()}.csv`);
    const csvLines = ["序号,offerId,标题,价格,链接"];
    result.data.forEach((item, i) => {
      const escapedTitle = `"${item.title.replace(/"/g, '""')}"`;
      csvLines.push(`${i+1},${item.offerId},${escapedTitle},${item.price},${item.link}`);
    });
    // UTF-8 BOM for Excel
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(outFile, BOM);
    fs.appendFileSync(outFile, csvLines.join("\r\n"), "utf8");
    console.log(`\n📁 已保存: ${outFile}`);

  } else {
    console.log(`❌ 采集失败: ${result.error}`);
    if (result.raw) console.log("   原始响应:", result.raw.slice(0, 200));
    
    // 步骤3: 提示使用插件
    console.log("\n[3/3] 建议使用 Chrome 插件方案:");
    console.log("   1. 确保已安装 1688标题采集 插件 (chrome://extensions/)");
    console.log("   2. 用 Chrome 打开 https://s.1688.com 并登录");
    console.log("   3. 点击插件图标 → 采集当前页");
  }
}

main().catch(console.error);
