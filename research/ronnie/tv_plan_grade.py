"""Ronnie's drawn 2024-2025 plans, graded. Every forward-looking projected path or arrow in his video ideas
(tv/video_drawings.jsonl.gz, each drawing id at its first appearance) becomes a plan: side from the path's start to its
end, a pullback entry at the first counter-turn (else the next open), the farthest anchor in the trade direction as the
target. Geometry is reported in daily ATR(14); outcomes are a target-versus-stop race on daily bars (tie = stop, 10-day
fill window, 60-day hold) against the mirrored plan as a placebo. He draws no stops, so the race uses 0.5/1.0/1.5 ATR.
Reads 2024-01 to 2025-06 prices on his symbols; any rule change this informs is evaluated forward-only.
Usage: python tv_plan_grade.py   (writes results/tv_plan_grade.txt)"""
import gzip, json, time

import numpy as np
import pandas as pd

from tv_prices import fetch

STOPS = (0.5, 1.0, 1.5)


def ts(t):
    return pd.Timestamp(t, unit="s") if not isinstance(t, str) else pd.Timestamp(t).tz_localize(None)


def plans_drawn():
    meta = {}
    for line in gzip.open("tv/video_ideas.jsonl.gz", "rt"):
        r = json.loads(line)
        meta[r["uuid"]] = (pd.Timestamp(r["created_at"][:19]), (r.get("symbol") or {}).get("pro_symbol"))
    first = {}
    for line in gzip.open("tv/video_drawings.jsonl.gz", "rt"):
        x = json.loads(line)
        if x["type"] not in ("LineToolPath", "LineToolArrow"):
            continue
        c, s = meta[x["uuid"]]
        if x["id"] not in first or c < first[x["id"]][0]:  # a reused chart carries drawings into later ideas
            first[x["id"]] = (c, s, x)
    rows = []
    for c, s, x in first.values():
        t = [ts(q["time"]) for q in x["anchors"]]
        if t[-1] > c and (c - t[0]).days < 30:  # reaches past the publish time, not a historical illustration
            rows.append(dict(created=c, sym=s, times=t, prices=[q["price"] for q in x["anchors"]]))
    return pd.DataFrame(rows)


def daily(sym):
    for _ in range(4):
        try:
            b, _err = fetch(sym, "1D", 5000)
            break
        except Exception:
            b = []
            time.sleep(3)
    d = pd.DataFrame([v for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s"),
                     columns=["open", "high", "low", "close"]).astype(float)
    pc = d.close.shift(1)
    d["atr"] = pd.concat([d.high - d.low, (d.high - pc).abs(), (d.low - pc).abs()], axis=1).max(axis=1).rolling(14).mean()
    return d


def race(d, k, side, entry, tgt, stop_atr, a, limit, fill_days=10, hold=60):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    stop, risk = entry - side * stop_atr * a, stop_atr * a
    f = k + 1 if not limit else next((m for m in range(k + 1, min(k + 1 + fill_days, len(c)))
                                       if (side > 0 and l[m] <= entry) or (side < 0 and h[m] >= entry)), None)
    if f is None or f >= len(c):
        return np.nan
    px = (min(o[f], entry) if side > 0 else max(o[f], entry)) if limit else o[f]
    for m in range(f, min(f + hold, len(c))):
        if (side > 0 and l[m] <= stop) or (side < 0 and h[m] >= stop):
            return (stop - px) * side / risk
        if m > f and ((side > 0 and h[m] >= tgt) or (side < 0 and l[m] <= tgt)):
            return (tgt - px) * side / risk
    return (c[min(f + hold, len(c)) - 1] - px) * side / risk


def main():
    raw = plans_drawn()
    px = {s: daily(s) for s in raw.sym.dropna().unique()}
    rows = []
    for _, r in raw.iterrows():
        d = px.get(r.sym)
        if d is None or len(d) < 30:
            continue
        k = d.index.searchsorted(r.created) - 1  # last closed day before publishing
        if k < 20 or k + 1 >= len(d):
            continue
        a, now = d.atr.iloc[k], d.close.iloc[k]
        i0 = max([j for j, t in enumerate(r.times) if t <= r.created + pd.Timedelta(days=1)], default=0)
        P, T = np.array(r.prices[i0:]), r.times[i0:]
        if len(P) < 2 or abs(P[-1] - P[0]) < 0.5 * a:
            continue
        side = int(np.sign(P[-1] - P[0]))
        pull = len(P) >= 3 and (P[1] - P[0]) * side < 0
        entry = P[1] if pull else d.open.iloc[k + 1]
        after = P[2:] if pull else P[1:]
        tgt = after.max() if side > 0 else after.min()
        if (tgt - entry) * side <= 0:
            continue
        row = dict(sym=r.sym, created=r.created, side=side, pull=pull, pull_atr=abs(P[0] - entry) / a if pull else 0.0,
                   tgt_atr=abs(tgt - entry) / a, horizon=(T[-1] - r.created).total_seconds() / 86400)
        for s in STOPS:
            row[f"R{s}"] = race(d, k, side, entry, tgt, s, a, pull)
            me = 2 * now - entry if pull else entry  # mirrored around the price at publishing
            row[f"M{s}"] = race(d, k, -side, me, me - (tgt - entry), s, a, pull)
        rows.append(row)
    z = pd.DataFrame(rows)
    out = [f"Ronnie's drawn plans 2024-2025: {len(z)} plans, {z.sym.nunique()} symbols, "
           f"{z.created.min().date()} to {z.created.max().date()}",
           f"  long {(z.side > 0).mean():.0%}; pullback entries {z.pull.mean():.0%} (median depth "
           f"{z[z.pull].pull_atr.median():.2f} ATR); target from entry median {z.tgt_atr.median():.2f} ATR "
           f"[IQR {z.tgt_atr.quantile(.25):.2f}-{z.tgt_atr.quantile(.75):.2f}]; drawn horizon median {z.horizon.median():.0f} days"]
    rng = np.random.default_rng(3)
    for s in STOPS:
        g = z.dropna(subset=[f"R{s}", f"M{s}"])
        diff = (g[f"R{s}"] - g[f"M{s}"]).values
        days = g.created.dt.date.values
        u = np.unique(days)
        groups = {q: np.flatnonzero(days == q) for q in u}
        bs = [diff[np.concatenate([groups[q] for q in rng.choice(u, len(u))])].mean() for _ in range(4000)]
        out.append(f"  stop {s} ATR (target {z.tgt_atr.median() / s:.1f}R at the median): n {len(g)}, plan {g[f'R{s}'].mean():+.3f}R, "
                   f"mirror {g[f'M{s}'].mean():+.3f}R, plan minus mirror {diff.mean():+.3f} "
                   f"[{np.percentile(bs, 2.5):+.3f}, {np.percentile(bs, 97.5):+.3f}] (publish-day clusters), plan wins {(g[f'R{s}'] > 0).mean():.0%}")
    t = "\n".join(out)
    print(t)
    open("results/tv_plan_grade.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
