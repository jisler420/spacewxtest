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
    """NOAA's day file stops at 23:50. Copy 23:45→23:50 and 23:50→23:55 if missing."""
    days = sorted({k[:10] for k in by})
    for day in days:
        k45, k50, k55 = f"{day}_23:45", f"{day}_23:50", f"{day}_23:55"
        def clone(src_key, dst_key):
            ln = by.get(src_key)
            if not ln:
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
            dt = dst - t0
            nf = (t1 + dt).strftime("%Y-%m-%d_%H:%M")
            by[dst_key] = f"{dst_key}    {nf}      {n}      {s}"
        if k50 not in by and k45 in by:
            clone(k45, k50)
        if k55 not in by and (k50 in by or k45 in by):
            clone(k50 if k50 in by else k45, k55)


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
    # Refuse wipe: merged must not collapse except 36h trim
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
