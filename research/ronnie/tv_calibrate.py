"""Where Ronnie's TradingView lines sit against price structure, measured on the bars each idea's chart showed.

Every idea's page record carries the bars on its chart at publish time, so all 158 ideas (every symbol) are usable;
distances are in ATR(14) of the chart's own timeframe at the last bar. Duplicated publications count once.

Q1 horizontal lines: nearest confirmed pivot (wick and body) per pivot order, touches, age, vs two placebos:
   the same line jittered 1-4 ATR, and a price drawn uniformly in the chart's range.
Q2 the mechanical zone map (ronnie_plan.build_zones) at publish time: recall of his lines, precision, grid search
   on one half of the ideas (by date parity), reported on the other half.
Q3 trend line / channel / Fibonacci anchors: pivot order of the anchor bar, wick or body, gap and age.
"""
import gzip, itertools, json, os, sys
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ronnie_plan  # noqa: E402

TOL = 0.25  # ATR: a line "is at" a price within this distance
ORDERS = (2, 3, 5, 8, 13, 21, 34)
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- data ----------------------------------------
def load_ideas():
    ideas = [json.loads(x) for x in open(f"{HERE}/tv/ideas.jsonl")]
    draws = defaultdict(list)
    for x in gzip.open(f"{HERE}/tv/drawings.jsonl.gz", "rt"):
        d = json.loads(x)
        draws[d["uuid"]].append(d)
    out, seen = [], set()
    for it in ideas:
        ds = draws[it["uuid"]]
        sig = (it["short"], it["created_at"][:10], it["interval"],
               tuple(sorted(round(a["price"], 6) for d in ds for a in d["anchors"] if d["type"] != "LineToolText")))
        if sig in seen:
            continue
        seen.add(sig)
        rec = json.load(gzip.open(f"{HERE}/tv/raw/{it['uuid']}.json.gz", "rt"))
        content = json.loads(rec["content"])
        main = next(s for p in content["panes"] for s in p["sources"] if s.get("type") == "MainSeries")
        v = np.array([b["value"][:5] for b in main["bars"]["data"] if b.get("value") and None not in b["value"][:5]], float)
        v = v[np.argsort(v[:, 0])]
        t, o, h, l, c = v.T
        tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
        tr[0] = h[0] - l[0]
        atr = np.zeros_like(tr)
        atr[0] = tr[0]
        for i in range(1, len(tr)):
            atr[i] = atr[i - 1] + (tr[i] - atr[i - 1]) / 14
        out.append(dict(it=it, draws=ds, t=t, o=o, h=h, l=l, c=c, atr=atr[-1], A=atr))
    return out


def pivot_orders(x, sign):
    """Largest k with x[j] the extreme of x[j-k:j+k+1], confirmed (j+k inside the data); 0 if none."""
    n, y = len(x), sign * x
    k_of = np.zeros(n, int)
    for j in range(n):
        k = 0
        while j - k - 1 >= 0 and j + k + 1 < n and y[j] >= y[j - k - 1] and y[j] >= y[j + k + 1]:
            k += 1
        # strict on the left so a flat top counts once
        k_of[j] = k
    return k_of


def structure(I):
    if "ho" not in I:
        I["ho"], I["lo_"] = pivot_orders(I["h"], 1), pivot_orders(I["l"], -1)
    return I


def pivots(I, k, src="wick"):
    I = structure(I)
    o, c = I["o"], I["c"]
    hi = I["h"] if src == "wick" else np.maximum(o, c)
    lo = I["l"] if src == "wick" else np.minimum(o, c)
    js_h, js_l = np.where(I["ho"] >= k)[0], np.where(I["lo_"] >= k)[0]
    return np.r_[hi[js_h], lo[js_l]], np.r_[js_h, js_l]


def horizontals(I):
    ys = []
    for d in I["draws"]:
        if d["type"] in ("LineToolHorzLine", "LineToolHorzRay") and d["anchors"]:
            ys.append(d["anchors"][0]["price"])
    return ys


def touches(I, y):
    a = I["atr"]
    return int(np.sum((abs(I["h"] - y) <= TOL * a) | (abs(I["l"] - y) <= TOL * a)))


# ---------------------------------------------------------------- Q1 ------------------------------------------
def q1(ideas):
    rows = []
    for I in ideas:
        a, lo, hi = I["atr"], I["l"].min(), I["h"].max()
        for y in horizontals(I):
            jit = y + RNG.uniform(1, 4) * a * RNG.choice((-1, 1))
            uni = RNG.uniform(lo, hi)
            for kind, v in (("his", y), ("jitter", jit), ("uniform", uni)):
                r = dict(kind=kind, tf=I["it"]["interval"], pos=(v - I["c"][-1]) / a, touches=touches(I, v),
                         inside=lo <= v <= hi)
                for k in ORDERS:
                    for src in ("wick", "body"):
                        p, js = pivots(I, k, src)
                        if len(p):
                            m = np.argmin(abs(p - v))
                            r[f"d{src}{k}"] = abs(p[m] - v) / a
                            r[f"age{src}{k}"] = len(I["c"]) - 1 - js[m]
                        else:
                            r[f"d{src}{k}"] = np.inf
                rows.append(r)
    out = []
    his = [r for r in rows if r["kind"] == "his"]
    out.append(f"Q1 horizontal lines: {len(his)} lines in {sum(1 for I in ideas if horizontals(I))} ideas "
               f"(timeframes {dict(Counter(r['tf'] for r in his))})")
    out.append(f"  inside the chart's bar range: {np.mean([r['inside'] for r in his]):.0%}; "
               f"distance from last close (ATR) median {np.median([abs(r['pos']) for r in his]):.1f}, "
               f"above close {np.mean([r['pos'] > 0 for r in his]):.0%}")
    out.append("  share of lines within %.2f ATR of a confirmed pivot of order >= k (wick | body):" % TOL)
    out.append("    k    " + "  ".join(f"{k:>17d}" for k in ORDERS))
    for kind in ("his", "jitter", "uniform"):
        rs = [r for r in rows if r["kind"] == kind]
        cells = [f"{np.mean([r[f'dwick{k}'] <= TOL for r in rs]):5.0%} | {np.mean([r[f'dbody{k}'] <= TOL for r in rs]):5.0%}  "
                 for k in ORDERS]
        out.append(f"    {kind:<8}" + " ".join(f"{x:>17}" for x in cells))
    for kind in ("his", "jitter", "uniform"):
        rs = [r for r in rows if r["kind"] == kind]
        out.append(f"  touches (bars with a wick within {TOL} ATR) {kind:<8}: median {np.median([r['touches'] for r in rs]):.0f}, "
                   f"mean {np.mean([r['touches'] for r in rs]):.1f}, zero {np.mean([r['touches'] == 0 for r in rs]):.0%}")
    for k in (5, 13):
        ages = [r[f"agewick{k}"] for r in his if r[f"dwick{k}"] <= TOL]
        if ages:
            out.append(f"  age of the matched order>={k} wick pivot (bars before publish): median {np.median(ages):.0f}, "
                       f"quartiles {np.percentile(ages, 25):.0f}-{np.percentile(ages, 75):.0f}, n={len(ages)}")
    return out, rows


# ---------------------------------------------------------------- Q2 ------------------------------------------
def zones_at_end(I, k, per_side, cluster, min_t, src):
    P = ronnie_plan.P
    saved = {x: P[x] for x in ("cluster_atr", "min_touches")}
    P["cluster_atr"], P["min_touches"] = cluster, min_t
    try:
        o, h, l, c = I["o"], I["h"], I["l"], I["c"]
        highs, lows = [], []
        for j in range(k, len(c) - k):
            if h[j] == h[j - k:j + k + 1].max():
                highs.append((h[j], max(o[j], c[j])) if src != "body" else (max(o[j], c[j]), max(o[j], c[j])))
            if l[j] == l[j - k:j + k + 1].min():
                lows.append((l[j], min(o[j], c[j])) if src != "body" else (min(o[j], c[j]), min(o[j], c[j])))
        return ronnie_plan.build_zones(highs[-per_side:], lows[-per_side:], I["atr"])
    finally:
        P.update(saved)


def score(ideas, params, jitter=False):
    hit = n_lines = z_hit = n_z = 0
    for I in ideas:
        ys = horizontals(I)
        if not ys:
            continue
        a = I["atr"]
        if jitter:
            ys = [y + RNG.uniform(1, 4) * a * RNG.choice((-1, 1)) for y in ys]
        zs = zones_at_end(I, *params)
        near = lambda y, z: z.lo - TOL * a <= y <= z.hi + TOL * a  # noqa: E731
        hit += sum(any(near(y, z) for z in zs) for y in ys)
        n_lines += len(ys)
        z_hit += sum(any(near(y, z) for y in ys) for z in zs)
        n_z += len(zs)
    rec, prec = hit / max(n_lines, 1), z_hit / max(n_z, 1)
    return rec, prec, 2 * rec * prec / max(rec + prec, 1e-9), n_z / max(1, sum(1 for I in ideas if horizontals(I)))


def q2(ideas):
    out = []
    default = (ronnie_plan.P["pivot_k"], ronnie_plan.P["reactions_per_side"], ronnie_plan.P["cluster_atr"],
               ronnie_plan.P["min_touches"], "wick")
    halves = (ideas[0::2], ideas[1::2])
    grid = list(itertools.product((2, 3, 5, 8, 13), (3, 6, 12, 24), (0.25, 0.5, 1.0), (1, 2, 3), ("wick", "body")))
    out.append(f"Q2 mechanical zone map vs his horizontal lines (tolerance {TOL} ATR), {len(grid)} grid cells")
    out.append("  params = (pivot_k, reactions_per_side, cluster_atr, min_touches, price)")
    fmt = lambda s: f"recall {s[0]:4.0%}  precision {s[1]:4.0%}  F1 {s[2]:.2f}  zones/idea {s[3]:.1f}"  # noqa: E731
    out.append(f"  default {default}: all {fmt(score(ideas, default))}")
    out.append(f"          jittered lines (placebo):  {fmt(score(ideas, default, jitter=True))}")
    best = {}
    for h_i, (fit, test) in enumerate((halves, halves[::-1])):
        scored = sorted(((score(fit, g), g) for g in grid), key=lambda x: -x[0][2])
        g = scored[0][1]
        best[h_i] = g
        out.append(f"  fit on half {h_i}: best {g}: fit {fmt(scored[0][0])}")
        out.append(f"      held-out half: {fmt(score(test, g))};  default there: {fmt(score(test, default))};"
                   f"  placebo there: {fmt(score(test, g, jitter=True))}")
        out.append("      next best on the fit half: " + "; ".join(f"{x[1]} F1 {x[0][2]:.2f}" for x in scored[1:6]))
    return out, best


# ---------------------------------------------------------------- Q3 ------------------------------------------
def bar_at(I, iso):
    ts = np.datetime64(iso.replace("Z", "")).astype("datetime64[s]").astype(int)
    j = int(np.searchsorted(I["t"], ts, side="right")) - 1
    return j if 0 <= j < len(I["t"]) and ts - I["t"][j] < (I["t"][1] - I["t"][0]) else None


def q3(ideas):
    rows = []
    for I in ideas:
        structure(I)
        a, n = I["atr"], len(I["c"])
        for d in I["draws"]:
            if d["type"] not in ("LineToolTrendLine", "LineToolParallelChannel", "LineToolFibRetracement", "LineToolRay"):
                continue
            anc = d["anchors"][:2]
            if len(anc) < 2 or any(x.get("time_est") for x in anc):
                continue
            js = [bar_at(I, x["time"]) for x in anc]
            info = []
            for j, x in zip(js, anc):
                if j is None:
                    info.append(None)
                    continue
                p = x["price"]
                cand = {"high": I["h"][j], "low": I["l"][j], "body_hi": max(I["o"][j], I["c"][j]), "body_lo": min(I["o"][j], I["c"][j])}
                name, v = min(cand.items(), key=lambda kv: abs(kv[1] - p))
                order = I["ho"][j] if name in ("high", "body_hi") else I["lo_"][j]
                # a pivot within +-2 bars counts: hand placement is off by a bar now and then
                win = range(max(0, j - 2), min(n, j + 3))
                order2 = max((I["ho"][w] if name in ("high", "body_hi") else I["lo_"][w]) for w in win)
                info.append(dict(src=name, dist=abs(v - p) / a, order=int(order), order2=int(order2)))
            rows.append(dict(type=d["type"], info=info, gap=(js[1] - js[0]) if None not in js else None,
                             age=(n - 1 - max(js)) if None not in js else None, extend=d["style"].get("extendRight")))
    out = [f"Q3 sloped lines and Fibonacci: {len(rows)} drawings with both anchors dated ({dict(Counter(r['type'] for r in rows))})"]
    anchors = [(r["type"], x) for r in rows for x in r["info"] if x]
    rnd = []
    for I in ideas:
        for _ in range(20):
            j = int(RNG.integers(0, len(I["c"])))
            rnd.append(max(I["ho"][max(0, j - 2):j + 3].max(), I["lo_"][max(0, j - 2):j + 3].max()))
    for typ in ("LineToolTrendLine", "LineToolParallelChannel", "LineToolFibRetracement"):
        xs = [x for t_, x in anchors if t_ == typ]
        if not xs:
            continue
        on = [x for x in xs if x["dist"] <= TOL]
        out.append(f"  {typ[8:]}: {len(xs)} anchors; within {TOL} ATR of that bar's wick or body {len(on) / len(xs):.0%} "
                   f"(sources {dict(Counter(x['src'] for x in on))})")
        out.append("     pivot order (within +-2 bars) of anchors on price: " +
                   ", ".join(f">={k}: {np.mean([x['order2'] >= k for x in on]):.0%}" for k in (3, 5, 8, 13, 21)))
    out.append("     random bar, same +-2 window: " + ", ".join(f">={k}: {np.mean([r >= k for r in rnd]):.0%}" for k in (3, 5, 8, 13, 21)))
    for typ in ("LineToolTrendLine", "LineToolParallelChannel"):
        rs = [r for r in rows if r["type"] == typ and r["gap"] is not None]
        if rs:
            g, ag = [abs(r["gap"]) for r in rs], [r["age"] for r in rs]
            out.append(f"  {typ[8:]}: anchor gap bars median {np.median(g):.0f} (quartiles {np.percentile(g, 25):.0f}-{np.percentile(g, 75):.0f}); "
                       f"second anchor age median {np.median(ag):.0f} (quartiles {np.percentile(ag, 25):.0f}-{np.percentile(ag, 75):.0f}); "
                       f"extend right {np.mean([bool(r['extend']) for r in rs]):.0%}")
    return out, rows


if __name__ == "__main__":
    ideas = load_ideas()
    lines = [f"{len(ideas)} unique ideas, bars per chart median {int(np.median([len(I['c']) for I in ideas]))}", ""]
    for f in (q1, q3, q2):
        o, _ = f(ideas)
        lines += o + [""]
    text = "\n".join(x.rstrip() for x in lines).rstrip()
    print(text)
    open(f"{HERE}/results/tv_calibrate.txt", "w").write(text + "\n")
