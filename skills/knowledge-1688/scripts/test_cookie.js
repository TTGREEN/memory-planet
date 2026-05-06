const { chromium } = require("playwright");

async function main() {
  const CHROME = "C:\\Users\\Administrator\\AppData\\Local\\Chromium\\Application\\chrome.exe";

  const STEALTH_SCRIPT = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format'},
        {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: ''},
        {name: 'Native Client', filename: 'internal-nacl-plugin', description: ''}
      ],
      configurable: true
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
    try { delete window.__playwright; } catch(e) {}
    try { delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Symbol; } catch(e) {}
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = { id: undefined };
  `;

  try {
    const browser = await chromium.launch({
      executablePath: CHROME,
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--window-size=1920,1080",
      ],
    });

    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });

    ctx.addInitScript(STEALTH_SCRIPT);
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    // Visit h5api first to get _m_h5_tk cookie
    console.log("Step 1: Visit h5api to get cookie...");
    await page.goto("https://h5api.m.1688.com/", { waitUntil: "commit", timeout: 20000 });
    await page.waitForTimeout(3000);
    console.log("h5api URL:", page.url().slice(0, 80));

    // Get cookies
    const cookies = await ctx.cookies();
    const mtk = cookies.find(c => c.name === "_m_h5_tk");
    console.log("Cookies count:", cookies.length);
    if (mtk) {
      console.log("_m_h5_tk found:", mtk.value.slice(0, 50));
    } else {
      console.log("_m_h5_tk NOT found");
      cookies.forEach(c => console.log("  ", c.name, ":", c.value.slice(0, 30)));
    }

    // Now visit search page
    console.log("\nStep 2: Visit search page...");
    await page.goto("https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE", { waitUntil: "commit", timeout: 20000 });
    await page.waitForTimeout(5000);
    console.log("Search URL:", page.url().slice(0, 80));

    const cookies2 = await ctx.cookies("https://s.1688.com");
    const mtk2 = cookies2.find(c => c.name === "_m_h5_tk");
    console.log("After search, _m_h5_tk:", mtk2 ? mtk2.value.slice(0, 50) : "NOT found");

    // Try mtop API now
    console.log("\nStep 3: Test mtop API...");
    const mtopCookies = await ctx.cookies("https://h5api.m.1688.com");
    const mtk3 = mtopCookies.find(c => c.name === "_m_h5_tk");
    console.log("h5api _m_h5_tk:", mtk3 ? mtk3.value.slice(0, 50) : "NOT found");

    if (mtk3) {
      console.log("\nGot token! Full cookie string:");
      const cookieStr = mtopCookies.map(c => `${c.name}=${c.value}`).join("; ");
      console.log(cookieStr.slice(0, 300));
    }

    await browser.close();
  } catch (e) {
    console.error("Error:", e.message.slice(0, 300));
  }
}

main();
