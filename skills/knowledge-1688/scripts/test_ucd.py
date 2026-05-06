import undetected_chromedriver as uc
import time
import sys
import json

CHROME = r"C:\Users\Administrator\AppData\Local\Chromium\Application\chrome.exe"
print("uc version:", uc.__version__)

try:
    opts = uc.ChromeOptions()
    opts.binary_location = CHROME
    opts.add_argument("--window-size=1920,1080")
    driver = uc.Chrome(options=opts, version_main=144)
    print("Chrome OK")

    driver.get("https://h5api.m.1688.com/")
    time.sleep(2)

    driver.get("https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%A1%B9%E9%93%BE")
    time.sleep(5)
    print("URL:", driver.current_url[:80])
    print("Title:", driver.title[:50])

    cks = driver.get_cookies()
    mtk = None
    for c in cks:
        nm = c.get("name") or ""
        if nm == "_m_h5_tk":
            mtk = c
            break

    if mtk:
        print("_m_h5_tk:", mtk["value"][:60])
        out = {"_m_h5_tk": mtk["value"], "domain": mtk.get("domain", ".1688.com")}
        with open(r"C:\Users\Administrator\.openclaw\workspace\skills\knowledge-1688-scraper\scripts\token_cache.json", "w") as f:
            json.dump(out, f)
        print("Token saved!")
    else:
        print("_m_h5_tk NOT found, 1688 cookies:")
        for c in cks:
            dom = c.get("domain") or ""
            nm = c.get("name") or ""
            if "1688" in dom:
                print(" ", dom, nm, "=", c.get("value", "")[:30])

    driver.quit()
    print("Done!")
except Exception as e:
    print("Error:", e)
    import traceback
    traceback.print_exc()
