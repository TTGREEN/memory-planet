/**
 * 1688 标题采集脚本
 * 使用 ab.js（agent-browser）进行反检测浏览器采集
 * 
 * 用法（PowerShell）：
 *   node 1688_title_scraper.js 项链 3
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────
const AB = "C:\\Users\\Administrator\\.openclaw\\workspace\\skills\\agent-browser-pro\\scripts\\ab.js";
const CHROME = "C:\\Users\\Administrator\\AppData\\Local\\Chromium\\Application\\chrome.exe";
const SESSION = "o1688_scrape";
const PROFILE = "Default";
const OUTPUT = "E:\\1688标题生成\\1688_titles.csv";

const KEYWORDS = process.argv[2] ? [process.argv[2]] : ["项链", "耳环", "手链"];
const MAX_PAGES = process.argv[3] ? parseInt(process.argv[3]) : 3;

// 搜索列表卡片选择器（优先级从高到低）
const CARD_SELECTORS = [
  "[data-offer-id]",
  ".offer-list-row .offer-item",
  ".sm-offer-item",
  "[class*='offerItem']",
  "#sm-offer-list > div",
  ".list-item",
];

// 排除的标题关键词
const BAD_TITLE_PATTERNS = [
  "点此可以直接和卖家交流",
  "联系卖家",
  "小二币",
  "掌财",
  "找相似",
  "找同款",
];

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] ${msg}`);
}

function execAb(cmd, opts = {}) {
  const fullCmd = `node "${AB}" ${cmd} --session ${SESSION} --profile ${PROFILE} --json --stealth aggressive`;
  // log(`[AB] ${fullCmd.slice(0, 80)}`);
  try {
    const out = execSync(fullCmd, {
      encoding: "utf-8",
      timeout: 30000,
      ...opts,
    });
    if (out && opts.verbose) log(out.slice(0, 200));
    return out;
  } catch (e) {
    log(`[AB ERROR] ${e.message.slice(0, 200)}`);
    return null;
  }
}

function abOpen(url) {
  return execAb(`open "${url}"`);
}

function abSnap() {
  const out = execAb("snap -i --json");
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function abEval(js) {
  const escaped = js.replace(/"/g, '\\"').replace(/\n/g, " ");
  const out = execAb(`eval "${escaped}"`);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return out.trim();
  }
}

function abWait(ms) {
  return execAb(`wait ${ms}`);
}

function abScroll() {
  return execAb("scroll down 800");
}

function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

// ─────────────────────────────────────────────
// 浏览器操作
// ─────────────────────────────────────────────
function closeBrowser() {
  try {
    execSync(`node "${AB}" close --session ${SESSION}`, { timeout: 5000 });
  } catch (e) {}
  sleep(500);
}

function ensureBrowser(url) {
  // 先尝试关闭旧 session
  closeBrowser();
  sleep(1000);
  abOpen(url);
  sleep(3000);
}

function isValidTitle(title) {
  if (!title || title.length < 5) return false;
  for (const pat of BAD_TITLE_PATTERNS) {
    if (title.includes(pat)) return false;
  }
  // 必须含中文
  return /[\u4e00-\u9fa5]/.test(title);
}

function extractTitlesViaJS() {
  // 使用 JavaScript 直接从页面提取数据（最可靠的方式）
  const js = `
    (function() {
      var results = [];
      var selectors = [
        '[data-offer-id]',
        '.offer-list-row .offer-item',
        '.sm-offer-item',
        '[class*="offerItem"]',
        '#sm-offer-list > div',
        '.list-item'
      ];
      var cards = null;
      for (var i = 0; i < selectors.length; i++) {
        cards = document.querySelectorAll(selectors[i]);
        if (cards && cards.length > 0) break;
      }
      if (!cards || cards.length === 0) return JSON.stringify({count: 0, items: []});

      var BAD_PATTERNS = [/点此可以直接和卖家交流/, /联系卖家/, /小二币/, /掌财/];
      var seenIds = {};

      for (var j = 0; j < cards.length; j++) {
        var card = cards[j];
        var offerId = card.getAttribute('data-offer-id');
        if (!offerId) {
          var html = card.innerHTML || '';
          var m = html.match(/offer[D_/]?(\\d+)/) || html.match(/offerId=(\\d+)/);
          if (m) offerId = m[1];
        }
        if (!offerId || seenIds[offerId]) continue;
        seenIds[offerId] = true;

        var title = '';
        // 方案1: 图片链接
        var imgLink = card.querySelector('a[data-img]');
        if (imgLink) title = imgLink.getAttribute('title') || '';
        // 方案2: 遍历链接
        if (!title || title.length < 5) {
          var links = card.querySelectorAll('a[href]');
          for (var k = 0; k < links.length; k++) {
            var a = links[k];
            var href = a.getAttribute('href') || '';
            var t = a.getAttribute('title') || a.innerText.trim();
            if (/im\\.1688|webchat|联系卖家/.test(href)) continue;
            if (t && t.length > 5 && t.length < 200 && /[\\u4e00-\\u9fa5]/.test(t)) {
              var bad = false;
              for (var p = 0; p < BAD_PATTERNS.length; p++) {
                if (BAD_PATTERNS[p].test(t)) { bad = true; break; }
              }
              if (!bad) { title = t; break; }
            }
          }
        }
        // 方案3: data-expect JSON
        if (!title || title.length < 5) {
          var de = card.getAttribute('data-expect');
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
        if (shopEl) shop = shopEl.innerText.trim();

        var link = offerId ? 'https://detail.1688.com/offer/' + offerId + '.html' : '';

        results.push({
          offerId: offerId,
          title: title,
          price: price,
          shop: shop,
          link: link
        });
      }

      return JSON.stringify({count: results.length, items: results, selector: selectors.join(',')});
    })()
  `;
  return abEval(js);
}

// ─────────────────────────────────────────────
// 滚动加载（daimaoHandle 策略）
// ─────────────────────────────────────────────
function scrollAndLoad() {
  for (let i = 0; i < 4; i++) {
    abScroll();
    sleep(1500);
  }
}

// ─────────────────────────────────────────────
// 搜索列表采集
// ─────────────────────────────────────────────
function scrapeSearchPage(keyword, pageNum) {
  const pageSize = 60;
  const encodedKw = encodeURIComponent(keyword);
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodedKw}&beginPage=${pageNum}`;
  
  log(`访问: ${url.slice(0, 100)}`);
  abOpen(url);
  sleep(4000);  // 等待页面加载

  // 滚动触发懒加载
  scrollAndLoad();

  // 提取数据
  const data = extractTitlesViaJS();
  if (!data || data.count === 0) {
    log(`  第 ${pageNum} 页: 未提取到数据`);
    return [];
  }

  log(`  第 ${pageNum} 页: 提取 ${data.count} 条 (selector: ${data.selector})`);
  return data.items.map(item => ({
    keyword,
    title: item.title,
    price: item.price,
    shop: item.shop,
    link: item.link,
  }));
}

// ─────────────────────────────────────────────
// CSV 保存
// ─────────────────────────────────────────────
function saveToCSV(items) {
  const lines = ["\ufeff关键词,标题,价格,店铺,商品链接"];
  for (const it of items) {
    const title = (it.title || "").replace(/"/g, '""');
    lines.push(`${it.keyword},"${title}",${it.price || ""},${it.shop || ""},${it.link || ""}`);
  }
  fs.writeFileSync(OUTPUT, lines.join("\r\n"), "utf8");
  log(`已保存 ${items.length} 条到 ${OUTPUT}`);
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
function main() {
  log("=".repeat(50));
  log("1688 标题采集 (ab.js + 反检测浏览器)");
  log(`关键词: ${KEYWORDS.join(", ")} | 每关键词 ${MAX_PAGES} 页`);
  log("=".repeat(50));

  const allItems = [];

  for (const keyword of KEYWORDS) {
    log(`\n>>> 关键词: ${keyword}`);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = scrapeSearchPage(keyword, page);
      allItems.push(...items);
      if (items.length === 0) {
        log(`  第 ${page} 页无数据，跳过剩余页`);
        break;
      }
      // 随机延时 3-7 秒
      const delay = 3000 + Math.random() * 4000;
      log(`  延时 ${(delay / 1000).toFixed(1)}s`);
      sleep(delay);
    }
  }

  // 去重（按标题前50字）
  const seen = new Set();
  const unique = [];
  for (const item of allItems) {
    const key = (item.title || "").slice(0, 50);
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  log(`\n${"=".repeat(50)}`);
  log(`采集完成: ${allItems.length} 条 → 去重后 ${unique.length} 条`);

  if (unique.length > 0) {
    saveToCSV(unique);
    log("\n前 5 条示例:");
    unique.slice(0, 5).forEach(it => {
      log(`  [${it.keyword}] ${it.title.slice(0, 40)}... | ¥${it.price}`);
    });
  } else {
    log("无有效数据");
  }

  closeBrowser();
}

main();
