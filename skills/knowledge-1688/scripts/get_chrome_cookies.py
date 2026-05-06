"""
从 Chrome 读取 1688 cookie (Windows)
Chrome 必须关闭才能读取 Cookies 文件（文件锁）
"""
import sqlite3
import os
import sys
import json
import shutil
import tempfile

COOKIE_PATH = os.path.join(
    os.environ["LOCALAPPDATA"],
    "Google", "Chrome", "User Data", "Default", "Network", "Cookies"
)

def read_chrome_cookies(domain="1688"):
    """读取 Chrome Cookies SQLite 文件"""
    if not os.path.exists(COOKIE_PATH):
        return {"error": f"Cookie file not found: {COOKIE_PATH}"}

    # Chrome 运行时会锁住文件，先复制到临时文件
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    try:
        shutil.copy2(COOKIE_PATH, tmp.name)
    except PermissionError:
        return {"error": "Chrome is running - please close Chrome first, then retry"}
    except Exception as e:
        return {"error": f"Copy failed: {e}"}

    try:
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(f"""
            SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly
            FROM cookies
            WHERE host_key LIKE '%{domain}%'
            ORDER BY host_key
        """)
        rows = cur.fetchall()
        conn.close()

        cookies = []
        for r in rows:
            cookies.append({
                "host": r["host_key"],
                "name": r["name"],
                "value": r["value"],
                "path": r["path"],
                "expires_utc": r["expires_utc"],
                "is_secure": bool(r["is_secure"]),
                "is_httponly": bool(r["is_httponly"]),
            })

        if not cookies:
            # 列出所有 host_key 包含该域名的
            cur2 = sqlite3.connect(tmp.name).cursor()
            cur2.execute(f"SELECT DISTINCT host_key FROM cookies WHERE host_key LIKE '%{domain}%'")
            found = [row[0] for row in cur2.fetchall()]
            return {"error": f"No cookies for {domain}", "checked_domains": found, "total_cookies": len(rows)}

        return {"cookies": cookies}
    finally:
        try:
            os.unlink(tmp.name)
        except:
            pass

def main():
    import json as _json
    result = read_chrome_cookies("1688")
    # 只输出纯 JSON，不允许任何其他输出
    sys.stdout.write(_json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
