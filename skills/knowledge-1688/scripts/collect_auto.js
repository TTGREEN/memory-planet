/**
 * 1688标题采集 - 最终版（自动cookie + 自动刷新token）
 * 
 * 策略：
 * 1. 启动 ab.js daemon（后台进程，不受 exec 超时限制）
 * 2. 用 ab.js --profile Default 打开 1688 搜索页（复用用户登录态）
 * 3. 从 ab.js session 提取 cookie（包含 _m_h5_tk）
 * 4. 调用 mtop API 采集数据
 * 5. token 过期后自动重新从 ab.js 获取新 token
 * 
 * 用法: node collect_auto.js <关键词> [页数]
 */
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");

// ── 常量 ──────────────────────────────────────────────
const APP_KEY = "12574478";
const APP_ID  = "32517";
const AB      = "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\agent-browser\\bin\\agent-browser.js";
const SESSION = "1688-mtop";
const COOKIE_FILE = path.join(__dirname, "cookies.json");
const TOKEN_FILE  = path.join(__dirname, "token_cache.json");

// ── 工具 ─────────────────────────────────────────────
function parseJSONP(raw) {
  const m = raw.match(/callback\s*\(\s*(\{.*\})\s*\)\s*$/s);
  if (m) return JSON.parse(m[1]);
  return JSON.parse(raw);
}

function cleanHTML(str) {
  if (!str) return "";
  return str.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function httpGet(url, headers) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const setCookies = res.headers["set-cookie"] || [];
        resolve({ status: res.statusCode, body: data, setCookies });
      });
    });
    req.on("error", e => resolve({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

// ── ab.js 命令 ────────────────────────────────────────
function abRun(cmd, timeout = 30000) {
  try {
    const fullCmd = `node "${AB}" --session "${SESSION}" ${cmd}`;
    const out = execSync(fullCmd, { encoding: "utf-8", timeout, windowsHide: true });
    return out || "";
  } catch (e) {
    return e.stdout || "";
  }
}

async function abOpen(url, waitMs = 5000) {
  const out = abRun(`open "${url}"`, 20000);
  await new Promise(r => setTimeout(r, waitMs));
  return out;
}

// ── 从 ab session 获取 1688 cookie ────────────────────
async function fetchCookieFromAB() {
  console.log("[AB] Opening 1688 search page with user profile...");

  // 打开搜索页（使用 Default profile 复用登录态）
  await abOpen("https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE", 6000);

  // 检查 URL（是否跳转到登录页）
  const url = abRun("get url").trim();
  console.log("[AB] Current URL:", url.slice(0, 80));
  if (url.includes("login") || url.includes("signin")) {
    throw new Error("1688 session expired - redirected to login page");
  }

  // 获取 cookies
  console.log("[AB] Fetching cookies...");
  const cookieOut = abRun("cookies get", 15000);

  // 解析 cookie 输出
  const lines = cookieOut.split(/[\n\r]+/).filter(l => l.trim() && !l.startsWith("#"));
  const cks = {};
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      cks[name] = value;
    }
  }

  const mtk = cks["_m_h5_tk"];
  if (!mtk) {
    throw new Error("_m_h5_tk not found in ab session cookies");
  }

  console.log("[AB] Got _m_h5_tk:", mtk.slice(0, 50));

  // 保存
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cks, null, 2));
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    token: mtk,
    timestamp: Date.now()
  }, null, 2));

  return cks;
}

// ── mtop API ──────────────────────────────────────────
function buildMtopUrl(keyword, page, mtk) {
  const t = Date.now().toString();
  const MTOKEN = mtk.split("_")[0];

  const params = {
    verticalProductFlag: "pccps",
    searchScene: "pcOfferSearch",
    charset: "utf8",
    beginPage: page,
    pageSize: 60,
    keywords: keyword,
    method: "getOfferList"
  };
  const paramsStr = JSON.stringify(params);
  const dataStr   = JSON.stringify({ appId: APP_ID, params: paramsStr });

  const signStr = `${MTOKEN}&${t}&${APP_KEY}&${dataStr}`;
  const sign    = crypto.createHash("md5").update(signStr).digest("hex");

  const query = [
    `jsv=2.7.4`, `appKey=${APP_KEY}`, `t=${t}`, `sign=${sign}`,
    `api=mtop.relationrecommend.WirelessRecommend.recommend`, `v=2.0`,
    `type=jsonp`, `timeout=20000`,
    `data=${encodeURIComponent(dataStr)}`
  ].join("&");

  return `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/?${query}`;
}

function extractPrice(priceInfo) {
  if (!priceInfo) return "";
  return String(priceInfo.price || priceInfo.priceStr || "").replace(/[¥￥]/g, "").trim();
}

async function mtopRequest(keyword, page, cookieStr) {
  // 从 cookie 提取当前有效 token
  let mtk = "";
  const cks = cookieStr.split("; ").forEach(c => {
    const [k, v] = c.split("=");
    if (k && k.trim() === "_m_h5_tk") mtk = v.trim();
  });

  if (!mtk) {
    return { success: false, error: "no token" };
  }

  const url = buildMtopUrl(keyword, page, mtk);

  const res = await httpGet(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Referer": "https://s.1688.com/",
    "Cookie": cookieStr,
    "Accept": "*/*"
  });

  if (res.error) return { success: false, error: res.error };

  try {
    const json = parseJSONP(res.body);
    const ret = json.ret && json.ret[0];
    if (!ret || !ret.startsWith("SUCCESS")) {
      // 检查是否是 token 过期
      const isExpired = ret && (ret.includes("TOKEN_EMPTY") || ret.includes("TOKEN_ILLEGAL") || ret.includes("签名失效"));
      return { success: false, error: ret || "unknown", tokenExpired: !!isExpired };
    }

    const offerData = json.data && json.data.data && json.data.data.OFFER;
    if (!offerData) return { success: false, error: "no OFFER data" };

    const items = (offerData.items || [])
      .filter(item => item && item.data && item.data.offerId)
      .map(item => {
        const d = item.data;
        return {
          offerId:     String(d.offerId || ""),
          title:       cleanHTML(d.title || ""),
          price:       extractPrice(d.priceInfo),
          shopName:    (d.shop && d.shop.text) ? d.shop.text : "",
          loginId:     d.loginId || "",
          province:    d.province || "",
          bookedCount: d.bookedCount || "",
          link:        `https://detail.1688.com/offer/${d.offerId}.html`
        };
      })
      .filter(item => item.title.length > 0);

    return { success: true, data: items, hasMore: offerData.hasMore };
  } catch(e) {
    return { success: false, error: "parse: " + e.message };
  }
}

// ── CSV 导出 ──────────────────────────────────────────
function exportCSV(items, keyword) {
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const header = "序号\tofferId\t标题\t价格(元)\t店铺名\t旺旺ID\t省份\t成交量\t链接\n";
  const rows = items.map((item, i) => [
    i + 1,
    item.offerId,
    `"${item.title.replace(/"/g, '""')}"`,
    item.price,
    `"${item.shopName.replace(/"/g, '""')}"`,
    `"${item.loginId.replace(/"/g, '""')}"`,
    item.province,
    item.bookedCount,
    item.link
  ].join("\t")).join("\n");

  const outFile = path.join(os.tmpdir(), `1688_${encodeURIComponent(keyword)}_${Date.now()}.csv`);
  fs.writeFileSync(outFile, BOM);
  fs.appendFileSync(outFile, header + rows, "utf8");
  return outFile;
}

// ── 主流程 ─────────────────────────────────────────────
async function main() {
  const keyword  = process.argv[2] || "项链";
  const maxPages = parseInt(process.argv[3] || "3", 10);

  console.log(`\n🔍 1688标题采集 | 关键词: ${keyword} | 最多${maxPages}页\n`);
  console.log("=".repeat(60));

  // Step 1: 获取 cookie
  console.log("\n[1] Fetching cookie from Chrome profile...");
  let cookieStr = "";
  try {
    const cks = await fetchCookieFromAB();
    cookieStr = Object.entries(cks).map(([k, v]) => `${k}=${v}`).join("; ");
    console.log("✅ Cookie obtained");
  } catch (e) {
    console.log("❌ Cookie fetch failed:", e.message);
    console.log("Make sure 1688 is logged in Chrome, then run again.");
    return;
  }

  // Step 2: 采集多页
  console.log("\n[2] Collecting data...");
  const allItems = [];
  const seenIds  = new Set();
  let tokenExpired = false;

  for (let page = 1; page <= maxPages && !tokenExpired; page++) {
    process.stdout.write(`  第${page}页... `);

    const r = await mtopRequest(keyword, page, cookieStr);

    if (!r.success && r.tokenExpired) {
      console.log("⚠️ Token expired, refreshing cookie...");
      try {
        const cks = await fetchCookieFromAB();
        cookieStr = Object.entries(cks).map(([k, v]) => `${k}=${v}`).join("; ");
        const r2 = await mtopRequest(keyword, page, cookieStr);
        if (r2.success) {
          r.data = r2.data;
          r.hasMore = r2.hasMore;
          r.success = true;
          console.log("✅ Token refreshed, retry page " + page + "... ");
        }
      } catch (e2) {
        console.log("❌ Refresh failed:", e2.message);
        break;
      }
    }

    if (!r.success) {
      console.log(`❌ ${r.error}`);
      break;
    }

    let newCount = 0;
    r.data.forEach(item => {
      if (!seenIds.has(item.offerId)) {
        seenIds.add(item.offerId);
        allItems.push(item);
        newCount++;
      }
    });
    console.log(`✅ ${r.data.length}条 (新增${newCount})`);

    if (!r.hasMore || r.data.length === 0) break;
  }

  // Step 3: 导出
  if (allItems.length > 0) {
    console.log(`\n✅ 共采集 ${allItems.length} 条\n`);
    allItems.slice(0, 8).forEach((item, i) => {
      const title = item.title.length > 35 ? item.title.slice(0, 35) + "..." : item.title;
      console.log(`  ${i+1}. [${item.offerId}] ${title} | ¥${item.price} | ${item.shopName} | ${item.loginId}`);
    });

    const csvFile = exportCSV(allItems, keyword);
    console.log(`\n📁 ${csvFile}`);
  } else {
    console.log("\n❌ 未采集到数据");
  }
}

main().catch(console.error);
