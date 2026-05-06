const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const fs = require("fs");
const https = require("https");
const http = require("http");

async function main() {
  const CHROME = "C:\\Users\\Administrator\\AppData\\Local\\Chromium\\Application\\chrome.exe";

  // Stealth script (daimaoHandle)
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
    // launch with system Chrome
    const browser = await chromium.launch({
      executablePath: CHROME,
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--window-size=1920,1080",
        "--disable-accelerated-2d-canvas",
      ],
    });

    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      ignoreHTTPSErrors: true,
    });

    ctx.addInitScript(STEALTH_SCRIPT);
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    await page.goto("https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE", { waitUntil: "commit", timeout: 20000 });
    console.log("OK, URL:", page.url().slice(0, 80));
    await page.waitForTimeout(6000);
    console.log("After 6s, URL:", page.url().slice(0, 80));

    const r = await page.evaluate(() => {
      return {
        title: document.title.slice(0, 60),
        cards: document.querySelectorAll("[data-offer-id]").length,
        offerListDiv: document.querySelectorAll("#sm-offer-list > div").length,
        smOffer: document.querySelectorAll(".sm-offer-item").length,
        offerRow: document.querySelectorAll(".offer-list-row .offer-item").length,
        bodyLen: document.body ? document.body.innerHTML.length : 0,
      };
    });
    console.log("Result:", JSON.stringify(r, null, 2));

    await browser.close();
  } catch (e) {
    console.error("Error:", e.message.slice(0, 300));
  }
}

main();
