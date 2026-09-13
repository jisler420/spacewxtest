#!/usr/bin/env python3
"""Save NOAA hemi-power as of ~23:55 UTC (previous evening).

The live NOAA day file is fetched on demand. This snapshot only fills blanks
from 23:55 UTC until ~05:55 UTC, when today's file has 6 hours. Never replace
the snapshot with the next day's short file.
"""
import datetime
import pathlib
import re
import sys
import urllib.request
from datetime import timezone

URL = "https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt"
ARCHIVE = pathlib.Path("data/hemi-archive.txt")


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "SpaceWx"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def rows(txt):
    return [ln for ln in (txt or "").splitlines() if len(ln) >= 16 and ln[:4].isdigit()]


def file_day(txt):
    for ln in (txt or "").splitlines():
        if "contains data for" in ln.lower():
            m = re.search(r"(\d{4}-\d{2}-\d{2})", ln)
            if m:
                return datetime.date.fromisoformat(m.group(1))
    days = []
    for ln in rows(txt):
        try:
            days.append(datetime.datetime.strptime(ln[:16], "%Y-%m-%d_%H:%M").date())
        except ValueError:
            pass
    return max(days) if days else None


def fill_utc_day_end(by):
    STEP = datetime.timedelta(minutes=5)
    MAXGAP = datetime.timedelta(minutes=90)

    def clone(src_key, dst_key):
        ln = by.get(src_key)
        if not ln or dst_key in by:
            return
        parts = ln.split()
        if len(parts) < 4:
            return
        obs, fcst, n, s = parts[0], parts[1], parts[2], parts[3]
        try:
            t0 = datetime.datetime.strptime(obs, "%Y-%m-%d_%H:%M")
            t1 = datetime.datetime.strptime(fcst, "%Y-%m-%d_%H:%M")
            dst = datetime.datetime.strptime(dst_key, "%Y-%m-%d_%H:%M")
        except ValueError:
            return
        nf = (t1 + (dst - t0)).strftime("%Y-%m-%d_%H:%M")
        by[dst_key] = f"{dst_key}    {nf}      {n}      {s}"

    parsed = []
    for k in list(by):
        try:
            parsed.append(datetime.datetime.strptime(k, "%Y-%m-%d_%H:%M"))
        except ValueError:
            continue
    parsed.sort()
    for i in range(len(parsed) - 1):
        t, nxt = parsed[i], parsed[i + 1]
        if STEP < (nxt - t) <= MAXGAP:
            src = t.strftime("%Y-%m-%d_%H:%M")
            cur = t + STEP
            while cur < nxt:
                clone(src, cur.strftime("%Y-%m-%d_%H:%M"))
                cur += STEP
    by_day = {}
    for t in parsed:
        by_day.setdefault(t.date(), []).append(t)
    for day, ts in by_day.items():
        last = max(ts)
        if last.hour < 22:
            continue
        end = datetime.datetime(day.year, day.month, day.day, 23, 55)
        if last >= end:
            continue
        src = last.strftime("%Y-%m-%d_%H:%M")
        cur = last + STEP
        while cur <= end and (cur - last) <= MAXGAP:
            clone(src, cur.strftime("%Y-%m-%d_%H:%M"))
            cur += STEP


def evening_of(txt, day):
    tag = day.isoformat()
    by = {}
    for ln in rows(txt):
        if ln[:10] == tag and ln[11:16] >= "18:00":
            by[ln[:16]] = ln
    fill_utc_day_end(by)
    keys = sorted(k for k in by if k[:10] == tag and k[11:16] >= "18:00")
    header = [
        "# SpaceWx hemi 23:55 UTC snapshot (previous evening — fill midnight blanks only)",
        f"# Day: {tag}  18:00–23:55 UTC",
    ]
    body = "\n".join(header) + "\n" + "\n".join(by[k] for k in keys) + "\n"
    return body, len(keys)


def should_capture(new, now):
    """Only rewrite the snapshot at end-of-UTC-day, never with the next day's stub."""
    day = file_day(new)
    if day is None:
        return False
    if now.hour >= 22 and day == now.date():
        return True
    if day < now.date() and now.hour == 0 and now.minute < 20:
        return True
    return False


def main():
    now = datetime.datetime.now(timezone.utc)
    old = ARCHIVE.read_text(encoding="utf-8") if ARCHIVE.exists() else ""
    old_n = len(rows(old))
    try:
        new = fetch()
    except Exception as e:
        print("fetch failed, keeping 23:55 snapshot:", e)
        if old_n == 0:
            sys.exit(1)
        print("hemi-archive rows", old_n, "(unchanged)")
        return
    if not should_capture(new, now):
        print("not 23:55 capture window, keeping snapshot rows", old_n, "noaa", len(rows(new)))
        return
    day = file_day(new)
    merged = (old or "") + "\n" + new
    body, n = evening_of(merged, day)
    if old_n and n < 12:
        print("refuse write: evening slice", n, "old", old_n)
        sys.exit(1)
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_text(body, encoding="utf-8")
    print("hemi 23:55 snapshot", day, "rows", n)


if __name__ == "__main__":
    main()
