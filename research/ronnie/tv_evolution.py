"""How Ronnie's drawings changed: 2018-2021 text ideas (tv/drawings.jsonl.gz) against 2024-2025 video ideas
(tv/video_ideas.jsonl.gz, crawled through each idea's `related` list). Writes results/tv_evolution.txt and
tv/video_drawings.jsonl.gz."""
import collections, gzip, json, math

import pandas as pd

import tv_fetch as T


def load_new():
    rows, meta = [], []
    for l in gzip.open("tv/video_ideas.jsonl.gz", "rt"):
        r = json.loads(l)
        c = r.get("content")
        if isinstance(c, str):
            c = json.loads(c)
        ch = (c or {}).get("charts", [c or {}])
        content = ch[0] if ch and isinstance(ch, list) else (c or {})
        rows += T.drawings(r["uuid"], content, r.get("interval"))
        meta.append(dict(uuid=r["uuid"], created=r["created_at"][:10], interval=r.get("interval"),
                         symbol=(r.get("symbol") or {}).get("short_name"), title=r.get("name"),
                         minutes=float((r.get("video") or {}).get("video_duration") or 0) / 60))
    return rows, pd.DataFrame(meta)


def round_number(p):
    if not p or p <= 0:
        return False
    s = f"{p:.10g}".replace(".", "").lstrip("0").rstrip("0")
    return len(s) <= 2  # at most two significant digits (e.g. 66000, 3200, 1.1)


def summary(rows, meta, label):
    d = pd.DataFrame(rows).drop_duplicates("id")  # a reused chart carries earlier drawings into later ideas
    out = [f"{label}: {len(meta)} ideas, {len(d)} unique drawings, {len(d) / max(len(meta), 1):.1f} new per idea"]
    out.append("  chart timeframes: " + ", ".join(f"{k} {v}" for k, v in meta.interval.value_counts().head(6).items()))
    out.append("  symbols: " + ", ".join(f"{k} {v}" for k, v in meta.symbol.value_counts().head(6).items()))
    t = d.type.str.replace("LineTool", "").value_counts()
    out.append("  tools (share): " + ", ".join(f"{k} {v / len(d):.0%}" for k, v in t.head(10).items()))
    hz = d[d.type.isin(["LineToolHorzLine", "LineToolHorzRay"])]
    if len(hz):
        prices = [a[0]["price"] for a in hz.anchors if a]
        out.append(f"  horizontal lines: {len(hz)}, two-significant-digit round numbers {sum(map(round_number, prices)) / len(prices):.0%}")
    fib = d[d.type.str.contains("Fib")]
    gaps = []
    for a in fib.anchors:
        ts = [x.get("time") for x in a[:2] if x.get("time")]
        if len(ts) == 2:
            gaps.append(abs((pd.Timestamp(ts[1]) - pd.Timestamp(ts[0])).total_seconds()) / 86400)
    if gaps:
        g = pd.Series(gaps)
        out.append(f"  Fibonacci: {len(fib)} drawings, anchor gap median {g.median():.1f} days (quartiles "
                   f"{g.quantile(0.25):.1f}-{g.quantile(0.75):.1f}); under 3 days {(g < 3).mean():.0%}, over 30 days {(g > 30).mean():.0%}")
        span = pd.Series([abs(a[1]["price"] - a[0]["price"]) / min(a[0]["price"], a[1]["price"])
                          for a in fib.anchors if len(a) >= 2 and a[0].get("price") and a[1].get("price")])
        out.append(f"  Fibonacci price span (|p1 - p0| / lower price): median {span.median():.0%}, quartiles "
                   f"{span.quantile(0.25):.0%}-{span.quantile(0.75):.0%}; anchors on the same bar "
                   f"{(pd.Series(gaps) < 1e-3).mean():.0%} (a vertical drag: only the prices matter)")
        lv = collections.Counter(c for L in fib.levels.dropna() for c, vis in L if vis)
        out.append("  visible Fibonacci levels: " + ", ".join(f"{k:g} {v}" for k, v in sorted(lv.items())[:12]))
    return out


def main():
    old = [json.loads(l) for l in gzip.open("tv/drawings.jsonl.gz", "rt")]
    ideas = [json.loads(l) for l in open("tv/ideas.jsonl")]
    om = pd.DataFrame([dict(uuid=i.get("uuid"), interval=i.get("interval"), symbol=i.get("symbol") if isinstance(i.get("symbol"), str) else (i.get("symbol") or {}).get("short_name")) for i in ideas])
    new, nm = load_new()
    with gzip.GzipFile("tv/video_drawings.jsonl.gz", "wb", mtime=0) as f:
        f.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in new).encode())
    lines = summary(old, om, "2018-2021 text ideas") + [""] + summary(new, nm, "2024-2025 video ideas")
    lines += ["", f"video minutes in total {nm.minutes.sum():.0f}; by year " + ", ".join(f"{k} {v}" for k, v in nm.created.str[:4].value_counts().sort_index().items())]
    t = "\n".join(lines)
    print(t)
    open("results/tv_evolution.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
