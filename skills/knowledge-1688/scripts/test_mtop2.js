const https = require("https");

// Try mtop API with ignoreLogin=true but empty/no token
async function mtopNoToken(keyword, page = 1) {
  const t = Date.now().toString();
  const data = JSON.stringify({
    appId: "32517",
    params: JSON.stringify({
      verticalProductFlag: "pccps",
      searchScene: "pcOfferSearch",
      charset: "utf8",
      beginPage: page,
      pageSize: 60,
      keywords: keyword,
      method: "getOfferList"
    })
  });

  const sign = "dummy"; // empty sig

  const url =
    `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/` +
    `?jsv=2.7.4&appKey=12574478&t=${t}&sign=${sign}` +
    `&api=mtop.relationrecommend.WirelessRecommend.recommend&v=2.0` +
    `&type=jsonp&ignoreLogin=true` +
    `&data=${encodeURIComponent(data)}&timeout=20000`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://s.1688.com/",
        "Origin": "https://s.1688.com"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        console.log("Status:", res.statusCode);
        console.log("Body:", data.slice(0, 400));
        resolve(data);
      });
    });
    req.on("error", e => { console.error("Error:", e.message); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); console.error("Timeout"); resolve(null); });
  });
}

// Try getting token cookie via simple HTTP request
async function getH5Cookies() {
  return new Promise((resolve) => {
    const options = {
      hostname: "h5api.m.1688.com",
      path: "/",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://s.1688.com/",
      }
    };
    const req = https.get(options, (res) => {
      const cookies = res.headers["set-cookie"];
      console.log("Status:", res.statusCode);
      console.log("Cookies:", cookies ? cookies.join("\n").slice(0, 300) : "none");
      resolve(cookies);
    });
    req.on("error", e => { console.error("Error:", e.message); resolve(null); });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  console.log("=== Test 1: Get h5api cookies ===");
  await getH5Cookies();

  console.log("\n=== Test 2: mtop API (ignoreLogin=true, no token) ===");
  await mtopNoToken("项链", 1);
}

main();
