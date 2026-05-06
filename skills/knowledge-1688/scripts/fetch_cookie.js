/**
 * fetch_cookie.js - 通过 ab.js --profile Default 获取 1688 cookie
 * ab.js --profile Default 复用 Chrome 用户 Profile（含登录态）
 * 用法: node fetch_cookie.js
 */
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const AB = "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\agent-browser\\bin\\agent-browser.js";
const SESSION = "1688-cookie-" + Date.now();
const OUT_FILE = path.join(__dirname, "token_cache.json");

function run(cmd, timeout = 30000) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      timeout,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return out;
  } catch (e) {
    return e.stdout || e.message || "";
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("=== 1688 Cookie Fetcher ===\n");
  console.log("Session:", SESSION);

  // Step 1: 用 --profile Default 打开搜索页（自动复用 Chrome 登录 cookie）
  console.log("\n[1] Opening 1688 search page with Chrome profile...");
  run(`node "${AB}" --profile Default --session "${SESSION}" open "https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE"`, 20000);
  await sleep(6000);

  // Step 2: 获取当前 URL（确认是否跳转到登录页）
  const url = run(`node "${AB}" --session "${SESSION}" get url`, 10000).trim();
  console.log("Current URL:", url.slice(0, 80));

  if (url.includes("login")) {
    console.log("⚠️  Redirected to login - 1688 session expired");
    console.log("Please log in to 1688 in Chrome first, then run this script again.");
    return;
  }

  // Step 3: 获取 cookies
  console.log("\n[2] Getting cookies...");
  const cookieOut = run(`node "${AB}" --session "${SESSION}" cookies get`, 15000);
  console.log("Cookie output:", cookieOut.slice(0, 300));

  // Step 4: 提取 _m_h5_tk
  const mtkMatch = cookieOut.match(/_m_h5_tk[=\s]+([^\s\n\r]+)/);
  if (mtkMatch) {
    const mtk = mtkMatch[1].trim();
    console.log("\n✅ Found _m_h5_tk:", mtk.slice(0, 50));

    // 提取更多 cookie
    const encMatch = cookieOut.match(/_m_h5_tk_enc[=\s]+([^\s\n\r]+)/);
    const lidMatch = cookieOut.match(/lid[=\s]+([^\s\n\r]+)/);
    const unbMatch = cookieOut.match(/unb[=\s]+([^\s\n\r]+)/);

    const cookie_jar = {};
    const lines = cookieOut.split(/[\n\r]+/);
    for (const line of lines) {
      const parts = line.trim().split(/\s*[=\s]\s*/);
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        if (name && value && !name.startsWith("#")) {
          cookie_jar[name] = value;
        }
      }
    }

    const result = {
      token: mtk,
      cookie_jar: cookie_jar,
      timestamp: Date.now()
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
    console.log("Saved to:", OUT_FILE);
  } else {
    console.log("❌ _m_h5_tk not found");
    console.log("Full cookie output:", cookieOut.slice(0, 500));
  }

  // Step 5: 关闭 session
  console.log("\n[3] Closing session...");
  run(`node "${AB}" --session "${SESSION}" close`, 5000);
  console.log("Done!");
}

main().catch(console.error);
