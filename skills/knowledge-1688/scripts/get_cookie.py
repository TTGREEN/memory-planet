"""
从 Chrome 内存/缓存读取 1688 cookie
策略：Chrome 运行时可以用 --disk-cache-dir 读缓存 cookie
"""
import sqlite3
import shutil
import os
import sys
import json
import time

COOKIE_PATH = os.path.join(
    os.environ["LOCALAPPDATA"],
    "Google", "Chrome", "User Data", "Default", "Network", "Cookies"
)
TMP_COPY = os.path.join(os.environ["TEMP"], "chrome_cookies_copy.db")
OUT_FILE = os.path.join(os.path.dirname(__file__), "token_cache.json")

def read_cookies():
    if not os.path.exists(COOKIE_PATH):
        print("Cookie file not found:", COOKIE_PATH)
        return None

    # 尝试复制（Chrome 运行时会失败，但可能缓存有部分数据）
    try:
        shutil.copy2(COOKIE_PATH, TMP_COPY)
    except PermissionError:
        # Chrome 运行中，复制失败 — 尝试读临时网络缓存
        print("Chrome is running, trying cache...")
        return read_from_cache()
    except Exception as e:
        print("Copy failed:", e)
        return None

    try:
        conn = sqlite3.connect(TMP_COPY)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly
            FROM cookies
            WHERE host_key LIKE '%1688%'
            ORDER BY host_key
        """)
        rows = cur.fetchall()
        conn.close()
        cookies = []
        for r in rows:
            cookies.append({
                "domain": r["host_key"],
                "name": r["name"],
                "value": r["value"],
                "path": r["path"],
                "expires_utc": r["expires_utc"],
                "is_secure": bool(r["is_secure"]),
                "is_httponly": bool(r["is_httponly"]),
            })
        os.unlink(TMP_COPY)
        return cookies
    except Exception as e:
        print("Read error:", e)
        try:
            os.unlink(TMP_COPY)
        except:
            pass
        return None

def read_from_cache():
    """从 Chrome 网络缓存目录找 cookie"""
    cache_dir = os.path.join(
        os.environ["LOCALAPPDATA"],
        "Google", "Chrome", "User Data", "Default", "Cache", "Network"
    )
    if not os.path.exists(cache_dir):
        return None
    # 读所有文件尝试找 cookie 数据（太慢且不可靠）
    print("Cache approach not reliable, skipping")
    return None

def main():
    print("Reading Chrome cookies...")
    cookies = read_cookies()

    if not cookies:
        print("No 1688 cookies found. Is 1688 logged in Chrome?")
        print("Please log in to 1688 in Chrome first, then run this script.")
        return

    print(f"Found {len(cookies)} 1688 cookies")

    # 找关键的 cookie
    mtk = None
    for c in cookies:
        if c["name"] == "_m_h5_tk":
            mtk = c
            break

    if mtk:
        print(f"_m_h5_tk: {mtk['value'][:60]}")
        print(f"Domain: {mtk['domain']}")
        print(f"Secure: {mtk['is_secure']}")
    else:
        print("_m_h5_tk NOT found")
        for c in cookies:
            print(f"  {c['domain']} {c['name']} = {c['value'][:30]}")

    # 保存完整 cookie jar
    cookie_jar = {c["name"]: c["value"] for c in cookies}
    result = {
        "cookie_jar": cookie_jar,
        "mtk_value": mtk["value"] if mtk else None,
        "mtk_domain": mtk["domain"] if mtk else None,
        "timestamp": time.time()
    }
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Saved to {OUT_FILE}")

if __name__ == "__main__":
    main()
