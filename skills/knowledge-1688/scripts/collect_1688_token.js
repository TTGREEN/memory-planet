/**
 * 1688标题采集 - mtop API 最终版
 * 使用真实登录 cookie，直接调 mtop API 获取标题
 * 用法: node collect_1688_token.js <关键词> [页码]
 */
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Cookie（从 Chrome 登录态导出）─────────────────────
const COOKIES = [
  "_m_h5_tk=7f1460da33ecc27e96cafa07b1c1d3c3_1776516987306",
  "_m_h5_tk_enc=0c3ae11125125b8ac4df5302cd65f88a",
  "__cn_logon__=true",
  "__cn_logon_id__=tb028554259",
  "_nk_=tb028554259",
  "_tb_token_=e5bb9e3763195",
  "ali_apache_track=c_mid=b2b-220874020794163e2b|c_lid=tb028554259|c_ms=1|c_mt=3",
  "cna=hsZUIrKHoz8CAbebGF6F3JS+",
  "cookie1=BxY8%2B6Hro2k66sObaexmDlKQ35PY14H0XAByv0ix2oE%3D",
  "cookie17=UUphwoAZvtUZ9TdYmg%3D%3D",
  "cookie2=161eedc189792a6f9fa3ded403e42c97",
  "csg=bd689dc3",
  "isg=BK2teLcVuNOE6Vwtg4AE_pN6vEknCuHceVMWNu-y6cSzZs0Yt1rxrPumVjqAffmU",
  "lid=tb028554259",
  "overseacurrency=CNY",
  "sg=910",
  "sgcookie=E1009R607Bve8mMxPHOnLwyXvTGekNk2tcUbZAxp8d55Lj29FTXelgStX%2B5UKONLCsBePZ9tcDG300Wmb%2BLy8wTdG%2BrYq%2BylwG5a%2BTmNEuoCknA%3D",
  "t=9fa278cbaad1b9e20178d17ba068d1eb",
  "taklid=8bd2fcc2280d4d0e8efc56b54bc07c66",
  "tfstk=gNuqC3sj8ELqUNvnTX4w4pWqAM4YWPJIoVw_sfcgG-2clZ6i45NCIOcMHAuaEj6bnVtx7CkItlD_CjONM4kF5Z9vDfba5PvBdeTIMIUTSpTczw5uH5huIQZmMHo7WPvBdUTIMjUTSjg5Hs5PqWeuiZ2gIQyu_WUgiZVDa8Va9GXmIPAya8FgSRDgSQlue54gIA4MajUqifbzOoAVmWwXqYV40Jc0EjGjrSWQKj2PSNA_goASi87GS4nGx_f8nHC7BrwxNSk9JZU0bDh__x8VoAlKyYPoKF7QnbhIAo3DJGhbl-zooD5GSbz43Ag02tJzKqhoJzqW-BloyxGxzf1MS7MQEj307eALur20z736eZ2Zqc0bDPBDdohi4YP4-glCB7VJQVnVIGr0w7yBaQWEPqdVbOAw3GITqyFzdINfXGE0w7yBaQSOXu28aJObG",
  "uc4=nk4=0%40FY4O630JtE9PsILx8T%2Ff%2BtaYmtBtog%3D%3D&id4=0%40U2grGRiBhUDIh3X%2FJH9SNXD658BF1SCD",
  "unb=2208740207941",
  "union={\"amug_biz\":\"comad\",\"amug_fl_src\":\"sem_bing\",\"creative_url\":\"https%3A%2F%2Fwww.1688.com%2Fzw%2Fhamlet.html%3Fscene%3D6%26cosite%3Dbingjj_pz%26\",\"creative_time\":1776507676075}",
  "xlly_s=1",
  "ptid=017700000009a1900a6007238ea718bc",
].join("; ");

// ── Config ──────────────────────────────────────────────
const MTOKEN   = "7f1460da33ecc27e96cafa07b1c1d3c3"; // _m_h5_tk 的 token 部分
const APP_KEY  = "12574478";
const APP_ID   = "32517";

// ── 工具函数 ───────────────────────────────────────────
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
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", e => resolve({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

function extractPrice(priceInfo) {
  if (!priceInfo) return "";
  // priceInfo 结构: { price: "5.90", priceDecimal: ".9", priceInteger: "5", ... }
  return String(priceInfo.price || priceInfo.priceStr || priceInfo.currentPrice || "").replace(/[¥￥]/g, "").trim();
}

// ── mtop API ────────────────────────────────────────────
async function mtopRequest(keyword, page = 1) {
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

  // 签名: MD5(token&timestamp&appKey&data)
  const signStr = `${MTOKEN}&${t}&${APP_KEY}&${data}`;
  const sign = crypto.createHash("md5").update(signStr).digest("hex");

  const query = [
    `jsv=2.7.4`, `appKey=${APP_KEY}`, `t=${t}`, `sign=${sign}`,
    `api=mtop.relationrecommend.WirelessRecommend.recommend`, `v=2.0`,
    `type=jsonp`, `timeout=20000`,
    `data=${encodeURIComponent(data)}`
  ].join("&");

  const url = `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/?${query}`;

  const res = await httpGet(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Referer": "https://s.1688.com/",
    "Cookie": COOKIES,
    "Accept": "*/*"
  });

  if (res.error) return { success: false, error: res.error };

  try {
    const json = parseJSONP(res.body);
    const ret = json.ret && json.ret[0];
    if (!ret || !ret.startsWith("SUCCESS")) {
      return { success: false, error: ret || "unknown error", raw: res.body.slice(0, 200) };
    }

    const offerData = json.data && json.data.data && json.data.data.OFFER;
    if (!offerData) return { success: false, error: "no OFFER data", raw: res.body.slice(0, 200) };

    const rawItems = offerData.items || [];
    const items = rawItems
      .filter(item => item && item.data && item.data.offerId)
      .map(item => {
        const d = item.data;
        return {
          offerId:    String(d.offerId || ""),
          title:      cleanHTML(d.title || ""),
          price:      extractPrice(d.priceInfo),
          shopName:   d.shop && d.shop.text ? d.shop.text : (d.shop && d.shop.shopName ? d.shop.shopName : ""),
          province:   d.province || "",
          city:       d.city || "",
          memberId:   d.memberId || "",
          loginId:    d.loginId || "",
          bookedCount: d.bookedCount || "",
          link:       `https://detail.1688.com/offer/${d.offerId}.html`
        };
      })
      .filter(item => item.title.length > 0);

    return {
      success: true,
      data: items,
      total: items.length,
      hasMore: offerData.hasMore
    };
  } catch(e) {
    return { success: false, error: "parse: " + e.message, raw: res.body.slice(0, 200) };
  }
}

// ── 多页采集 ───────────────────────────────────────────
async function collectAll(keyword, maxPages = 5) {
  const allItems = [];
  const seenIds = new Set();

  for (let page = 1; page <= maxPages; page++) {
    process.stdout.write(`  第${page}页... `);
    const r = await mtopRequest(keyword, page);
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

  return allItems;
}

// ── 导出 CSV ────────────────────────────────────────────
function exportCSV(items, keyword) {
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]); // UTF-8 BOM (Excel 兼容)
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
  const maxPages = parseInt(process.argv[3] || "3", 10);

  console.log(`\n🔍 1688标题采集`);
  console.log(`关键词: ${keyword} | 最多${maxPages}页\n`);
  console.log("=".repeat(60));

  const items = await collectAll(keyword, maxPages);

  if (items.length > 0) {
    console.log(`\n✅ 共采集 ${items.length} 条\n`);
    console.log("前10条预览:");
    items.slice(0, 10).forEach((item, i) => {
      const title = item.title.length > 35 ? item.title.slice(0, 35) + "..." : item.title;
      console.log(`  ${i+1}. [${item.offerId}] ${title} | ¥${item.price} | ${item.shopName} | ${item.loginId} | ${item.province}`);
    });

    const csvFile = exportCSV(items, keyword);
    console.log(`\n📁 ${csvFile}`);
  } else {
    console.log("\n❌ 未采集到数据");
  }
}

main().catch(console.error);
