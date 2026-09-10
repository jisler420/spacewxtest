#!/usr/bin/env python3
"""Merge NOAA live hemi-power into data/hemi.txt (keep 36h)."""
import datetime
import pathlib
import urllib.request
from datetime import timezone

URL = "https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt"
PATHS = [pathlib.Path("data/hemi.txt"), pathlib.Path("kiosk/data/hemi.txt")]


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "SpaceWx"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def rows(txt):
    return [ln for ln in txt.splitlines() if len(ln) >= 16 and ln[:4].isdigit()]


def merge(old, new):
    by = {}
    for ln in rows(old) + rows(new):
        by[ln[:16]] = ln
    now = datetime.datetime.now(timezone.utc)
    cut = now - datetime.timedelta(hours=36)
    kept = []
    for key in sorted(by):
        try:
            t = datetime.datetime.strptime(key, "%Y-%m-%d_%H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if t >= cut:
            kept.append(by[key])
    header = [ln for ln in new.splitlines() if not (len(ln) >= 4 and ln[:4].isdigit())]
    return "\n".join(header).rstrip() + "\n" + "\n".join(kept) + "\n"


def main():
    new = fetch()
    old = PATHS[0].read_text(encoding="utf-8") if PATHS[0].exists() else ""
    body = merge(old, new)
    for p in PATHS:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    print("hemi rows", len(rows(body)))


if __name__ == "__main__":
    main()
