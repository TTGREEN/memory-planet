const https = require("https");

function mtopReq(keyword, page = 1, extraParams = {}) {
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
      method: "getOfferList",
      ...extraParams
    })
  });

  // Try with fake token (first part before underscore)
  const fakeToken = "a14be012db1ba5fa2b48040534f36cff";
  const signStr = `${fakeToken}&${t}&12574478&${data}`;
  const crypto = require("crypto");
  const sign = crypto.createHash("md5").update(signStr).digest("hex");

  const url =
    `https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/` +
    `?jsv=2.7.4&appKey=12574478&t=${t}&sign=${sign}` +
    `&api=mtop.relationrecommend.WirelessRecommend.recommend&v=2.0` +
    `&type=jsonp&timeout=20000` +
    `&data=${encodeURIComponent(data)}`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://s.1688.com/",
        "Cookie": `_m_h5_tk=${fakeToken}; _m_h5_tk_enc=a82b218cc28f60d9f55480cb7526ecf6`
      }
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        console.log("Status:", res.statusCode, "| Body:", body.slice(0, 300));
        resolve(body);
      });
    });
    req.on("error", e => { console.error("Error:", e.message); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); console.error("Timeout"); resolve(null); });
  });
}

async function main() {
  console.log("=== Test with fake token ===");
  await mtopReq("项链", 1);
}

main();
