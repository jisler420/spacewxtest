#!/usr/bin/env python3
"""Merge NOAA planetary_k_index_1m.json into data/kp1m-archive.json (keep 6h). Never replace with empty."""
import datetime
import json
import pathlib
import sys
import urllib.request
from datetime import timezone

URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
ARCHIVE = pathlib.Path("data/kp1m-archive.json")
KEEP_H = 6


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "SpaceWx"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def parse_t(tag):
    s = str(tag or "").strip().replace(" ", "T")
    if not s:
        return None
    if not (s.endswith("Z") or "+" in s[10:] or s.endswith("z")):
        s += "Z"
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def as_rows(data):
    if isinstance(data, dict):
        data = data.get("rows") or data.get("data") or []
    if not isinstance(data, list):
        return []
    out = []
    for r in data:
        if not isinstance(r, dict):
            continue
        t = parse_t(r.get("time_tag"))
        if t is None:
            continue
        k = r.get("estimated_kp")
        if k is None:
            k = r.get("kp")
        try:
            k = float(k)
        except (TypeError, ValueError):
            continue
        out.append({
            "time_tag": r.get("time_tag"),
            "estimated_kp": k,
            "kp": r.get("kp"),
            "t": t,
        })
    return out


def load_old():
    if not ARCHIVE.exists():
        return []
    try:
        return as_rows(json.loads(ARCHIVE.read_text(encoding="utf-8")))
    except Exception:
        return []


def merge(old, new):
    by = {}
    for r in old + new:
        by[r["t"]] = r
    cut = datetime.datetime.now(timezone.utc) - datetime.timedelta(hours=KEEP_H)
    kept = []
    dropped = 0
    for t in sorted(by):
        if t >= cut:
            rec = by[t]
            kept.append({
                "time_tag": rec["time_tag"],
                "estimated_kp": rec["estimated_kp"],
                "kp": rec.get("kp"),
            })
        else:
            dropped += 1
    return kept, dropped


def main():
    old = load_old()
    old_n = len(old)
    try:
        raw = fetch()
        new = as_rows(raw)
    except Exception as e:
        print("fetch failed, keeping archive:", e)
        if old_n == 0:
            sys.exit(1)
        print("kp1m rows", old_n, "(unchanged)")
        return
    if not new and old_n:
        print("NOAA empty, keeping", old_n, "archive rows")
        return
    kept, dropped = merge(old, new)
    if old_n and len(kept) == 0:
        print("refuse write: merged empty, old", old_n)
        sys.exit(1)
    if old_n and len(kept) < max(12, old_n - dropped - 8):
        print("refuse write: merged", len(kept), "old", old_n, "trimmed", dropped)
        sys.exit(1)
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_text(json.dumps(kept, separators=(",", ":")), encoding="utf-8")
    print("kp1m-archive rows", len(kept), "trimmed", dropped, "noaa", len(new))


if __name__ == "__main__":
    main()
