"""Active time (AFK subtracted) per app and per file from an ActivityWatch database.

Usage: python scripts/aw_analyze.py [path to peewee-sqlite.v2.db]
The database is opened read-only.
"""
import bisect
import json
import os
import sqlite3
import sys
from datetime import datetime

DEFAULT_DB = os.path.expandvars(r"%LOCALAPPDATA%\activitywatch\activitywatch\aw-server\peewee-sqlite.v2.db")
TOP = 12


def ts(s):
    return datetime.fromisoformat(s).timestamp()


def main(db):
    sys.stdout.reconfigure(encoding="utf-8")
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    buckets = dict(c.execute("select type, key from bucketmodel"))
    win, afk_key = buckets["currentwindow"], buckets["afkstatus"]

    active = [
        (ts(t), ts(t) + float(d))
        for t, d, s in c.execute("select timestamp, duration, datastr from eventmodel where bucket_id=? order by timestamp", (afk_key,))
        if json.loads(s).get("status") == "not-afk"
    ]
    starts = [a for a, _ in active]

    def overlap(a, b):
        tot, i = 0.0, max(0, bisect.bisect_right(starts, a) - 1)
        while i < len(active) and active[i][0] < b:
            tot += max(0.0, min(b, active[i][1]) - max(a, active[i][0]))
            i += 1
        return tot

    apps, titles = {}, {}
    for t, d, s in c.execute("select timestamp, duration, datastr from eventmodel where bucket_id=?", (win,)):
        a = ts(t)
        sec = overlap(a, a + float(d))
        j = json.loads(s)
        app, title = j.get("app") or "?", j.get("title") or ""
        apps[app] = apps.get(app, 0) + sec
        titles[(app, title)] = titles.get((app, title), 0) + sec

    print("Active hours per app:")
    for k, v in sorted(apps.items(), key=lambda x: -x[1])[:TOP]:
        print(f"  {v / 3600:7.1f}  {k}")
    for app in ("Figma.exe", "AfterFX.exe", "Cursor.exe"):
        print(f"\n{app} by title:")
        rows = sorted(((v, t) for (a, t), v in titles.items() if a == app), reverse=True)[:TOP]
        for v, t in rows:
            print(f"  {v / 3600:7.1f}  {t}")
    yt = sum(v for (_, t), v in titles.items() if "YouTube" in t)
    print(f"\nYouTube in the title, active: {yt / 3600:.1f} h")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB)
