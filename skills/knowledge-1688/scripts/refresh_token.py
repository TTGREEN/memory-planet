"""
1688 Token 自动刷新
通过 1688 轻量级接口自动刷新 token（无需浏览器）
"""
import requests
import re
import hashlib
import json
import time
import os

APP_KEY = "12574478"
APP_ID = "32517"
CACHE_FILE = os.path.join(os.path.dirname(__file__), "token_cache.json")

def get_fresh_token(cookies=None):
    """
    通过不带 token 的 mtop 请求，1688 会种新的 cookie 并返回 token
    """
    t = str(int(time.time() * 1000))
    params = {
        "verticalProductFlag": "pccps",
        "searchScene": "pcOfferSearch",
        "charset": "utf8",
        "beginPage": 1,
        "pageSize": 1,
        "keywords": "项链",
        "method": "getOfferList"
    }
    data_str = json.dumps({"appId": APP_ID, "params": json.dumps(params)})

    # 用空 token 签名（触发 1688 种 cookie）
    sign_str = "&" + t + "&" + APP_KEY + "&" + data_str
    sign = hashlib.md5(sign_str.encode()).hexdigest()

    url = (
        "https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/"
        "?jsv=2.7.4&appKey=" + APP_KEY + "&t=" + t + "&sign=" + sign +
        "&api=mtop.relationrecommend.WirelessRecommend.recommend&v=2.0"
        "&type=jsonp&timeout=20000&data=" + requests.utils.quote(data_str)
    )

    cookie_str = ""
    if cookies:
        cookie_str = "; ".join(k + "=" + v for k, v in cookies.items())

    resp = requests.get(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://s.1688.com/",
        "Cookie": cookie_str,
        "Accept": "*/*"
    }, timeout=15)

    # 从 Set-Cookie 头提取 _m_h5_tk
    mtk = None
    enc = None
    for h in resp.headers.get("Set-Cookie", "").split(","):
        m = re.match(r"_m_h5_tk=([^;]+)", h.strip())
        if m:
            mtk = m.group(1)
        m2 = re.match(r"_m_h5_tk_enc=([^;]+)", h.strip())
        if m2:
            enc = m2.group(1)

    return mtk, enc


def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_cache(token, cookie_jar):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "token": token,
            "cookie_jar": cookie_jar,
            "timestamp": time.time()
        }, f, ensure_ascii=False)


if __name__ == "__main__":
    cached = load_cache()

    if cached:
        age = (time.time() - cached["timestamp"]) / 60
        print("Cached token age: {:.1f} min".format(age))
        print("Token:", cached["token"][:50])

        # 尝试用缓存 cookie 刷新 token
        cks = cached.get("cookie_jar", {})
        print("Trying refresh with existing cookies...")
        new_mtk, new_enc = get_fresh_token(cks)
        if new_mtk:
            print("Fresh token:", new_mtk[:60])
            save_cache(new_mtk, cks)
            print("Updated cache!")
        else:
            print("Refresh failed (need real login cookie)")
            print("Current token will expire ~55min after issue")
    else:
        print("No cache found")
        print("Run get_cookie.py first to establish session")
