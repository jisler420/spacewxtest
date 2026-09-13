#!/usr/bin/env python3
"""Merge NOAA live hemi-power into data/hemi-archive.txt (keep 36h). Never replace with empty."""
import datetime
import pathlib
import sys
import urllib.request
from datetime import timezone

URL = "https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt"
ARCHIVE = pathlib.Path("data/hemi-archive.txt")
PATHS = [ARCHIVE]
LEGACY = [pathlib.Path("data/hemi.txt")]
KEEP_H = 36


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "SpaceWx"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def rows(txt):
    return [ln for ln in (txt or "").splitlines() if len(ln) >= 16 and ln[:4].isdigit()]


def unique_n(txt):
    return len({ln[:16] for ln in rows(txt)})


def load_all():
    chunks = []
    for p in PATHS + LEGACY:
        if p.exists():
            chunks.append(p.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def fill_utc_day_end(by):
    """Hold-forward 5-min slots across gaps ≤90 min and pad a UTC day to 23:55."""
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


def merge(old, new):
    by = {}
    for ln in rows(old) + rows(new):
        by[ln[:16]] = ln
    fill_utc_day_end(by)
    now = datetime.datetime.now(timezone.utc)
    cut = now - datetime.timedelta(hours=KEEP_H)
    kept, dropped = [], 0
    for key in sorted(by):
        try:
            t = datetime.datetime.strptime(key, "%Y-%m-%d_%H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if t >= cut:
            kept.append(by[key])
        else:
            dropped += 1
    header = [ln for ln in (new or old).splitlines() if not (len(ln) >= 4 and ln[:4].isdigit())]
    if not header:
        header = ["# SpaceWx hemi-power archive (36h rolling merge of NOAA OVATION)"]
    body = "\n".join(header).rstrip() + "\n" + "\n".join(kept) + "\n"
    return body, len(kept), dropped


def main():
    old = load_all()
    old_n = unique_n(old)
    try:
        new = fetch()
    except Exception as e:
        print("fetch failed, keeping archive:", e)
        if old_n == 0:
            sys.exit(1)
        for p in PATHS:
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.write_text(old, encoding="utf-8")
        print("hemi rows", old_n, "(unchanged)")
        return
    if not unique_n(new) and old_n:
        print("NOAA empty, keeping", old_n, "archive rows")
        for p in PATHS:
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists() and old:
                p.write_text(old, encoding="utf-8")
        return
    body, kept_n, dropped = merge(old, new)
    if old_n and kept_n == 0:
        print("refuse write: merged empty, old", old_n)
        sys.exit(1)
    if old_n and kept_n < max(12, old_n - dropped - 8):
        print("refuse write: merged", kept_n, "old", old_n, "trimmed", dropped)
        sys.exit(1)
    for p in PATHS:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    print("hemi-archive rows", kept_n, "trimmed", dropped, "noaa", len(rows(new)))


if __name__ == "__main__":
    main()
