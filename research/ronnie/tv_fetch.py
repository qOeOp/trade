"""Scrape every TradingView idea published by Ronnie_Dong.

tv/ideas.jsonl     one row per idea: publish/update time, symbol, interval, direction, title, text, text updates
tv/drawings.jsonl.gz  one row per drawing: idea uuid, tool type, anchors (UTC time + price), text, style
tv/raw/<uuid>.json.gz  the idea page's full embedded record (chart state incl. the bars he saw), lossless
JSONL is ASCII-escaped so the author's verbatim text passes the repository's typography hooks.
tv/snap/<uuid>.webp    the published snapshot (mid size; full size at image_url in ideas.jsonl)

Re-runs skip ideas whose raw file exists; pass --refresh to refetch everything.
"""
import gzip, json, os, re, sys, time, urllib.request

USER = "Ronnie_Dong"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tv")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
# chart-state keys that are rendering noise, not drawing geometry or meaning
STYLE_KEYS = ("color", "linecolor", "linewidth", "linestyle", "backgroundColor", "fillBackground", "extendLeft",
              "extendRight", "reverse", "showPrice", "text", "fontsize", "bold", "icon", "visible", "interval")


def get(url, raw=False, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
            return b if raw else b.decode()
        except Exception as e:
            err = e
            time.sleep(2 ** (k + 1))
    raise err


def list_ideas():
    url, rows = f"https://www.tradingview.com/api/v1/ideas/?by={USER}&page=1", []
    while url:
        d = json.loads(get(url))
        rows += d["results"]
        url = d["next"]
        time.sleep(1)
    assert all(r["user"]["username"] == USER for r in rows)
    return rows, d["count"]


def idea_record(chart_url):
    h = get(chart_url)
    for b in re.findall(r'<script type="application/prs.init-data\+json">(.*?)</script>', h, re.S):
        if "ssrIdeaData" in b:
            for v in json.loads(b).values():
                if isinstance(v, dict) and "ssrIdeaData" in v:
                    return v["ssrIdeaData"]
    raise ValueError(f"no ssrIdeaData in {chart_url}")


def sig8(x):
    return float(f"{x:.8g}") if isinstance(x, float) else x


def bar_seconds(interval):
    if not interval:
        return None
    unit = {"D": 86400, "W": 604800, "M": 2592000}
    i = str(interval)
    return int(i[:-1] or 1) * unit[i[-1]] if i[-1] in unit else int(i) * 60 if i.isdigit() else None


def drawings(uuid, content, interval):
    rows = []
    for pane_no, pane in enumerate(content.get("panes", [])):
        for s in pane.get("sources", []):
            if not s.get("type", "").startswith("LineTool"):
                continue
            st = s.get("state", {})
            # `indexes` resolves anchors placed right of the last bar to absolute times; `points` keeps bar offsets
            # prices are mouse placements: 8 significant digits keep them, the raw record keeps the exact float
            anchors = [{"time": i.get("time"), "price": sig8(i.get("price"))} for i in s.get("indexes") or []]
            bar = bar_seconds(st.get("interval") or interval)
            for a, p in zip(anchors, s.get("points") or []):
                if a["time"] is None and p.get("time_t") is not None and bar:
                    # past the chart's future timescale TradingView leaves the time empty; extrapolate by whole
                    # bars (exact on 24x7 symbols, off by closed sessions elsewhere)
                    t = p["time_t"] + p.get("offset", 0) * bar
                    a.update(time=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t)), time_est=True)
            if not anchors:
                anchors = [{"time_t": p.get("time_t"), "offset": p.get("offset"), "price": sig8(p.get("price"))}
                           for p in s.get("points") or []]
            rows.append({"uuid": uuid, "pane": pane_no, "id": s.get("id"), "type": s["type"],
                         "anchors": anchors,
                         "style": {k: st[k] for k in STYLE_KEYS if k in st},
                         # Fibonacci levels are stored as [coeff, color, visible]
                         "levels": sorted((v[0], v[2]) for k, v in st.items()
                                          if re.fullmatch(r"level\d+", k) and isinstance(v, list) and len(v) >= 3)
                         or None})
    return rows


def main(refresh=False):
    os.makedirs(f"{OUT}/raw", exist_ok=True)
    os.makedirs(f"{OUT}/snap", exist_ok=True)
    listing, count = list_ideas()
    print(f"listed {len(listing)} of {count}")
    ideas, draws = [], []
    for n, it in enumerate(sorted(listing, key=lambda r: r["date_timestamp"])):
        uuid = it["image_url"]
        raw = f"{OUT}/raw/{uuid}.json.gz"
        if refresh or not os.path.exists(raw):
            rec = idea_record(it["chart_url"])
            with gzip.open(raw, "wt") as f:
                json.dump(rec, f, ensure_ascii=False)
            time.sleep(1.5)
        with gzip.open(raw, "rt") as f:
            rec = json.load(f)
        snap = f"{OUT}/snap/{uuid}.webp"
        if refresh or not os.path.exists(snap):
            try:  # the image host resets connections now and then; a re-run fills any gap
                img = get(it["image"]["middle_webp"], raw=True, tries=8)
                with open(snap, "wb") as f:
                    f.write(img)
            except OSError as e:
                print(f"snapshot {uuid} missing: {e}")
        content = json.loads(rec["content"]) if rec.get("content") else {}
        main_src = next((s for p in content.get("panes", []) for s in p.get("sources", []) if s.get("type") == "MainSeries"), {})
        bars = main_src.get("bars", {}).get("data", [])
        ideas.append({
            "uuid": uuid, "id": it["id"], "created_at": rec["created_at"], "updated_at": rec.get("updated_at"),
            "symbol": (rec.get("symbol") or {}).get("pro_symbol") or it["symbol"]["name"],
            "short": (rec.get("symbol") or {}).get("short_name") or it["symbol"]["short_name"],
            "interval": rec.get("interval"), "direction": {1: "long", 2: "short"}.get(rec.get("direction"), rec.get("direction")),
            "name": rec["name"], "description": rec.get("description"),
            "updates": rec.get("updates") or [], "tags": [t["tag"] for t in rec.get("tags") or []],
            "likes": rec.get("likes_count"), "views": rec.get("views"), "comments": rec.get("comments_count"),
            "is_video": it.get("is_video"), "is_education": it.get("is_education"),
            "chart_url": it["chart_url"], "image_url": rec.get("preview_image_urls", {}).get("original"),
            "chart_symbol": main_src.get("state", {}).get("symbol"), "chart_interval": main_src.get("state", {}).get("interval"),
            "bars": len(bars), "first_bar": bars[0]["value"][0] if bars else None, "last_bar": bars[-1]["value"][0] if bars else None,
            "has_content": bool(content)})
        d = drawings(uuid, content, rec.get("interval"))
        draws += d
        print(f"{n + 1:3d} {rec['created_at'][:10]} {ideas[-1]['symbol']:<22} {ideas[-1]['interval']:>4} {len(d):3d} drawings  {rec['name'][:60]}")
    with open(f"{OUT}/ideas.jsonl", "w") as f:
        f.writelines(json.dumps(r) + "\n" for r in ideas)
    # gzipped because plain text exceeds the 500 KB large-file hook; mtime=0 keeps re-runs byte-identical
    with gzip.GzipFile(f"{OUT}/drawings.jsonl.gz", "wb", mtime=0) as f:
        f.write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in draws).encode())
    print(f"{len(ideas)} ideas, {len(draws)} drawings")


if __name__ == "__main__":
    main(refresh="--refresh" in sys.argv)
