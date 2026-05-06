"""
1688 标题采集脚本
基于 6 个项目知识：feng25927(mtop API) + daimaoHandle(Playwright Stealth) + MarketSpider(选择器)

双模式：
1. mtop API 模式 — 直接调1688内部API，绕过页面解析（最轻量）
2. Playwright 浏览器模式 — 反检测浏览器采集（备用）

用法：
    python 1688_title_scraper.py                    # 交互模式
    python 1688_title_scraper.py 项链 5            # 命令行：关键词 + 页数
"""

import os
import sys
import re
import json
import time
import hashlib
import random
import requests
from datetime import datetime

# ─────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────
KEYWORDS = ["项链", "耳环", "手链", "戒指", "吊坠"]
MAX_PAGES = 3
OUTPUT_FILE = r"E:\1688标题生成\1688_titles.csv"
COOKIE_FILE = os.path.join(os.path.dirname(__file__), "cookie.txt")

# mtop API 端点（feng25927 发现）
MTOP_URL = "https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/"
APP_KEY = "12574478"
APP_ID = "32517"

# 搜索列表选择器（MarketSpider + daimaoHandle）
CARD_SELECTORS = [
    "#sm-offer-list > div",
    ".offer-list-row .offer-item",
    ".sm-offer-item",
    "[class*='offerItem']",
    ".list-item",
    "[data-offer-id]",
]
TITLE_SELECTORS = [
    "a[data-img]",
    "[class*='title'] a",
    "[class*='name'] a",
    "a[href*='/offer/']",
]
EXCLUDE_TITLE_PATTERNS = [
    "点此可以直接和卖家交流",
    "联系卖家",
    "小二币",
    "掌财",
]

# ─────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────
def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}")

def save_results(items, path):
    """保存到 CSV（BOM UTF-8，兼容 Excel）"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ["\ufeff关键词,标题,价格,店铺,商品链接,采集时间"]
    for it in items:
        title = (it.get("title") or "").replace('"', '""')
        lines.append(
            f'{it.get("keyword","")},"{title}",{it.get("price","")},'
            f'{it.get("shop","")},{it.get("link","")},{it.get("time","")}'
        )
    with open(path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(lines))
    log(f"已保存 {len(items)} 条到 {path}")

def load_cookie(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""

def save_cookie(cookie_str, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write(cookie_str)

def parse_cookie(cookie_str):
    """简单解析 cookie 字符串为 dict"""
    jar = {}
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            jar[k.strip()] = v.strip()
    return jar

def extract_mtop_token(cookie_str):
    """从 cookie 提取 mtop token（feng25927 算法）"""
    m = re.search(r'_m_h5_tk=([^_\s]+)', cookie_str)
    return m.group(1) if m else None

def build_mtop_sign(token, timestamp, data_json):
    """mtop 签名算法（feng25927）"""
    sign_str = f"{token}&{timestamp}&{APP_KEY}&{data_json}"
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()

def build_mtop_params(keyword, page, cookie_str):
    """构建 mtop API 请求参数"""
    t = str(int(time.time() * 1000))
    token = extract_mtop_token(cookie_str) or ""

    params_dict = {
        "verticalProductFlag": "pccps",
        "searchScene": "pcOfferSearch",
        "charset": "utf8",
        "beginPage": page,
        "pageSize": 60,
        "keywords": keyword,
        "method": "getOfferList"
    }
    params_str = json.dumps(params_dict, separators=(",", ":"))
    data_dict = {"appId": APP_ID, "params": params_str}
    data = json.dumps(data_dict, separators=(",", ":"))
    sign = build_mtop_sign(token, t, data) if token else ""

    return {
        "jsv": "2.7.4",
        "appKey": APP_KEY,
        "t": t,
        "sign": sign,
        "api": "mtop.relationrecommend.WirelessRecommend.recommend",
        "v": "2.0",
        "type": "jsonp",
        "ignoreLogin": "true",
        "data": data,
        "timeout": "20000",
    }

def fetch_mtop_api(keyword, page, cookie_str):
    """
    请求 mtop API（feng25927 逆向的 API）
    返回: list[dict] 或 None（失败返回 None）
    """
    params = build_mtop_params(keyword, page, cookie_str)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Cookie": cookie_str,
        "Referer": "https://s.1688.com/",
    }
    try:
        resp = requests.get(MTOP_URL, params=params, headers=headers, timeout=15)
        raw = resp.text
        # jsonp 前缀截断（feng25927 算法：response[39:-1]）
        if raw.startswith("mtopjsonp"):
            raw = raw[raw.index("(") + 1:-2] if "(" in raw else raw[39:-1]
        data = json.loads(raw)
        items = data.get("data", {}).get("data", {}).get("offer", {}).get("items", [])
        results = []
        for it in items:
            d = it.get("data", {})
            title = d.get("title", "")
            price_info = d.get("priceInfo", {})
            price = price_info.get("price", "") if price_info else ""
            shop_text = d.get("shop", {}).get("text", "") if isinstance(d.get("shop"), dict) else ""
            # offerId → 详情页链接
            offer_id = d.get("offerId", "")
            link = f"https://detail.1688.com/offer/{offer_id}.html" if offer_id else ""
            results.append({
                "keyword": keyword,
                "title": clean_title(title),
                "price": price,
                "shop": shop_text,
                "link": link,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
        return results
    except Exception as e:
        log(f"mtop API 请求失败: {e}", "WARN")
        return None

def clean_title(title):
    """清洗 1688 标题（去除 HTML 标签、冗余字符）"""
    if not title:
        return ""
    # 去除 HTML 标签
    title = re.sub(r"<[^>]+>", "", title)
    # 去除多余空白
    title = re.sub(r"\s+", " ", title).strip()
    # 去除特殊转义
    title = title.replace("\\n", " ").replace("\\t", " ")
    return title

def is_valid_title(title):
    """判断是否是有效商品标题（排除按钮文案）"""
    if not title or len(title) < 5:
        return False
    for pat in EXCLUDE_TITLE_PATTERNS:
        if pat in title:
            return False
    # 有效标题应含中文
    return bool(re.search(r"[\u4e00-\u9fa5]", title))


# ─────────────────────────────────────────────
# Playwright 浏览器采集模式（daimaoHandle + MarketSpider）
# ─────────────────────────────────────────────
def scrape_by_browser(keyword, max_pages, progress_callback=None):
    """
    Playwright 反检测浏览器采集（降级模式）
    daimaoHandle 的 Stealth 脚本 + MarketSpider 的选择器
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("Playwright 未安装，执行: pip install playwright && playwright install chromium", "ERROR")
        return []

    STEALTH_SCRIPT = """
    () => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }],
            configurable: true
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
        const toDelete = ['__playwright', '__cdc_adoQpoasnfa76pfcZLmcfl_Symbol', '__cdc_adoQpoasnfa76pfcZLmcfl_Promise'];
        toDelete.forEach(k => { try { delete window[k]; } catch(e) {} });
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = { id: undefined };
    }
    """

    results = []
    search_url = f"https://s.1688.com/selloffer/offer_search.htm?keywords={requests.utils.quote(keyword)}&beginPage=1"

    with sync_playwright() as p:
        # 使用用户 Chromium（TOOLS.md 中的配置）
        chromium_path = r"C:\Users\Administrator\AppData\Local\Chromium\Application\chrome.exe"
        if not os.path.exists(chromium_path):
            chromium_path = None  # 回退到bundled

        context = p.chromium.launch_persistent_context(
            user_data_dir="",
            headless=True,
            slow_mo=50,
            executable_path=chromium_path,
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--no-first-run",
            ],
        )
        context.add_init_script(STEALTH_SCRIPT)

        if context.pages:
            page = context.pages[0]
        else:
            page = context.new_page()

        page.set_default_timeout(15000)

        for page_num in range(1, max_pages + 1):
            url = f"https://s.1688.com/selloffer/offer_search.htm?keywords={requests.utils.quote(keyword)}&beginPage={page_num}"
            log(f"[浏览器] 访问第 {page_num}/{max_pages} 页: {url[:80]}")
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)  # 等待动态内容加载

            # 滚动触发懒加载（daimaoHandle 策略）
            prev_height = 0
            scroll_retries = 0
            while scroll_retries < 3:
                page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(1000)
                new_height = page.evaluate("() => document.body.scrollHeight")
                if new_height > prev_height:
                    prev_height = new_height
                    scroll_retries = 0
                else:
                    scroll_retries += 1

            # 提取商品卡片
            cards = []
            for sel in CARD_SELECTORS:
                try:
                    cards = page.query_selector_all(sel)
                    if cards:
                        log(f"[浏览器] 选择器 '{sel}' 命中 {len(cards)} 个卡片")
                        break
                except Exception:
                    continue

            page_results = []
            for card in cards:
                try:
                    # 提取 offerId
                    offer_id = (
                        card.get_attribute("data-offer-id") or
                        re.search(r'offer[D_/]?(\d+)', card.inner_html()).group(1) if re.search(r'offer[D_/]?(\d+)', card.inner_html()) else ""
                    )
                    if not offer_id:
                        continue

                    # 提取标题（智能提取，排除旺旺按钮）
                    title = ""
                    # 方案1: 图片链接 title
                    try:
                        img_link = card.query_selector("a[data-img]")
                        if img_link:
                            title = img_link.get_attribute("title") or ""
                    except Exception:
                        pass
                    # 方案2: 遍历链接，找含中文的正文链接
                    if not title or not is_valid_title(title):
                        links = card.query_selector_all("a[href]")
                        for a in links:
                            try:
                                href = a.get_attribute("href") or ""
                                t = a.get_attribute("title") or a.inner_text().strip()
                                # 排除旺旺/联系类链接
                                if any(p in href for p in ["im.1688", "webchat", "联系卖家"]):
                                    continue
                                if is_valid_title(t) and not any(p in t for p in EXCLUDE_TITLE_PATTERNS):
                                    title = t
                                    break
                            except Exception:
                                continue
                    # 方案3: data-expect JSON
                    if not title or not is_valid_title(title):
                        try:
                            de = card.get_attribute("data-expect")
                            if de:
                                obj = json.loads(de)
                                if obj and isinstance(obj, dict):
                                    title = obj.get("title", "")
                        except Exception:
                            pass

                    if not is_valid_title(title):
                        continue

                    # 提取价格
                    price = ""
                    try:
                        price_el = card.query_selector("[class*='price']")
                        if price_el:
                            p_text = price_el.inner_text()
                            m = re.search(r'([¥￥]?\s*[\d,]+\.?\d*)', p_text)
                            price = m.group(1).replace(",", "") if m else ""
                    except Exception:
                        pass

                    # 提取店铺
                    shop = ""
                    try:
                        for shop_sel in ["[class*='company']", "[class*='shop']", ".shop-name", ".company-name"]:
                            shop_el = card.query_selector(shop_sel)
                            if shop_el:
                                shop = shop_el.inner_text().strip()
                                if shop:
                                    break
                    except Exception:
                        pass

                    link = f"https://detail.1688.com/offer/{offer_id}.html"
                    page_results.append({
                        "keyword": keyword,
                        "title": title,
                        "price": price,
                        "shop": shop,
                        "link": link,
                        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    })
                except Exception as e:
                    continue

            log(f"[浏览器] 第 {page_num} 页提取到 {len(page_results)} 条")
            results.extend(page_results)

            if progress_callback:
                progress_callback(page_num, max_pages)

            # 翻页延时
            delay = random.uniform(3, 8)
            log(f"[浏览器] 随机延时 {delay:.1f}s")
            time.sleep(delay)

        context.close()

    return results


# ─────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────
def main():
    log("=" * 50)
    log("1688 标题采集脚本（双模式）")
    log("  模式1: mtop API（优先）")
    log("  模式2: Playwright 浏览器（降级）")
    log("=" * 50)

    # 解析命令行参数
    if len(sys.argv) >= 2:
        keywords_input = [sys.argv[1]]
        max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else MAX_PAGES
    else:
        keywords_input = KEYWORDS
        max_pages = MAX_PAGES

    all_results = []
    mode = "mtop_api"

    # 先尝试 mtop API 模式
    log(f"\n{'='*50}")
    log("阶段1: 尝试 mtop API 模式（feng25927 逆向）")
    log(f"{'='*50}")
    cookie_str = load_cookie(COOKIE_FILE)

    for keyword in keywords_input:
        log(f"\n--- 关键词: {keyword} ---")
        keyword_results = []
        for page in range(1, max_pages + 1):
            log(f"采集第 {page}/{max_pages} 页...")
            items = fetch_mtop_api(keyword, page, cookie_str)
            if items is None:
                # mtop 失败，切换到浏览器模式
                log("mtop API 失败，切换到浏览器模式", "WARN")
                mode = "browser"
                break
            # 过滤无效标题
            valid = [it for it in items if is_valid_title(it.get("title", ""))]
            log(f"  有效数据: {len(valid)}/{len(items)} 条")
            keyword_results.extend(valid)
            time.sleep(random.uniform(1, 3))

        if mode == "browser":
            break
        all_results.extend(keyword_results)
        log(f"  [{keyword}] 共采集 {len(keyword_results)} 条")

    # 浏览器模式（降级）
    if mode == "browser":
        log(f"\n{'='*50}")
        log("阶段2: Playwright 浏览器采集模式")
        log(f"{'='*50}")
        for keyword in keywords_input:
            log(f"\n--- 关键词: {keyword} ---")
            items = scrape_by_browser(keyword, max_pages)
            all_results.extend(items)
            log(f"  [{keyword}] 共采集 {len(items)} 条")

    # 去重（按标题）
    seen = set()
    unique_results = []
    for it in all_results:
        key = it.get("title", "")[:50]  # 按前50字去重
        if key and key not in seen:
            seen.add(key)
            unique_results.append(it)

    log(f"\n{'='*50}")
    log(f"采集完成: 共 {len(all_results)} 条，去重后 {len(unique_results)} 条")
    log(f"{'='*50}")

    if unique_results:
        save_results(unique_results, OUTPUT_FILE)
        log(f"结果已保存到: {OUTPUT_FILE}")
        # 打印前5条
        log("\n前5条示例:")
        for it in unique_results[:5]:
            print(f"  [{it['keyword']}] {it['title'][:40]}... | {it['price']}")
    else:
        log("无有效数据", "WARN")


if __name__ == "__main__":
    main()
