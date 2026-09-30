"""community-v1: do other traders draw our lines, and do their lines hold? See INTENT.md.

Reads community/ideas.jsonl.gz and community/drawings.jsonl.gz (from fetch.py). Writes community/result.txt and
community/lines.csv.gz.
"""
import gzip, json, os, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo"), os.path.join(ROOT, "timing")):
    sys.path.insert(0, p)
from forward import COINS, hourly  # noqa: E402
from run import atr, lines_by_bar  # noqa: E402  (timing/run.py: the same line rules as line_break_ridge)
from tv_effect import react  # noqa: E402

WINDOW, NEAR, N_MOVED, HORIZON = 5.0, 0.25, 100, 240  # ATR, ATR, draws, 1h bars (60 x 4h)
HORZ = {"LineToolHorzLine", "LineToolHorzRay"}
SLOPED = {"LineToolTrendLine", "LineToolRay"}


def rows(name):
    with gzip.open(os.path.join(HERE, f"{name}.jsonl.gz"), "rt") as f:
        return [json.loads(x) for x in f]


def same_market(chart_symbol, coin):
    s = (chart_symbol or "").split(":")[-1]
    return s in (f"{coin}USDT", f"{coin}USDT.P", f"{coin}USD", f"{coin}USD.P", f"{coin}USDC", f"{coin}USDC.P", f"{coin}PERP")


def ts(a):
    t = a.get("time")
    return None if t is None else float(t) if isinstance(t, (int, float)) else pd.Timestamp(t).timestamp()


class Market:
    def __init__(self, coin, now):
        h = hourly(coin, now)
        self.t1 = h.time.values.astype(np.int64)
        d4 = h.resample("4h", label="left", closed="left").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
        self.t4 = (d4.index.as_unit("s").asi8).astype(np.int64)
        self.a4 = atr(d4.high.values, d4.low.values, d4.close.values)
        self.lines = lines_by_bar(d4.high.values, d4.low.values, d4.close.values)
        k = np.searchsorted(self.t4, self.t1, side="right") - 1  # the 4h bar each hour belongs to
        a_prev = np.r_[np.nan, self.a4[:-1]]
        self.B = dict(o=h.open.values, h=h.high.values, l=h.low.values, c=h.close.values, atr=a_prev[np.maximum(k, 0)])

    def at(self, t0):
        """(1h index of the last bar closed by t0, 4h bar index whose lines are known, ATR, last close)."""
        i0 = int(np.searchsorted(self.t1, t0 - 3600, side="right")) - 1
        i4 = int(np.searchsorted(self.t4, t0, side="right")) - 1  # lines of the forming 4h bar use closed bars only
        return i0, i4, self.B["atr"][i0], self.B["c"][i0]


def main():
    rng = np.random.default_rng(3)
    now = pd.Timestamp(datetime.now(timezone.utc))
    ideas = {i["uuid"]: i for i in rows("ideas")}
    draws = rows("drawings")
    mk = {}
    horz, sloped, zones, seen = [], [], [], set()
    for d in draws:
        it = ideas[d["uuid"]]
        coin = it["symbol"].split(":")[1][:-4]
        key = (d["uuid"], d["type"], json.dumps(d["anchors"]))  # multi-chart layouts repeat the same drawing
        if key in seen or not same_market(d["chart_symbol"], coin) or d["style"].get("visible") is False:
            continue
        seen.add(key)
        t0 = pd.Timestamp(it["created_at"]).timestamp() if it.get("created_at") else it["ts"]
        if coin not in mk:
            mk[coin] = Market(coin, now)
        M = mk[coin]
        i0, i4, a, p = M.at(t0)
        if i0 < 500 or i4 < 300 or not a > 0:
            continue
        base = dict(uuid=d["uuid"], author=it["author"], coin=coin, t0=t0, i0=i0, i4=i4, a=a, p=p)
        pr = [q.get("price") for q in d["anchors"][:2]]
        flat = d["type"] in SLOPED and len(pr) == 2 and pr[0] is not None and pr[0] == pr[1]
        if (d["type"] in HORZ or flat) and pr and pr[0] is not None:
            y = float(pr[0])
            if abs(y - p) <= WINDOW * a:
                horz.append({**base, "y": y})
        elif d["type"] == "LineToolRectangle" and len(pr) == 2 and None not in pr:
            for y in map(float, pr):  # a zone's two edges
                if abs(y - p) <= WINDOW * a:
                    zones.append({**base, "y": y})
        elif d["type"] in SLOPED and len(d["anchors"]) >= 2:
            (x1, y1), (x2, y2) = ((ts(q), q.get("price")) for q in d["anchors"][:2])
            if None in (x1, x2, y1, y2) or x1 == x2 or max(x1, x2) >= t0:
                continue
            v = y1 + (y2 - y1) * (t0 - x1) / (x2 - x1)
            if abs(v - p) <= WINDOW * a:
                sloped.append({**base, "y": v, "slope": np.sign((y2 - y1) / (x2 - x1))})
    H, S, Z = pd.DataFrame(horz), pd.DataFrame(sloped), pd.DataFrame(zones)
    out = [f"community-v1 (INTENT.md): {len(ideas)} ideas fetched, {H.uuid.nunique() if len(H) else 0} with a usable "
           f"horizontal line, {S.uuid.nunique() if len(S) else 0} with a usable trend line; "
           f"{len(H)} horizontal and {len(S)} sloped community lines, and {len(Z)} zone edges, within {WINDOW:.0f} ATR of price", ""]

    def moved(y, a):
        return y + rng.uniform(1, 4, N_MOVED) * a * rng.choice((-1, 1), N_MOVED)

    # A: horizontal agreement
    def agree(df):
        dist, dist_m = [], []
        for r in df.itertuples():
            ours = np.array([y for lid, _s, y in mk[r.coin].lines[r.i4] if lid[0] == "L"])
            f = (lambda y: np.min(np.abs(ours - y)) / r.a) if len(ours) else (lambda y: np.inf)
            dist.append(f(r.y))
            dist_m.append(np.mean([f(y) <= NEAR for y in moved(r.y, r.a)]))
        df["d_ours"], df["moved_near"] = dist, dist_m
        return np.mean(df.d_ours <= NEAR), df.moved_near.mean()

    sh, shm = agree(H)
    out.append(f"A. Horizontal agreement: {sh:.0%} of community levels lie within {NEAR} ATR of one of our levels, "
               f"against {shm:.0%} for the same levels moved 1-4 ATR (ratio {sh / shm:.2f}; median distance "
               f"{H.d_ours.median():.2f} ATR). Decision rule: ratio >= 1.5 -> "
               f"{'we draw where people draw' if sh >= 1.5 * shm else 'we do not draw where people draw'}.")
    if len(Z):
        sz, szm = agree(Z)
        out.append(f"   Zone edges (amendment, reported apart): {sz:.0%} within {NEAR} ATR of our levels vs {szm:.0%} moved "
                   f"(ratio {sz / szm:.2f}).")
    # B: sloped agreement
    if len(S):
        dist, dist_m = [], []
        for r in S.itertuples():
            # falling-highs lines (side 1) slope down, rising-lows lines (side -1) slope up
            ours = np.array([y for lid, s, y in mk[r.coin].lines[r.i4] if lid[0] == "T" and -s == r.slope])
            f = (lambda y: np.min(np.abs(ours - y)) / r.a) if len(ours) else (lambda y: np.inf)
            dist.append(f(r.y))
            dist_m.append(np.mean([f(y) <= NEAR for y in moved(r.y, r.a)]))
        S["d_ours"], S["moved_near"] = dist, dist_m
        ss, ssm = np.mean(S.d_ours <= NEAR), S.moved_near.mean()
        out.append(f"B. Trend-line agreement: {ss:.0%} of community trend lines pass within {NEAR} ATR of one of our "
                   f"trend lines of the same slope at publish time, against {ssm:.0%} moved (ratio "
                   f"{ss / ssm if ssm else np.inf:.2f}; {np.mean(np.isinf(S.d_ours)):.0%} had no line of ours with that slope).")
    out.append("")

    def reaction(df, label, group):
        held, mv = [], []
        for r in df.itertuples():
            B = mk[r.coin].B
            x = react(B, r.i0, r.y, HORIZON)
            m = [react(B, r.i0, y, HORIZON) for y in moved(r.y, r.a)]
            m = [z for z in m if z is not None]
            held.append(x)
            mv.append(np.mean(m) if m else np.nan)
        df = df.assign(held=held, moved=mv)
        v = df.dropna(subset=["held", "moved"])
        v = v.assign(diff=v.held.astype(float) - v.moved)
        g = v.groupby(group)["diff"].agg(["sum", "count"])
        bs = []
        for _ in range(2000):
            s = g.iloc[rng.integers(0, len(g), len(g))].sum()
            bs.append(s["sum"] / s["count"])
        lo, hi = np.percentile(bs, [2.5, 97.5])
        info = lo > 0 and v["diff"].mean() >= 0.03
        out.append(f"{label}: {len(v)} resolved of {len(df)}; held {v.held.mean():.0%}, moved copies held "
                   f"{v.moved.mean():.0%}; held minus moved {v['diff'].mean():+.1%} [{lo:+.1%}, {hi:+.1%}] -> "
                   f"{'carries information' if info else 'no information shown'}")
        return df

    H = reaction(H, "C. Community levels after publishing", "uuid")
    if len(Z):
        Z = reaction(Z, "   Zone edges (amendment, reported apart)", "uuid")
    # D: our nearest level above and below price at each community publish time (one set per idea)
    ours = []
    for (uuid, coin), g in H.groupby(["uuid", "coin"]):
        r = g.iloc[0]
        ys = np.array([y for lid, _s, y in mk[coin].lines[r.i4] if lid[0] == "L"])
        for y in (ys[ys < r.p].max() if (ys < r.p).any() else None, ys[ys > r.p].min() if (ys > r.p).any() else None):
            if y is not None and abs(y - r.p) <= WINDOW * r.a:
                ours.append({**r[["uuid", "author", "coin", "t0", "i0", "i4", "a", "p"]].to_dict(), "y": y})
    reaction(pd.DataFrame(ours), "D. Our nearest levels at the same moments", "uuid")
    # E: consensus clusters, formed when a third author draws within NEAR ATR inside 72 hours
    clusters = []
    for coin, g in H.sort_values("t0").groupby("coin"):
        used = set()
        recs = list(g.itertuples())
        for k, r in enumerate(recs):
            if r.Index in used:
                continue
            mates = [q for q in recs[:k + 1] if q.Index not in used and r.t0 - q.t0 <= 72 * 3600 and abs(q.y - r.y) <= NEAR * r.a]
            if len({q.author for q in mates}) >= 3:
                used.update(q.Index for q in mates)
                clusters.append(dict(uuid=f"c{len(clusters)}", author="*", coin=coin, t0=r.t0, i0=r.i0, i4=r.i4, a=r.a, p=r.p,
                                     y=float(np.median([q.y for q in mates])), n_authors=len({q.author for q in mates})))
    if clusters:
        reaction(pd.DataFrame(clusters), f"E. Consensus levels (>= 3 authors within {NEAR} ATR and 72 h)", "uuid")
    else:
        out.append("E. Consensus levels: none formed")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")
    cols = ["uuid", "author", "coin", "t0", "y", "a", "p", "d_ours", "held", "moved"]
    pd.concat([H[cols].assign(kind="horizontal"), Z[cols].assign(kind="zone edge") if len(Z) else None,
               S[[c for c in cols if c in S]].assign(kind="sloped") if len(S) else None]).to_csv(
        os.path.join(HERE, "lines.csv.gz"), index=False, float_format="%.6g")


if __name__ == "__main__":
    main()
