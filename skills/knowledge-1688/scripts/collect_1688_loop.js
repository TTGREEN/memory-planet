/**
 * 1688 mtop API 循环采集脚本
 * 全自动：Cookie获取 → Token刷新 → 分页采集 → CSV导出
 * 
 * 使用方法:
 *   node collect_1688_loop.js <关键词> [最大页数]
 *   node collect_1688_loop.js 项链 10
 */
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ── Config ──────────────────────────────────────────────
const APP_KEY = "12574478";
const APP_ID = "32517";
const COOKIE_DOMAIN = ".1688.com";
const CHROME_COOKIE_PATH = path.join(
  process.env.LOCALAPPDATA || "C:\\Users\\Administrator\\AppData\\Local",
  "Google", "Chrome", "User Data", "Default", "Network", "Cookies"
);
const TOKEN_CACHE = path.join(os.tmpdir(), "1688_token_cache.json");

// ── Step 1: 从 Chrome SQLite 读取 Cookie ──────────────
function getCookiesFromChrome() {
  console.log("📦 从 Chrome 读取 Cookie...");
  const script = `
    const sqlite3 = require('sqlite3');
    const path = require('path');
    const os = require('os');
    const fs = require('fs');
    const { execSync } = require('child_process');

    const COOKIE_PATH = '${CHROME_COOKIE_PATH.replace(/\\/g, "\\\\")}';
    const DOMAIN = '.1688.com';

    function readCookies() {
      if (!require('fs').existsSync(COOKIE_PATH)) {
        return { error: 'Cookie file not found: ' + COOKIE_PATH };
      }
      const tmp = os.tmpdir() + '\\\\chrome_cookies_' + process.pid + '.db';
      try {
        require('fs').copyFileSync(COOKIE_PATH, tmp);
      } catch(e) {
        return { error: 'Chrome is running (or file locked). Please close Chrome and retry.' };
      }
      const db = new sqlite3.Database(tmp);
      const rows = db.prepare('SELECT host_key, name, value FROM cookies WHERE host_key LIKE ?').all('%' + DOMAIN + '%');
      db.close();
      try { require('fs').unlinkSync(tmp); } catch(e) {}
      return { cookies: rows };
    }
    console.log(JSON.stringify(readCookies()));
  `;

  try {
    // 尝试用 node 直接跑（需要 sqlite3）
    const out = execSync(`node -e "${script.replace(/"/g, '\\"')}"`, { timeout: 15000 });
    return JSON.parse(out.toString());
  } catch(e) {
    // fallback: 用 Python 脚本
    try {
      const out = execSync(
        `python "${path.join(__dirname, "get_chrome_cookies.py")}"`,
        { timeout: 15000, encoding: "utf8", shell: "powershell" }
      );
      const result = JSON.parse(out.trim());
      if (result.error) return result;
      return { cookies: result.cookies };
    } catch(e2) {
      return { error: "Both Node and Python cookie extraction failed: " + e2.message };
    }
  }
}

function chromeCookiesToString(cookies) {
  if (!cookies || !Array.isArray(cookies)) return "";
  return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}

// ── Step 2: Token 刷新 ─────────────────────────────────
async function refreshToken(cookieStr) {
  const t = Date.now().toString();
  const params = JSON.stringify({ appId: APP_ID, params: JSON.stringify({ beginPage: 1, pageSize: 1, keywords: "项链", method: "getOfferList", searchScene: "pcOfferSearch", charset: "utf8", verticalProductFlag: "pccps" }) });
  
  // 空token签名触发刷新
  const signStr = `&${t}&${APP_KEY}&${params}`;
  const sign = crypto.createHash("md5").update(signStr).digest("hex");

  const query = `jsv=2.7.4&appKey=${APP_KEY}&t=${t}&sign=${sign}&api=mtop.relationrecommend.WirelessRecommend.recommend&v=2.0&type=jsonp&timeout=20000&data=${encodeURIComponent(params)}`;
  const url = `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/?${query}`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://s.1688.com/",
      "Cookie": cookieStr,
      "Accept": "*/*"
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"] || [];
        let newToken = null, newEnc = null;
        setCookie.forEach(c => {
          const m = c.match(/_m_h5_tk=([^;]+)/);
          if (m) newToken = m[1];
          const m2 = c.match(/_m_h5_tk_enc=([^;]+)/);
          if (m2) newEnc = m2[1];
        });
        resolve({ newToken, newEnc, setCookie });
      });
    });
    req.on("error", e => resolve({ error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

// ── Step 3: mtop 请求 ──────────────────────────────────
async function mtopRequest(keyword, page, token, cookieStr) {
  const t = Date.now().toString();
  const paramsDict = {
    verticalProductFlag: "pccps", searchScene: "pcOfferSearch", charset: "utf8",
    beginPage: page, pageSize: 60, keywords: keyword, method: "getOfferList"
  };
  const paramsStr = JSON.stringify(paramsDict);
  const dataDict = { appId: APP_ID, params: paramsStr };
  const data = JSON.stringify(dataDict);

  // 签名: MD5(token&timestamp&appKey&data)
  const signStr = `${token.split("_")[0]}&${t}&${APP_KEY}&${data}`;
  const sign = crypto.createHash("md5").update(signStr).digest("hex");

  const query = [
    `jsv=2.7.4`, `appKey=${APP_KEY}`, `t=${t}`, `sign=${sign}`,
    `api=mtop.relationrecommend.WirelessRecommend.recommend`, `v=2.0`,
    `type=jsonp`, `timeout=20000`,
    `data=${encodeURIComponent(data)}`
  ].join("&");

  const url = `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/?${query}`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "Referer": "https://s.1688.com/",
      "Cookie": cookieStr,
      "Accept": "*/*"
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", e => resolve({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

function parseJSONP(raw) {
  const m = raw.match(/callback\s*\(\s*(\{.*\})\s*\)\s*$/s);
  if (m) return JSON.parse(m[1]);
  return JSON.parse(raw);
}

function cleanHTML(str) {
  if (!str) return "";
  return str.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function extractPrice(priceInfo) {
  if (!priceInfo) return "";
  return String(priceInfo.price || priceInfo.priceStr || priceInfo.currentPrice || "").replace(/[¥￥]/g, "").trim();
}

// ── Step 4: 核心采集循环 ────────────────────────────────
async function collectAll(keyword, maxPages, progressCB) {
  // 4.1 获取 Chrome Cookie
  const cookieResult = getCookiesFromChrome();
  if (cookieResult.error) {
    // 如果 Chrome 读取失败，尝试用缓存的 cookie
    console.log(`⚠️  ${cookieResult.error}`);
    console.log("   尝试使用缓存 Cookie...");
    const cached = loadTokenCache();
    if (cached && cached.cookieStr) {
      console.log("   ✅ 使用缓存 Cookie");
    } else {
      throw new Error("需要关闭 Chrome 后重试，或提供 Cookie");
    }
  }

  const chromeCookies = cookieResult.cookies || [];
  const cookieStr = chromeCookies.length > 0
    ? chromeCookiesToString(chromeCookies)
    : (loadTokenCache()?.cookieStr || "");

  // 4.2 提取登录 Cookie（必须有小号 cookie2, _tb_token_, t）
  const hasLogin = cookieStr.includes("cookie2=") && cookieStr.includes("_tb_token_=") && cookieStr.includes("t=");
  if (!hasLogin) {
    throw new Error("1688 未登录：缺少 cookie2 / _tb_token_ / t。请先在 Chrome 登录 1688。");
  }

  // 4.3 刷新 Token
  console.log("🔑 刷新 Token...");
  const refreshResult = await refreshToken(cookieStr);
  if (refreshResult.error) {
    // 如果刷新失败，尝试用缓存 token
    const cached = loadTokenCache();
    if (cached && cached.token) {
      console.log(`⚠️  Token刷新失败(${refreshResult.error})，使用缓存 Token`);
    } else {
      throw new Error("Token刷新失败且无缓存: " + refreshResult.error);
    }
  } else {
    console.log(`✅ Token刷新成功`);
    saveTokenCache(refreshResult.newToken, cookieStr);
  }

  const token = refreshResult.newToken || loadTokenCache()?.token || "";
  const activeCookieStr = cookieStr || loadTokenCache()?.cookieStr || "";

  // 4.4 分页采集
  const allItems = [];
  const seenIds = new Set();
  let tokenRefreshCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    if (progressCB) progressCB({ phase: "collect", page, totalPages: maxPages, collected: allItems.length });

    process.stdout.write(`  第${page}页... `);

    const r = await mtopRequest(keyword, page, token, activeCookieStr);

    if (r.error) {
      // Token 过期，尝试刷新
      if (r.error.includes("timeout") || r.error === "timeout") {
        console.log(`⏰ Token超时，尝试刷新...`);
        const r2 = await refreshToken(activeCookieStr);
        if (r2.newToken) {
          token = r2.newToken;
          saveTokenCache(token, activeCookieStr);
          tokenRefreshCount++;
          // 重试当前页
          const r3 = await mtopRequest(keyword, page, token, activeCookieStr);
          if (r3.error) { console.log(`❌ ${r3.error}`); break; }
          processResult(r3);
        } else {
          console.log(`❌ Token刷新失败: ${r2.error}`);
          break;
        }
      } else {
        console.log(`❌ ${r.error}`);
        break;
      }
    } else {
      processResult(r);
    }

    function processResult(res) {
      try {
        const json = parseJSONP(res.body);
        const ret = json.ret && json.ret[0];
        if (!ret || !ret.startsWith("SUCCESS")) {
          const errMsg = ret || "unknown";
          console.log(`❌ ${errMsg}`);
          return;
        }

        const offerData = json.data?.data?.OFFER;
        if (!offerData) {
          // token 过期典型症状：ret=FAIL_BIZ_CAPTCHA
          const failType = json.data?.errorCode || json.data?.code || "";
          if (failType.includes("CAPTCHA") || failType.includes("captcha")) {
            console.log(`\n⚠️  遇到验证(Blocked by CAPTCHA)，尝试刷新Token...`);
          } else {
            console.log(`\n⚠️  无数据（${failType || 'unknown'}）`);
          }
          return;
        }

        const rawItems = offerData.items || [];
        let newCount = 0;
        rawItems.forEach(item => {
          if (item?.data?.offerId && !seenIds.has(item.data.offerId)) {
            seenIds.add(item.data.offerId);
            const d = item.data;
            allItems.push({
              offerId:     String(d.offerId || ""),
              title:       cleanHTML(d.title || ""),
              price:       extractPrice(d.priceInfo),
              shopName:    d.shop?.text || d.shop?.shopName || "",
              province:    d.province || "",
              city:        d.city || "",
              memberId:    d.memberId || "",
              loginId:     d.loginId || "",
              bookedCount: d.bookedCount || "",
              link:        `https://detail.1688.com/offer/${d.offerId}.html`
            });
            newCount++;
          }
        });

        console.log(`✅ ${rawItems.length}条 (新增${newCount}) 累计${allItems.length}`);
        if (!offerData.hasMore || rawItems.length === 0) {
          console.log("  → 已到最后一页");
          page = maxPages + 1; // 结束循环
        }
      } catch(e) {
        console.log(`❌ 解析失败: ${e.message}`);
      }
    }
  }

  return { items: allItems, tokenRefreshCount };
}

// ── Token 缓存 ──────────────────────────────────────────
function loadTokenCache() {
  try {
    if (fs.existsSync(TOKEN_CACHE)) {
      const d = JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8"));
      // 检查是否过期（> 50分钟）
      if (Date.now() - d.timestamp < 50 * 60 * 1000) {
        return d;
      }
    }
  } catch(e) {}
  return null;
}

function saveTokenCache(token, cookieStr) {
  try {
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
      token, cookieStr, timestamp: Date.now()
    }), "utf8");
  } catch(e) {}
}

// ── 导出 CSV ────────────────────────────────────────────
function exportCSV(items, keyword) {
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const header = "序号\tofferId\t标题\t价格(元)\t店铺名\t省份\t城市\t成交量\t旺旺ID\t链接\n";
  const rows = items.map((item, i) => [
    i + 1,
    item.offerId,
    `"${item.title.replace(/"/g, '""')}"`,
    item.price,
    `"${item.shopName.replace(/"/g, '""')}"`,
    item.province,
    item.city,
    item.bookedCount,
    `"${item.loginId.replace(/"/g, '""')}"`,
    item.link
  ].join("\t")).join("\n");

  const outFile = path.join(os.tmpdir(), `1688_${encodeURIComponent(keyword)}_${Date.now()}.csv`);
  fs.writeFileSync(outFile, BOM);
  fs.appendFileSync(outFile, header + rows, "utf8");
  return outFile;
}

// ── 主入口 ─────────────────────────────────────────────
async function main() {
  const keyword = process.argv[2] || "项链";
  const maxPages = parseInt(process.argv[3] || "5", 10);

  console.log(`\n🔍 1688 循环采集`);
  console.log(`关键词: ${keyword} | 最大${maxPages}页`);
  console.log("=".repeat(60));

  // 显示缓存状态
  const cached = loadTokenCache();
  if (cached) {
    const age = Math.round((Date.now() - cached.timestamp) / 60000);
    console.log(`📋 Token缓存: ${age}分钟前 (${cached.token.slice(0, 20)}...)`);
  } else {
    console.log("📋 Token缓存: 无");
  }

  try {
    const { items, tokenRefreshCount } = await collectAll(keyword, maxPages);

    if (items.length > 0) {
      console.log(`\n✅ 共采集 ${items.length} 条 (Token刷新${tokenRefreshCount}次)\n`);
      console.log("前10条预览:");
      items.slice(0, 10).forEach((item, i) => {
        const title = item.title.length > 35 ? item.title.slice(0, 35) + "..." : item.title;
        console.log(`  ${i+1}. [${item.offerId}] ${title} | ¥${item.price} | ${item.shopName} | ${item.loginId} | ${item.province}`);
      });

      const csvFile = exportCSV(items, keyword);
      console.log(`\n📁 ${csvFile}`);
    } else {
      console.log("\n❌ 未采集到数据");
      console.log("\n可能原因:");
      console.log("  1. Chrome 未登录 1688（请先登录）");
      console.log("  2. Chrome 正在运行（Cookie文件被锁，请关闭Chrome）");
      console.log("  3. Token 已彻底过期（需要重新登录）");
    }
  } catch(e) {
    console.error("\n❌ 错误:", e.message);
  }
}

main().catch(console.error);
