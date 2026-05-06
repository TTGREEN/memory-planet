const https = require("https");
const http = require("http");
const crypto = require("crypto");

async function fetch1688(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data.slice(0, 500) }));
    });
    req.on("error", (e) => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: "timeout" }); });
  });
}

async function mtopRequest(keyword, page = 1) {
  const t = Date.now().toString();
  const APP_KEY = "12574478";
  const APP_ID = "32517";

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

  // Sign with empty token (no cookie needed with ignoreLogin=true)
  const signStr = `&${t}&${APP_KEY}&${data}`;
  const sign = crypto.createHash("md5").update(signStr).digest("hex");

  const url =
    `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/` +
    `?jsv=2.7.4&appKey=${APP_KEY}&t=${t}&sign=${sign}` +
    `&api=mtop.relationrecommend.WirelessRecommend.recommend&v=2.0` +
    `&type=jsonp&ignoreLogin=true&data=${encodeURIComponent(data)}&timeout=20000`;

  console.log("Requesting mtop API...");
  return fetch1688(url);
}

async function main() {
  // Test 1: direct API call
  const r1 = await mtopRequest("项链", 1);
  console.log("Status:", r1.status || r1.error);
  if (r1.body) console.log("Body preview:", r1.body.slice(0, 300));
  console.log("---");

  // Test 2: try the PC search page with basic request
  const r2 = await fetch1688("https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE");
  console.log("PC search status:", r2.status || r2.error);
  if (r2.body) console.log("PC search body preview:", r2.body.slice(0, 200));
}

main().catch(console.error);
