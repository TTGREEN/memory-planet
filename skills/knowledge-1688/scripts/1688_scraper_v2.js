/**
 * 1688 标题采集脚本 v2
 * 直接使用 workspace 的 playwright（绕过 CLI 超时问题）
 * 
 * 用法: node 1688_scraper_v2.js [关键词] [页数]
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────
const CHROME = "C:\\Users\\Administrator\\AppData\\Local\\Chromium\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\User Data\\Default";
const KEYWORDS = process.argv[2] ? [process.argv[2]] : ["项链"];
const MAX_PAGES = process.argv[3] ? parseInt(process.argv[3]) : 3;
const OUTPUT = "E:\\1688标题生成\\1688_titles.csv";

const BAD_PATTERNS = [
  /点此可以直接和卖家交流/, /联系卖家/, /小二币/, /掌财/, /找相似/, /找同款/
];

const STEALTH_SCRIPT = `
() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' }
    ],
    configurable: true
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
  const toDelete = ['__playwright', '__cdc_adoQpoasnfa76pfcZLmcfl_Symbol', '__cdc_adoQpoasnfa76pfcZLmcfl_Promise', '__pw_manual'];
  toDelete.forEach(k => { try { delete window[k]; } catch(e) {} });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = { id: undefined };
}
`;

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────
function log(msg, level = "INFO") {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] [${level}] ${msg}`);
}

function isValidTitle(title) {
  if (!title || title.length < 5) return false;
  for (const p of BAD_PATTERNS) if (p.test(title)) return false;
  return /[\u4e00-\u9fa5]/.test(title);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// 提取函数（运行在浏览器内）
// ─────────────────────────────────────────────
const EXTRACT_JS = `
function() {
  var selectors = [
    '[data-offer-id]',
    '.offer-list-row .offer-item',
    '.sm-offer-item',
    '[class*="offerItem"]',
    '#sm-offer-list > div',
    '.list-item'
  ];
  var cards = null, sel = '';
  for (var i = 0; i < selectors.length; i++) {
    cards = document.querySelectorAll(selectors[i]);
    if (cards && cards.length > 0) { sel = selectors[i]; break; }
  }
  if (!cards || cards.length === 0) return JSON.stringify({count: 0, items: [], sel: ''});

  var results = [], seen = {};
  for (var j = 0; j < cards.length; j++) {
    var card = cards[j];
    var offerId = card.getAttribute ? card.getAttribute('data-offer-id') : null;
    if (!offerId) {
      var html = card.innerHTML || '';
      var m = html.match(/offer[D_/]?(\\d+)/) || html.match(/offerId=(\\d+)/);
      if (m) offerId = m[1];
    }
    if (!offerId || seen[offerId]) continue;
    seen[offerId] = true;

    var title = '';
    // 方案1: 图片链接
    var imgLink = card.querySelector('a[data-img]');
    if (imgLink) title = imgLink.getAttribute ? (imgLink.getAttribute('title') || '') : '';
    // 方案2: 正文链接
    if (!title || title.length < 5) {
      var links = card.querySelectorAll('a[href]');
      for (var k = 0; k < links.length; k++) {
        var a = links[k];
        var href = a.getAttribute ? (a.getAttribute('href') || '') : '';
        var t = a.getAttribute ? (a.getAttribute('title') || '') : '';
        if (!t) t = (a.innerText || '').trim();
        if (/im\\.1688|webchat|联系卖家/.test(href)) continue;
        if (t && t.length > 5 && t.length < 200 && /[\\u4e00-\\u9fa5]/.test(t) && !/点此|联系卖家/.test(t)) {
          title = t; break;
        }
      }
    }
    // 方案3: data-expect JSON
    if (!title || title.length < 5) {
      var de = card.getAttribute ? card.getAttribute('data-expect') : null;
      if (de) {
        try {
          var obj = JSON.parse(de);
          if (obj && obj.title) title = obj.title;
        } catch(e) {}
      }
    }
    if (!title || title.length < 5) continue;

    var price = '';
    var priceEl = card.querySelector('[class*="price"]');
    if (priceEl) {
      var pt = priceEl.innerText || '';
      var pm = pt.match(/([¥￥]?[\\d,]+\\.?\\d*)/);
      if (pm) price = pm[1].replace(',', '');
    }

    var shop = '';
    var shopEl = card.querySelector('[class*="company"]') || card.querySelector('[class*="shop"]');
    if (shopEl) shop = (shopEl.innerText || '').trim();

    results.push({
      offerId: offerId,
      title: title,
      price: price,
      shop: shop,
      link: 'https://detail.1688.com/offer/' + offerId + '.html'
    });
  }
  return JSON.stringify({count: results.length, items: results, sel: sel});
}
`;

// ─────────────────────────────────────────────
// 滚动加载（等待新内容出现）
// ─────────────────────────────────────────────
async function scrollToLoad(page) {
  for (let i = 0; i < 4; i++) {
    const hBefore = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const hAfter = await page.evaluate(() => document.body.scrollHeight);
    if (hAfter <= hBefore) break;
  }
}

// ─────────────────────────────────────────────
// 浏览器采集
// ─────────────────────────────────────────────
async function scrapeKeyword(keyword, maxPages) {
  const results = [];
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-accelerated-2d-canvas",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(STEALTH_SCRIPT);

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  for (let p = 1; p <= maxPages; p++) {
    const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}&beginPage=${p}`;
    log(`[${keyword}] 访问第 ${p}/${maxPages} 页`);
    
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
      await scrollToLoad(page);

      let data;
      try {
        data = await page.evaluate(EXTRACT_JS);
        log(`[DEBUG] evaluate returned type: ${typeof data}, length: ${data ? String(data).length : 'null'}`);
        if (data && typeof data === 'string' && data.length < 200) {
          log(`[DEBUG] evaluate raw: ${data.slice(0, 200)}`);
        }
      } catch (e) {
        log(`[DEBUG] evaluate error: ${e.message.slice(0, 200)}`, "ERROR");
      }
      let parsed;
      try {
        parsed = (typeof data === "string") ? JSON.parse(data) : (data || { count: 0, items: [] });
      } catch (e) {
        log(`[DEBUG] JSON parse error: ${e.message.slice(0, 100)}`, "ERROR");
        parsed = { count: 0, items: [] };
      }

      if (parsed.count === 0) {
        log(`[${keyword}] 第 ${p} 页无数据，停止`);
        break;
      }

      log(`[${keyword}] 第 ${p} 页: ${parsed.count} 条 (selector: ${parsed.sel})`);
      results.push(...parsed.items.map(it => ({ ...it, keyword })));
    } catch (e) {
      log(`[${keyword}] 第 ${p} 页出错: ${e.message.slice(0, 100)}`, "ERROR");
    }

    if (p < maxPages) await sleep(3000 + Math.random() * 3000);
  }

  await browser.close();
  return results;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
async function main() {
  log("=".repeat(50));
  log("1688 标题采集 v2 (playwright)");
  log(`关键词: ${KEYWORDS.join(", ")} | 每词 ${MAX_PAGES} 页`);
  log("=".repeat(50));

  const allItems = [];
  for (const kw of KEYWORDS) {
    const items = await scrapeKeyword(kw, MAX_PAGES);
    allItems.push(...items);
    log(`[${kw}] 采集完成: ${items.length} 条`);
  }

  // 去重
  const seen = new Set();
  const unique = allItems.filter(it => {
    const k = (it.title || "").slice(0, 50);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    // 额外过滤：排除非标题
    return isValidTitle(it.title);
  });

  log(`${"=".repeat(50)}`);
  log(`总计 ${allItems.length} 条 → 去重+过滤后 ${unique.length} 条`);

  if (unique.length > 0) {
    // 保存 CSV
    const rows = ["\ufeff关键词,标题,价格,店铺,商品链接"];
    for (const it of unique) {
      const t = (it.title || "").replace(/"/g, '""');
      rows.push(`${it.keyword},"${t}",${it.price || ""},${it.shop || ""},${it.link || ""}`);
    }
    const dir = path.dirname(OUTPUT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT, rows.join("\r\n"), "utf8");
    log(`已保存到: ${OUTPUT}`);
    unique.slice(0, 5).forEach(it => {
      log(`  [${it.keyword}] ${it.title.slice(0, 40)} | ¥${it.price}`);
    });
  } else {
    log("无有效数据", "WARN");
  }
}

main().catch(e => {
  log(`致命错误: ${e.message}`, "ERROR");
  process.exit(1);
});
