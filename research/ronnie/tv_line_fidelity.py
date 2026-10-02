"""Fidelity of an automatic trend-line drawer to Ronnie's own lines (2026-10-02). Before a drawing technique is judged
by a backtest, the rule that draws it must reproduce the drawings of the person it is taken from.

His lines: the 52 trend lines and channel borders in his 2024-2025 video ideas whose value at publish lies within 3 ATR
of price (`tv_line_method.load`). The drawer, from bars up to publish: every line through two confirmed order-k pivot
lows (support, below price) or highs (resistance, above price) that closes have respected since its first pivot,
scored by touches, keeping the top N per side within 3 ATR. A line of his is matched when a drawn line on the same side
is within 0.5 ATR of it at publish and within 1 ATR 100 bars earlier. Fidelity = his lines matched minus the same lines
moved 1.5 ATR up or down matched (a dense drawer matches anything). Parameters are chosen on ideas published on odd
days and checked on even days.
Usage: python tv_line_fidelity.py   (writes results/tv_line_fidelity.txt)"""
import itertools

import numpy as np
import pandas as pd

import tv_line_method as M

KS, THROUGH, TOUCH, NS, SPANS = (3, 5, 8), (0.0, 0.03, 0.08), (2, 3), (2, 4), (20, 60)
LOOKS, ANCHORS = (700, 2000), ("wick", "body")
LOOK = 2000


def his_lines():
    out = []
    for created, sym, x in M.load():
        if x["type"] not in ("LineToolTrendLine", "LineToolParallelChannel"):
            continue
        tf = M.TF.get(x["style"].get("interval"))
        if tf is None or not sym or not sym.startswith(("BINANCE:", "FX:", "TVC:")):
            continue
        if any(q.get("price") is None or q.get("time") is None or q.get("time_est") for q in x["anchors"]):
            continue
        d = M.bars(sym, tf)
        now = int(d.index.searchsorted(created)) - 1
        I = [int(d.index.searchsorted(M.ts(q["time"]))) for q in x["anchors"]]
        P = [q["price"] for q in x["anchors"]]
        if I[0] == I[1] or now < 700:
            continue
        borders = [(P[0], (P[1] - P[0]) / (I[1] - I[0]))]
        if x["type"] == "LineToolParallelChannel":
            off = P[2] - (P[0] + borders[0][1] * (I[2] - I[0]))
            borders.append((P[0] + off, borders[0][1]))
        a, c = d.atr.values[now], d.c.values[now]
        for p0, sl in borders:
            v_now, v_back = p0 + sl * (now - I[0]), p0 + sl * (now - 100 - I[0])
            if abs(v_now - c) <= 3 * a:
                out.append(dict(key=(sym, tf, now), side=1 if v_now < c else -1, v_now=v_now, v_back=v_back, a=a,
                                odd=created.day % 2 == 1))
    return pd.DataFrame(out)


def candidates(sym, tf, now, k, look, anchor):
    """every pivot-pair line with its stats, at publish (anchored on wick extremes or body edges)"""
    d = M.bars(sym, tf)
    h, l, c, a = (d[x].values[: now + 1] for x in ("h", "l", "c", "atr"))
    o = d.o.values[: now + 1]
    if anchor == "body":
        h, l = np.maximum(o, c), np.minimum(o, c)
    hi, lo = M.pivots(d.iloc[: now + 1], k)
    lo0 = max(0, now - look)
    rows = []
    for side, piv, ext in ((1, np.flatnonzero(lo[lo0: now - k + 1]) + lo0, l), (-1, np.flatnonzero(hi[lo0: now - k + 1]) + lo0, h)):
        pe = ext[piv]
        for u, v in itertools.combinations(range(len(piv)), 2):
            j1, j2 = piv[u], piv[v]
            sl = (ext[j2] - ext[j1]) / (j2 - j1)
            idx = np.arange(j1, now + 1)
            y = ext[j1] + sl * (idx - j1)
            v_now = y[-1]
            if (c[now] - v_now) * side <= 0 or abs(v_now - c[now]) > 3 * a[now]:
                continue
            through = np.mean((c[j1:now + 1] - y) * side < -0.1 * a[j1:now + 1])
            yp = ext[j1] + sl * (piv - j1)
            touches = int(np.sum((piv >= j1) & (np.abs(pe - yp) <= 0.2 * a[piv])))
            rows.append(dict(side=side, span=j2 - j1, through=through, touches=touches, v_now=v_now,
                             v_back=ext[j1] + sl * (now - 100 - j1)))
    return pd.DataFrame(rows)


def last2(sym, tf, now):
    """L-1's drawer: the last two confirmed order-5 pivots per side, support only if rising, resistance only if falling"""
    d = M.bars(sym, tf)
    h, l, c, a = (d[x].values[: now + 1] for x in ("h", "l", "c", "atr"))
    hi, lo = M.pivots(d.iloc[: now + 1], 5)
    rows = []
    for side, piv, ext in ((1, np.flatnonzero(lo[: now - 4]), l), (-1, np.flatnonzero(hi[: now - 4]), h)):
        if len(piv) < 2:
            continue
        j1, j2 = piv[-2], piv[-1]
        if (ext[j2] - ext[j1]) * side <= 0:
            continue
        sl = (ext[j2] - ext[j1]) / (j2 - j1)
        rows.append(dict(side=side, v_now=ext[j1] + sl * (now - j1), v_back=ext[j1] + sl * (now - 100 - j1)))
    return pd.DataFrame(rows)


def main():
    H = his_lines()
    cand = {}
    for key in H.key.unique():
        for k, look, anc in itertools.product(KS, LOOKS, ANCHORS):
            cand[(key, k, look, anc)] = candidates(*key, k, look, anc)
        cand[(key, "last2")] = last2(*key)
    grid = []
    cells = list(itertools.product(KS, THROUGH, TOUCH, NS, SPANS, LOOKS, ANCHORS)) + [("last2",) * 7]
    for k, thr, tmin, n, smin, look, anc in cells:
        drawn = {}
        for key in H.key.unique():
            if k == "last2":
                drawn[key] = cand[(key, "last2")]
                continue
            z = cand[(key, k, look, anc)]
            if len(z):
                z = z[(z.through <= thr) & (z.touches >= tmin) & (z.span >= smin)]
                z = pd.concat([g.sort_values(["touches", "span"], ascending=False).head(n) for _, g in z.groupby("side")]) if len(z) else z
            drawn[key] = z

        def hit(r, shift=0.0):
            z = drawn[r.key]
            if not len(z):
                return False
            z = z[z.side == r.side]
            return bool(((abs(z.v_now - (r.v_now + shift * r.a)) <= 0.5 * r.a) & (abs(z.v_back - (r.v_back + shift * r.a)) <= 1.0 * r.a)).any())

        H["hit"] = [hit(r) for r in H.itertuples()]
        H["moved"] = [np.mean([hit(r, s) for s in (-1.5, 1.5)]) for r in H.itertuples()]
        for half, g in H.groupby("odd"):
            grid.append(dict(k=k, through=thr, touches=tmin, n=n, span=smin, look=look, anchor=anc, half="calib" if half else "check",
                             recall=g.hit.mean(), moved=g.moved.mean(), fidelity=g.hit.mean() - g.moved.mean(), lines=len(g)))
    G = pd.DataFrame(grid)
    cal = G[G.half == "calib"].sort_values("fidelity", ascending=False)
    best = cal.iloc[0]
    chk = G[(G.half == "check") & (G.k == best.k) & (G.through == best.through) & (G.touches == best.touches) &
            (G.n == best.n) & (G.span == best.span) & (G.look == best.look) & (G.anchor == best.anchor)].iloc[0]
    base = G[G.k == "last2"]
    out = [f"Fidelity of automatic trend lines to Ronnie's lines: {len(H)} lines of his near price "
           f"({(H.odd).sum()} calibration, {(~H.odd).sum()} check)",
           "top calibration cells:", cal.head(8).round(3).to_string(index=False), "",
           f"chosen on calibration: k {best.k}, through <= {best.through}, touches >= {best.touches}, top {best.n} per side, span >= {best.span}, look {best.look}, {best.anchor}",
           "mean fidelity by look-back: " + ", ".join(f"{k} {v:+.0%}" for k, v in G[G.k != "last2"].groupby("look").fidelity.mean().items())
           + "; by anchor: " + ", ".join(f"{k} {v:+.0%}" for k, v in G[G.k != "last2"].groupby("anchor").fidelity.mean().items()),
           f"  check half: recall {chk.recall:.0%}, moved lines {chk.moved:.0%}, fidelity {chk.fidelity:+.0%}",
           f"L-1's own drawer (the last two order-5 pivot lows if rising, highs if falling): "
           + "; ".join(f"{r.half} recall {r.recall:.0%} moved {r.moved:.0%}" for r in base.itertuples())]
    t = "\n".join(out)
    print(t)
    open("results/tv_line_fidelity.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
